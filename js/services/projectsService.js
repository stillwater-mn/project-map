// js/services/projectsService.js
// Data access layer: cache + fetchById + attachments.
// No DOM, no sidebar, no routing.
//
// Upgrades:
// - Automatic cache-busting on schema changes (query param _v based on requested fields)
// - Optional TTL to refresh in-memory cache periodically
// - Cache load uses f=json + returnGeometry=false (attributes-only)

import { SERVICES, PROJECT_INFO_FIELDS, CACHE_CONFIG } from '../config.js';
import { safeSqlString } from '../ui/format.js';

let _cachePromise = null;

let _all = [];
let _byType = new Map();
let _byId = new Map();

let _cacheLoadedAt = 0;

/* -----------------------------
   Internal helpers
----------------------------- */

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
 * Convert Esri JSON FeatureSet -> GeoJSON-like features your UI expects:
 * { type:'Feature', properties:{...}, geometry:null }
 */
function normalizeEsriJsonToFeatures(esriJson) {
  const esriFeatures = esriJson?.features || [];
  return esriFeatures
    .map((f) => ({
      type: 'Feature',
      properties: f?.attributes || {},
      geometry: null
    }))
    .filter((f) => f?.properties?.OBJECTID != null);
}

/**
 * Deterministic "version" string based on requested fields.
 * If you add/remove/rename fields, this changes automatically => busts browser/proxy caches.
 */
function makeSchemaVersion(fieldKeys) {
  const keys = Array.isArray(fieldKeys) ? fieldKeys.filter(Boolean) : [];
  // stable + compact; no crypto needed
  return keys.join('|');
}

function shouldRefreshCache() {
  const ttlMs = Number(CACHE_CONFIG?.ttlMs ?? 0);
  if (!ttlMs || ttlMs <= 0) return false; // TTL disabled
  if (!_cacheLoadedAt) return true;
  return Date.now() - _cacheLoadedAt > ttlMs;
}

/* -----------------------------
   Cache loader (REST, attributes only)
----------------------------- */

async function loadCacheViaRestFetch() {
  const base = SERVICES.projectsPoints;
  if (!base) throw new Error('SERVICES.projectsPoints is not set');

  const queryUrl = `${base.replace(/\/+$/, '')}/query`;

  // Attributes-only cache. Keep this aligned with sidebar/detail usage.
  const fieldKeys = ['OBJECTID', ...PROJECT_INFO_FIELDS.map((f) => f.key)];
  const outFields = fieldKeys.join(',');
  const _v = makeSchemaVersion(fieldKeys);

  const params = new URLSearchParams({
    where: '1=1',
    outFields,
    returnGeometry: 'false',
    f: 'json',
    _v // cache-bust when schema changes
  });

  const url = `${queryUrl}?${params.toString()}`;

  const res = await fetch(url, { cache: 'no-store' }); // helps in some browsers/CDNs
  if (!res.ok) throw new Error(`REST query failed: ${res.status} ${res.statusText}`);

  const data = await res.json();

  if (data?.error) {
    const msg = data.error.message || 'ArcGIS REST error';
    const details = Array.isArray(data.error.details) ? ` (${data.error.details.join('; ')})` : '';
    throw new Error(msg + details);
  }

  const feats = normalizeEsriJsonToFeatures(data);
  buildIndexes(feats);

  _cacheLoadedAt = Date.now();

  return { all: _all, byType: _byType, byId: _byId };
}

/* -----------------------------
   Public API
----------------------------- */

/**
 * Load/cache projects once (list + quick lookup).
 * Auto-refreshes if TTL has elapsed.
 * Returns: { all, byType, byId }
 */
export function loadProjectsOnce() {
  const needsRefresh = shouldRefreshCache();

  if (_cachePromise && !needsRefresh) return _cachePromise;

  _cachePromise = (async () => {
    return await loadCacheViaRestFetch();
  })();

  // If it fails, allow retries later
  _cachePromise = _cachePromise.catch((err) => {
    _cachePromise = null;
    throw err;
  });

  return _cachePromise;
}

/**
 * Manual cache bust (call this after edits if you want instant refresh).
 */
export function invalidateProjectsCache() {
  _cachePromise = null;
  _cacheLoadedAt = 0;
  _all = [];
  _byType = new Map();
  _byId = new Map();
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
 * Fetch a single project (geometry needed for flyTo/highlight).
 * Attempts GeoJSON first; falls back to Esri JSON.
 * Also uses schema-based _v to bust caches when field lists change.
 */
export async function fetchProjectById(
  objectId,
  fields = PROJECT_INFO_FIELDS.map((f) => f.key)
) {
  const base = SERVICES.projectsPoints;
  if (!base) return null;

  const queryUrl = `${base.replace(/\/+$/, '')}/query`;
  const fieldKeys = ['OBJECTID', ...fields];
  const outFields = fieldKeys.join(',');
  const _v = makeSchemaVersion(fieldKeys);

  // Attempt 1: GeoJSON
  try {
    const p1 = new URLSearchParams({
      where: `OBJECTID = ${Number(objectId)}`,
      outFields,
      returnGeometry: 'true',
      f: 'geojson',
      _v
    });

    const r1 = await fetch(`${queryUrl}?${p1.toString()}`, { cache: 'no-store' });
    if (r1.ok) {
      const d1 = await r1.json();
      if (!d1?.error) return d1?.features?.[0] || null;
    }
  } catch {
    // fall through
  }

  // Attempt 2: Esri JSON fallback
  try {
    const p2 = new URLSearchParams({
      where: `OBJECTID = ${Number(objectId)}`,
      outFields,
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      _v
    });

    const r2 = await fetch(`${queryUrl}?${p2.toString()}`, { cache: 'no-store' });
    if (!r2.ok) return null;

    const d2 = await r2.json();
    if (d2?.error) return null;

    const f0 = d2?.features?.[0];
    if (!f0) return null;

    const attrs = f0.attributes || {};
    const g = f0.geometry;

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

/**
 * Build a safe where clause for a project_type value.
 */
export function buildWhereForProjectType(projectType) {
  if (!projectType) return '1=1';
  const safe = safeSqlString(projectType);
  return `project_type = '${safe}'`;
}

/**
 * Fetch attachment metadata for a project OBJECTID.
 */
export async function fetchProjectAttachments(objectId) {
  const base = SERVICES.projectsPoints;
  if (!base) return [];

  const url = `${base.replace(/\/+$/, '')}/queryAttachments`;
  const params = new URLSearchParams({
    objectIds: String(objectId),
    f: 'json',
    returnUrl: 'true'
  });

  const res = await fetch(`${url}?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`queryAttachments failed: ${res.status} ${res.statusText}`);

  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || 'Attachment query error');

  const group = data?.attachmentGroups?.find((g) => Number(g.parentObjectId) === Number(objectId));
  return group?.attachmentInfos || [];
}
