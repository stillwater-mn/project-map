// js/layers.js
// Creates and exports Leaflet/Esri layers used across the app.
// - Basemaps
// - Clustered projects points layer + marker lookup
// - Related geometry layers (lines/polygons) with styles from config
// - Jurisdiction boundary GeoJSON loader (cached)

import { SERVICES, BASEMAPS, GEOMETRY_STYLES } from './config.js';

/* -----------------------------------
   Base Maps
----------------------------------- */
export const cartoLayer = L.tileLayer(BASEMAPS.carto.url, BASEMAPS.carto.options);
export const satelliteLayer = L.tileLayer(BASEMAPS.satellite.url, BASEMAPS.satellite.options);

/* -----------------------------------
   Marker Lookup for Cluster
----------------------------------- */
export const markerLookup = Object.create(null);

/* -----------------------------------
   Clustered Projects Layer (Points)
----------------------------------- */
export const projectsLayer = L.esri.Cluster.featureLayer({
  url: SERVICES.projectsPoints,
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
  }
});

/* -----------------------------------
   Related Geometry Layers (Lines/Polygons)
   Styled via GEOMETRY_STYLES in config.js
----------------------------------- */

// Use style functions (more reliable across redraws)
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

/* -----------------------------------
   Jurisdiction Boundary (GeoJSON)
----------------------------------- */
export let jurisdictionBoundaryLayer = null;
export let jurisdictionBoundaryReady = null;

/**
 * Loads GeoJSON boundary once and caches both the promise and the layer.
 * @param {string} url
 * @param {object} style Leaflet path style
 * @returns {Promise<L.GeoJSON>}
 */
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
      // allow retry on next call
      jurisdictionBoundaryReady = null;
      jurisdictionBoundaryLayer = null;
      throw err;
    });

  return jurisdictionBoundaryReady;
}
