/**
 * @file HTML utility functions.
 */

/**
 * Escape HTML special characters to prevent XSS when interpolating into markup.
 * Returns '' for null/undefined; stringifies everything else (numbers, booleans, etc.).
 *
 * @param {*} str - Value to escape
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
