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
  renderProjectAttachments,
  getSidebarLngOffset
} from './utils.js';

import { renderDetailTable } from './ui/table.js';
import { fetchProjectById } from './services/projectsService.js';
import { UI_CONFIG } from './config.js';

// Module state

let lastOriginPaneId  = 'home';
let lastPaneId        = 'home';
let projectRouteToken = 0;
let isInitialLoad     = true;

// Hash helpers

function getHashId() {
  return window.location.hash.replace('#', '');
}

function isProjectHash(h) {
  return typeof h === 'string' && /^project-\d+$/.test(h);
}

function isPaneHash(h, cfg) {
  return !!h && cfg.some((p) => p?.id === h);
}

function isOriginPaneId(id, cfg) {
  const pane = cfg.find((p) => p.id === id);
  return !!pane && pane.kind !== 'detail';
}

// Config helpers

function getDetailPane(cfg) {
  return cfg.find((p) => p.kind === 'detail') ?? null;
}

function getPaneById(cfg, id) {
  return cfg.find((p) => p.id === id) ?? null;
}

// fitHomeToBoundary  (sidebar-aware)

async function fitHomeToBoundary(map) {
  try {
    if (jurisdictionBoundaryReady) await jurisdictionBoundaryReady;
  } catch {
    return;
  }

  const boundary = jurisdictionBoundaryLayer;
  if (!boundary?.getBounds) return;

  // Wait two frames so the sidebar has finished animating before we read its width
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  const bounds = boundary.getBounds();
  if (!bounds?.isValid?.()) return;

  const flyOpts = {
    padding:       UI_CONFIG.fitBoundsPadding,
    duration:      UI_CONFIG.flyBounds.duration,
    easeLinearity: UI_CONFIG.flyBounds.easeLinearity,
    noMoveStart:   true
  };

  if (window.innerWidth > UI_CONFIG.mobileBreakpoint) {
    const sidebarEl    = document.getElementById('sidebar');
    const sidebarWidth = sidebarEl?.getBoundingClientRect().width ?? 0;

    if (sidebarWidth > 0) {
      const mapWidth = map.getSize().x;
      const sw       = bounds.getSouthWest();
      const ne       = bounds.getNorthEast();
      const lngSpan  = ne.lng - sw.lng;

      // Shift the entire bounding box left so its visual centre lands in the
      // open portion of the map (right of the sidebar).
      const lngShift = ((sidebarWidth + UI_CONFIG.sidebarLngPad) / mapWidth) * lngSpan;

      map.flyToBounds(
        L.latLngBounds(
          L.latLng(sw.lat, sw.lng - lngShift),
          L.latLng(ne.lat, ne.lng - lngShift)
        ),
        flyOpts
      );
      return;
    }
  }

  map.flyToBounds(bounds, flyOpts);
}

// flyToMarkerFast  (sidebar-aware)

// Flies/pans to a marker, offsetting the destination longitude so the marker
// lands in the visible portion of the map rather than under the sidebar.
// Uses getSidebarLngOffset() from utils.js with the *target* zoom so the
// offset is accurate even when the map is about to change zoom levels.
function flyToMarkerFast(map, marker, zoom = UI_CONFIG.featureZoom) {
  if (!map || !marker || typeof marker.getLatLng !== 'function') return;

  const ll     = marker.getLatLng();
  const offset = getSidebarLngOffset(map, zoom);
  const target = L.latLng(ll.lat, ll.lng - offset);

  try {
    // If the raw (non-adjusted) point is already well inside the viewport,
    // a gentle pan is enough; otherwise do a full fly.
    if (map.getBounds().pad(-UI_CONFIG.nearViewportPad).contains(ll)) {
      map.panTo(target, { animate: true, duration: UI_CONFIG.panNear.duration });
    } else {
      map.flyTo(target, zoom, { animate: true, duration: UI_CONFIG.flyFull.duration, easeLinearity: UI_CONFIG.flyFull.easeLinearity });
    }
  } catch {
    map.flyTo(target, zoom, { animate: true, duration: UI_CONFIG.flyFull.duration, easeLinearity: UI_CONFIG.flyFull.easeLinearity });
  }

  // Unspider/uncollapse the cluster so the individual marker becomes visible
  const clusterGroup =
    projectsLayer?._cluster ??
    projectsLayer?._clusters ??
    projectsLayer?._markerCluster;

  if (clusterGroup && typeof clusterGroup.zoomToShowLayer === 'function') {
    clusterGroup.zoomToShowLayer(marker, () => {
      try {
        // Re-apply offset after the cluster animation settles
        map.panTo(L.latLng(ll.lat, ll.lng - getSidebarLngOffset(map, map.getZoom())), {
          animate: true,
          duration: UI_CONFIG.panRecentre.duration
        });
      } catch {}
    });
  }
}

// waitForMarker
//
// Resolves with the Leaflet marker for objectId once it appears in
// markerLookup, or null after timeoutMs if it never arrives.
//
// Relies purely on the layer's 'createfeature' and 'load' events rather than
// a polling loop — no repeated setTimeout ticks needed. A single setTimeout
// acts as the outer deadline so we never hang indefinitely.
function waitForMarker(objectId, timeoutMs = UI_CONFIG.markerWaitTimeoutMs) {
  const id = Number(objectId);

  return new Promise((resolve) => {
    // Fast path: marker already exists
    const existing = markerLookup[id];
    if (existing) return resolve(existing);

    let settled = false;

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        projectsLayer?.off?.('createfeature', onCreate);
        projectsLayer?.off?.('load', onLoad);
      } catch {}
      resolve(result);
    };

    // Fired each time the cluster layer creates an individual feature marker
    const onCreate = () => {
      const lyr = markerLookup[id];
      if (lyr) cleanup(lyr);
    };

    // Fired when a full tile/page of features has loaded — check again in case
    // the feature arrived in a batch without a per-feature createfeature event
    const onLoad = () => {
      const lyr = markerLookup[id];
      cleanup(lyr ?? null);
    };

    // Hard deadline: give up and resolve with null so callers never hang
    const deadline = setTimeout(() => cleanup(null), timeoutMs);

    try {
      projectsLayer?.on?.('createfeature', onCreate);
      projectsLayer?.on?.('load', onLoad);
    } catch {}
  });
}

// getObjectIdFromEsriClick

function getObjectIdFromEsriClick(e) {
  const id =
    e?.feature?.properties?.OBJECTID ??
    e?.layer?.feature?.properties?.OBJECTID ??
    e?.target?.feature?.properties?.OBJECTID;

  return id != null ? Number(id) : null;
}

// Detail pane helpers

function fillDetailTableFromFeature(detailPane, feature) {
  const tableId = detailPane?.detail?.tableId;
  const fields  = detailPane?.detail?.fields;
  if (!tableId || !Array.isArray(fields)) return;

  const tbody = document.querySelector(`#${tableId} tbody`);
  renderDetailTable(tbody, feature, fields);
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

  if (hostId !== 'project-attachments') {
    const host = document.getElementById(hostId);
    if (host) host.innerHTML = '';
    return;
  }

  renderProjectAttachments(objectId);
}

// ---------------------------------------------------------------------------
// Back button scroll-lift
//
// .pane-back-header is position:sticky directly inside .leaflet-sidebar-pane
// (which is a direct child of .leaflet-sidebar-content, the scroll root).
// This mirrors the W3Schools sticky pattern — no overflow between the sticky
// element and the scroll container, so it actually pins.
//
// wireBackHeaderObserver() plants a 1px sentinel immediately after the header.
// An IntersectionObserver watches it against the scroll root — the moment it
// leaves view, content is scrolling under the header and the blur class fires.
// ---------------------------------------------------------------------------

const _scrollObservers = new Map(); // paneId → { observer, sentinel }

function teardownScrollObserver(paneId) {
  const entry = _scrollObservers.get(paneId);
  if (!entry) return;
  entry.observer.disconnect();
  entry.sentinel.remove();
  _scrollObservers.delete(paneId);
}

function wireBackHeaderObserver(paneId) {
  const header = document.querySelector(`#${paneId} .pane-back-header`);
  if (!header) return;

  header.classList.remove('pane-back-header--scrolled');
  teardownScrollObserver(paneId);

  const scrollRoot = header.closest('.leaflet-sidebar-content');
  if (!scrollRoot) return;

  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'height:1px;width:100%;pointer-events:none;';
  header.insertAdjacentElement('afterend', sentinel);

  const observer = new IntersectionObserver(
    ([entry]) => {
      header.classList.toggle('pane-back-header--scrolled', !entry.isIntersecting);
    },
    { root: scrollRoot, threshold: 0 }
  );

  observer.observe(sentinel);
  _scrollObservers.set(paneId, { observer, sentinel });
}

function setBackButtonTarget(detailPane) {
  const btn = document.querySelector(`#${detailPane.id} .sidebar-back-button`);
  if (!btn) return;
  btn.dataset.backTarget = lastOriginPaneId;
  wireBackHeaderObserver(detailPane.id);
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

  if (projectsLayer?.setWhere) projectsLayer.setWhere(`OBJECTID = ${objectId}`);

  const markerPromise = waitForMarker(objectId);

  // If the marker is already in the lookup, fly immediately
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

  // When the marker eventually appears in the cluster, update position + icon
  markerPromise.then((marker) => {
    if (myToken !== projectRouteToken) return;
    if (!marker) return;

    flyToMarkerFast(map, marker);

    if (marker.feature) {
      fillDetailTableFromFeature(detailPane, marker.feature);
      highlightFeature(marker.feature);
    }

    const feature = marker.feature ?? featNow;
    const pn      = feature?.properties?.project_name;
    if (pn) showRelatedFeatures(pn, map, { fit: true });
  });
}

// handlePaneHash

function handlePaneHash(map, sidebar, paneId, cfg) {
  projectRouteToken++;

  const targetId      = paneId || 'home';
  const pane          = getPaneById(cfg, targetId);
  const home          = getPaneById(cfg, 'home');
  const resolvedPane  = pane ?? home;
  if (!resolvedPane) return;

  sidebar.open(resolvedPane.id);

  if (isOriginPaneId(resolvedPane.id, cfg)) {
    lastOriginPaneId = resolvedPane.id;
    lastPaneId       = resolvedPane.id;
  }

  // Wire scroll observer for any non-home pane that has a back header
  if (resolvedPane.kind !== 'home') {
    wireBackHeaderObserver(resolvedPane.id);
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

  if (resolvedPane.id === 'home' || isInitialLoad) fitHomeToBoundary(map);
}

// Public API

export function setupSidebarRouting(sidebar, map, sidebarConfig) {
  const cfg = Array.isArray(sidebarConfig) ? sidebarConfig : [];

  // Intercept pane-link clicks → set hash (let route() handle the rest)
  document.querySelectorAll('.sidebar-pane-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const paneId = link.getAttribute('href')?.slice(1);
      if (paneId) window.location.hash = paneId;
    });
  });

  // Project marker click → navigate to project hash
  projectsLayer?.on?.('click', (e) => {
    const objectId = getObjectIdFromEsriClick(e);
    if (!Number.isFinite(objectId)) return;

    const current = getHashId();
    const next    = `project-${objectId}`;

    // Track the pane we're navigating *away from* so the back button works
    if (isPaneHash(current, cfg)) {
      const pane = getPaneById(cfg, current);
      if (pane && pane.kind !== 'detail') {
        lastOriginPaneId = current;
        lastPaneId       = current;
      }
    }

    // Clicking the same project again while already on its detail pane:
    // re-open and re-fly without relying on a hashchange event 
    if (current === next) {
      projectRouteToken++;

      const detailPane = getDetailPane(cfg);
      if (!detailPane) return;

      sidebar.open(detailPane.id);
      setBackButtonTarget(detailPane);
      startDetailAttachments(detailPane, objectId);

      if (projectsLayer?.setWhere) projectsLayer.setWhere(`OBJECTID = ${objectId}`);

      window.location.hash = next;
      handleProjectHash(map, sidebar, cfg).catch(() => {});
      return;
    }

    window.location.hash = next;
  });

  // Central route handler 
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
  isInitialLoad = false;
  window.addEventListener('hashchange', route);
}

export function setLastOriginPane(paneId) {
  if (typeof paneId === 'string' && paneId) {
    lastOriginPaneId = paneId;
    lastPaneId       = paneId;
  }
}
