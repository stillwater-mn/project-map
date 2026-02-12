// js/utils.js
import { linesLayer, polygonsLayer, projectsLayer, markerLookup } from './layers.js';
import { safeSqlString, escapeHtml } from './ui/format.js';
import { fetchProjectAttachments as fetchAttachmentsFromService } from './services/projectsService.js';

let currentHighlight = null;

let relatedRequestToken = 0;
let _attachmentsRequestToken = 0;

let _gallery = [];
let _galleryIndex = 0;
let _galleryObjectId = '';

let _highlightedMarker = null;
let _highlightedObjectId = null;

let _hoverTooltipEl = null;

// makeSelectedIcon
function makeSelectedIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
      <path d="M15 41.5c-.4 0-.8-.2-1.1-.6C11.5 37.8 3 26.6 3 17.2 3 9.1 8.9 2.5 15 2.5s12 6.6 12 14.7c0 9.4-8.5 20.6-10.9 23.7-.3.4-.7.6-1.1.6z"
            fill="#e11d48" stroke="#7f1d1d" stroke-width="1.5"/>
      <circle cx="15" cy="17" r="6.2" fill="#ffffff" stroke="#7f1d1d" stroke-width="1.5"/>
    </svg>
  `;

  return L.divIcon({
    className: 'project-marker-selected',
    html: svg.trim(),
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -36]
  });
}

const defaultBlueIcon = new L.Icon.Default();
const selectedRedIcon = makeSelectedIcon();

// expose icons for layers.js (no import cycle)
window.__projectSelectedIcon = selectedRedIcon;
window.__projectDefaultIcon = defaultBlueIcon;

// isImageContentType
function isImageContentType(ct) {
  return typeof ct === 'string' && ct.startsWith('image/');
}

// firstNonEmpty
function firstNonEmpty(arr) {
  return Array.isArray(arr) ? arr.find(Boolean) : null;
}

// isLeafletMarker
function isLeafletMarker(layer) {
  return !!layer && typeof layer.getLatLng === 'function' && typeof layer.setIcon === 'function';
}

// applyIconState
function applyIconState(layer, makeSelected) {
  if (!isLeafletMarker(layer)) return;

  try {
    layer.setIcon(makeSelected ? selectedRedIcon : defaultBlueIcon);
  } catch {}
}

// setHighlightedMarkerById
function setHighlightedMarkerById(objectId) {
  const id = Number(objectId);
  if (!Number.isFinite(id)) return;

  _highlightedObjectId = id;
  window.__highlightedObjectId = String(id);

  const marker = markerLookup[id];
  if (!marker) return;

  if (_highlightedMarker && _highlightedMarker !== marker) {
    applyIconState(_highlightedMarker, false);
  }

  applyIconState(marker, true);
  _highlightedMarker = marker;
}

// clearHighlightedMarker
function clearHighlightedMarker() {
  _highlightedObjectId = null;
  window.__highlightedObjectId = '';

  if (_highlightedMarker) {
    applyIconState(_highlightedMarker, false);
  }
  _highlightedMarker = null;
}

// initHoverTooltip
export function initHoverTooltip(map, { top = 12, right = 12 } = {}) {
  if (!map) return null;

  if (!_hoverTooltipEl) {
    _hoverTooltipEl = L.DomUtil.create('div', 'project-hover-tooltip', map.getContainer());
    _hoverTooltipEl.style.position = 'absolute';
    _hoverTooltipEl.style.top = `${top}px`;
    _hoverTooltipEl.style.right = `${right}px`;
    _hoverTooltipEl.style.zIndex = '1000';
    _hoverTooltipEl.style.display = 'none';
    _hoverTooltipEl.style.pointerEvents = 'none';
  }

  return _hoverTooltipEl;
}

// setHoverTooltip
export function setHoverTooltip(text) {
  if (!_hoverTooltipEl) return;
  const t = String(text ?? '').trim();
  _hoverTooltipEl.textContent = t;
  _hoverTooltipEl.style.display = t ? 'block' : 'none';
}

// hideHoverTooltip
export function hideHoverTooltip() {
  if (!_hoverTooltipEl) return;
  _hoverTooltipEl.style.display = 'none';
}

// wireHoverTooltipToProjectsLayer
export function wireHoverTooltipToProjectsLayer({
  format = (name) => `Click to view: ${name}`,
  fallbackName = 'Project'
} = {}) {
  if (!projectsLayer) return;

  if (projectsLayer.__hoverTooltipWired) return;
  projectsLayer.__hoverTooltipWired = true;

  projectsLayer.on('mouseover', (e) => {
    const props =
      e?.feature?.properties || e?.layer?.feature?.properties || e?.target?.feature?.properties;

    const name = props?.project_name || fallbackName;
    setHoverTooltip(format(name));
  });

  projectsLayer.on('mouseout', () => {
    hideHoverTooltip();
  });

  try {
    projectsLayer._map?.on?.('movestart zoomstart', hideHoverTooltip);
  } catch {}
}

// flyToFeature
export async function flyToFeature(map, feature, zoom = 18) {
  if (!map || !feature) return;

  const objectId = feature?.properties?.OBJECTID;

  if (objectId != null) {
    const marker = markerLookup[objectId];

    if (marker && typeof marker.getLatLng === 'function') {
      const clusterGroup =
        projectsLayer?._cluster || projectsLayer?._clusters || projectsLayer?._markerCluster;

      const zoomToShow =
        clusterGroup && typeof clusterGroup.zoomToShowLayer === 'function'
          ? clusterGroup.zoomToShowLayer.bind(clusterGroup)
          : null;

      if (zoomToShow) {
        await new Promise((resolve) => {
          zoomToShow(marker, () => resolve());
        });
      }

      map.flyTo(marker.getLatLng(), zoom, { animate: true });
      return;
    }
  }

  const geom = feature.geometry;
  if (!geom) return;

  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates || [];
    if (lat != null && lng != null) map.flyTo([lat, lng], zoom, { animate: true });
    return;
  }

  if (
    geom.type === 'LineString' ||
    geom.type === 'Polygon' ||
    geom.type === 'MultiPolygon' ||
    geom.type === 'MultiLineString'
  ) {
    const layer = L.geoJSON(feature);
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { animate: true, padding: [20, 20] });
    }
  }
}

// highlightFeature
export function highlightFeature(feature) {
  if (!feature) return;
  currentHighlight = feature;

  const objectId = feature?.properties?.OBJECTID;
  if (objectId != null) setHighlightedMarkerById(objectId);
}

// waitForEsriLayerLoad
function waitForEsriLayerLoad(layer, token) {
  return new Promise((resolve) => {
    if (!layer) return resolve([]);

    const done = () => {
      if (token !== relatedRequestToken) return resolve([]);
      const layers = typeof layer.getLayers === 'function' ? layer.getLayers() : [];
      resolve(layers || []);
    };

    if (typeof layer.once === 'function') {
      layer.once('load', done);
      setTimeout(done, 2500);
    } else {
      setTimeout(done, 250);
    }
  });
}

// showRelatedFeatures
export async function showRelatedFeatures(projectName, map, { fit = true } = {}) {
  if (!projectName || !map) return;

  const myToken = ++relatedRequestToken;
  const safeName = safeSqlString(projectName);

  if (linesLayer?.setWhere) linesLayer.setWhere(`project_name = '${safeName}'`);
  if (polygonsLayer?.setWhere) polygonsLayer.setWhere(`project_name = '${safeName}'`);

  const [lineLayers, polyLayers] = await Promise.all([
    waitForEsriLayerLoad(linesLayer, myToken),
    waitForEsriLayerLoad(polygonsLayer, myToken)
  ]);

  if (myToken !== relatedRequestToken) return;
  if (!fit) return;

  let bounds = null;

  const polyFeatures = polyLayers.map((l) => l?.feature).filter(Boolean);
  const lineFeatures = lineLayers.map((l) => l?.feature).filter(Boolean);

  if (polyFeatures.length) bounds = L.geoJSON(polyFeatures).getBounds();
  else if (lineFeatures.length) bounds = L.geoJSON(lineFeatures).getBounds();

  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, { animate: true, padding: [20, 20] });
  }
}

// resetRelatedFeatures
export function resetRelatedFeatures() {
  if (linesLayer?.setWhere) linesLayer.setWhere('1=0');
  if (polygonsLayer?.setWhere) polygonsLayer.setWhere('1=0');
}

// showOnlyProject
export function showOnlyProject(objectId) {
  if (projectsLayer && objectId != null) {
    projectsLayer.setWhere(`OBJECTID = ${objectId}`);
  }
}

// resetProjectFilter
export function resetProjectFilter() {
  if (projectsLayer) projectsLayer.setWhere('1=1');
}

// resetTableHighlights
export function resetTableHighlights() {
  currentHighlight = null;

  clearHighlightedMarker();

  relatedRequestToken++;
  resetRelatedFeatures();
  resetProjectFilter();
}

// ensureAttachmentModal
function ensureAttachmentModal() {
  if (document.getElementById('attachment-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'attachment-modal';
  modal.className = 'attachment-modal hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');

  modal.innerHTML = `
    <div class="attachment-modal__backdrop" data-close="1"></div>

    <div class="attachment-modal__panel" role="document">
      <button class="attachment-modal__close" type="button" aria-label="Close" data-close="1">×</button>

      <div class="attachment-modal__titleRow">
        <div class="attachment-modal__title" id="attachment-modal-title"></div>
        <div class="attachment-modal__counter" id="attachment-modal-counter"></div>
      </div>

      <div class="attachment-modal__content" id="attachment-modal-content"></div>

      <button class="attachment-modal__nav attachment-modal__prev" type="button" aria-label="Previous" id="attachment-modal-prev">‹</button>
      <button class="attachment-modal__nav attachment-modal__next" type="button" aria-label="Next" id="attachment-modal-next">›</button>

      <div class="attachment-modal__actions">
        <a class="attachment-modal__open" id="attachment-modal-open" href="#" target="_blank" rel="noopener">
          Open in new tab
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-close') === '1') closeAttachmentModal();
  });

  document.getElementById('attachment-modal-prev')?.addEventListener('click', () => galleryPrev());
  document.getElementById('attachment-modal-next')?.addEventListener('click', () => galleryNext());

  window.addEventListener('keydown', (e) => {
    const m = document.getElementById('attachment-modal');
    const isOpen = m && !m.classList.contains('hidden');
    if (!isOpen) return;

    if (e.key === 'Escape') closeAttachmentModal();
    if (e.key === 'ArrowLeft') galleryPrev();
    if (e.key === 'ArrowRight') galleryNext();
  });
}

// closeAttachmentModal
function closeAttachmentModal() {
  const modal = document.getElementById('attachment-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

// galleryPrev
function galleryPrev() {
  if (!_gallery || _gallery.length <= 1) return;
  _galleryIndex = (_galleryIndex - 1 + _gallery.length) % _gallery.length;
  renderGallerySlide();
}

// galleryNext
function galleryNext() {
  if (!_gallery || _gallery.length <= 1) return;
  _galleryIndex = (_galleryIndex + 1) % _gallery.length;
  renderGallerySlide();
}

// renderGallerySlide
function renderGallerySlide() {
  const titleEl = document.getElementById('attachment-modal-title');
  const counterEl = document.getElementById('attachment-modal-counter');
  const contentEl = document.getElementById('attachment-modal-content');
  const openEl = document.getElementById('attachment-modal-open');
  const prevBtn = document.getElementById('attachment-modal-prev');
  const nextBtn = document.getElementById('attachment-modal-next');

  if (!titleEl || !contentEl || !openEl || !counterEl || !prevBtn || !nextBtn) return;
  if (!_gallery || !_gallery.length) return;

  const slide = _gallery[_galleryIndex];
  titleEl.textContent = slide.name || 'Attachment';
  openEl.href = slide.url || '#';

  counterEl.textContent = _gallery.length > 1 ? `${_galleryIndex + 1} / ${_gallery.length}` : '';

  const showNav = _gallery.length > 1;
  prevBtn.style.display = showNav ? 'flex' : 'none';
  nextBtn.style.display = showNav ? 'flex' : 'none';

  contentEl.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'attachment-modal__img';
  img.src = slide.url;
  img.alt = slide.name || 'Attachment image';
  contentEl.appendChild(img);
}

// openAttachmentModal
function openAttachmentModal({ url, name, type, galleryIndex = null }) {
  const modal = document.getElementById('attachment-modal');
  const titleEl = document.getElementById('attachment-modal-title');
  const counterEl = document.getElementById('attachment-modal-counter');
  const contentEl = document.getElementById('attachment-modal-content');
  const openEl = document.getElementById('attachment-modal-open');
  const prevBtn = document.getElementById('attachment-modal-prev');
  const nextBtn = document.getElementById('attachment-modal-next');

  if (!modal || !titleEl || !contentEl || !openEl || !counterEl || !prevBtn || !nextBtn) return;

  if (Number.isFinite(galleryIndex) && _gallery.length) {
    _galleryIndex = galleryIndex;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    renderGallerySlide();
    modal.querySelector('.attachment-modal__close')?.focus?.();
    return;
  }

  titleEl.textContent = name || 'Attachment';
  counterEl.textContent = '';
  openEl.href = url || '#';
  prevBtn.style.display = 'none';
  nextBtn.style.display = 'none';

  contentEl.innerHTML = '';

  if (url && isImageContentType(type)) {
    const img = document.createElement('img');
    img.className = 'attachment-modal__img';
    img.src = url;
    img.alt = name || 'Attachment image';
    contentEl.appendChild(img);
  } else {
    const box = document.createElement('div');
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

// wireAttachmentModalClicks
function wireAttachmentModalClicks(host) {
  if (host._attachmentModalWired) return;
  host._attachmentModalWired = true;

  host.addEventListener('click', (e) => {
    const a = e.target?.closest?.('.js-attachment-open');
    if (!a) return;

    e.preventDefault();

    const url = a.getAttribute('data-url') || '';
    const name = a.getAttribute('data-name') || 'Attachment';
    const type = a.getAttribute('data-type') || 'file';

    const giRaw = a.getAttribute('data-gallery-index');
    const gi = giRaw != null ? Number(giRaw) : null;

    openAttachmentModal({
      url,
      name,
      type,
      galleryIndex: Number.isFinite(gi) ? gi : null
    });
  });
}

// renderProjectAttachments
export async function renderProjectAttachments(objectId, title = 'Attachments') {
  const host = document.getElementById('project-attachments');
  if (!host) return;

  ensureAttachmentModal();

  host.dataset.objectid = String(objectId);
  const myToken = ++_attachmentsRequestToken;

  host.innerHTML = `<div class="attachments-loading">Loading…</div>`;

  try {
    const infos = await fetchAttachmentsFromService(objectId);

    if (myToken !== _attachmentsRequestToken) return;
    if (host.dataset.objectid !== String(objectId)) return;

    const allInfos = infos || [];

    _galleryObjectId = String(objectId);
    _gallery = allInfos
      .filter((info) => info?.url && isImageContentType(info.contentType || ''))
      .map((info) => ({
        url: info.url,
        name: info.name || 'Attachment',
        type: info.contentType || 'image'
      }));

    if (!allInfos.length) {
      host.innerHTML = ` `;
      return;
    }

    const featuredImage = firstNonEmpty(_gallery);

    if (featuredImage) {
      const safeName = escapeHtml(featuredImage.name);
      const total = _gallery.length;

      const badge = total > 1 ? `<div class="attachment-count-badge">(1/${total})</div>` : '';
      const bg = featuredImage.url.replaceAll("'", "\\'");

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

    const featuredFile = firstNonEmpty(
      allInfos.map((info) => {
        const url = info?.url || '';
        if (!url) return null;
        return { url, name: info?.name || 'Attachment', type: info?.contentType || 'file' };
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
    if (myToken !== _attachmentsRequestToken) return;
    if (host.dataset.objectid !== String(objectId)) return;

    console.error(err);
    host.innerHTML = `
      <div class="attachments-header">${escapeHtml(title)}</div>
      <div class="attachments-error">Failed to load attachments.</div>
    `;
  }
}
