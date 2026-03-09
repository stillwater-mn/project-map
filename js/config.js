// js/config.js

export const APP_VERSION = '2026-03-09.1';



export const SERVICES = Object.freeze({
  // Clustered points layer (FeatureServer layer 1)
  projectsPoints:
    'https://services3.arcgis.com/eUyz58xtA1naNJoX/ArcGIS/rest/services/Current_Projects_Data_(Public)/FeatureServer/1',

  // Related geometry layers
  projectsLines:
    'https://services3.arcgis.com/eUyz58xtA1naNJoX/ArcGIS/rest/services/Current_Projects_Data_(Public)/FeatureServer/2',
  projectsPolygons:
    'https://services3.arcgis.com/eUyz58xtA1naNJoX/ArcGIS/rest/services/Current_Projects_Data_(Public)/FeatureServer/3'
});

export const MAP_CONFIG = Object.freeze({
  center: [45.05718292465032, -92.83309936523439],
  zoom: 13,
  scrollWheelZoom: true,
  zoomControl: false
});

export const BASEMAPS = Object.freeze({
  carto: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 19, attribution: '&copy; Carto' },
    label: 'Vector'
  },
  satellite: {
    type: 'esri',
    url: 'https://maps.co.washington.mn.us/arcgis/rest/services/Aerials/Aerials2024/MapServer',
    options: { maxZoom: 20, attribution: 'Washington County 2024' },
    label: 'Aerial',
    overlay: {
      type: 'tile',
      url: 'https://tiles.stadiamaps.com/tiles/stamen_toner_labels/{z}/{x}/{y}{r}.png',
      options: {
        minZoom: 0,
        maxZoom: 20,
        attribution: '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://www.stamen.com/" target="_blank">Stamen Design</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }
    }
  }
});

export const THEME = Object.freeze({
  accent: '#CC4529',
  boundary: '#111'
});

// Centralized geometry symbology (lines + polygons)
export const GEOMETRY_STYLES = Object.freeze({
  lines: Object.freeze({
    color: '#CC4529',
    weight: 6,
    opacity: 0.75
  }),

  polygons: Object.freeze({
    color: '#CC4529',
    weight: 3,
    opacity: 0.9,
    fillColor: '#CC4529',
    fillOpacity: 0.35
  })
});

// Only these fields appear in Project Info.
export const PROJECT_INFO_FIELDS = Object.freeze([
  { key: 'project_name', label: 'Project Name' },
  { key: 'project_type', label: 'Project Type' },
  { key: 'lead_agency', label: 'Lead Agency' },
  { key: 'summary', label: 'Summary' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'status', label: 'Project Status' },
  { key: 'project_mangager', label: 'Project Contact' },
  { key: 'url', label: 'View Project Page' }
]);

export const BOUNDARY = Object.freeze({
  url: 'data/jurisdiction_boundary.geojson',
  style: Object.freeze({
    color: THEME.boundary,
    weight: 3,
    opacity: 1,
    fillOpacity: 0
  })
});



















