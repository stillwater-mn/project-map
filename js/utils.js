// js/utils.js
import { linesLayer, polygonsLayer, projectsLayer, markerLookup } from './layers.js';
import { safeSqlString, escapeHtml } from './ui/format.js';
import { fetchProjectAttachments as fetchAttachmentsFromService } from './services/projectsService.js';


export const highlightState = {
  objectId:     null,  // Number | null  — currently highlighted OBJECTID
  selectedIcon: null,  // set below after makeSelectedIcon()
  defaultIcon:  null   // set below after L.Icon.Default()
};



function makeSelectedIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
      <path d="M15 41.5c-.4 0-.8-.2-1.1-.6C11.5 37.8 3 26.6 3 17.2 3 9.1 8.9 2.5 15 2.5s12 6.6 12 14.7c0 9.4-8.5 20.6-10.9 23.7-.3.4-.7.6-1.1.6z"
            fill="#e11d48" stroke="#7f1d1d" stroke-width="1.5"/>
      <circle cx="15" cy="17" r="6.2" fill="#ffffff" stroke="#7f1d1d" stroke-width="1.5"/>
    </svg>
  `;
  return L.divIcon({
    className:   'project-marker-selected',
    html:        svg.trim(),
    iconSize:    [30, 42],
    iconAnchor:  [15, 42],
    popupAnchor: [0, -36]
  });
}

const defaultBlueIcon = new L.Icon.Default();
const selectedRedIcon = makeSelectedIcon();

// Expose on shared state so layers.js can read without a circular import
highlightState.selectedIcon = selectedRedIcon;
highlightState.defaultIcon  = defaultBlueIcon;


// Sidebar-aware centering


const MOBILE_BREAKPOINT = 1100; // px — matches router.js


export function getSidebarLngOffset(map, targetZoom) {
  if (!map || window.innerWidth <= MOBILE_BREAKPOINT) return 0;

  const sidebarEl    = document.getElementById('sidebar');
  const sidebarWidth = sidebarEl?.getBoundingClientRect().width ?? 0;
  if (!sidebarWidth) return 0;

  const zoom   = targetZoom ?? map.getZoom();
  const center = map.getCenter();

  // Project centre to pixel space at target zoom, shift right by half the
  // sidebar width, then unproject — the lng delta is the required offset.
  const centerPx  = map.project(center, zoom);
  const shiftedPx = L.point(centerPx.x + sidebarWidth / 2, centerPx.y);
  const shiftedLl = map.unproject(shiftedPx, zoom);

  return shiftedLl.lng - center.lng;
}

/** Returns an adjusted L.LatLng that compensates for sidebar occlusion. */
function adjustedLatLng(map, ll, targetZoom) {
  const offset = getSidebarLngOffset(map, targetZoom);
  return L.latLng(ll.lat, ll.lng - offset);
}


// Hover tooltip

let _hoverTooltipEl = null;

export function initHoverTooltip(map, { top = 12, right = 12 } = {}) {
  if (!map || _hoverTooltipEl) return _hoverTooltipEl;

  _hoverTooltipEl = L.DomUtil.create('div', 'project-hover-tooltip', map.getContainer());
  Object.assign(_hoverTooltipEl.style, {
    position:      'absolute',
    top:           `${top}px`,
    right:         `${right}px`,
    zIndex:        '1000',
    display:       'none',
    pointerEvents: 'none'
  });

  return _hoverTooltipEl;
}

export function setHoverTooltip(text) {
  if (!_hoverTooltipEl) return;
  const t = String(text ?? '').trim();
  _hoverTooltipEl.textContent = t;
  _hoverTooltipEl.style.display = t ? 'block' : 'none';
}

export function hideHoverTooltip() {
  if (_hoverTooltipEl) _hoverTooltipEl.style.display = 'none';
}

export function wireHoverTooltipToProjectsLayer({
  format       = (name) => `Click to view: ${name}`,
  fallbackName = 'Project'
} = {}) {
  if (!projectsLayer || projectsLayer.__hoverTooltipWired) return;
  projectsLayer.__hoverTooltipWired = true;

  projectsLayer.on('mouseover', (e) => {
    const props =
      e?.feature?.properties ??
      e?.layer?.feature?.properties ??
      e?.target?.feature?.properties;
    setHoverTooltip(format(props?.project_name || fallbackName));
  });

  projectsLayer.on('mouseout', () => hideHoverTooltip());

  try {
    projectsLayer._map?.on?.('movestart zoomstart', hideHoverTooltip);
  } catch {}
}


// Marker highlight state


let _highlightedMarker = null;

function isLeafletMarker(layer) {
  return (
    !!layer &&
    typeof layer.getLatLng === 'function' &&
    typeof layer.setIcon   === 'function'
  );
}

function applyIconState(layer, selected) {
  if (!isLeafletMarker(layer)) return;
  try { layer.setIcon(selected ? selectedRedIcon : defaultBlueIcon); } catch {}
}

function setHighlightedMarkerById(objectId) {
  const id = Number(objectId);
  if (!Number.isFinite(id)) return;

  highlightState.objectId = id;

  const marker = markerLookup[id];
  if (!marker) return;

  if (_highlightedMarker && _highlightedMarker !== marker) {
    applyIconState(_highlightedMarker, false);
  }

  applyIconState(marker, true);
  _highlightedMarker = marker;
}

function clearHighlightedMarker() {
  highlightState.objectId = null;
  if (_highlightedMarker) applyIconState(_highlightedMarker, false);
  _highlightedMarker = null;
}


// flyToFeature 


export async function flyToFeature(map, feature, zoom = 16) {
  if (!map || !feature) return;

  const objectId = feature?.properties?.OBJECTID;

  // Prefer the live cluster marker — it already exists on the map
  if (objectId != null) {
    const marker = markerLookup[objectId];

    if (marker && typeof marker.getLatLng === 'function') {
      const clusterGroup =
        projectsLayer?._cluster ??
        projectsLayer?._clusters ??
        projectsLayer?._markerCluster;

      if (clusterGroup && typeof clusterGroup.zoomToShowLayer === 'function') {
        await new Promise((resolve) => clusterGroup.zoomToShowLayer(marker, resolve));
      }

      map.flyTo(adjustedLatLng(map, marker.getLatLng(), zoom), zoom, { animate: true });
      return;
    }
  }

  const geom = feature.geometry;
  if (!geom) return;

  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates ?? [];
    if (lat != null && lng != null) {
      map.flyTo(adjustedLatLng(map, L.latLng(lat, lng), zoom), zoom, { animate: true });
    }
    return;
  }

  if (
    geom.type === 'LineString'      ||
    geom.type === 'MultiLineString' ||
    geom.type === 'Polygon'         ||
    geom.type === 'MultiPolygon'
  ) {
    const layer  = L.geoJSON(feature);
    const bounds = layer.getBounds();
    if (bounds?.isValid()) {
      map.fitBounds(bounds, { animate: true, padding: [20, 20] });
    }
  }
}


// highlightFeature


let currentHighlight = null;

export function highlightFeature(feature) {
  if (!feature) return;
  currentHighlight = feature;
  const objectId = feature?.properties?.OBJECTID;
  if (objectId != null) setHighlightedMarkerById(objectId);
}


// Related geometry layers


let relatedRequestToken = 0;

function waitForEsriLayerLoad(layer, token) {
  return new Promise((resolve) => {
    if (!layer) return resolve([]);

    const done = () => {
      if (token !== relatedRequestToken) return resolve([]);
      resolve(typeof layer.getLayers === 'function' ? layer.getLayers() : []);
    };

    if (typeof layer.once === 'function') {
      layer.once('load', done);
      setTimeout(done, 2500);
    } else {
      setTimeout(done, 250);
    }
  });
}

export async function showRelatedFeatures(projectName, map, { fit = true } = {}) {
  if (!projectName || !map) return;

  const myToken  = ++relatedRequestToken;
  const safeName = safeSqlString(projectName);

  if (linesLayer?.setWhere)    linesLayer.setWhere(`project_name = '${safeName}'`);
  if (polygonsLayer?.setWhere) polygonsLayer.setWhere(`project_name = '${safeName}'`);

  const [lineLayers, polyLayers] = await Promise.all([
    waitForEsriLayerLoad(linesLayer, myToken),
    waitForEsriLayerLoad(polygonsLayer, myToken)
  ]);

  if (myToken !== relatedRequestToken || !fit) return;

  const polyFeatures = polyLayers.map((l) => l?.feature).filter(Boolean);
  const lineFeatures = lineLayers.map((l) => l?.feature).filter(Boolean);

  let bounds = null;
  if (polyFeatures.length)      bounds = L.geoJSON(polyFeatures).getBounds();
  else if (lineFeatures.length) bounds = L.geoJSON(lineFeatures).getBounds();

  if (bounds?.isValid()) {
    map.fitBounds(bounds, { animate: true, padding: [20, 20] });
  }
}

export function resetRelatedFeatures() {
  if (linesLayer?.setWhere)    linesLayer.setWhere('1=0');
  if (polygonsLayer?.setWhere) polygonsLayer.setWhere('1=0');
}

export function resetProjectFilter() {
  if (projectsLayer) projectsLayer.setWhere('1=1');
}

export function resetTableHighlights() {
  currentHighlight = null;
  clearHighlightedMarker();
  relatedRequestToken++;
  resetRelatedFeatures();
  resetProjectFilter();
}


// Attachment gallery


let _attachmentsRequestToken = 0;
let _gallery      = [];
let _galleryIndex = 0;

function isImageContentType(ct) {
  return typeof ct === 'string' && ct.startsWith('image/');
}

function firstNonEmpty(arr) {
  return Array.isArray(arr) ? arr.find(Boolean) : null;
}

// -- Modal DOM (created once on first use) --

function ensureAttachmentModal() {
  if (document.getElementById('attachment-modal')) return;

  const modal = document.createElement('div');
  modal.id        = 'attachment-modal';
  modal.className = 'attachment-modal hidden';
  modal.setAttribute('role',        'dialog');
  modal.setAttribute('aria-modal',  'true');
  modal.setAttribute('aria-hidden', 'true');

  modal.innerHTML = `
    <div class="attachment-modal__backdrop" data-close="1"></div>
    <div class="attachment-modal__panel" role="document">
      <button class="attachment-modal__close" type="button" aria-label="Close" data-close="1">×</button>
      <div class="attachment-modal__titleRow">
        <div class="attachment-modal__title"   id="attachment-modal-title"></div>
        <div class="attachment-modal__counter" id="attachment-modal-counter"></div>
      </div>
      <div class="attachment-modal__content" id="attachment-modal-content"></div>
      <button class="attachment-modal__nav attachment-modal__prev" type="button" aria-label="Previous" id="attachment-modal-prev">‹</button>
      <button class="attachment-modal__nav attachment-modal__next" type="button" aria-label="Next"     id="attachment-modal-next">›</button>
      <div class="attachment-modal__actions">
        <a class="attachment-modal__open" id="attachment-modal-open" href="#" target="_blank" rel="noopener">
          Open in new tab
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target?.getAttribute?.('data-close') === '1') closeAttachmentModal();
  });

  document.getElementById('attachment-modal-prev')?.addEventListener('click', galleryPrev);
  document.getElementById('attachment-modal-next')?.addEventListener('click', galleryNext);

  window.addEventListener('keydown', (e) => {
    const m      = document.getElementById('attachment-modal');
    const isOpen = m && !m.classList.contains('hidden');
    if (!isOpen) return;
    if (e.key === 'Escape')     closeAttachmentModal();
    if (e.key === 'ArrowLeft')  galleryPrev();
    if (e.key === 'ArrowRight') galleryNext();
  });
}

function closeAttachmentModal() {
  const modal = document.getElementById('attachment-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function galleryPrev() {
  if (_gallery.length <= 1) return;
  _galleryIndex = (_galleryIndex - 1 + _gallery.length) % _gallery.length;
  renderGallerySlide();
}

function galleryNext() {
  if (_gallery.length <= 1) return;
  _galleryIndex = (_galleryIndex + 1) % _gallery.length;
  renderGallerySlide();
}

function renderGallerySlide() {
  const titleEl   = document.getElementById('attachment-modal-title');
  const counterEl = document.getElementById('attachment-modal-counter');
  const contentEl = document.getElementById('attachment-modal-content');
  const openEl    = document.getElementById('attachment-modal-open');
  const prevBtn   = document.getElementById('attachment-modal-prev');
  const nextBtn   = document.getElementById('attachment-modal-next');

  if (!titleEl || !contentEl || !openEl || !counterEl || !prevBtn || !nextBtn) return;
  if (!_gallery.length) return;

  const slide   = _gallery[_galleryIndex];
  const showNav = _gallery.length > 1;

  titleEl.textContent   = slide.name || 'Attachment';
  openEl.href           = slide.url  || '#';
  counterEl.textContent = showNav ? `${_galleryIndex + 1} / ${_gallery.length}` : '';
  prevBtn.style.display = showNav ? 'flex' : 'none';
  nextBtn.style.display = showNav ? 'flex' : 'none';

  contentEl.innerHTML = '';
  const img     = document.createElement('img');
  img.className = 'attachment-modal__img';
  img.src       = slide.url;
  img.alt       = slide.name || 'Attachment image';
  contentEl.appendChild(img);
}

function openAttachmentModal({ url, name, type, galleryIndex = null }) {
  const modal     = document.getElementById('attachment-modal');
  const titleEl   = document.getElementById('attachment-modal-title');
  const counterEl = document.getElementById('attachment-modal-counter');
  const contentEl = document.getElementById('attachment-modal-content');
  const openEl    = document.getElementById('attachment-modal-open');
  const prevBtn   = document.getElementById('attachment-modal-prev');
  const nextBtn   = document.getElementById('attachment-modal-next');

  if (!modal || !titleEl || !contentEl || !openEl || !counterEl || !prevBtn || !nextBtn) return;

  // Gallery mode
  if (Number.isFinite(galleryIndex) && _gallery.length) {
    _galleryIndex = galleryIndex;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    renderGallerySlide();
    modal.querySelector('.attachment-modal__close')?.focus?.();
    return;
  }

  // Single-file mode
  titleEl.textContent   = name || 'Attachment';
  counterEl.textContent = '';
  openEl.href           = url  || '#';
  prevBtn.style.display = 'none';
  nextBtn.style.display = 'none';

  contentEl.innerHTML = '';

  if (url && isImageContentType(type)) {
    const img     = document.createElement('img');
    img.className = 'attachment-modal__img';
    img.src       = url;
    img.alt       = name || 'Attachment image';
    contentEl.appendChild(img);
  } else {
    const box     = document.createElement('div');
    box.className = 'attachment-modal__filebox';
    box.innerHTML = `
      <div class="attachment-modal__filename">${escapeHtml(name || 'Attachment')}</div>
      <div class="attachment-modal__filetype">${escapeHtml(type || 'file')}</div>
      ${url ? '' : '<div class="attachment-modal__hint">No URL available for this attachment.</div>'}
    `;
    contentEl.appendChild(box);
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('.attachment-modal__close')?.focus?.();
}

function wireAttachmentModalClicks(host) {
  if (host._attachmentModalWired) return;
  host._attachmentModalWired = true;

  host.addEventListener('click', (e) => {
    const a = e.target?.closest?.('.js-attachment-open');
    if (!a) return;
    e.preventDefault();

    const url   = a.getAttribute('data-url')  || '';
    const name  = a.getAttribute('data-name') || 'Attachment';
    const type  = a.getAttribute('data-type') || 'file';
    const giRaw = a.getAttribute('data-gallery-index');
    const gi    = giRaw != null ? Number(giRaw) : null;

    openAttachmentModal({ url, name, type, galleryIndex: Number.isFinite(gi) ? gi : null });
  });
}

export async function renderProjectAttachments(objectId, title = 'Attachments') {
  const host = document.getElementById('project-attachments');
  if (!host) return;

  ensureAttachmentModal();

  host.dataset.objectid = String(objectId);
  const myToken = ++_attachmentsRequestToken;

  host.innerHTML = `<div class="attachments-loading">Loading…</div>`;

  try {
    const infos = await fetchAttachmentsFromService(objectId);

    if (myToken !== _attachmentsRequestToken)       return;
    if (host.dataset.objectid !== String(objectId)) return;

    const allInfos = infos || [];

    _gallery = allInfos
      .filter((info) => info?.url && isImageContentType(info.contentType || ''))
      .map((info) => ({
        url:  info.url,
        name: info.name        || 'Attachment',
        type: info.contentType || 'image'
      }));

    if (!allInfos.length) {
      host.innerHTML = ' ';
      return;
    }

    const featuredImage = firstNonEmpty(_gallery);

    if (featuredImage) {
      const safeName = escapeHtml(featuredImage.name);
      const total    = _gallery.length;
      const badge    = total > 1 ? `<div class="attachment-count-badge">(1/${total})</div>` : '';
      const bg       = featuredImage.url.replaceAll("'", "\\'");

      host.innerHTML = `
        <div class="attachments-featured">
          <a class="attachment-card attachment-featured js-attachment-open"
             href="${featuredImage.url}" target="_blank" rel="noopener"
             data-url="${featuredImage.url}"
             data-name="${safeName}"
             data-type="${featuredImage.type}"
             data-gallery-index="0">
            <div class="attachment-thumbwrap" style="--thumb-bg: url('${bg}')">
              <img class="attachment-thumb attachment-thumb--featured" src="${featuredImage.url}" alt="${safeName}">
              ${badge}
            </div>
          </a>
        </div>
      `;
      wireAttachmentModalClicks(host);
      return;
    }

    // Non-image file fallback
    const featuredFile = firstNonEmpty(
      allInfos.map((info) => {
        const url = info?.url || '';
        return url
          ? { url, name: info?.name || 'Attachment', type: info?.contentType || 'file' }
          : null;
      })
    );

    if (featuredFile) {
      const safeName = escapeHtml(featuredFile.name);
      const safeType = escapeHtml(featuredFile.type);

      host.innerHTML = `
        <div class="attachments-featured">
          <a class="attachment-card attachment-featured js-attachment-open"
             href="${featuredFile.url}" target="_blank" rel="noopener"
             data-url="${featuredFile.url}"
             data-name="${safeName}"
             data-type="${featuredFile.type}">
            <div class="attachment-file">
              <div class="attachment-name">${safeName}</div>
              <div class="attachment-type">${safeType}</div>
            </div>
          </a>
        </div>
      `;
      wireAttachmentModalClicks(host);
      return;
    }

    host.innerHTML = `
      <div class="attachments-header">${escapeHtml(title)}</div>
      <div class="attachments-empty">No viewable attachments.</div>
    `;

  } catch (err) {
    if (myToken !== _attachmentsRequestToken)       return;
    if (host.dataset.objectid !== String(objectId)) return;
    console.error(err);
    host.innerHTML = `
      <div class="attachments-header">${escapeHtml(title)}</div>
      <div class="attachments-error">Failed to load attachments.</div>
    `;
  }
}
