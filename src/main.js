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
import { getAppMode, sheetUrl } from './utils/appMode.js';
import { GRID_TEMPLATES } from './generated/grid-templates.js';
import { createMemoryOpfsService } from './Engines/memoryOpfsService.js';
import { createServerOpfsService } from './Engines/serverOpfsService.js';
import { createOpfsService } from './Engines/opfsService.js';
import { loadEmbeddedData } from './utils/embeddedDataLoader.js';
import { createPersistenceDialog } from './components/persistence-dialog.js';
import { createPersistentComponents } from './orchestrators/shared/orchestrator-shared.js';

// Track the visual viewport height as --viewport-height so the layout shrinks
// when the on-screen keyboard appears on mobile. On Android Chrome the layout
// viewport (and CSS dvh) does not shrink for the soft keyboard by default, so
// the bottom of the grid ends up behind the keyboard with no way to scroll to
// it. visualViewport.height reflects the actual visible area and resizes when
// the keyboard shows/hides.
if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const updateViewportHeight = () => {
    // Skip when pinch-zoomed: vv.height = layoutHeight / scale, which would
    // shrink #root to a fraction of the screen and leave blank space below
    // the app's bottom scrollbar.
    if (vv.scale === 1) {
      document.documentElement.style.setProperty('--viewport-height', `${vv.height}px`);
    } else {
      document.documentElement.style.removeProperty('--viewport-height');
    }
  };
  vv.addEventListener('resize', updateViewportHeight);
  updateViewportHeight();
}

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
// "+ New" sets ?new=standard|loop so we skip the entry-sheet auto-load and,
// in single-bundle exports (where loop.html doesn't exist), pick the right type.
const newSheetType = urlParams.get('new') === 'loop' ? 'loop'
  : urlParams.get('new') === 'standard' ? 'standard'
  : null;
const isNewSheetFlow = newSheetType !== null;

let drilldownConfig = null;
if (functionId) {
  try {
    drilldownConfig = {
      functionId: functionId || null,
      versionId: versionId || null,
      argValues: argsParam ? JSON.parse(argsParam) : []
    };
  } catch (e) {
    console.error(`${logPrefix} Failed to parse drill-down args:`, e);
  }
}

// Storage setup per mode:
// - viewer: in-memory (no persistence)
// - disk-persistence: server-backed via /persist/ endpoints
// - local/hosted: OPFS (initialized by orchestrator)
//
// If embedded data is present on localhost (exported HTML served locally),
// seed the storage on first load so the data carries over.
let preloadedOpfs = null;
let viewerEntryConfig = null;
const hasEmbeddedData = !!document.getElementById('sc-embedded-data')?.textContent?.trim();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Failed to find root container element');
}

// Seeding and unzipping embedded data can take a few seconds — show a spinner
// so the page isn't blank while we work.
function showBootOverlay(text) {
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  const label = document.createElement('span');
  label.className = 'import-overlay-text';
  label.textContent = text;
  overlay.appendChild(label);
  container.appendChild(overlay);
  return overlay;
}

// Decide whether the stored manifest is usable as-is, or if we need to re-seed
// from the embedded zip. A valid seeding lands entrySheetId in the manifest and
// leaves its sheet file readable; anything else is treated as stale/partial.
async function needsReseed(opfs, storedManifest) {
  if (Object.keys(storedManifest.sheets).length === 0) return true;
  if (!storedManifest.entrySheetId) return true;
  if (!storedManifest.sheets[storedManifest.entrySheetId]) return true;
  try {
    await opfs.loadSheet(storedManifest.entrySheetId);
    return false;
  } catch {
    return true;
  }
}

if (appMode === 'viewer') {
  const overlay = showBootOverlay('Loading\u2026');
  preloadedOpfs = createMemoryOpfsService();
  try {
    viewerEntryConfig = await loadEmbeddedData(preloadedOpfs);
  } finally {
    overlay.remove();
  }
} else if (appMode === 'disk-persistence' || (hasEmbeddedData && appMode === 'local')) {
  const isDiskPersistence = appMode === 'disk-persistence';
  preloadedOpfs = isDiskPersistence ? createServerOpfsService() : createOpfsService();
  await preloadedOpfs.init();
  if (hasEmbeddedData) {
    const manifest = await preloadedOpfs.readSheetManifest();
    if (await needsReseed(preloadedOpfs, manifest)) {
      const overlay = showBootOverlay('Preparing spreadsheet\u2026');
      try {
        const seeded = await loadEmbeddedData(preloadedOpfs);
        // First-time seed via "+ New": populate OPFS but stay on the blank sheet.
        if (!isNewSheetFlow) viewerEntryConfig = seeded;
      } finally {
        overlay.remove();
      }
    } else if (!spreadsheetId && !isNewSheetFlow && manifest.entrySheetId) {
      // OPFS already seeded and no explicit ?id= — recover entry from manifest.
      // Skip when ?new= is set: the user clicked "+ New" and expects a blank sheet.
      viewerEntryConfig = {
        entrySheetId: manifest.entrySheetId,
        entrySheetType: manifest.sheets[manifest.entrySheetId].type || 'standard',
      };
    }
  }
}

// ============================================================================
// ORCHESTRATOR + NAVIGATION LAYER
// ============================================================================

// Single-bundle exports are always built from index.html, so the initial DOM
// is standard-grid regardless of the exported file's name. For multi-page
// builds the pathname identifies the entry.
let currentSheetType = import.meta.env.SC_SINGLE_BUNDLE
  ? 'standard'
  : (isLoopSheet ? 'loop' : 'standard');

// Persistent components: created and mounted once, survive orchestrator swaps.
// Only the grid (whose DOM container changes) is recreated per orchestrator.
const persistentComponents = createPersistentComponents();

function mountPersistentComponents() {
  persistentComponents.header.mount(container.querySelector('.app-header'));
  persistentComponents.toolbar.mount(container.querySelector('.toolbar'));
  persistentComponents.formulaBar.mount(container.querySelector('.formula-bar'));
  persistentComponents.panels.mount({
    inputsPanel: container.querySelector('.inputs-panel'),
    outputsPanel: container.querySelector('.outputs-panel'),
  });
  persistentComponents.formatDialog.mount();
  persistentComponents.functionsDialog.mount();
  persistentComponents.namedRangesDialog.mount();
  persistentComponents.importDialog.mount();
  persistentComponents.dropZone.mount(container);
  persistentComponents.codeExportDialog.mount();
  persistentComponents.languagePackListDialog.mount();
  persistentComponents.languagePackEditor.mount();
  persistentComponents.findBar.mount(container);
}

function createOrchestrator(type, extraConfig = {}) {
  const factory = type === 'loop'
    ? createLoopSheetOrchestrator
    : createSpreadsheetOrchestrator;
  return factory({ ...extraConfig, ...breadcrumbCallbacks, ...viewerCallbacks, persistentComponents });
}

async function switchToSheetType(targetType) {
  if (targetType === currentSheetType) return;
  app.destroy();
  persistentComponents.header.reset();
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

mountPersistentComponents();
await app.mountUI(container);

// ============================================================================
// LOAD INITIAL CONTENT
// ============================================================================

if (drilldownConfig) {
  // Handled by orchestrator during mountUI — nothing else to load

} else if (newSheetType === 'loop' && currentSheetType !== 'loop') {
  // Single-bundle exports serve standard-grid HTML; swap orchestrator for + New Loop.
  await switchToSheetType('loop');

} else if (viewerEntryConfig?.entrySheetId) {
  // Viewer mode, or first-load seeded data in disk-persistence/local mode
  const targetType = viewerEntryConfig.entrySheetType === 'loop' ? 'loop' : 'standard';
  await switchToSheetType(targetType);

  try {
    await app.loadSpreadsheetFromOpfs(viewerEntryConfig.entrySheetId);
  } catch (error) {
    console.error(`${logPrefix} Failed to load entry sheet:`, error);
  }

} else if (importUrl) {
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
      window.location.href = sheetUrl(entrySheetId, entrySheetType);
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
  try {
    // In single-bundle builds the pathname can't disambiguate loop vs standard;
    // consult the manifest and swap orchestrator if the sheet type differs.
    if (import.meta.env.SC_SINGLE_BUNDLE && preloadedOpfs) {
      const manifest = await preloadedOpfs.readSheetManifest();
      const sheetType = manifest?.sheets?.[spreadsheetId]?.type;
      if ((sheetType === 'loop' || sheetType === 'standard') && sheetType !== currentSheetType) {
        await switchToSheetType(sheetType);
      }
    }
    await app.loadSpreadsheetFromOpfs(spreadsheetId);
  } catch (error) {
    console.error(`${logPrefix} Failed to load spreadsheet:`, error);
    alert(`Failed to load spreadsheet: ${error.message}`);
  }
}

window.spreadsheetApp = app;
setupKeyboardShortcuts(breadcrumbNav, persistentComponents.findBar);

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
  span.textContent = 'Viewer mode \u2014 changes aren\u2019t saved when you close the tab.';
  banner.appendChild(span);

  const persistenceDialog = createPersistenceDialog();
  const persistBtn = document.createElement('button');
  persistBtn.className = 'viewer-banner-btn';
  persistBtn.textContent = 'Set up auto-save';
  persistBtn.addEventListener('click', () => persistenceDialog.open());
  banner.appendChild(persistBtn);

  container.insertBefore(banner, container.firstChild);
}

/**
 * Set up keyboard shortcuts that live outside the orchestrator lifecycle.
 * @param {Object} breadcrumbNav - Breadcrumb navigation instance
 * @param {Object} findBar - Find bar component (persistent across swaps)
 */
function setupKeyboardShortcuts(breadcrumbNav, findBar) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (breadcrumbNav.hasTree()) {
        breadcrumbNav.navigateBack();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      findBar.open();
    }
  });
}
