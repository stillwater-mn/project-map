// js/config.js

export const APP_VERSION = '2026-02-18.1';



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
  center: [45.0566, -92.8085],
  zoom: 12,
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
    
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 20,
      attribution:
        'Tiles &copy; Esri'
    },
    label: 'Satellite'
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













