// js/ui/format.js
export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatCellValue(val) {
  if (val == null) return '';
  const s = String(val);


  if (/^https?:\/\//i.test(s.trim())) {
    const safeUrl = escapeHtml(s.trim());
    return `<a class="project-link-btn" href="${safeUrl}" target="_blank" rel="noopener noreferrer">View Page</a>`;
  }


  return escapeHtml(s).replaceAll('\n', '<br>');
}

export function safeSqlString(val) {
  // Esri SQL string literal escaping: single quote -> doubled
  return String(val ?? '').replace(/'/g, "''");
}

export function esriErrorToString(err) {
  if (!err) return 'Unknown error';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.error && err.error.message) return err.error.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
