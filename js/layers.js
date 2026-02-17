// js/layers.js


import { SERVICES, BASEMAPS, GEOMETRY_STYLES, PROJECT_INFO_FIELDS } from './config.js';
import { highlightState } from './utils.js';

export const cartoLayer = L.tileLayer(BASEMAPS.carto.url, BASEMAPS.carto.options);
export const satelliteLayer = L.tileLayer(BASEMAPS.satellite.url, BASEMAPS.satellite.options);


export const markerLookup = Object.create(null);


//Point feature
const PROJECT_FIELDS = [
  'OBJECTID',
  ...PROJECT_INFO_FIELDS.map(f => f.key)
];

export const projectsLayer = L.esri.Cluster.featureLayer({
  url: SERVICES.projectsPoints,
  fields: PROJECT_FIELDS,
  disableClusteringAtZoom: 17,
  spiderfyOnMaxZoom: true,
  removeOutsideVisibleBounds: true,
  useCors: true
});


// Populate markerLookup as features are created so deep-links can wait on markers.
projectsLayer.on('createfeature', function (e) {
  const objId =
    e?.feature?.properties?.OBJECTID ??
    e?.layer?.feature?.properties?.OBJECTID ??
    e?.target?.feature?.properties?.OBJECTID;

  if (objId != null && e?.layer) {
    markerLookup[Number(objId)] = e.layer;

    // Re-apply highlight if this marker was recreated by clustering
    const hid = highlightState.objectId;
    if (Number.isFinite(hid) && hid === Number(objId) && typeof e.layer.setIcon === 'function') {
      try {
        e.layer.setIcon(highlightState.selectedIcon ?? e.layer.options?.icon);
      } catch {}
    }
  }
});



function lineStyle() {
  return GEOMETRY_STYLES.lines;
}

function polygonStyle() {
  return GEOMETRY_STYLES.polygons;
}

export const linesLayer = L.esri.featureLayer({
  url: SERVICES.projectsLines,
  useCors: true,
  where: '1=0', // hidden initially
  simplifyFactor: 0,
  precision: 5,
  style: lineStyle
});

export const polygonsLayer = L.esri.featureLayer({
  url: SERVICES.projectsPolygons,
  useCors: true,
  where: '1=0', // hidden initially
  simplifyFactor: 0,
  precision: 5,
  style: polygonStyle
});


export let jurisdictionBoundaryLayer = null;
export let jurisdictionBoundaryReady = null;


export function loadJurisdictionBoundary(url, style) {
  if (jurisdictionBoundaryReady) return jurisdictionBoundaryReady;

  jurisdictionBoundaryReady = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Boundary fetch failed: ${r.status}`);
      return r.json();
    })
    .then((geojson) => {
      jurisdictionBoundaryLayer = L.geoJSON(geojson, { style });
      return jurisdictionBoundaryLayer;
    })
    .catch((err) => {
      jurisdictionBoundaryReady = null;
      jurisdictionBoundaryLayer = null;
      throw err;
    });

  return jurisdictionBoundaryReady;
}
