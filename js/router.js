// js/router.js
import {
  projectsLayer,
  markerLookup,
  jurisdictionBoundaryReady,
  jurisdictionBoundaryLayer
} from './layers.js';

import {
  highlightFeature,
  flyToFeature,
  showRelatedFeatures,
  resetTableHighlights,
  resetRelatedFeatures,
  resetProjectFilter,
  renderProjectAttachments
} from './utils.js';

import { escapeHtml, formatCellValue } from './ui/format.js';
import { fetchProjectById } from './services/projectsService.js';

let lastOriginPaneId = 'home';
let lastPaneId = 'home';
let projectRouteToken = 0;

// getHashId
function getHashId() {
  return window.location.hash.replace('#', '');
}

// isProjectHash
function isProjectHash(h) {
  return typeof h === 'string' && /^project-\d+$/.test(h);
}

// isPaneHash
function isPaneHash(h, cfg) {
  if (!h) return false;
  return cfg.some((p) => p?.id === h);
}

// isOriginPaneId
function isOriginPaneId(id, cfg) {
  const pane = cfg.find((p) => p.id === id);
  return !!pane && pane.kind !== 'detail';
}

// getDetailPane
function getDetailPane(cfg) {
  return cfg.find((p) => p.kind === 'detail') || null;
}

// getPaneById
function getPaneById(cfg, id) {
  return cfg.find((p) => p.id === id) || null;
}

// fitHomeToBoundary
async function fitHomeToBoundary(map) {
  try {
    if (jurisdictionBoundaryReady) await jurisdictionBoundaryReady;
  } catch {
    return;
  }

  const boundary = jurisdictionBoundaryLayer;
  if (!boundary || !boundary.getBounds) return;

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  const bounds = boundary.getBounds();
  if (!bounds?.isValid?.()) return;

  const sidebarEl = document.getElementById('sidebar');
  const sidebarWidth = sidebarEl ? sidebarEl.getBoundingClientRect().width : 0;
  const buffer = 180;

  const flyOpts = {
    padding: [20, 20],
    duration: 1.2,
    easeLinearity: 0.12,
    noMoveStart: true
  };

  if (window.innerWidth > 1100 && sidebarWidth > 0) {
    const mapWidth = map.getSize().x;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const lngSpan = ne.lng - sw.lng;
    const lngShift = ((sidebarWidth + buffer) / mapWidth) * lngSpan;

    const adjustedBounds = L.latLngBounds(
      L.latLng(sw.lat, sw.lng - lngShift),
      L.latLng(ne.lat, ne.lng - lngShift)
    );

    map.flyToBounds(adjustedBounds, flyOpts);
  } else {
    map.flyToBounds(bounds, flyOpts);
  }
}

// getObjectIdFromEsriClick
function getObjectIdFromEsriClick(e) {
  const id1 = e?.feature?.properties?.OBJECTID;
  if (id1 != null) return Number(id1);

  const id2 = e?.layer?.feature?.properties?.OBJECTID;
  if (id2 != null) return Number(id2);

  const id3 = e?.target?.feature?.properties?.OBJECTID;
  if (id3 != null) return Number(id3);

  return null;
}

// waitForMarker
function waitForMarker(objectId, timeoutMs = 1400) {
  const id = Number(objectId);

  return new Promise((resolve) => {
    const existing = markerLookup[id];
    if (existing) return resolve(existing);

    const start = Date.now();

    const onCreate = () => {
      const lyr = markerLookup[id];
      if (lyr) cleanup(lyr);
    };

    const onLoad = () => {
      const lyr = markerLookup[id];
      if (lyr) cleanup(lyr);
    };

    const tick = () => {
      const lyr = markerLookup[id];
      if (lyr) return cleanup(lyr);
      if (Date.now() - start > timeoutMs) return cleanup(null);
      setTimeout(tick, 70);
    };

    const cleanup = (result) => {
      try {
        projectsLayer?.off?.('createfeature', onCreate);
        projectsLayer?.off?.('load', onLoad);
      } catch {}
      resolve(result);
    };

    try {
      projectsLayer?.on?.('createfeature', onCreate);
      projectsLayer?.on?.('load', onLoad);
    } catch {}

    tick();
  });
}

// flyToMarkerFast
function flyToMarkerFast(map, marker, zoom = 18) {
  if (!map || !marker || typeof marker.getLatLng !== 'function') return;

  const ll = marker.getLatLng();

  try {
    if (map.getBounds().pad(-0.2).contains(ll)) {
      map.panTo(ll, { animate: true, duration: 0.22 });
    } else {
      map.flyTo(ll, zoom, { animate: true, duration: 0.45, easeLinearity: 0.3 });
    }
  } catch {
    map.flyTo(ll, zoom, { animate: true, duration: 0.45, easeLinearity: 0.3 });
  }

  const clusterGroup =
    projectsLayer?._cluster || projectsLayer?._clusters || projectsLayer?._markerCluster;

  if (clusterGroup && typeof clusterGroup.zoomToShowLayer === 'function') {
    clusterGroup.zoomToShowLayer(marker, () => {
      try {
        map.panTo(marker.getLatLng(), { animate: true, duration: 0.2 });
      } catch {}
    });
  }
}

// fillDetailTableFromFeature
function fillDetailTableFromFeature(detailPane, feature) {
  const tableId = detailPane?.detail?.tableId;
  const fields = detailPane?.detail?.fields;

  if (!tableId || !Array.isArray(fields)) return;

  const tbody = document.querySelector(`#${tableId} tbody`);
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
    row.innerHTML = `<td>${escapeHtml(label ?? key)}</td><td>${formatCellValue(val)}</td>`;
    tbody.appendChild(row);
  }

  if (!tbody.children.length) {
    tbody.innerHTML = `<tr><td colspan="2">No details available.</td></tr>`;
  }
}

// clearDetailAttachments
function clearDetailAttachments(detailPane) {
  const hostId = detailPane?.detail?.attachments?.hostId;
  if (!hostId) return;
  const host = document.getElementById(hostId);
  if (host) host.innerHTML = '';
}

// startDetailAttachments
function startDetailAttachments(detailPane, objectId) {
  const hostId = detailPane?.detail?.attachments?.hostId;
  if (!hostId) return;

  if (hostId !== 'project-attachments') {
    const host = document.getElementById(hostId);
    if (host) host.innerHTML = '';
    return;
  }

  renderProjectAttachments(objectId);
}

// setBackButtonTarget
function setBackButtonTarget(detailPane) {
  const backButton = document.querySelector(`#${detailPane.id} .sidebar-back-button`);
  if (!backButton) return;

  backButton.href = `#${lastOriginPaneId}`;
  backButton.onclick = (e) => {
    e.preventDefault();
    resetTableHighlights();
    window.location.hash = `#${lastOriginPaneId}`;
  };
}

// handleProjectHash
async function handleProjectHash(map, sidebar, cfg) {
  const detailPane = getDetailPane(cfg);
  if (!detailPane) return;

  const myToken = ++projectRouteToken;

  const match = window.location.hash.match(/^#project-(\d+)$/);
  if (!match) return;

  const objectId = Number(match[1]);
  if (!Number.isFinite(objectId)) return;

  sidebar.open(detailPane.id);
  setBackButtonTarget(detailPane);
  startDetailAttachments(detailPane, objectId);

  // filter to the one project again
  if (projectsLayer?.setWhere) {
    projectsLayer.setWhere(`OBJECTID = ${objectId}`);
  }

  const markerPromise = waitForMarker(objectId);

  const existingMarker = markerLookup[objectId];
  if (existingMarker) flyToMarkerFast(map, existingMarker);

  let featNow = null;

  try {
    const fields = Array.isArray(detailPane?.detail?.fields)
      ? detailPane.detail.fields.map((f) => f.key).filter(Boolean)
      : [];

    featNow = await fetchProjectById(objectId, fields);
    if (myToken !== projectRouteToken) return;

    if (featNow) {
      fillDetailTableFromFeature(detailPane, featNow);
      highlightFeature(featNow);

      if (!existingMarker) flyToFeature(map, featNow);

      const pn = featNow?.properties?.project_name;
      if (pn) showRelatedFeatures(pn, map, { fit: true });
    }
  } catch {}

  markerPromise.then((marker) => {
    if (myToken !== projectRouteToken) return;
    if (!marker) return;

    flyToMarkerFast(map, marker);

    if (marker.feature) {
      fillDetailTableFromFeature(detailPane, marker.feature);
      highlightFeature(marker.feature);
    }

    const feature = marker.feature || featNow;
    const pn = feature?.properties?.project_name;
    if (pn) showRelatedFeatures(pn, map, { fit: true });
  });
}

// handlePaneHash
function handlePaneHash(map, sidebar, paneId, cfg) {
  projectRouteToken++;

  const targetId = paneId || 'home';
  const pane = getPaneById(cfg, targetId);

  const home = getPaneById(cfg, 'home');
  const resolvedPane = pane || home;
  if (!resolvedPane) return;

  sidebar.open(resolvedPane.id);

  if (isOriginPaneId(resolvedPane.id, cfg)) {
    lastOriginPaneId = resolvedPane.id;
    lastPaneId = resolvedPane.id;
  }

  if (resolvedPane.where && projectsLayer?.setWhere) {
    projectsLayer.setWhere(resolvedPane.where);
  } else if (projectsLayer?.setWhere) {
    projectsLayer.setWhere('1=1');
  }

  resetRelatedFeatures();

  const detailPane = getDetailPane(cfg);
  if (detailPane && resolvedPane.id !== detailPane.id) {
    clearDetailAttachments(detailPane);
  }

  if (resolvedPane.id === 'home') fitHomeToBoundary(map);
}

// setupSidebarRouting
export function setupSidebarRouting(sidebar, map, sidebarConfig) {
  const cfg = Array.isArray(sidebarConfig) ? sidebarConfig : [];

  document.querySelectorAll('.sidebar-pane-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const paneId = link.getAttribute('href')?.slice(1);
      if (paneId) window.location.hash = paneId;
    });
  });

  projectsLayer?.on?.('click', (e) => {
    const objectId = getObjectIdFromEsriClick(e);
    if (!Number.isFinite(objectId)) return;

    const current = getHashId();
    const next = `project-${objectId}`;

    if (isPaneHash(current, cfg)) {
      const pane = getPaneById(cfg, current);
      if (pane && pane.kind !== 'detail') {
        lastOriginPaneId = current;
        lastPaneId = current;
      }
    }

    if (current === next) {
      projectRouteToken++;

      const detailPane = getDetailPane(cfg);
      if (!detailPane) return;

      sidebar.open(detailPane.id);
      setBackButtonTarget(detailPane);
      startDetailAttachments(detailPane, objectId);

      // re-apply filter immediately
      if (projectsLayer?.setWhere) projectsLayer.setWhere(`OBJECTID = ${objectId}`);

      window.location.hash = next;
      handleProjectHash(map, sidebar, cfg).catch(() => {});
      return;
    }

    window.location.hash = next;
  });

  const route = () => {
    const h = getHashId();

    if (!h) {
      handlePaneHash(map, sidebar, 'home', cfg);
      return;
    }

    if (isProjectHash(h)) {
      handleProjectHash(map, sidebar, cfg).catch(() => {});
      return;
    }

    resetProjectFilter();
    handlePaneHash(map, sidebar, h, cfg);
  };

  route();
  window.addEventListener('hashchange', route);

  window.__getLastPaneId = () => lastPaneId || 'home';
}

// setLastOriginPane
export function setLastOriginPane(paneId) {
  if (typeof paneId === 'string' && paneId) {
    lastOriginPaneId = paneId;
    lastPaneId = paneId;
  }
}
