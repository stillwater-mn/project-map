// js/ui/table.js


import { escapeHtml, formatCellValue } from './format.js';

/**
 * Populate a detail table tbody from a GeoJSON-like feature.
 *
 * Skips rows where the value is null/empty.
 * Guards against re-rendering the same OBJECTID twice (idempotent).
 *
 * @param {HTMLElement}  tbody
 * @param {object}       feature   — { properties: { OBJECTID, ... } }
 * @param {Array}        fields    — [{ key, label }, ...]
 */
export function renderDetailTable(tbody, feature, fields) {
  if (!tbody || !feature || !Array.isArray(fields)) return;

  const props    = feature?.properties ?? {};
  const objectId = props.OBJECTID;

  const table = tbody.closest('table');
  if (table?.dataset?.objectid && String(table.dataset.objectid) === String(objectId)) return;
  if (table) table.dataset.objectid = String(objectId ?? '');

  tbody.innerHTML = '';

  for (const { key, label } of fields) {
    const val = props?.[key];
    if (val == null || String(val).trim() === '') continue;

    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(label ?? key)}</td><td>${formatCellValue(val)}</td>`;
    tbody.appendChild(row);
  }

  if (!tbody.children.length) {
    tbody.innerHTML = `<tr><td colspan="2">No details available.</td></tr>`;
  }
}