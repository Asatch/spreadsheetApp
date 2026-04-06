/**
 * @file Spreadsheet Orchestrator
 * @description Main coordination hub following v3 architecture.
 * Creates storage, instantiates all modules, wires dependencies, and provides coordination.
 */

import {
  createEngines,
  createComponents,
  initializeModules,
  createIdenticalModuleConfigs,
  createBaseClipboardConfig,
  createBaseFormulaBarConfig,
  createBasePanelsConfig,
  createBaseGridConfig,
  createBaseFormattingEngineConfig,
  createBaseCanonicalValuesEngineConfig,
  createBaseStorageEngineConfig,
  createBaseHeaderConfig,
  fetchAndImportFromUrl,
} from './shared/orchestrator-shared.js';
import { createOpfsService } from '../Engines/opfsService.js';
import { createFunctionCompiler } from '../Engines/functionCompiler.js';
import { createOrchestrationCore } from './shared/orchestration-core.js';

/**
 * Creates and initializes the spreadsheet orchestrator.
 *
 * This is the main entry point for the spreadsheet application. It creates all engines,
 * components, and wires them together following the v3 architecture pattern.
 *
 * @param {Object} [config={}] - Configuration options
 * @param {number} [config.maxHistorySize=50] - Maximum number of history states to maintain
 * @returns {{
 *   mountUI: function(HTMLElement): void,
 *   setValue: function(string, string): void,
 *   getValue: function(string): *,
 *   destroy: function(): void
 * }} Public API for the spreadsheet with methods:
 *   - mountUI: Mounts the UI to a container element
 *   - setValue: Sets a cell value programmatically
 *   - getValue: Gets the calculated value of a cell
 *   - destroy: Cleans up and unmounts the spreadsheet
 */
export function createSpreadsheetOrchestrator(config = {}) {
  // ============================================================================
  // MUTABLE ENGINE/COMPONENT REFERENCES (recreated on reload)
  // ============================================================================

  let canonicalValuesEngine = null;
  let formattingEngine = null;
  let calculationEngine = null;
  let clipboardEngine = null;
  let storageEngine = null;
  let historyEngine = null;
  let scenarioEngine = null;
  let languagePackEngine = null;
  let formulaBar = null;
  let panels = null;
  let grid = null;
  let header = null;
  let toolbar = null;
  let formatDialog = null;
  let functionsDialog = null;
  let namedRangesDialog = null;
  let importDialog = null;
  let dropZone = null;
  let codeExportDialog = null;
  let languagePackListDialog = null;
  let languagePackEditor = null;
  let functionCompiler = null;
  let core = null;

  // OPFS service (persistent across reloads, initialized once)
  let opfsService = null;
  let opfsInitialized = false;

  // Source data for FormattingEngine (recreated on reload)
  let sourceData = null;

  // Spreadsheet name (displayed in header, used in export)
  let spreadsheetName = 'Untitled';

  // ============================================================================
  // INITIALIZATION FUNCTION (called on create and reload)
  // ============================================================================

  function initializeAll() {
    console.log('[Orchestrator] Initializing all engines and components...');

    // Create fresh source data
    sourceData = {
      formatRules: new Map(),
      cellStyles: new Map(),
      spreadsheetDefaults: {}
    };

    // Create all engines and components using shared factories
    const engines = createEngines();
    canonicalValuesEngine = engines.canonicalValuesEngine;
    formattingEngine = engines.formattingEngine;
    calculationEngine = engines.calculationEngine;
    storageEngine = engines.storageEngine;
    historyEngine = engines.historyEngine;
    clipboardEngine = engines.clipboardEngine;
    scenarioEngine = engines.scenarioEngine;
    languagePackEngine = engines.languagePackEngine;

    const components = createComponents();
    formulaBar = components.formulaBar;
    panels = components.panels;
    grid = components.grid;
    header = components.header;
    toolbar = components.toolbar;
    formatDialog = components.formatDialog;
    functionsDialog = components.functionsDialog;
    namedRangesDialog = components.namedRangesDialog;
    importDialog = components.importDialog;
    dropZone = components.dropZone;
    codeExportDialog = components.codeExportDialog;
    languagePackListDialog = components.languagePackListDialog;
    languagePackEditor = components.languagePackEditor;

    // Create function compiler (needs storageEngine methods)
    functionCompiler = createFunctionCompiler({
      loadFunctionFromOpfs: (id) => storageEngine.loadFunction(id),
    });

    // ============================================================================
    // CENTRAL FUNCTIONS (via orchestration core)
    // ============================================================================

    // Create and initialize orchestration core
    core = createOrchestrationCore();

    core.init({
      // Engines
      canonicalValuesEngine,
      formattingEngine,
      calculationEngine,
      storageEngine,
      historyEngine,
      clipboardEngine,
      // Components
      toolbar,
      grid,
      formulaBar,
      panels,
      header,
      importDialog,
      codeExportDialog,
      languagePackListDialog,
      // Services
      functionCompiler,
      // Adapters
      adapters: {
        setBatch: (entries) => canonicalValuesEngine.setBatch(entries),
      },
      // Config
      config: {
        logPrefix: '[Orchestrator]',
        defaultName: 'Untitled',
        basePath: import.meta.env.BASE_URL,
        sheetType: 'standard',
      },
      // Hooks
      hooks: {
        getName: () => spreadsheetName,
        setName: (name) => { spreadsheetName = name; },
        getScenarios: () => panels.getScenarios(),
        getOpfsService: () => opfsService,
        onBreadcrumbReset: config.onBreadcrumbReset,
        onOpenSpreadsheet: config.onOpenSpreadsheet,
      },
    });

    // ============================================================================
    // CALLBACKS (shared + orchestrator-specific)
    // ============================================================================

    const callbacks = {
      ...core.getSharedCallbacks(),

      // Breadcrumb drilldown (injected from main.js, may be undefined)
      onBreadcrumbDrilldown: config.onBreadcrumbDrilldown,

      // canonicalValuesEngine callbacks
      onValueChange: (changedInfo) => {
        formattingEngine.beginBatch();
        calculationEngine.processInputs(changedInfo);
        formattingEngine.endBatch();
        panels.refreshOutputs();
        storageEngine.markDirty();
      },
      recordChanges: (mapName, keys) => historyEngine.recordChanges(mapName, keys),

      // formattingEngine callbacks
      refreshCell: (cellKey) => {
        grid.refreshCell(cellKey);
      },

      // storageEngine callbacks
      getCanonicalSnapshot: () => canonicalValuesEngine.getSnapshot(),
      getOutputModes: () => ({}),  // Standard sheets always use 'last' mode
      getCalcSnapshot: () => ({
        nodeCalcData: calculationEngine.getNodeCalcData(),
        namedInputs: new Set(canonicalValuesEngine.getAllNamedInputs())
      }),

      // clipboardEngine callbacks
      setBatch: (entries) => canonicalValuesEngine.setBatch(entries),

      // formulaBar callbacks
      onCommit: (cellKey, rawValue) => canonicalValuesEngine.setValue(cellKey, rawValue),

      // panels callbacks
      setValue: (cellKey, rawValue) => canonicalValuesEngine.setValue(cellKey, rawValue),
      getCellDisplay: (cellKey) => formattingEngine.getCellDisplay(cellKey),

      // grid callbacks
      onInputDetected: (inputText) => formulaBar.handleInputFromGrid(inputText),
      focusFormulaBar: (cursorMode) => formulaBar.focus(cursorMode),
    };

    // ============================================================================
    // BUILD MODULE CONFIGS
    // ============================================================================

    // Get identical module configs from shared
    const identicalConfigs = createIdenticalModuleConfigs({
      calculationEngine,
      formattingEngine,
      canonicalValuesEngine,
      clipboardEngine,
      storageEngine,
      scenarioEngine,
      grid,
      panels,
      formatDialog,
      functionsDialog,
      namedRangesDialog,
      formulaBar,
      functionCompiler,
      callbacks,
      maxHistorySize: config.maxHistorySize || 50,
    });

    // Build module-specific configs using base creators
    const moduleConfigs = {
      ...identicalConfigs,

      canonicalValuesEngine: createBaseCanonicalValuesEngineConfig({
        sourceData,
        calculationEngine,
        historyEngine,
        callbacks,
      }),

      formattingEngine: createBaseFormattingEngineConfig({
        sourceData,
        grid,
        calculationEngine,
        historyEngine,
        storageEngine,
        callbacks,
      }),

      clipboardEngine: createBaseClipboardConfig({
        grid,
        canonicalValuesEngine,
        formulaBar,
        toolbar,
        formattingEngine,
        calculationEngine,
        historyEngine,
        callbacks,
      }),

      storageEngine: createBaseStorageEngineConfig({
        canonicalValuesEngine,
        formattingEngine,
        calculationEngine,
        grid,
        panels,
        header,
        callbacks,
      }),

      formulaBar: createBaseFormulaBarConfig({
        canonicalValuesEngine,
        grid,
        callbacks,
      }),

      panels: createBasePanelsConfig({
        canonicalValuesEngine,
        calculationEngine,
        formulaBar,
        toolbar,
        storageEngine,
        callbacks,
      }),

      grid: createBaseGridConfig({
        formattingEngine,
        formulaBar,
        clipboardEngine,
        calculationEngine,
        canonicalValuesEngine,
        toolbar,
        callbacks,
      }),

      header: createBaseHeaderConfig({
        functionsDialog,
        storageEngine,
        callbacks,
      }),

      codeExportDialog: {
        languagePackEngine: { type: 'object', value: languagePackEngine },
      },

      languagePackListDialog: {
        languagePackEngine: { type: 'object', value: languagePackEngine },
        onEditPack: { type: 'function', value: (packId, readOnly) => languagePackEditor.open(packId, readOnly) },
      },

      languagePackEditor: {
        languagePackEngine: { type: 'object', value: languagePackEngine },
        storageEngine: { type: 'object', value: storageEngine },
      },
    };

    // ============================================================================
    // INITIALIZE ALL MODULES
    // ============================================================================

    const modules = {
      canonicalValuesEngine,
      formattingEngine,
      calculationEngine,
      clipboardEngine,
      storageEngine,
      historyEngine,
      formulaBar,
      panels,
      grid,
      header,
      toolbar,
      formatDialog,
      functionsDialog,
      namedRangesDialog,
      importDialog,
      dropZone,
      codeExportDialog,
      languagePackListDialog,
      languagePackEditor,
    };

    initializeModules(modules, moduleConfigs, '[Orchestrator]');

    console.log('[Orchestrator] ✓ All modules validated and initialized');
  }

  // ============================================================================
  // OPFS INITIALIZATION (runs once, persists across reloads)
  // ============================================================================

  async function initializeOpfs() {
    if (opfsInitialized) return;

    // Use pre-created OPFS service if provided (e.g., memoryOpfsService in viewer mode)
    if (config.opfsService) {
      opfsService = config.opfsService;
      opfsInitialized = true;
      console.log('[Orchestrator] Using provided OPFS service');
      return;
    }

    try {
      opfsService = createOpfsService();
      await opfsService.init();
      opfsInitialized = true;
      console.log('[Orchestrator] OPFS initialized');
    } catch (error) {
      console.warn('[Orchestrator] OPFS not available:', error.message);
      opfsService = null;
    }
  }

  // ============================================================================
  // INITIAL SETUP
  // ============================================================================

  initializeAll();

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    /**
     * Mounts the spreadsheet UI to the specified container.
     *
     * @param {HTMLElement} container - The DOM element to mount the spreadsheet into
     */
    async mountUI(container) {
      console.log('[Orchestrator] Mounting UI...');

      await initializeOpfs();
      if (opfsService) {
        storageEngine.setOpfsService(opfsService);
        scenarioEngine.setDependencies({ storageEngine, opfsService });
        languagePackEngine.init({ opfsService });
      }

      header.mount(container.querySelector('.app-header'));
      toolbar.mount(container.querySelector('.toolbar'));
      formulaBar.mount(container.querySelector('.formula-bar'));
      panels.mount({
        inputsPanel: container.querySelector('.inputs-panel'),
        outputsPanel: container.querySelector('.outputs-panel'),
      });
      grid.mount({
        container: container.querySelector('.spreadsheet-grid-container'),
        addColBtn: container.querySelector('.add-columns-btn'),
        addRowBtn: container.querySelector('.add-rows-btn'),
      });
      formatDialog.mount();
      functionsDialog.mount();
      namedRangesDialog.mount();
      importDialog.mount();
      dropZone.mount(container);
      codeExportDialog.mount();
      languagePackListDialog.mount();
      languagePackEditor.mount();

      console.log('[Orchestrator] UI mounted successfully');

      if (config.drilldownConfig) {
        await this.loadDrilldownSpreadsheet(config.drilldownConfig);
      }
    },

    /**
     * Import a zip from a URL into the Downloads folder.
     * @param {string} url - URL to fetch the zip from
     * @returns {Promise<{entrySheetId: string|null, entrySheetType: string, alreadyDownloaded: boolean}>}
     */
    async importFromUrl(url) {
      return fetchAndImportFromUrl(url, { storageEngine, opfsService, functionCompiler });
    },

    /**
     * Loads a custom function's definition spreadsheet for drill-down viewing.
     * Creates a preview spreadsheet so edits don't affect the original.
     */
    async loadDrilldownSpreadsheet(drilldownConfig) {
      try {
        const result = await core.loadDrilldown(drilldownConfig);
        spreadsheetName = result.name;
        panels.loadScenarios(result.testCases);
      } catch (error) {
        console.error('[Orchestrator] Failed to load drill-down spreadsheet:', error);
      }
    },

    /**
     * Sets a cell value programmatically.
     */
    setValue(cellKey, value) {
      canonicalValuesEngine.setValue(cellKey, value);
    },

    /**
     * Gets the calculated value of a cell.
     */
    getValue(cellKey) {
      return calculationEngine.getCellValue(cellKey);
    },

    /**
     * Loads a spreadsheet from OPFS by ID.
     */
    async loadSpreadsheetFromOpfs(id) {
      try {
        const result = await core.loadFromOpfs(id);
        spreadsheetName = result.name;
        panels.loadScenarios(result.testCases);
      } catch (error) {
        console.error('[Orchestrator] Failed to load from OPFS:', error);
        throw error;
      }
    },

    getTitle() {
      return spreadsheetName;
    },

    getNavigationState() {
      const isPersisted = !storageEngine.isScratchpadMode() && storageEngine.getCurrentSpreadsheetId();
      return {
        scratchpadMode: storageEngine.isScratchpadMode(),
        spreadsheetId: isPersisted ? storageEngine.getCurrentSpreadsheetId() : null,
        activeScenarioIndex: panels.getActiveScenarioIndex(),
        xml: isPersisted ? null : storageEngine.exportToXml(spreadsheetName),
      };
    },

    async saveBeforeNavigate() {
      if (!storageEngine.isScratchpadMode() && storageEngine.getCurrentSpreadsheetId()) {
        await storageEngine.saveNow();
      }
    },

    async restoreNavigationState(node) {
      if (node.spreadsheetId) {
        // Persisted root — reload from OPFS (flushed before navigating away)
        await this.loadSpreadsheetFromOpfs(node.spreadsheetId);
        if (header.isInPreviewMode()) header.exitPreviewMode();
      } else {
        // All other nodes — restore from saved XML
        const result = await core.restoreFromXml(node.xml);
        spreadsheetName = result.name;
        panels.loadScenarios(result.testCases);
      }
      storageEngine.setScratchpadMode(node.scratchpadMode);
      if (node.drilldownInfo) {
        header.setPreviewMode(node.drilldownInfo);
      } else if (header.isInPreviewMode()) {
        header.exitPreviewMode();
      }
      panels.setActiveScenarioVisual(node.activeScenarioIndex);
      historyEngine.clear();
    },

    /**
     * Destroys the spreadsheet and cleans up all components.
     */
    destroy() {
      console.log('[Orchestrator] Destroying...');
      header.unmount();
      toolbar.unmount();
      formulaBar.unmount();
      panels.unmount();
      grid.unmount();
      formatDialog.unmount();
      functionsDialog.unmount();
      namedRangesDialog.unmount();
      importDialog.unmount();
      dropZone.unmount();
      codeExportDialog.unmount();
      languagePackListDialog.unmount();
      languagePackEditor.unmount();
    },

    /**
     * DEV HELPER: Clear all function caches (OPFS).
     * Call from console: spreadsheet.clearFunctionCaches()
     */
    async clearFunctionCaches() {
      console.log('[Dev] Clearing function caches...');

      // Clear OPFS function storage
      if (opfsService) {
        const functions = await storageEngine.listFunctions();
        for (const func of functions) {
          await storageEngine.deleteFunction(func.id);
          console.log(`[Dev] Deleted OPFS function: ${func.name} (${func.id})`);
        }
        console.log(`[Dev] Cleared ${functions.length} functions from OPFS`);
      }

      console.log('[Dev] All function caches cleared. Reload to re-fetch from server.');
    },
  };
}
