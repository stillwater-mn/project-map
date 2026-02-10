// js/sidebarBuilder.js
import { projectsLayer } from './layers.js';
import { PROJECT_INFO_FIELDS } from './config.js';

import {
  flyToFeature,
  highlightFeature,
  showRelatedFeatures,
  resetTableHighlights,
  renderProjectAttachments
} from './utils.js';

import { setLastOriginPane } from './router.js';
import { escapeHtml, formatCellValue, esriErrorToString } from './ui/format.js';
import { loadProjectsOnce, getFeaturesForPane, getCachedById } from './services/projectsService.js';

/* -----------------------------
   Generic DOM builders
----------------------------- */

function paneHeaderHTML(title) {
  return `
    <h1 class="leaflet-sidebar-header">
      ${escapeHtml(title)}
      <span class="leaflet-sidebar-close"><i class="fa fa-caret-left"></i></span>
    </h1>
  `;
}

function backButtonHTML() {
  return `<a href="#home" class="sidebar-back-button sidebar-pane-link">← Back</a>`;
}

function buildListTableHTML({ tableId, columns }) {
  const thead = columns
    .map((c) => `<th>${escapeHtml(c.label ?? c.key)}</th>`)
    .join('');

  return `
    <table class="project-table" id="${escapeHtml(tableId)}">
      <thead><tr>${thead}</tr></thead>
      <tbody></tbody>
    </table>
  `;
}

function buildDetailTableHTML({ tableId }) {
  return `
    <table class="project-table project-info-table" id="${escapeHtml(tableId)}">
      <thead><tr><th>Field</th><th>Value</th></tr></thead>
      <tbody></tbody>
    </table>
  `;
}

function showTableMessage(tbody, message) {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
}

/* -----------------------------
   Generic renderers
----------------------------- */

/**
 * Render a cell value as HTML:
 * - URLs => "View Link" button
 * - Everything else => escaped text
 */
function cellHTML(value) {
  if (value == null) return '';

  const s = String(value).trim();
  if (!s) return '';

  // URL -> "View Link" button
  if (/^https?:\/\//i.test(s)) {
    const safeHref = escapeHtml(s);
    return `
      <a
        class="project-link-btn"
        href="${safeHref}"
        target="_blank"
        rel="noopener noreferrer"
        onclick="event.stopPropagation()"
      >
        View Link
      </a>
    `;
  }

  return escapeHtml(s);
}

function renderListRows(tbody, features, columns) {
  if (!tbody) return;
  tbody.innerHTML = '';

  const frag = document.createDocumentFragment();

  for (const feature of features) {
    const props = feature?.properties || {};
    const objectId = props.OBJECTID;

    const tr = document.createElement('tr');
    tr.dataset.objectid = String(objectId ?? '');

    tr.innerHTML = columns
      .map((c) => {
        const raw = props?.[c.key];
        return `<td>${cellHTML(raw)}</td>`;
      })
      .join('');

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);
}

function renderDetailTableFromFeature(tbody, feature, fields) {
  if (!tbody) return;

  const props = feature?.properties || {};
  const objectId = props.OBJECTID;

  const table = tbody.closest('table');
  if (table?.dataset?.objectid && String(table.dataset.objectid) === String(objectId)) return;
  if (table) table.dataset.objectid = String(objectId ?? '');

  tbody.innerHTML = '';

  for (const { key, label } of fields) {
    const val = props?.[key];
    if (val == null || String(val).trim() === '') continue;

    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(label)}</td><td>${formatCellValue(val)}</td>`;
    tbody.appendChild(row);
  }

  if (!tbody.children.length) {
    tbody.innerHTML = `<tr><td colspan="2">No details available.</td></tr>`;
  }
}

/* -----------------------------
   Actions
----------------------------- */

/**
 * Open a detail route instantly from list click:
 * - open detail pane
 * - start attachments
 * - fill detail from cache if possible
 * - then set hash so router is canonical
 */
function openDetailInstant({ sidebar, map, originPaneId, objectId, detailPaneConfig }) {
  setLastOriginPane(originPaneId);

  sidebar.open(detailPaneConfig.id);

  // Back button will be handled by router; but keep highlight reset behavior
  resetTableHighlights();

  // Attachments (optional)
  const attachmentsHostId = detailPaneConfig?.detail?.attachments?.hostId;
  if (attachmentsHostId) renderProjectAttachments(objectId);

  // Fill table from cache if possible
  const tableId = detailPaneConfig?.detail?.tableId;
  const fields = detailPaneConfig?.detail?.fields || PROJECT_INFO_FIELDS;
  const tbody = tableId ? document.querySelector(`#${tableId} tbody`) : null;

  const feature = getCachedById(objectId);

  if (feature && tbody) {
    renderDetailTableFromFeature(tbody, feature, fields);

    highlightFeature(feature);
    flyToFeature(map, feature);

    const pn = feature?.properties?.project_name;
    if (pn) showRelatedFeatures(pn, map, { fit: true });
  } else if (tbody) {
    showTableMessage(tbody, 'Loading…');
  }

  // canonical route
  window.location.hash = `project-${objectId}`;
}

function wireListClickDelegation({
  tableId,
  sidebar,
  map,
  originPaneId,
  rowRoute,
  detailPaneConfig
}) {
  const table = document.getElementById(tableId);
  const tbody = table?.querySelector?.('tbody');
  if (!tbody) return;

  if (tbody._wired) return;
  tbody._wired = true;

  tbody.addEventListener('click', (e) => {
    // If user clicked a link/button inside the row, do NOT route
    if (e.target?.closest?.('a')) return;

    const tr = e.target?.closest?.('tr[data-objectid]');
    if (!tr) return;

    const objectId = Number(tr.dataset.objectid);
    if (!Number.isFinite(objectId)) return;

    const route = typeof rowRoute === 'function' ? rowRoute({ OBJECTID: objectId }) : null;

    if (route && String(route).startsWith('project-') && detailPaneConfig) {
      openDetailInstant({ sidebar, map, originPaneId, objectId, detailPaneConfig });
      return;
    }

    if (route) window.location.hash = `#${route}`;
  });
}

/* -----------------------------
   Build sidebar from config
----------------------------- */

export function buildSidebar(map, config) {
  const sidebar = L.control.sidebar({
    container: 'sidebar',
    autopan: true,
    closeButton: true
  }).addTo(map);

  // Identify your detail pane (first kind === 'detail')
  const detailPaneConfig = config.find((p) => p.kind === 'detail') || null;

  // Build panes
  for (const pane of config) {
    const tabContent =
      pane.id === 'home' ? `<i class="fa ${pane.tabIcon}"></i>` : `<i style="display:none"></i>`;

    const paneDiv = document.createElement('div');
    paneDiv.id = pane.id;
    paneDiv.className = 'leaflet-sidebar-pane';

    let bodyHTML = pane.content || '';

    if (pane.kind !== 'home') {
      // generic wrapper + back button
      let inner = `${backButtonHTML()}`;

      if (pane.kind === 'list') {
        inner += `
          <div style="margin-top:1rem;">
            ${buildListTableHTML(pane.list)}
          </div>
        `;
      }

      if (pane.kind === 'detail') {
        const hostId = pane?.detail?.attachments?.hostId;
        inner += `
          ${hostId ? `<div class="project-attachments" id="${escapeHtml(hostId)}" aria-live="polite"></div>` : ''}
          <div style="margin-top:1rem;">
            ${buildDetailTableHTML(pane.detail)}
          </div>
        `;
      }

      bodyHTML = `<div class="pane-body">${inner}</div>`;
    }

    paneDiv.innerHTML = paneHeaderHTML(pane.title) + bodyHTML;

    sidebar.addPanel({
      id: pane.id,
      tab: tabContent,
      pane: paneDiv,
      title: pane.title,
      skipTab: !!pane.skipTab
    });
  }

  // Back buttons reset highlights
  document.querySelectorAll('.sidebar-back-button').forEach((btn) => {
    btn.addEventListener('click', () => resetTableHighlights());
  });

  // Mark the home tab for CSS hiding (unchanged)
  requestAnimationFrame(() => {
    const tabLis = document.querySelectorAll('.leaflet-sidebar-tabs li');
    for (const li of tabLis) {
      const a = li.querySelector('a');
      if (a?.getAttribute('href') === '#home') {
        li.classList.add('tab-home');
        break;
      }
    }
  });

  // Preload cache
  loadProjectsOnce().catch((err) => {
    console.error('Failed to load project cache:', esriErrorToString(err), err);
  });

  // Wire list click delegation after cache is available (so instant open works)
  loadProjectsOnce()
    .then(() => {
      for (const pane of config) {
        if (pane.kind !== 'list') continue;
        const tableId = pane?.list?.tableId;
        if (!tableId) continue;

        wireListClickDelegation({
          tableId,
          sidebar,
          map,
          originPaneId: pane.id,
          rowRoute: pane?.list?.rowRoute,
          detailPaneConfig
        });
      }
    })
    .catch((err) => {
      console.error('Failed to wire table clicks:', esriErrorToString(err), err);
    });

  // Render list panes on open (data driven)
  sidebar.on('content', (e) => {
    const paneId = e?.id;
    if (!paneId) return;

    const pane = config.find((p) => p.id === paneId);
    if (!pane) return;

    // Apply map filter if defined (router is canonical, this is UX-friendly)
    if (pane.where && projectsLayer?.setWhere) projectsLayer.setWhere(pane.where);

    if (pane.kind !== 'list') return;

    const tableId = pane?.list?.tableId;
    const columns = pane?.list?.columns || [{ key: 'project_name', label: 'Project Name' }];

    const tbody = tableId ? document.querySelector(`#${tableId} tbody`) : null;
    if (!tbody) return;

    showTableMessage(tbody, 'Loading…');

    loadProjectsOnce()
      .then(() => {
        const features = getFeaturesForPane(pane.list); // uses pane.list.projectType
        renderListRows(tbody, features, columns);
      })
      .catch((err) => {
        console.error('Failed to render pane table:', esriErrorToString(err), err);
        showTableMessage(tbody, 'Failed to load projects');
      });
  });

  return sidebar;
}
