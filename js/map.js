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

function getBasemapControlPosition() {
  // Phone + tablet (<= 991px): top right
  // Desktop: keep your current bottom left
  return window.matchMedia('(max-width: 991px)').matches ? 'topright' : 'bottomleft';
}

export function createMap(mapId) {
  const map = L.map(mapId, {
    center: MAP_CONFIG.center,
    zoom: MAP_CONFIG.zoom,
    scrollWheelZoom: MAP_CONFIG.scrollWheelZoom,
    layers: [cartoLayer]
  });

  initHoverTooltip(map);
  wireHoverTooltipToProjectsLayer();

  cartoLayer.addTo(map);
  projectsLayer.addTo(map);

  linesLayer.addTo(map).setWhere('1=0');
  polygonsLayer.addTo(map).setWhere('1=0');

  loadJurisdictionBoundary(BOUNDARY.url, BOUNDARY.style)
    .then((boundaryLayer) => boundaryLayer.addTo(map))
    .catch((err) => console.error('Failed to load jurisdiction boundary GeoJSON:', err));

  // Basemap switcher (responsive position)
  const basemapCtrl = L.basemapControl({
    position: getBasemapControlPosition(),
    layers: [
      { layer: cartoLayer, name: BASEMAPS.carto.label },
      { layer: satelliteLayer, name: BASEMAPS.satellite.label }
    ]
  }).addTo(map);

  // Keep position in sync on resize/orientation change
  const repositionBasemap = () => {
    const pos = getBasemapControlPosition();
    if (basemapCtrl && basemapCtrl.options && basemapCtrl.options.position !== pos) {
      basemapCtrl.setPosition(pos);
    }
  };

  window.addEventListener('resize', repositionBasemap, { passive: true });
  window.addEventListener('orientationchange', repositionBasemap, { passive: true });

  return map;
}
