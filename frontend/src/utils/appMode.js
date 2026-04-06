/**
 * @file App Mode Detection
 * @description Detects the runtime mode of the application.
 *
 * Modes:
 * - 'viewer': Embedded data present, or running on file:// protocol.
 *   Read-only viewer with in-memory storage. OPFS and server unavailable.
 * - 'local': Running on localhost/127.0.0.1. Full editing with OPFS.
 * - 'hosted': Running on a remote server. Full editing with OPFS.
 */

/**
 * Detect the current application mode.
 * Checks for embedded data first (a file:// page without data is still viewer mode).
 * @returns {'viewer' | 'local' | 'hosted'}
 */
export function getAppMode() {
  if (document.getElementById('sc-embedded-data')?.textContent?.trim()) return 'viewer';
  if (location.protocol === 'file:') return 'viewer';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'local';
  return 'hosted';
}

/**
 * @returns {boolean} True if running in viewer mode
 */
export function isViewerMode() {
  return getAppMode() === 'viewer';
}

/**
 * @returns {boolean} True if drilldown should use breadcrumb navigation
 */
export function isBreadcrumbMode() {
  return isViewerMode() || localStorage.getItem('sc-breadcrumb-drilldown') === 'true';
}
