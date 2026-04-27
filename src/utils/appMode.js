/**
 * @file App Mode Detection
 * @description Detects the runtime mode of the application.
 *
 * Modes:
 * - 'viewer': Embedded data present, or running on file:// protocol.
 *   Read-only viewer with in-memory storage. OPFS and server unavailable.
 * - 'disk-persistence': Running on the local Python server (port 21845).
 *   Full editing with file-based persistence via /persist/ endpoints.
 * - 'local': Running on localhost/127.0.0.1. Full editing with OPFS.
 * - 'hosted': Running on a remote server. Full editing with OPFS.
 */

/** @type {number} The port used by the disk-persistence Python server. */
export const DISK_PERSIST_PORT = 21845;

/**
 * Detect the current application mode.
 * Localhost checks come first — embedded data on localhost is seed content
 * for OPFS/server import, not a reason to go read-only.
 * @returns {'viewer' | 'disk-persistence' | 'local' | 'hosted'}
 */
export function getAppMode() {
  if (location.protocol === 'file:') return 'viewer';
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocalhost && location.port === String(DISK_PERSIST_PORT)) return 'disk-persistence';
  if (isLocalhost) return 'local';
  if (document.getElementById('sc-embedded-data')?.textContent?.trim()) return 'viewer';
  return 'hosted';
}

/**
 * @returns {boolean} True if running in viewer mode
 */
export function isViewerMode() {
  return getAppMode() === 'viewer';
}

/**
 * @returns {boolean} True if running in disk-persistence mode (local Python server)
 */
export function isDiskPersistenceMode() {
  return getAppMode() === 'disk-persistence';
}

/**
 * @returns {boolean} True if drilldown should use breadcrumb navigation
 */
export function isBreadcrumbMode() {
  return isViewerMode() || localStorage.getItem('sc-breadcrumb-drilldown') === 'true';
}

/**
 * The navigation base for building URLs in the running app.
 *
 * In single-bundle builds the current HTML file is the entire app — the
 * pathname is the only valid entry point. In multi-page builds, BASE_URL
 * points at the directory containing index.html / loop.html.
 *
 * @param {'standard' | 'loop'} [sheetType] Only honored in multi-page builds
 * @returns {string}
 */
export function appBasePath(sheetType = 'standard') {
  if (import.meta.env.SC_SINGLE_BUNDLE) return window.location.pathname;
  return import.meta.env.BASE_URL + (sheetType === 'loop' ? 'loop.html' : 'index.html');
}

/**
 * Build a URL for navigating to a spreadsheet by id.
 *
 * In single-bundle builds (exported HTML, disk-persistence, served standalone) the
 * current HTML file is the entire app for all sheet types — navigation reuses
 * window.location.pathname. In multi-page builds, index.html / loop.html are
 * distinct entry points under BASE_URL.
 *
 * @param {string} id
 * @param {'standard' | 'loop'} [sheetType]
 * @param {Record<string, string>} [extraParams]
 * @returns {string} URL suitable for window.location.href
 */
export function sheetUrl(id, sheetType = 'standard', extraParams = {}) {
  const params = new URLSearchParams({ id, ...extraParams });
  return `${appBasePath(sheetType)}?${params.toString()}`;
}
