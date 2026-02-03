// js/router.js
// Config-driven hash router:
// - Pane routes: #home, #pane-xyz
// - Project routes: #project-123
// Adds: fit-to-boundary on #home with sidebar offset on wide screens.
//
// Performance updates:
// - Do NOT filter clustered points layer on project route (no setWhere OBJECTID=...)
// - Start flying immediately (no waiting on cluster unwrap / marker creation)
// - Refine position when marker becomes available (tiny pan), and unwrap clusters in background
// - Keep cancellation token to prevent stale async work from applying

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

/* -----------------------------
   Routing state
----------------------------- */
let lastOriginPaneId = 'home';
let lastPaneId = 'home';

// cancel stale async project work
let projectRouteToken = 0;

/* -----------------------------
   Hash helpers
----------------------------- */
function getHashId() {
  return window.location.hash.replace('#', '');
}

function isProjectHash(h) {
  return typeof h === 'string' && /^project-\d+$/.test(h);
}

function isPaneHash(h, cfg) {
  if (!h) return false;
  return cfg.some((p) => p?.id === h);
}

function isOriginPaneId(id, cfg) {
  const pane = cfg.find((p) => p.id === id);
  return !!pane && pane.kind !== 'detail';
}

function getDetailPane(cfg) {
  return cfg.find((p) => p.kind === 'detail') || null;
}

function getPaneById(cfg, id) {
  return cfg.find((p) => p.id === id) || null;
}

/* -----------------------------
   Boundary fit on #home
----------------------------- */
async function fitHomeToBoundary(map) {
  try {
    if (jurisdictionBoundaryReady) {
      await jurisdictionBoundaryReady;
    }
  } catch {
    return;
  }

  const boundary = jurisdictionBoundaryLayer;
  if (!boundary || !boundary.getBounds) return;

  // Allow sidebar animation + DOM layout to settle
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

/* -----------------------------
   Robust OBJECTID extraction
----------------------------- */
function getObjectIdFromEsriClick(e) {
  const id1 = e?.feature?.properties?.OBJECTID;
  if (id1 != null) return Number(id1);

  const id2 = e?.layer?.feature?.properties?.OBJECTID;
  if (id2 != null) return Number(id2);

  const id3 = e?.target?.feature?.properties?.OBJECTID;
  if (id3 != null) return Number(id3);

  return null;
}

/**
 * Wait for a marker to exist in markerLookup (deep links can load before markers are created).
 * Uses createfeature/load listeners + polling, with short timeout (since we no longer block fly-to on it).
 */
function waitForMarker(objectId, timeoutMs = 1200) {
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

/**
 * Fast marker navigation:
 * - Fly immediately to marker latlng (no waiting)
 * - If cluster group exists, unwrap in background then micro-pan to final latlng
 */
function flyToMarkerFast(map, marker, zoom = 18) {
  if (!map || !marker || typeof marker.getLatLng !== 'function') return;

  const ll = marker.getLatLng();

  // If already mostly in view, pan is fastest
  try {
    if (map.getBounds().pad(-0.2).contains(ll)) {
      map.panTo(ll, { animate: true, duration: 0.22 });
    } else {
      map.flyTo(ll, zoom, { animate: true, duration: 0.45, easeLinearity: 0.3 });
    }
  } catch {
    map.flyTo(ll, zoom, { animate: true, duration: 0.45, easeLinearity: 0.3 });
  }

  // Unwrap clusters in background (do not await)
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

/* -----------------------------
   Detail rendering (config-driven)
----------------------------- */
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

function clearDetailAttachments(detailPane) {
  const hostId = detailPane?.detail?.attachments?.hostId;
  if (!hostId) return;

  const host = document.getElementById(hostId);
  if (host) host.innerHTML = '';
}

function startDetailAttachments(detailPane, objectId) {
  const hostId = detailPane?.detail?.attachments?.hostId;
  if (!hostId) return;

  // Your current utils.js renders into #project-attachments.
  if (hostId !== 'project-attachments') {
    const host = document.getElementById(hostId);
    if (host) host.innerHTML = '';
    return;
  }

  renderProjectAttachments(objectId);
}

/* -----------------------------
   Back button
----------------------------- */
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

/* -----------------------------
   Route handlers
----------------------------- */
async function handleProjectHash(map, sidebar, cfg) {
  const detailPane = getDetailPane(cfg);
  if (!detailPane) return;

  const myToken = ++projectRouteToken;

  const match = window.location.hash.match(/^#project-(\d+)$/);
  if (!match) return;

  const objectId = Number(match[1]);
  if (!Number.isFinite(objectId)) return;

  // Open detail pane immediately
  sidebar.open(detailPane.id);
  setBackButtonTarget(detailPane);

  // Attachments (async)
  startDetailAttachments(detailPane, objectId);

  // IMPORTANT: do NOT filter the clustered points layer here.
  // Filtering causes a server refresh + recluster and delays marker availability.

  // Start waiting for marker immediately (but we will not await it)
  const markerPromise = waitForMarker(objectId);

  // Optimistic: if marker already exists, fly now (instant)
  const existingMarker = markerLookup[objectId];
  if (existingMarker) {
    flyToMarkerFast(map, existingMarker);
  }

  // Fetch attributes/geometry (used for table + fallback flyTo + related geometry)
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

      // If we haven't flown yet (no marker), fly immediately via geometry
      if (!existingMarker) {
        flyToFeature(map, featNow);
      }

      const pn = featNow?.properties?.project_name;
      if (pn) showRelatedFeatures(pn, map, { fit: true });
    }
  } catch {
    // ignore
  }

  // Refine when marker becomes available (do not block)
  markerPromise.then((marker) => {
    if (myToken !== projectRouteToken) return;
    if (!marker) return;

    flyToMarkerFast(map, marker);

    // If marker has authoritative feature props, refresh table (once)
    if (marker.feature) {
      fillDetailTableFromFeature(detailPane, marker.feature);
      highlightFeature(marker.feature);
    }

    const feature = marker.feature || featNow;
    const pn = feature?.properties?.project_name;
    if (pn) showRelatedFeatures(pn, map, { fit: true });
  });
}

function handlePaneHash(map, sidebar, paneId, cfg) {
  // cancel in-flight project work when switching panes
  projectRouteToken++;

  const targetId = paneId || 'home';
  const pane = getPaneById(cfg, targetId);

  // If unknown pane, fall back to home if present
  const home = getPaneById(cfg, 'home');
  const resolvedPane = pane || home;
  if (!resolvedPane) return;

  sidebar.open(resolvedPane.id);

  // Track origin + last pane (origin is anything except detail)
  if (isOriginPaneId(resolvedPane.id, cfg)) {
    lastOriginPaneId = resolvedPane.id;
    lastPaneId = resolvedPane.id;
  }

  // Apply filter if pane defines where; else show all
  if (resolvedPane.where && projectsLayer?.setWhere) {
    projectsLayer.setWhere(resolvedPane.where);
  } else if (projectsLayer?.setWhere) {
    projectsLayer.setWhere('1=1');
  }

  // Clear related geometry when leaving project route
  resetRelatedFeatures();

  // Clear attachments when leaving detail pane
  const detailPane = getDetailPane(cfg);
  if (detailPane && resolvedPane.id !== detailPane.id) {
    clearDetailAttachments(detailPane);
  }

  // Fit boundary when on home
  if (resolvedPane.id === 'home') {
    fitHomeToBoundary(map);
  }
}

/* -----------------------------
   Setup
----------------------------- */
export function setupSidebarRouting(sidebar, map, sidebarConfig) {
  const cfg = Array.isArray(sidebarConfig) ? sidebarConfig : [];

  // Sidebar link clicks -> set hash
  document.querySelectorAll('.sidebar-pane-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const paneId = link.getAttribute('href')?.slice(1);
      if (paneId) window.location.hash = paneId;
    });
  });

  // Map point clicks -> project route
  projectsLayer?.on?.('click', (e) => {
    const objectId = getObjectIdFromEsriClick(e);
    if (!Number.isFinite(objectId)) return;

    const current = getHashId();
    const next = `project-${objectId}`;

    // Preserve origin if currently on a pane route
    if (isPaneHash(current, cfg)) {
      const pane = getPaneById(cfg, current);
      if (pane && pane.kind !== 'detail') {
        lastOriginPaneId = current;
        lastPaneId = current;
      }
    }

    // If already on this project, hashchange won't fire — refresh manually
    if (current === next) {
      // bump token so any in-flight route work cancels
      projectRouteToken++;

      const detailPane = getDetailPane(cfg);
      if (!detailPane) return;

      sidebar.open(detailPane.id);
      setBackButtonTarget(detailPane);
      startDetailAttachments(detailPane, objectId);

      // Maintain canonical hash and run handler explicitly
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

    // Pane navigation: ensure we aren't stuck on single-OBJECTID filter
    resetProjectFilter();
    handlePaneHash(map, sidebar, h, cfg);
  };

  // Initial load
  route();

  // Listen for hash changes
  window.addEventListener('hashchange', route);

  // Expose last pane if you want it elsewhere
  window.__getLastPaneId = () => lastPaneId || 'home';
}

/**
 * External setter (used by list clicks)
 */
export function setLastOriginPane(paneId) {
  if (typeof paneId === 'string' && paneId) {
    lastOriginPaneId = paneId;
    lastPaneId = paneId;
  }
}
