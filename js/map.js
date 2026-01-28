// js/map.js
import {
  cartoLayer,
  satelliteLayer,
  projectsLayer,
  linesLayer,
  polygonsLayer,
  loadJurisdictionBoundary
} from './layers.js';

import { MAP_CONFIG, BASEMAPS, BOUNDARY } from './config.js';
import { initHoverTooltip, wireHoverTooltipToProjectsLayer } from './utils.js';

export function createMap(mapId) {
  const map = L.map(mapId, {
    center: MAP_CONFIG.center,
    zoom: MAP_CONFIG.zoom,
    scrollWheelZoom: MAP_CONFIG.scrollWheelZoom,
    layers: [cartoLayer]
  });

  // Tooltip system (kept from your current setup)
  initHoverTooltip(map);
  wireHoverTooltipToProjectsLayer();

  // Primary layers
  cartoLayer.addTo(map);
  projectsLayer.addTo(map);

  // Related geometry layers (hidden until needed)
  linesLayer.addTo(map).setWhere('1=0');
  polygonsLayer.addTo(map).setWhere('1=0');

  // Boundary (no fitting here — router will fit when #home is active)
  loadJurisdictionBoundary(BOUNDARY.url, BOUNDARY.style)
    .then((boundaryLayer) => boundaryLayer.addTo(map))
    .catch((err) => console.error('Failed to load jurisdiction boundary GeoJSON:', err));

  // Basemap switcher
  L.basemapControl({
    position: 'bottomleft',
    layers: [
      { layer: cartoLayer, name: BASEMAPS.carto.label },
      { layer: satelliteLayer, name: BASEMAPS.satellite.label }
    ]
  }).addTo(map);

  return map;
}
