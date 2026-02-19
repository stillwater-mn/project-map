// js/services/projectsService.js


import { SERVICES, PROJECT_INFO_FIELDS } from '../config.js';
import { safeSqlString } from '../ui/format.js';

let _cachePromise = null;

let _all = [];
let _byType = new Map();
let _byId = new Map();

//internal helpers

function sortFeaturesByName(features) {
  const byName = (a, b) => {
    const an = (a?.properties?.project_name || '').toLowerCase();
    const bn = (b?.properties?.project_name || '').toLowerCase();
    return an.localeCompare(bn);
  };
  features.sort(byName);
}

function buildIndexes(features) {
  _all = (features || []).filter((f) => f?.properties?.OBJECTID != null);
  _byType = new Map();
  _byId = new Map();

  for (const f of _all) {
    const p = f.properties || {};
    const id = Number(p.OBJECTID);
    const type = p.project_type || 'Unknown';

    _byId.set(id, f);

    if (!_byType.has(type)) _byType.set(type, []);
    _byType.get(type).push(f);
  }

  sortFeaturesByName(_all);
  for (const [, arr] of _byType) sortFeaturesByName(arr);
}

/**
 * Convert Esri JSON FeatureSet (features[].attributes) into "GeoJSON-like" features
 * your UI already expects: feature.properties.*
 */
function normalizeEsriJsonToFeatures(esriJson) {
  const esriFeatures = esriJson?.features || [];
  return esriFeatures
    .map((f) => ({
      type: 'Feature',
      properties: f?.attributes || {},
      geometry: null // cache doesn't need geometry
    }))
    .filter((f) => f?.properties?.OBJECTID != null);
}

/* -----------------------------
   Cache loader (REST, attributes only)
----------------------------- */

async function loadCacheViaRestFetch() {
  const base = SERVICES.projectsPoints;
  if (!base) throw new Error('SERVICES.projectsPoints is not set');

  const queryUrl = `${base.replace(/\/+$/, '')}/query`;

  // Cache should be attributes-only for reliability & speed.
  // Do NOT use f=geojson here; it often fails depending on service settings.
  const outFields = ['OBJECTID', ...PROJECT_INFO_FIELDS.map((f) => f.key)].join(',');

  const params = new URLSearchParams({
    where: '1=1',
    outFields,
    returnGeometry: 'false',
    f: 'json'
  });

  const url = `${queryUrl}?${params.toString()}`;

  // 'no-store' prevents the browser from serving a stale HTTP-cached response
  // after our JS-level cache has expired (which would defeat the 5-min refresh).
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`REST query failed: ${res.status} ${res.statusText}`);

  const data = await res.json();

  if (data?.error) {
    const msg = data.error.message || 'ArcGIS REST error';
    const details = Array.isArray(data.error.details) ? ` (${data.error.details.join('; ')})` : '';
    throw new Error(msg + details);
  }

  const feats = normalizeEsriJsonToFeatures(data);
  buildIndexes(feats);

  return { all: _all, byType: _byType, byId: _byId };
}

/* -----------------------------
   Public API
----------------------------- */

/**
 * Always fetches fresh data from the service.
 * Use this wherever you need the list to reflect the current state of the
 * hosted feature layer view (e.g. the sidebar list on pane open).
 * Returns: { all, byType, byId }
 */
export async function loadProjectsFresh() {
  return await loadCacheViaRestFetch();
}

/**
 * Fetches once per page load and caches the result.
 * Use this only for fast-path operations where slightly stale data is
 * acceptable (e.g. pre-filling the detail table from cache on row click).
 * Returns: { all, byType, byId }
 */
export function loadProjectsOnce() {
  if (_cachePromise) return _cachePromise;

  _cachePromise = loadCacheViaRestFetch().catch((err) => {
    _cachePromise = null;
    throw err;
  });

  return _cachePromise;
}

/**
 * Get cached feature by OBJECTID (from attributes-only cache).
 */
export function getCachedById(objectId) {
  return _byId.get(Number(objectId)) || null;
}

/**
 * For sidebar pane list rendering.
 * Uses projectType from pane config to choose cached bucket.
 */
export function getFeaturesForPane(paneConfig) {
  if (!paneConfig?.projectType) return _all;
  return _byType.get(paneConfig.projectType) || [];
}

/**
 * Fetch a single project as GeoJSON (for map flyTo/highlight on deep links).
 * NOTE: This still uses f=geojson + returnGeometry=true because you need geometry.
 * If your service doesn't support geojson, we fall back to f=json and normalize.
 */
export async function fetchProjectById(
  objectId,
  fields = PROJECT_INFO_FIELDS.map((f) => f.key)
) {
  const base = SERVICES.projectsPoints;
  if (!base) return null;

  const queryUrl = `${base.replace(/\/+$/, '')}/query`;
  const outFields = ['OBJECTID', ...fields].join(',');

  // Attempt 1: GeoJSON (best for Leaflet geoJSON helpers)
  try {
    const p1 = new URLSearchParams({
      where: `OBJECTID = ${Number(objectId)}`,
      outFields,
      returnGeometry: 'true',
      f: 'geojson'
    });

    const r1 = await fetch(`${queryUrl}?${p1.toString()}`);
    if (r1.ok) {
      const d1 = await r1.json();
      if (!d1?.error) return d1?.features?.[0] || null;
      // if d1.error exists, fall through to JSON fallback
    }
  } catch {
    // fall through
  }

  // Attempt 2: Esri JSON fallback, normalize geometry to GeoJSON-like
  try {
    const p2 = new URLSearchParams({
      where: `OBJECTID = ${Number(objectId)}`,
      outFields,
      returnGeometry: 'true',
      outSR: '4326', // ensures geometry is in WGS84 for easy conversion
      f: 'json'
    });

    const r2 = await fetch(`${queryUrl}?${p2.toString()}`);
    if (!r2.ok) return null;

    const d2 = await r2.json();
    if (d2?.error) return null;

    const f0 = d2?.features?.[0];
    if (!f0) return null;

    const attrs = f0.attributes || {};
    const g = f0.geometry;

    // Convert Esri geometry to GeoJSON geometry (minimal, common cases)
    // - points: {x,y}
    // - polylines: {paths}
    // - polygons: {rings}
    let geometry = null;

    if (g && typeof g.x === 'number' && typeof g.y === 'number') {
      geometry = { type: 'Point', coordinates: [g.x, g.y] };
    } else if (g?.paths) {
      geometry = { type: 'MultiLineString', coordinates: g.paths };
    } else if (g?.rings) {
      geometry = { type: 'Polygon', coordinates: g.rings };
    }

    return {
      type: 'Feature',
      properties: attrs,
      geometry
    };
  } catch {
    return null;
  }
}

export function buildWhereForProjectType(projectType) {
  if (!projectType) return '1=1';
  const safe = safeSqlString(projectType);
  return `project_type = '${safe}'`;
}

export async function fetchProjectAttachments(objectId) {
  const base = SERVICES.projectsPoints;
  if (!base) return [];

  const url = `${base.replace(/\/+$/, '')}/queryAttachments`;
  const params = new URLSearchParams({
    objectIds: String(objectId),
    f: 'json',
    returnUrl: 'true'
  });

  const res = await fetch(`${url}?${params.toString()}`);
  if (!res.ok) throw new Error(`queryAttachments failed: ${res.status} ${res.statusText}`);

  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || 'Attachment query error');

  const group = data?.attachmentGroups?.find((g) => Number(g.parentObjectId) === Number(objectId));
  return group?.attachmentInfos || [];
}
