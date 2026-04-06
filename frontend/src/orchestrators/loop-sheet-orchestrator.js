/**
 * @file Loop Sheet Orchestrator
 * @description Orchestrator for loop sheets - iterative calculation sheets.
 *
 * Loop sheets have:
 * - Row 0: Initial values
 * - Row 1: Iteration formulas (template)
 * - Rows 2+: Generated (read-only) by adjusting Row 1 formulas
 * - _STOP column: Stop condition, when TRUE iteration stops
 * - ~N syntax: Relative literals that adjust with row offset
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
import { parseCellKey } from '../utils/cellUtils.js';
import { adjustFormulaByOffset, collapseFormulaToRow1 } from '../utils/clipboardUtils.js';
import { escapeCSSString } from '../utils/cssUtils.js';

/**
 * Maximum iterations to prevent infinite loops (display safety cap)
 */
const MAX_ITERATIONS = 1000;

/**
 * Apply loop sheet-specific bounds properties to base grid bounds.
 * Single source of truth for minRow, virtual column, and formula editing constraint.
 */
const applyLoopBounds = (bounds) => ({
  ...bounds,
  minRow: 0,
  virtualRightColumn: '_STOP',
  formulaEditingMaxRow: 1
});

/**
 * Creates and initializes the loop sheet orchestrator.
 *
 * @param {Object} [config={}] - Configuration options
 * @param {number} [config.maxHistorySize=50] - Maximum history states
 * @returns {Object} Public API
 */
export function createLoopSheetOrchestrator(config = {}) {
  // Engine/component references
  let canonicalValuesEngine = null;
  let formattingEngine = null;
  let calculationEngine = null;
  let storageEngine = null;
  let historyEngine = null;
  let clipboardEngine = null;
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

  // Source data
  let sourceData = null;

  // Loop sheet specific state
  let spreadsheetName = config.name || 'Loop Sheet';

  // Iteration state
  let iterationCount = 0;
  let isIterating = false;
  let maxIterations = null; // optional user-set limit (null = no limit)
  const pendingRefreshCells = new Set();

  // ============================================================================
  // ITERATION: PURE RULES
  // ============================================================================

  /**
   * Check if a cell is editable (only rows 0 and 1 are editable, plus named entities)
   * @param {string} cellKey - Cell key like "A1", "_STOP0", or named entity like "MyInput"
   * @returns {boolean} True if cell can be edited
   */
  function isCellEditable(cellKey) {
    if (cellKey.startsWith('=')) return false;
    const parsed = parseCellKey(cellKey);
    if (!parsed) return true; // Named entity
    return parsed.row <= 1;
  }

  /**
   * Get the row 1 equivalent of a cell (for redirecting edits)
   * @param {string} cellKey - Cell key like "A5"
   * @returns {string} The row 1 version like "A1", or original if already editable
   */
  function getEditableEquivalent(cellKey) {
    const parsed = parseCellKey(cellKey);
    if (!parsed || parsed.row <= 1) return cellKey;
    return `${parsed.col}1`;
  }

  /**
   * Normalize stop column entries to enforce mutual exclusivity.
   * @param {Array<[string, string]>} entries - Entries to normalize
   * @returns {Array<[string, string]>} Normalized entries with stop rules applied
   */
  function normalizeStopEntries(entries) {
    const stop0Entry = entries.find(([key]) => key === '_STOP0');
    const stop1Entry = entries.find(([key]) => key === '_STOP1');
    if (!stop0Entry && !stop1Entry) return entries;

    const isEmptyValue = (v) => v === '' || v === undefined || v === null;
    const stop0Value = stop0Entry ? stop0Entry[1] : null;
    const stop1Value = stop1Entry ? stop1Entry[1] : null;
    const stop0Empty = stop0Value === null || isEmptyValue(stop0Value);
    const stop1Empty = stop1Value === null || isEmptyValue(stop1Value);

    const nonStopEntries = entries.filter(([key]) => key !== '_STOP0' && key !== '_STOP1');
    let finalStop0 = null;
    let finalStop1 = null;

    if (!stop0Empty) {
      finalStop0 = stop0Value;
      finalStop1 = stop0Value;
    } else if (!stop1Empty) {
      finalStop0 = '';
      finalStop1 = stop1Value;
    } else if (stop1Entry && stop1Empty) {
      finalStop0 = '';
      finalStop1 = '';
    } else if (stop0Entry && stop0Empty) {
      finalStop0 = '';
    }

    const finalEntries = [...nonStopEntries];
    if (finalStop0 !== null) finalEntries.push(['_STOP0', finalStop0]);
    if (finalStop1 !== null) finalEntries.push(['_STOP1', finalStop1]);
    return finalEntries;
  }

  // ============================================================================
  // ITERATION: HELPERS
  // ============================================================================

  function getAllCellKeys() {
    const snapshot = canonicalValuesEngine.getSnapshot();
    return snapshot.canonicalValues.map(([key]) => key);
  }

  function getRow1CellKeys() {
    return getAllCellKeys().filter(key => {
      const parsed = parseCellKey(key);
      return parsed && parsed.row === 1;
    });
  }

  function getGeneratedCellKeys() {
    return getAllCellKeys().filter(key => {
      const parsed = parseCellKey(key);
      return parsed && parsed.row >= 2;
    });
  }

  function clearGeneratedRows() {
    const generatedKeys = getGeneratedCellKeys();
    if (generatedKeys.length > 0) {
      canonicalValuesEngine.silentDeleteKeys(generatedKeys);
      calculationEngine.silentDeleteKeys(generatedKeys);
      formattingEngine.silentDeleteKeys(generatedKeys);
    }
  }

  function clearGridGeneratedRows() {
    grid.removeGeneratedRows({ minRows: 30 });
  }

  function generateRow(targetRow) {
    const row1Keys = getRow1CellKeys();
    const offset = targetRow - 1;
    const entries = [];
    for (const key of row1Keys) {
      const parsed = parseCellKey(key);
      if (!parsed) continue;
      const formula = canonicalValuesEngine.getValue(key);
      const newKey = `${parsed.col}${targetRow}`;
      const adjustedFormula = formula.startsWith('=')
        ? adjustFormulaByOffset(formula, offset, 0)
        : formula;
      entries.push([newKey, adjustedFormula]);
    }
    return entries;
  }

  function isStopConditionMet(row) {
    const stopKey = `_STOP${row}`;
    const value = calculationEngine.getCellValue(stopKey);
    return value !== false;
  }

  function hasValidStopCondition(row) {
    const stopKey = `_STOP${row}`;
    const canonical = canonicalValuesEngine.getValue(stopKey);
    if (canonical === '' || canonical === undefined || canonical === null) return false;
    const value = calculationEngine.getCellValue(stopKey);
    if (typeof value === 'string' && value.startsWith('#')) return false;
    return true;
  }

  // ============================================================================
  // ITERATION: BATCH REFRESH
  // ============================================================================

  function queueRefresh(cellKey) {
    if (isIterating) {
      pendingRefreshCells.add(cellKey);
    } else {
      grid.refreshCell(cellKey);
    }
  }

  function flushPendingRefreshes() {
    if (pendingRefreshCells.size === 0) return;
    const updates = [];
    for (const cellKey of pendingRefreshCells) {
      const cellElement = document.getElementById(cellKey);
      if (cellElement) {
        updates.push({ element: cellElement, display: formattingEngine.getCellDisplay(cellKey) });
      }
    }
    for (const { element, display } of updates) {
      const escapedText = escapeCSSString(display.text || '');
      element.style.setProperty('--cell-value', `"${escapedText}"`);
      Object.assign(element.style, display.styles);
    }
    pendingRefreshCells.clear();
  }

  // ============================================================================
  // ITERATION: MAIN LOOP
  // ============================================================================

  function runIterationLoop() {
    console.log('[LoopOrchestrator] Starting iteration loop...');
    isIterating = true;
    pendingRefreshCells.clear();
    clearGeneratedRows();

    // Check Row 0 stop condition first (Until semantics)
    if (hasValidStopCondition(0) && isStopConditionMet(0)) {
      console.log('[LoopOrchestrator] Stop condition met at Row 0, no iterations');
      iterationCount = 0;
      isIterating = false;
      clearGridGeneratedRows();
      flushPendingRefreshes();
      panels.refreshOutputs();
      return;
    }

    // _STOP1 must have a valid condition defined
    if (!hasValidStopCondition(1)) {
      console.log('[LoopOrchestrator] No valid stop condition in _STOP1, stopping at row 1');
      iterationCount = 1;
      isIterating = false;
      clearGridGeneratedRows();
      flushPendingRefreshes();
      panels.refreshOutputs();
      return;
    }

    // Check Row 1 stop condition
    if (isStopConditionMet(1)) {
      console.log('[LoopOrchestrator] Stop condition met at Row 1, 1 iteration');
      iterationCount = 1;
      isIterating = false;
      clearGridGeneratedRows();
      flushPendingRefreshes();
      panels.refreshOutputs();
      return;
    }

    // Generate rows until stop condition
    let currentRow = 2;
    while (currentRow < MAX_ITERATIONS) {
      const gridMaxRow = grid.getGridBounds().maxRow;
      if (currentRow > gridMaxRow) {
        grid.addRows(currentRow - gridMaxRow, { rowClass: 'generated-row' });
      }

      const entries = generateRow(currentRow);
      canonicalValuesEngine.setBatch(entries, { skipHistory: true });

      if (isStopConditionMet(currentRow)) {
        console.log(`[LoopOrchestrator] Stop condition met at Row ${currentRow}`);
        iterationCount = currentRow;
        break;
      }
      currentRow++;
    }

    if (currentRow >= MAX_ITERATIONS) {
      console.warn(`[LoopOrchestrator] Hit max iterations (${MAX_ITERATIONS})`);
      iterationCount = MAX_ITERATIONS;
    }

    isIterating = false;
    flushPendingRefreshes();
    console.log(`[LoopOrchestrator] Iteration complete, ${iterationCount} rows`);
    panels.refreshOutputs();
    updateIterationStatus();
  }

  // ============================================================================
  // ITERATION STATUS
  // ============================================================================

  function updateIterationStatus() {
    const statusEl = document.querySelector('.iteration-status');
    if (!statusEl) return;

    if (maxIterations != null && iterationCount >= maxIterations) {
      statusEl.textContent = `Error: loop did not converge within ${maxIterations} iterations`;
      statusEl.classList.add('error');
    } else {
      statusEl.textContent = '';
      statusEl.classList.remove('error');
    }
  }

  function syncMaxIterationsInput() {
    const input = document.querySelector('.max-iterations-input');
    if (!input) return;
    input.value = maxIterations != null ? maxIterations : '';
  }

  // ============================================================================
  // CENTRAL FUNCTIONS: EDITABILITY-AWARE
  // ============================================================================

  /**
   * Editability-aware setValue
   * @param {string} cellKey - Cell to set
   * @param {string} rawValue - Value to set
   * @returns {boolean} True if set succeeded
   */
  function setValue(cellKey, rawValue) {
    if (!isCellEditable(cellKey)) {
      console.log('[LoopOrchestrator] Cannot edit generated cell:', cellKey);
      return false;
    }
    const collapsed = collapseFormulaToRow1(rawValue);
    const normalized = normalizeStopEntries([[cellKey, collapsed]]);
    canonicalValuesEngine.setBatch(normalized);
    return true;
  }

  /**
   * Editability-aware setBatch
   * @param {Array<[string, string]>} entries - Entries to set
   * @returns {boolean} True if any entries were set
   */
  function setBatch(entries) {
    const editableEntries = entries.filter(([key]) => isCellEditable(key));
    if (editableEntries.length === 0) return false;
    const collapsed = editableEntries.map(([key, value]) => [key, collapseFormulaToRow1(value)]);
    const normalized = normalizeStopEntries(collapsed);
    canonicalValuesEngine.setBatch(normalized);
    return true;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function initializeAll() {
    console.log('[LoopOrchestrator] Initializing...');

    sourceData = {
      formatRules: new Map(),
      cellStyles: new Map(),
      spreadsheetDefaults: {}
    };

    // Create engines and components using shared factories
    const engines = createEngines();
    canonicalValuesEngine = engines.canonicalValuesEngine;
    formattingEngine = engines.formattingEngine;
    calculationEngine = engines.calculationEngine;
    storageEngine = engines.storageEngine;
    historyEngine = engines.historyEngine;
    clipboardEngine = engines.clipboardEngine;
    scenarioEngine = engines.scenarioEngine;
    languagePackEngine = engines.languagePackEngine;

    const components = createComponents({
      gridInitialBounds: applyLoopBounds({ maxCol: 'H', maxRow: 29 }),
    });
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
        setBatch: setBatch,  // Editability-aware version defined above
      },
      // Config
      config: {
        logPrefix: '[LoopOrchestrator]',
        defaultName: 'Loop Sheet',
        basePath: import.meta.env.BASE_URL + 'loop.html',
        sheetType: 'loop',
      },
      // Hooks
      hooks: {
        afterHistoryChange: runIterationLoop,
        afterLoad: runIterationLoop,
        transformGridBounds: applyLoopBounds,
        getName: () => spreadsheetName,
        setName: (name) => { spreadsheetName = name; },
        getScenarios: () => panels.getScenarios(),
        getOpfsService: () => opfsService,
        getOutputValue: (name) => {
          const cellKey = `${name.toUpperCase()}${iterationCount}`;
          return calculationEngine.getCellValue(cellKey);
        },
        onBreadcrumbReset: config.onBreadcrumbReset,
        onOpenSpreadsheet: config.onOpenSpreadsheet,
        setMaxIterations: (val) => { maxIterations = val; syncMaxIterationsInput(); },
        getMaxIterations: () => maxIterations,
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
        const changedKeys = Array.from(changedInfo.keys());
        const editableChanged = changedKeys.some(k => isCellEditable(k));

        if (editableChanged) {
          clearGeneratedRows();
          clearGridGeneratedRows();
          storageEngine.markDirty();
        }

        formattingEngine.beginBatch();
        calculationEngine.processInputs(changedInfo);
        formattingEngine.endBatch();

        if (editableChanged) {
          runIterationLoop();
        } else {
          panels.refreshOutputs();
        }
      },
      recordChanges: (mapName, keys) => {
        // Filter out generated row keys from history
        const editableKeys = keys.filter(k => isCellEditable(k));
        if (editableKeys.length > 0) {
          historyEngine.recordChanges(mapName, editableKeys);
        }
      },

      // formattingEngine callbacks
      refreshCell: (cellKey) => {
        queueRefresh(cellKey);
      },

      // column names callbacks
      getColumnNames: () => grid.getColumnNames(),
      onColumnNameChange: () => { storageEngine.markDirty(); },

      // loop settings callbacks
      getMaxIterations: () => maxIterations,

      // storageEngine callbacks
      getCanonicalSnapshot: () => {
        // Only save rows 0-1, not generated rows
        const snapshot = canonicalValuesEngine.getSnapshot();
        snapshot.canonicalValues = snapshot.canonicalValues.filter(([key]) => isCellEditable(key));
        snapshot.type = 'loop';
        if (maxIterations != null) snapshot.maxIterations = maxIterations;
        return snapshot;
      },
      getOutputModes: () => panels.getOutputModes(),
      getCalcSnapshot: () => {
        // Include editable cells (rows 0-1) AND their anonymous expression dependencies
        const allNodeCalcData = calculationEngine.getNodeCalcData();
        const filteredNodeCalcData = new Map();

        // First pass: add editable cells
        for (const [key, node] of allNodeCalcData) {
          if (isCellEditable(key)) {
            filteredNodeCalcData.set(key, node);
          }
        }

        // Second pass: add anonymous expressions that are dependencies
        const collectAnonymousDeps = (precedents) => {
          if (!precedents) return;
          for (const dep of precedents) {
            if (dep.startsWith('=') && !filteredNodeCalcData.has(dep)) {
              const depNode = allNodeCalcData.get(dep);
              if (depNode) {
                filteredNodeCalcData.set(dep, depNode);
                collectAnonymousDeps(depNode.precedents);
              }
            }
          }
        };

        const editableCells = Array.from(filteredNodeCalcData.values());
        for (const node of editableCells) {
          collectAnonymousDeps(node.precedents);
        }

        return {
          nodeCalcData: filteredNodeCalcData,
          namedInputs: new Set(canonicalValuesEngine.getAllNamedInputs())
        };
      },

      // clipboardEngine callbacks
      setBatch: setBatch,  // Central editability-aware function

      // formulaBar callbacks
      onCommit: setValue,  // Central editability-aware function

      // panels callbacks
      setValue: setValue,  // Central editability-aware function
      getCellDisplay: (address) => {
        // For loop sheets, address is a column letter - get display for final iteration row
        const col = address.toUpperCase();
        const cellKey = `${col}${iterationCount}`;
        return formattingEngine.getCellDisplay(cellKey);
      },

      // grid callbacks
      onInputDetected: (inputText) => {
        let activeCell = grid.getActiveCell();
        if (!isCellEditable(activeCell)) {
          const row1Cell = getEditableEquivalent(activeCell);
          if (row1Cell !== activeCell) {
            grid.setActiveCell(row1Cell);
            activeCell = row1Cell;
          } else {
            return;
          }
        }
        formulaBar.handleInputFromGrid(inputText);
      },
      focusFormulaBar: (cursorMode) => {
        let activeCell = grid.getActiveCell();
        if (!isCellEditable(activeCell)) {
          const row1Cell = getEditableEquivalent(activeCell);
          if (row1Cell !== activeCell) {
            grid.setActiveCell(row1Cell);
            activeCell = row1Cell;
          } else {
            return;
          }
        }
        formulaBar.focus(cursorMode);
      },
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

    // Build module-specific configs using base creators with loop-specific overrides
    const baseFormattingConfig = createBaseFormattingEngineConfig({
      sourceData,
      grid,
      calculationEngine,
      historyEngine,
      storageEngine,
      callbacks,
    });

    const moduleConfigs = {
      ...identicalConfigs,

      canonicalValuesEngine: createBaseCanonicalValuesEngineConfig({
        sourceData,
        calculationEngine,
        historyEngine,
        callbacks,
      }),

      formattingEngine: {
        ...baseFormattingConfig,
        getInheritedFormatting: { type: 'function', value: (cellKey) => {
          const parsed = parseCellKey(cellKey);
          if (!parsed || parsed.row <= 1) return null;
          const row1Key = `${parsed.col}1`;
          const styles = formattingEngine.getCellStyles(row1Key);
          const rules = formattingEngine.getCellFormatRules(row1Key);
          if (!styles && !rules) return null;
          return { styles, formatRules: rules };
        }},
        onFormattingChange: { type: 'function', value: () => {
          baseFormattingConfig.onFormattingChange.value();
          if (!isIterating && iterationCount > 1) {
            runIterationLoop();
          }
        }},
      },

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

      // FormulaBar with loop-specific additions
      formulaBar: {
        ...createBaseFormulaBarConfig({
          canonicalValuesEngine,
          grid,
          callbacks,
        }),
        isCellEditable: { type: 'function', value: isCellEditable },
        onDisabledClick: { type: 'function', value: () => {
          const activeCell = grid.getActiveCell();
          const row1Cell = getEditableEquivalent(activeCell);
          if (row1Cell !== activeCell) {
            grid.setActiveCell(row1Cell);
            formulaBar.focus();
          }
        }},
      },

      // Panels with loop-specific additions
      panels: {
        ...createBasePanelsConfig({
          canonicalValuesEngine,
          calculationEngine,
          formulaBar,
          toolbar,
          storageEngine,
          callbacks,
        }),
        getColumnValues: { type: 'function', value: (address) => {
          // For loop sheets with output_mode="all", return all iteration values
          const col = address.toUpperCase();
          const values = [];

          // Include row 0 if not blank
          const row0Key = `${col}0`;
          const row0Value = canonicalValuesEngine.getValue(row0Key);
          if (row0Value !== null && row0Value !== undefined && row0Value !== '') {
            values.push(formattingEngine.getCellDisplay(row0Key));
          }

          // Include all iteration rows (1 through iterationCount)
          for (let row = 1; row <= iterationCount; row++) {
            const cellKey = `${col}${row}`;
            values.push(formattingEngine.getCellDisplay(cellKey));
          }

          return values;
        }},
        getColumnNames: { type: 'function', value: () => grid.getColumnNames() },
      },

      grid: {
        ...createBaseGridConfig({
          formattingEngine,
          formulaBar,
          clipboardEngine,
          calculationEngine,
          canonicalValuesEngine,
          toolbar,
          callbacks,
        }),
        onColumnNameChange: { type: 'function', value: callbacks.onColumnNameChange },
      },

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

    initializeModules(modules, moduleConfigs, '[LoopOrchestrator]');

    console.log('[LoopOrchestrator] Initialized');
  }

  // Initialize on creation
  initializeAll();

  // ============================================================================
  // OPFS INITIALIZATION (runs once, persists across reloads)
  // ============================================================================

  async function initializeOpfs() {
    if (opfsInitialized) return;

    // Use pre-created OPFS service if provided (e.g., memoryOpfsService in viewer mode)
    if (config.opfsService) {
      opfsService = config.opfsService;
      opfsInitialized = true;
      console.log('[LoopOrchestrator] Using provided OPFS service');
      return;
    }

    try {
      opfsService = createOpfsService();
      await opfsService.init();
      opfsInitialized = true;
      console.log('[LoopOrchestrator] OPFS initialized');
    } catch (error) {
      console.warn('[LoopOrchestrator] OPFS not available:', error.message);
      opfsService = null;
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    async mountUI(container) {
      console.log('[LoopOrchestrator] Mounting UI...');

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
        addRowBtn: null,  // Loop sheets don't allow manual row addition
      });
      formatDialog.mount();
      functionsDialog.mount();
      namedRangesDialog.mount();
      importDialog.mount();
      dropZone.mount(container);
      codeExportDialog.mount();
      languagePackListDialog.mount();
      languagePackEditor.mount();

      // Wire loop settings UI
      const loopSettingsEl = container.querySelector('.loop-settings');
      if (loopSettingsEl) {
        loopSettingsEl.hidden = false;
        const maxIterInput = loopSettingsEl.querySelector('.max-iterations-input');
        if (maxIterInput) {
          maxIterInput.addEventListener('change', () => {
            const val = maxIterInput.value.trim();
            maxIterations = val ? parseInt(val, 10) : null;
            if (maxIterations != null && isNaN(maxIterations)) maxIterations = null;
            storageEngine.markDirty();
            updateIterationStatus();
          });
        }
      }

      // Register _STOP as sticky (classes already in HTML, but needed for new cells)
      grid.setStickyRightColumns(['_STOP']);

      // Make rows 0 and 1 sticky (editable rows stay visible while scrolling)
      grid.setStickyTopRows([0, 1]);

      // Handle drill-down mode (loading a custom function's definition spreadsheet)
      if (config.drilldownConfig) {
        await this.loadDrilldownSpreadsheet(config.drilldownConfig);
      }

      console.log('[LoopOrchestrator] UI mounted');
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
        // Note: runIterationLoop is called via hooks.afterLoad in core
      } catch (error) {
        console.error('[LoopOrchestrator] Failed to load drill-down spreadsheet:', error);
      }
    },

    getIterationCount() {
      return iterationCount;
    },

    runIteration() {
      runIterationLoop();
    },

    setValue(cellKey, value) {
      return setValue(cellKey, value);
    },

    getValue(cellKey) {
      return calculationEngine.getCellValue(cellKey);
    },

    async loadSpreadsheetFromOpfs(id) {
      try {
        const result = await core.loadFromOpfs(id);
        spreadsheetName = result.name;
        panels.loadScenarios(result.testCases);
        // Note: runIterationLoop is called via hooks.afterLoad in core
      } catch (error) {
        console.error('[LoopOrchestrator] Failed to load from OPFS:', error);
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

    destroy() {
      console.log('[LoopOrchestrator] Destroying...');
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
