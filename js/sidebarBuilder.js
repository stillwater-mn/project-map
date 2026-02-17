// js/sidebarBuilder.js
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
import { renderDetailTable } from './ui/table.js';
import { loadProjectsOnce, getFeaturesForPane, getCachedById } from './services/projectsService.js';

// DOM builders

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

// List row renderer
// Uses formatCellValue from format.js directly — no duplicate cellHTML needed

function renderListRows(tbody, features, columns) {
  if (!tbody) return;
  tbody.innerHTML = '';

  const frag = document.createDocumentFragment();

  for (const feature of features) {
    const props    = feature?.properties ?? {};
    const objectId = props.OBJECTID;

    const tr = document.createElement('tr');
    tr.dataset.objectid = String(objectId ?? '');

    tr.innerHTML = columns
      .map((c) => `<td>${formatCellValue(props?.[c.key])}</td>`)
      .join('');

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);
}

// Detail open — fast path from list click
//
// Fills the table immediately from cache so the UI feels instant, then sets
// the hash. The router takes over from there (flyTo, related features, etc.)
// — no duplication of that logic here.

function openDetailInstant({ sidebar, map, originPaneId, objectId, detailPaneConfig }) {
  setLastOriginPane(originPaneId);
  resetTableHighlights();
  sidebar.open(detailPaneConfig.id);

  // Attachments
  const attachmentsHostId = detailPaneConfig?.detail?.attachments?.hostId;
  if (attachmentsHostId) renderProjectAttachments(objectId);

  // Fill table from cache if available — purely a UX fast-path
  const tableId = detailPaneConfig?.detail?.tableId;
  const fields  = detailPaneConfig?.detail?.fields ?? PROJECT_INFO_FIELDS;
  const tbody   = tableId ? document.querySelector(`#${tableId} tbody`) : null;
  const feature = getCachedById(objectId);

  if (feature && tbody) {
    renderDetailTable(tbody, feature, fields);
    highlightFeature(feature);
    flyToFeature(map, feature);
    const pn = feature?.properties?.project_name;
    if (pn) showRelatedFeatures(pn, map, { fit: true });
  } else if (tbody) {
    showTableMessage(tbody, 'Loading…');
  }

  // Hand off to router — it is canonical for all subsequent state
  window.location.hash = `project-${objectId}`;
}

// List click delegation

function wireListClickDelegation({ tableId, sidebar, map, originPaneId, rowRoute, detailPaneConfig }) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody || tbody._wired) return;
  tbody._wired = true;

  tbody.addEventListener('click', (e) => {
    // Don't intercept clicks on links/buttons inside a row
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

// Build sidebar from config

export function buildSidebar(map, config) {
  const sidebar = L.control.sidebar({
    container:   'sidebar',
    autopan:     true,
    closeButton: true
  }).addTo(map);

  const detailPaneConfig = config.find((p) => p.kind === 'detail') ?? null;

  // Build panes
  for (const pane of config) {
    const tabContent =
      pane.id === 'home' ? `<i class="fa ${pane.tabIcon}"></i>` : `<i style="display:none"></i>`;

    const paneDiv = document.createElement('div');
    paneDiv.id        = pane.id;
    paneDiv.className = 'leaflet-sidebar-pane';

    let bodyHTML = pane.content || '';

    if (pane.kind !== 'home') {
      let inner = backButtonHTML();

      if (pane.kind === 'list') {
        inner += `<div style="margin-top:1rem;">${buildListTableHTML(pane.list)}</div>`;
      }

      if (pane.kind === 'detail') {
        const hostId = pane?.detail?.attachments?.hostId;
        inner += `
          ${hostId ? `<div class="project-attachments" id="${escapeHtml(hostId)}" aria-live="polite"></div>` : ''}
          <div style="margin-top:1rem;">${buildDetailTableHTML(pane.detail)}</div>
        `;
      }

      bodyHTML = `<div class="pane-body">${inner}</div>`;
    }

    paneDiv.innerHTML = paneHeaderHTML(pane.title) + bodyHTML;

    sidebar.addPanel({
      id:      pane.id,
      tab:     tabContent,
      pane:    paneDiv,
      title:   pane.title,
      skipTab: !!pane.skipTab
    });
  }

  // Back buttons reset highlights
  document.querySelectorAll('.sidebar-back-button').forEach((btn) => {
    btn.addEventListener('click', () => resetTableHighlights());
  });

  // Mark the home tab for CSS targeting
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

  // Single loadProjectsOnce chain: preload cache, then wire clicks
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
          originPaneId:     pane.id,
          rowRoute:         pane?.list?.rowRoute,
          detailPaneConfig
        });
      }
    })
    .catch((err) => {
      console.error('Failed to load project cache:', esriErrorToString(err), err);
    });

  // Render list panes on open
  sidebar.on('content', (e) => {
    const paneId = e?.id;
    if (!paneId) return;

    const pane = config.find((p) => p.id === paneId);
    if (!pane || pane.kind !== 'list') return;

    const tableId = pane?.list?.tableId;
    const columns = pane?.list?.columns ?? [{ key: 'project_name', label: 'Project Name' }];
    const tbody   = tableId ? document.querySelector(`#${tableId} tbody`) : null;
    if (!tbody) return;

    showTableMessage(tbody, 'Loading…');

    loadProjectsOnce()
      .then(() => {
        renderListRows(tbody, getFeaturesForPane(pane.list), columns);
      })
      .catch((err) => {
        console.error('Failed to render pane table:', esriErrorToString(err), err);
        showTableMessage(tbody, 'Failed to load projects');
      });
  });

  return sidebar;
}
