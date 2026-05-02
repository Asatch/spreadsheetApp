/**
 * @file Spreadsheet Orchestrator
 * @description Main coordination hub following v3 architecture.
 * Creates storage, instantiates all modules, wires dependencies, and provides coordination.
 */

import { createHeadlessComponents } from './shared/headless-components.js';
import { createGrid } from '../components/grid.js';
import {
  createEngines,
  initializeModules,
  createIdenticalModuleConfigs,
  createBaseClipboardConfig,
  createBaseFormulaBarConfig,
  createBasePanelsConfig,
  createBaseGridConfig,
  createRowColOps,
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
  let findBar = null;
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

    const components = config.headless
      ? createHeadlessComponents()
      : { ...config.persistentComponents, grid: createGrid() };
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
    findBar = components.findBar;

    // Create function compiler (needs storageEngine methods, or use injected one)
    functionCompiler = config.functionCompiler ?? createFunctionCompiler({
      loadFunctionFromOpfs: (id) => storageEngine.loadFunction(id),
    });

    // Headless mode: force scratchpad so auto-save paths (which depend on
    // window/OPFS) bail out cleanly.
    if (config.headless) {
      storageEngine.setScratchpadMode(true);
    }

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
      onCommit: (cellKey, rawValue, tokens) => {
        if (tokens) {
          canonicalValuesEngine.setClassified(cellKey, tokens);
        } else {
          canonicalValuesEngine.setValue(cellKey, rawValue);
        }
      },

      // panels callbacks
      setValue: (cellKey, rawValue) => canonicalValuesEngine.setValue(cellKey, rawValue),
      getCellDisplay: (cellKey) => formattingEngine.getCellDisplay(cellKey),

      // grid callbacks
      onInputDetected: (inputText) => formulaBar.handleInputFromGrid(inputText),
      focusFormulaBar: (cursorMode) => formulaBar.focus(cursorMode),

      // toolbar callbacks
      openFind: () => findBar.open(),
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
        calculationEngine,
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

      grid: (() => {
        const base = createBaseGridConfig({
          formattingEngine,
          formulaBar,
          clipboardEngine,
          calculationEngine,
          canonicalValuesEngine,
          toolbar,
          callbacks,
        });
        const rowColOps = createRowColOps({ grid, clipboardEngine });
        return {
          ...base,
          onInsertRow: { type: 'function', value: rowColOps.insertRow },
          onInsertCol: { type: 'function', value: rowColOps.insertCol },
          onDeleteRow: { type: 'function', value: rowColOps.deleteRow },
          onDeleteCol: { type: 'function', value: rowColOps.deleteCol },
        };
      })(),

      header: createBaseHeaderConfig({
        functionsDialog,
        storageEngine,
        grid,
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
      findBar,
    };

    initializeModules(modules, moduleConfigs, '[Orchestrator]');
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
      return;
    }

    try {
      opfsService = createOpfsService();
      await opfsService.init();
      opfsInitialized = true;
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
      await initializeOpfs();
      if (opfsService) {
        storageEngine.setOpfsService(opfsService);
        scenarioEngine.setDependencies({ storageEngine, opfsService });
        languagePackEngine.init({ opfsService });
      }

      // Persistent components are mounted once by main.js.
      // Only mount grid here — its DOM container is swapped between sheet types.
      grid.mount({
        container: container.querySelector('.spreadsheet-grid-container'),
        addColBtn: container.querySelector('.add-columns-btn'),
        addRowBtn: container.querySelector('.add-rows-btn'),
      });

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
     * Headless entry point: load a spreadsheet from an XML string.
     * Returns { name, testCases } from the parsed XML.
     */
    async loadFromXml(xml) {
      const result = await core.restoreFromXml(xml);
      spreadsheetName = result.name;
      panels.loadScenarios(result.testCases);
      return result;
    },

    /**
     * No-op for standard sheets (provided for API symmetry with loop sheets).
     */
    runIteration() {
      return { iterationCount: 0, hitMax: false };
    },

    /**
     * Returns [{ key, value }] for each declared output cell.
     */
    getOutputs() {
      return panels.getOutputCells().map(key => ({
        key,
        value: calculationEngine.getCellValue(key),
      }));
    },

    /**
     * Returns [{ key, raw, value, errorMeta }] for every cell with a canonical value.
     */
    getAllCells() {
      const snapshot = canonicalValuesEngine.getSnapshot();
      return snapshot.canonicalValues.map(([key, raw]) => {
        const node = calculationEngine.getNode(key);
        return {
          key,
          raw,
          value: calculationEngine.getCellValue(key),
          errorMeta: node?.errorMeta ?? null,
        };
      });
    },

    /**
     * Returns [{ cell, error }] for cells whose computed value is an error.
     */
    getErrors() {
      return this.getAllCells()
        .filter(c => c.errorMeta && (Array.isArray(c.errorMeta) ? c.errorMeta.length : true))
        .map(c => ({ cell: c.key, error: typeof c.value === 'string' && c.value.startsWith('#') ? c.value : '#ERROR!' }));
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
      // Only unmount grid — its DOM container is replaced on sheet type switch.
      // Persistent components stay mounted; their deps are refreshed via init()
      // when the next orchestrator is created.
      grid.unmount();
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
