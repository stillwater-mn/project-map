// js/services/projectsService.js

import { SERVICES, PROJECT_INFO_FIELDS } from '../config.js';
import { safeSqlString } from '../ui/format.js';

let _cachePromise = null;

let _all = [];
let _byType = new Map();
let _byId = new Map();

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

async function fetchJson(url, { noStore = true } = {}) {
  const res = await fetch(url, {
    cache: noStore ? 'no-store' : 'default',
    headers: noStore ? { 'Cache-Control': 'no-cache' } : undefined
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data?.error) {
    const msg = data.error.message || 'ArcGIS REST error';
    const details = Array.isArray(data.error.details)
      ? ` (${data.error.details.join('; ')})`
      : '';
    throw new Error(msg + details);
  }

  return data;
}

async function loadCacheViaRestFetch() {
  const base = SERVICES.projectsPoints;
  if (!base) throw new Error('SERVICES.projectsPoints is not set');

  const queryUrl = `${base.replace(/\/+$/, '')}/query`;

  const outFields = ['OBJECTID', ...PROJECT_INFO_FIELDS.map((f) => f.key)].join(',');

  const params = new URLSearchParams({
    where: '1=1',
    outFields,
    returnGeometry: 'false',
    f: 'json'
  });

  const data = await fetchJson(`${queryUrl}?${params.toString()}`, { noStore: true });

  const feats = normalizeEsriJsonToFeatures(data);
  buildIndexes(feats);

  return { all: _all, byType: _byType, byId: _byId };
}

export function loadProjectsOnce() {
  if (_cachePromise) return _cachePromise;

  _cachePromise = (async () => {
    return await loadCacheViaRestFetch();
  })();

  _cachePromise = _cachePromise.catch((err) => {
    _cachePromise = null;
    throw err;
  });

  return _cachePromise;
}

export async function refreshProjectsCache() {
  _cachePromise = null;
  return await loadProjectsOnce();
}

export function getCachedById(objectId) {
  return _byId.get(Number(objectId)) || null;
}

export function getFeaturesForPane(paneConfig) {
  if (!paneConfig?.projectType) return _all;
  return _byType.get(paneConfig.projectType) || [];
}

export async function fetchProjectById(
  objectId,
  fields = PROJECT_INFO_FIELDS.map((f) => f.key)
) {
  const base = SERVICES.projectsPoints;
  if (!base) return null;

  const queryUrl = `${base.replace(/\/+$/, '')}/query`;
  const outFields = ['OBJECTID', ...fields].join(',');

  try {
    const p1 = new URLSearchParams({
      where: `OBJECTID = ${Number(objectId)}`,
      outFields,
      returnGeometry: 'true',
      f: 'geojson',
      _ts: String(Date.now())
    });

    const d1 = await fetchJson(`${queryUrl}?${p1.toString()}`, { noStore: true });
    return d1?.features?.[0] || null;
  } catch {}

  try {
    const p2 = new URLSearchParams({
      where: `OBJECTID = ${Number(objectId)}`,
      outFields,
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      _ts: String(Date.now())
    });

    const d2 = await fetchJson(`${queryUrl}?${p2.toString()}`, { noStore: true });

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

    return { type: 'Feature', properties: attrs, geometry };
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
    returnUrl: 'true',
    _ts: String(Date.now())
  });

  const data = await fetchJson(`${url}?${params.toString()}`, { noStore: true });

  const group = data?.attachmentGroups?.find(
    (g) => Number(g.parentObjectId) === Number(objectId)
  );

  return group?.attachmentInfos || [];
}
