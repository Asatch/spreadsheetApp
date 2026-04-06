/**
 * Spreadsheet Application Entry Point
 *
 * Bootstraps either the standard spreadsheet or loop sheet orchestrator
 * based on which HTML page loaded this script.
 *
 * URL Parameters:
 * - ?drilldown=<functionId> or ?fn=<functionId> - Drill-down mode
 * - ?versionId=<versionId> - Optional: specific version UUID
 * - ?args=<JSON-encoded-array> - Optional: argument values for drill-down
 * - ?id=<spreadsheetId> - Load spreadsheet from OPFS
 * - ?import=<url> - Import a zip from URL into Downloads folder
 */

import { createSpreadsheetOrchestrator } from './orchestrators/spreadsheet-orchestrator.js';
import { createLoopSheetOrchestrator } from './orchestrators/loop-sheet-orchestrator.js';
import { createBreadcrumbNavigation } from './breadcrumb-navigation.js';
import { getAppMode } from './utils/appMode.js';
import { GRID_TEMPLATES } from './generated/grid-templates.js';
import { createMemoryOpfsService } from './Engines/memoryOpfsService.js';
import { loadEmbeddedData } from './utils/embeddedDataLoader.js';

// ============================================================================
// PARSE STARTUP CONFIG
// ============================================================================

const isLoopSheet = window.location.pathname.includes('loop');
const logPrefix = '[Main]';
const appMode = getAppMode();

const urlParams = new URLSearchParams(window.location.search);
const functionId = urlParams.get('drilldown') || urlParams.get('fn');
const versionId = urlParams.get('versionId');
const argsParam = urlParams.get('args');
const spreadsheetId = urlParams.get('id');
const importUrl = urlParams.get('import');

let drilldownConfig = null;
if (functionId) {
  try {
    drilldownConfig = {
      functionId: functionId || null,
      versionId: versionId || null,
      argValues: argsParam ? JSON.parse(argsParam) : []
    };
    console.log(`${logPrefix} Drill-down mode:`, drilldownConfig);
  } catch (e) {
    console.error(`${logPrefix} Failed to parse drill-down args:`, e);
  }
}

// Viewer mode: use in-memory OPFS instead of real browser OPFS
let preloadedOpfs = null;
let viewerEntryConfig = null;
if (appMode === 'viewer') {
  console.log(`${logPrefix} Viewer mode detected — loading embedded data`);
  preloadedOpfs = createMemoryOpfsService();
  viewerEntryConfig = await loadEmbeddedData(preloadedOpfs);
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Failed to find root container element');
}

// ============================================================================
// ORCHESTRATOR + NAVIGATION LAYER
// ============================================================================

let currentSheetType = isLoopSheet ? 'loop' : 'standard';

function createOrchestrator(type, extraConfig = {}) {
  const factory = type === 'loop'
    ? createLoopSheetOrchestrator
    : createSpreadsheetOrchestrator;
  return factory({ ...extraConfig, ...breadcrumbCallbacks, ...viewerCallbacks });
}

async function switchToSheetType(targetType) {
  if (targetType === currentSheetType) return;
  app.destroy();
  swapGridHtml(targetType);
  currentSheetType = targetType;
  app = createOrchestrator(targetType, { opfsService: preloadedOpfs });
  await app.mountUI(container);
  breadcrumbNav.setApp(app, targetType);
  window.spreadsheetApp = app;
}

// Breadcrumb navigation (survives orchestrator teardown)
const breadcrumbNav = createBreadcrumbNavigation();

const breadcrumbCallbacks = {
  onBreadcrumbDrilldown: (info) => breadcrumbNav.handleDrilldown(info),
  onBreadcrumbReset: (info) => breadcrumbNav.handleReset(info)
};

breadcrumbNav.setSwapHandler(switchToSheetType);

// Viewer mode: open sheets in-place instead of navigating via URL
const viewerCallbacks = appMode !== 'viewer' ? {} : {
  onOpenSpreadsheet: async (id, sheetType) => {
    breadcrumbNav.clearTree();
    await switchToSheetType(sheetType);
    await app.loadSpreadsheetFromOpfs(id);
  }
};

let app = createOrchestrator(currentSheetType, { drilldownConfig, opfsService: preloadedOpfs });

// ============================================================================
// MOUNT
// ============================================================================

if (appMode === 'viewer') {
  insertViewerBanner(container);
}

breadcrumbNav.mount(container);
breadcrumbNav.setApp(app, currentSheetType);

await app.mountUI(container);
console.log('='.repeat(60));
console.log(`SC ${isLoopSheet ? 'Loop Sheet' : 'Spreadsheet'} - Initialized${appMode === 'viewer' ? ' (Viewer Mode)' : ''}`);
console.log('='.repeat(60));

// ============================================================================
// LOAD INITIAL CONTENT
// ============================================================================

if (drilldownConfig) {
  // Handled by orchestrator during mountUI — nothing else to load

} else if (appMode === 'viewer' && viewerEntryConfig?.entrySheetId) {
  const targetType = viewerEntryConfig.entrySheetType === 'loop' ? 'loop' : 'standard';
  await switchToSheetType(targetType);

  try {
    await app.loadSpreadsheetFromOpfs(viewerEntryConfig.entrySheetId);
  } catch (error) {
    console.error(`${logPrefix} Failed to load viewer entry sheet:`, error);
  }

} else if (importUrl) {
  console.log(`${logPrefix} Importing from URL:`, importUrl);

  // Strip ?import= from URL so a refresh won't re-trigger
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('import');
  history.replaceState(null, '', cleanUrl.pathname + (cleanUrl.search || ''));

  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  const overlayText = document.createElement('span');
  overlayText.className = 'import-overlay-text';
  overlayText.textContent = 'Importing spreadsheet\u2026';
  overlay.appendChild(overlayText);
  container.appendChild(overlay);

  try {
    const { entrySheetId, entrySheetType, alreadyDownloaded } = await app.importFromUrl(importUrl);
    if (entrySheetId) {
      if (alreadyDownloaded) {
        overlayText.textContent = 'Already downloaded \u2014 opening\u2026';
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      const base = entrySheetType === 'loop' ? import.meta.env.BASE_URL + 'loop.html' : import.meta.env.BASE_URL + 'index.html';
      window.location.href = `${base}?id=${entrySheetId}`;
    } else {
      console.warn(`${logPrefix} No entry sheet found in imported zip`);
      showImportError(overlay, overlayText, 'No spreadsheet found in the imported file.');
    }
  } catch (error) {
    console.error(`${logPrefix} Failed to import from URL:`, error);
    const isNetworkError = error instanceof TypeError;
    const message = isNetworkError
      ? 'Could not download the spreadsheet. Check the URL and try again, or save the zip file and import it manually.'
      : 'Failed to import spreadsheet: ' + error.message;
    showImportError(overlay, overlayText, message);
  }

} else if (spreadsheetId) {
  console.log(`${logPrefix} Loading spreadsheet from OPFS:`, spreadsheetId);
  try {
    await app.loadSpreadsheetFromOpfs(spreadsheetId);
  } catch (error) {
    console.error(`${logPrefix} Failed to load spreadsheet:`, error);
    alert(`Failed to load spreadsheet: ${error.message}`);
  }
}

window.spreadsheetApp = app;
setupKeyboardShortcuts(breadcrumbNav);

// ============================================================================
// HELPERS
// ============================================================================

function swapGridHtml(targetSheetType) {
  const template = GRID_TEMPLATES[targetSheetType];

  const currentGridArea = container.querySelector('.grid-area-wrapper')
    || container.querySelector('.spreadsheet-grid-container');

  const temp = document.createElement('div');
  temp.innerHTML = template.gridHtml;
  const newGridArea = temp.firstElementChild;

  currentGridArea.parentNode.replaceChild(newGridArea, currentGridArea);

  const titleEl = container.querySelector('.app-title');
  if (titleEl) titleEl.textContent = template.appTitle;
}

function showImportError(overlay, textEl, message) {
  textEl.className = 'import-overlay-text import-overlay-error';
  textEl.textContent = message;
  const dismiss = document.createElement('button');
  dismiss.className = 'import-overlay-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => overlay.remove());
  overlay.appendChild(dismiss);
}

/**
 * Insert the viewer mode banner at the top of the container.
 * @param {HTMLElement} container - Root container element
 */
function insertViewerBanner(container) {
  const banner = document.createElement('div');
  banner.className = 'viewer-banner';
  const span = document.createElement('span');
  span.textContent = 'Viewer mode \u2014 changes won\u2019t be saved';
  banner.appendChild(span);
  container.insertBefore(banner, container.firstChild);
}

/**
 * Set up keyboard shortcuts that live outside the orchestrator lifecycle.
 * @param {Object} breadcrumbNav - Breadcrumb navigation instance
 */
function setupKeyboardShortcuts(breadcrumbNav) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (breadcrumbNav.hasTree()) {
        breadcrumbNav.navigateBack();
      }
    }
  });
}
