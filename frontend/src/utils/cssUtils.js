/**
 * Escape special characters for use in CSS string values.
 * Handles backslashes and quotes to prevent CSS parsing errors.
 * @param {string} str - Text to escape
 * @returns {string} - Escaped text safe for CSS strings
 */
export function escapeCSSString(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
