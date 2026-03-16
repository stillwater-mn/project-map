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
import { loadProjectsOnce, loadProjectsFresh, getFeaturesForPane, getCachedById } from './services/projectsService.js';

// DOM builders

function paneHeaderHTML(title) {
  return `
    <h1 class="leaflet-sidebar-header">
      ${escapeHtml(title)}
      <span class="leaflet-sidebar-close"><svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </h1>
  `;
}

function backButtonHTML() {
  return `<button type="button" class="sidebar-back-button" aria-label="Go back" data-back-target="home"><svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Back</button>`;
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
      pane.id === 'home'
        ? `<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="14" height="1.8" rx="0.9" fill="currentColor"/><rect x="2" y="8.1" width="14" height="1.8" rx="0.9" fill="currentColor"/><rect x="2" y="12.2" width="14" height="1.8" rx="0.9" fill="currentColor"/></svg>`
        : `<i style="display:none"></i>`;

    const paneDiv = document.createElement('div');
    paneDiv.id        = pane.id;
    paneDiv.className = 'leaflet-sidebar-pane';

    let bodyHTML = pane.content || '';

    if (pane.kind !== 'home') {
      let inner = '';

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

      bodyHTML = `<div class="pane-back-header">${backButtonHTML()}</div><div class="pane-body">${inner}</div>`;
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

  // Back button — delegated click handler, reads data-back-target set by router
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.sidebar-back-button');
    if (!btn) return;
    const target = btn.dataset.backTarget ?? 'home';
    resetTableHighlights();
    window.location.hash = target;
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


  loadProjectsOnce().catch((err) => {
    console.warn('Startup project cache preload failed (will retry on pane open):', esriErrorToString(err));
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

    loadProjectsFresh()
      .then(() => {
        renderListRows(tbody, getFeaturesForPane(pane.list), columns);
        wireListClickDelegation({
          tableId,
          sidebar,
          map,
          originPaneId:     pane.id,
          rowRoute:         pane?.list?.rowRoute,
          detailPaneConfig
        });
      })
      .catch((err) => {
        console.error('Failed to render pane table:', esriErrorToString(err), err);
        showTableMessage(tbody, 'Failed to load projects. Please try again.');
      });
  });

  return sidebar;
}
