/**
 * @file Orchestration Core
 * @description Shared coordination logic factory for both orchestrators.
 * Centralizes cross-cutting operations that are identical or parameterizable
 * via config/hooks between standard and loop sheet orchestrators.
 */

import { expandRange } from '../../utils/cellUtils.js';
import { parseXml, stripUnusedInputsFromXml } from '../../utils/xmlSerializer.js';
import { createExportPackage, downloadBlob, generateExportFilename } from '../../utils/exportPackager.js';
import { isBreadcrumbMode, sheetUrl, appBasePath } from '../../utils/appMode.js';
import { parseImportFolder, parseImportFolderFromEntries, extractZipFromHtml } from '../../utils/importPackager.js';
import { isArrayType } from '../../utils/typeService.js';

// ============================================================================
// VERSION STRING
// ============================================================================

/**
 * Compute the next version string by incrementing the major version.
 * "1.0" → "2.0", "3.0" → "4.0", null → "1.0".
 * Falls back to "1.0" for unparseable or corrupted values.
 * @param {string|null} current - Current version string
 * @returns {string} Next version string
 */
function nextVersionString(current) {
  if (!current) return '1.0';
  const major = parseInt(current, 10);
  if (isNaN(major) || major > 999) return '1.0';
  return `${major + 1}.0`;
}

// ============================================================================
// DRILLDOWN NAVIGATION
// ============================================================================

/**
 * Opens a drill-down view for a custom function.
 * Unified function used by both Ctrl+D and View button paths.
 *
 * @param {Object} info - Drill-down info
 * @param {string} info.functionId - Function UUID (required unless versionId provided)
 * @param {string} [info.versionId] - Version UUID (for specific version)
 * @param {Array} [info.args] - Argument values to pre-fill
 * @param {string} [info.sheetType] - 'standard' or 'loop' (defaults to 'standard')
 */
export function openDrilldown({ functionId, versionId, args, sheetType }) {
  const params = new URLSearchParams();

  if (versionId) params.set('versionId', versionId);
  if (functionId) params.set('drilldown', functionId);
  if (args && args.length > 0) {
    params.set('args', JSON.stringify(args));
  }

  const url = `${appBasePath(sheetType)}?${params.toString()}`;

  window.open(url, '_blank');
}

/**
 * Creates the orchestration core - shared coordination logic.
 *
 * @returns {Object} Core instance with init() and shared callbacks
 */
export function createOrchestrationCore() {
  // Dependencies (set via init)
  let deps = null;

  /**
   * Initialize the core with dependencies.
   *
   * @param {Object} initConfig - Configuration
   * @param {Object} initConfig.canonicalValuesEngine - Canonical values engine
   * @param {Object} initConfig.formattingEngine - Formatting engine
   * @param {Object} initConfig.calculationEngine - Calculation engine
   * @param {Object} initConfig.storageEngine - Storage engine
   * @param {Object} initConfig.historyEngine - History engine
   * @param {Object} initConfig.clipboardEngine - Clipboard engine
   * @param {Object} initConfig.toolbar - Toolbar component
   * @param {Object} initConfig.grid - Grid component
   * @param {Object} initConfig.formulaBar - Formula bar component
   * @param {Object} initConfig.panels - Panels component
   * @param {Object} initConfig.header - Header component
   * @param {Object} initConfig.importDialog - Import dialog component
   * @param {Object} initConfig.functionCompiler - Function compiler
   * @param {Object} initConfig.adapters - Orchestrator-specific adapters
   * @param {Function} initConfig.adapters.setBatch - Set batch of cell values (loop filters non-editable)
   * @param {Object} [initConfig.config] - Static configuration
   * @param {string} [initConfig.config.logPrefix='[OrchestrationCore]'] - Log prefix
   * @param {string} [initConfig.config.defaultName='Untitled'] - Default spreadsheet name
   * @param {Object} [initConfig.hooks] - Behavioral hooks
   * @param {Function} [initConfig.hooks.afterHistoryChange] - Called after undo/redo
   * @param {Function} [initConfig.hooks.afterLoad] - Called after spreadsheet load
   * @param {Function} [initConfig.hooks.transformGridBounds] - Transform grid bounds for loop sheets
   * @param {Function} [initConfig.hooks.getName] - Returns current spreadsheet name
   * @param {Function} [initConfig.hooks.setName] - Sets current spreadsheet name
   * @param {Function} [initConfig.hooks.getScenarios] - Returns current scenarios array
   * @param {Function} [initConfig.hooks.getOutputValue] - (name) => value, resolves output name to cell value
   * @param {Function} [initConfig.hooks.getOpfsService] - Returns opfsService (may be null if not yet initialized)
   */
  function init(initConfig) {
    deps = {
      // Engines
      canonicalValuesEngine: initConfig.canonicalValuesEngine,
      formattingEngine: initConfig.formattingEngine,
      calculationEngine: initConfig.calculationEngine,
      storageEngine: initConfig.storageEngine,
      historyEngine: initConfig.historyEngine,
      clipboardEngine: initConfig.clipboardEngine,
      // Components
      toolbar: initConfig.toolbar,
      grid: initConfig.grid,
      formulaBar: initConfig.formulaBar,
      panels: initConfig.panels,
      header: initConfig.header,
      importDialog: initConfig.importDialog,
      codeExportDialog: initConfig.codeExportDialog,
      languagePackListDialog: initConfig.languagePackListDialog,
      // Services
      functionCompiler: initConfig.functionCompiler,
      // Adapters and hooks
      adapters: initConfig.adapters || {},
      hooks: initConfig.hooks || {},
      // Config
      config: {
        logPrefix: initConfig.config?.logPrefix || '[OrchestrationCore]',
        defaultName: initConfig.config?.defaultName || 'Untitled',
        basePath: initConfig.config?.basePath || (import.meta.env?.BASE_URL ?? '/'),
        sheetType: initConfig.config?.sheetType || 'standard',
      },
    };
  }

  /**
   * Verify transpiled JS by running scenarios through it and comparing
   * against the expected outputs (ground truth from the spreadsheet engine).
   *
   * @param {string} jsCode - Transpiled JavaScript code
   * @param {string} funcName - Function name (uppercase)
   * @param {Array} scenarios - Scenarios with .inputs and .outputs populated
   * @param {Array} inputNames - Ordered input names
   * @param {Array<string>} dependencyJsCode - JS code for dependency functions
   * @returns {Array<string>} List of error messages (empty if all pass)
   */
  function verifyTranspiledJs(jsCode, funcName, scenarios, inputNames, dependencyJsCode = []) {
    const TOLERANCE_FACTOR = 1e-6;
    const errors = [];

    // Compile the transpiled JS with dependencies
    let compiledFn;
    try {
      const allCode = [...dependencyJsCode, jsCode].join('\n');
      compiledFn = new Function(`
        ${allCode}
        return ${funcName.toUpperCase()};
      `)();
    } catch (e) {
      return [`Failed to compile transpiled JS: ${e.message}`];
    }

    for (let i = 0; i < scenarios.length; i++) {
      const sc = scenarios[i];
      if (!sc.outputs) continue;

      // Build args in input parameter order
      const args = inputNames.map(name => {
        const val = sc.inputs[name];
        return typeof val === 'string' ? parseFloat(val.replace(/\s/g, '')) || 0 : val;
      });

      let result;
      try {
        result = compiledFn(...args);
      } catch (e) {
        errors.push(`Scenario ${i + 1}: execution error: ${e.message}`);
        continue;
      }

      // Compare each output
      const outputNames = Object.keys(sc.outputs);
      for (const outputName of outputNames) {
        const expected = sc.outputs[outputName];
        if (typeof expected !== 'number') continue;

        // For multi-output functions, result is an object; for single-output, it's a number
        let actual;
        if (outputNames.length === 1) {
          actual = typeof result === 'number' ? result : result;
        } else {
          // Multi-output: result is an object with output names as keys
          actual = result[outputName];
        }

        // Compare the actual value against expected
        if (typeof actual === 'number') {
          const tolerance = Math.abs(expected) * TOLERANCE_FACTOR || TOLERANCE_FACTOR;
          if (Math.abs(actual - expected) >= tolerance) {
            errors.push(
              `Scenario ${i + 1} [${outputName}]: expected ${expected}, got ${actual}`
            );
          }
        }
      }
    }

    return errors;
  }

  /**
   * Records outputs for scenarios by cycling through each one,
   * setting its inputs, reading outputs, then restoring original inputs.
   * Uses setBatch with skipHistory to avoid polluting undo history.
   * Uses hooks.getOutputValue to resolve output names to cell values
   * (standard sheets use the name directly; loop sheets map to the final iteration row).
   */
  function recordScenarioOutputs(scenariosToProcess, inputNames, outputNames) {
    if (scenariosToProcess.length === 0 || inputNames.length === 0 || outputNames.length === 0) {
      return scenariosToProcess;
    }

    const getOutputValue = deps.hooks.getOutputValue
      || ((name) => deps.calculationEngine.getCellValue(name));

    const originalInputs = {};
    for (const name of inputNames) {
      originalInputs[name] = deps.canonicalValuesEngine.getValue(name);
    }

    for (let i = 0; i < scenariosToProcess.length; i++) {
      const sc = scenariosToProcess[i];
      const hasAllInputs = inputNames.every(name =>
        sc.inputs[name] !== undefined && sc.inputs[name] !== ''
      );

      if (!hasAllInputs) continue;

      // Use setBatch with skipHistory to avoid polluting undo history
      const entries = inputNames.map(name => [name, sc.inputs[name]]);
      deps.canonicalValuesEngine.setBatch(entries, { skipHistory: true });

      const outputs = {};
      for (const name of outputNames) {
        outputs[name] = getOutputValue(name);
      }
      scenariosToProcess[i].outputs = outputs;
    }

    // Restore original values with skipHistory
    const restoreEntries = inputNames.map(name => [name, originalInputs[name]]);
    deps.canonicalValuesEngine.setBatch(restoreEntries, { skipHistory: true });

    return scenariosToProcess;
  }

  /**
   * Records scenario outputs, resolves IDs, and exports versioned XML.
   *
   * @param {string} funcName - Function name (uppercase)
   * @returns {Promise<{xml: string, versionId: string, functionId: string, functionName: string, spreadsheetId: string, isNew: boolean}>}
   */
  async function assembleVersionedXml(funcName) {
    const scenarios = deps.hooks.getScenarios();
    const inputNames = deps.canonicalValuesEngine.getAllNamedInputs();
    const outputNames = deps.panels.getOutputCells();

    // Record scenario outputs before export
    recordScenarioOutputs(scenarios, inputNames, outputNames);

    // Get IDs
    const spreadsheetId = deps.storageEngine.getCurrentSpreadsheetId();
    const entry = await deps.storageEngine.getSheetMetadata(spreadsheetId);

    const versionId = crypto.randomUUID();
    const existingFunctionId = entry?.functionId;
    const functionId = existingFunctionId || crypto.randomUUID();
    const isNew = !existingFunctionId;

    // Export XML with embedded version info
    const xml = deps.storageEngine.exportToXml(funcName, {
      versionId,
      functionId,
      sourceSpreadsheetId: spreadsheetId
    });

    const previousVersionString = entry?.publishedVersion?.versionString || null;
    return { xml, versionId, functionId, functionName: funcName, spreadsheetId, isNew, previousVersionString };
  }

  /**
   * Clears selected cells (Delete/Backspace key).
   * Uses adapters.setBatch so loop sheets can filter non-editable cells.
   */
  function handleClearCells() {
    const selection = deps.grid.getSelection();
    const { cells } = expandRange(selection.start, selection.end);

    const clearEntries = cells.map(cellKey => [cellKey, '']);
    deps.adapters.setBatch(clearEntries);

    const activeCell = deps.grid.getActiveCell();
    if (cells.includes(activeCell)) {
      deps.formulaBar.loadCell(activeCell);
    }
  }

  /**
   * Handles undo operation and refreshes UI components.
   * Calls hooks.afterHistoryChange for orchestrator-specific post-undo work.
   */
  function handleUndo() {
    const success = deps.historyEngine.undo();
    if (success) {
      deps.clipboardEngine.cancelCut();

      // Call hook for orchestrator-specific work (e.g., runIterationLoop)
      if (deps.hooks.afterHistoryChange) {
        deps.hooks.afterHistoryChange();
      }

      const activeCell = deps.grid.getActiveCell();
      const selectionNotation = deps.grid.getSelectionNotation();
      deps.formulaBar.loadCell(activeCell);
      deps.formulaBar.updateCellNameDisplay(selectionNotation);
      deps.toolbar.updateHighlightState(deps.formattingEngine.getActiveHighlight());
      deps.panels.rebuildInputsList();
      deps.panels.refreshOutputs();
      deps.grid.refreshNamedRangeOverlays();
    }
  }

  /**
   * Handles redo operation and refreshes UI components.
   * Calls hooks.afterHistoryChange for orchestrator-specific post-redo work.
   */
  function handleRedo() {
    const success = deps.historyEngine.redo();
    if (success) {
      deps.clipboardEngine.cancelCut();

      // Call hook for orchestrator-specific work (e.g., runIterationLoop)
      if (deps.hooks.afterHistoryChange) {
        deps.hooks.afterHistoryChange();
      }

      const activeCell = deps.grid.getActiveCell();
      const selectionNotation = deps.grid.getSelectionNotation();
      deps.formulaBar.loadCell(activeCell);
      deps.formulaBar.updateCellNameDisplay(selectionNotation);
      deps.toolbar.updateHighlightState(deps.formattingEngine.getActiveHighlight());
      deps.panels.rebuildInputsList();
      deps.panels.refreshOutputs();
      deps.grid.refreshNamedRangeOverlays();
    }
  }

  // ============================================================================
  // SHARED CENTRAL FUNCTIONS (previously createSharedCentralFunctions)
  // ============================================================================

  /**
   * Updates toolbar undo/redo button states when history state changes.
   */
  function refreshHistoryButtons({ canUndo, canRedo }) {
    deps.toolbar.setUndoEnabled(canUndo);
    deps.toolbar.setRedoEnabled(canRedo);
  }

  /**
   * Applies cell format from format dialog to selected cells.
   * @param {Object} format - Format object (e.g., { NUMBER: {...} })
   */
  function handleApplyCellFormat(format) {
    const logPrefix = deps.config.logPrefix;
    const selection = deps.grid.getSelection();
    const { cells } = expandRange(selection.start, selection.end);

    const result = deps.formattingEngine.applyFormatRules(cells, format);

    if (!result.success) {
      console.error(`${logPrefix} Failed to apply cell format:`, result.error);
    }
  }

  /**
   * Applies default format from format dialog to spreadsheet-wide defaults.
   * @param {Object} format - Format object (e.g., { NUMBER: {...} })
   */
  function handleApplyDefaultFormat(format) {
    const logPrefix = deps.config.logPrefix;
    const typeKey = Object.keys(format)[0];
    const typeSpecificFormat = format[typeKey];

    const result = deps.formattingEngine.updateSpreadsheetDefault(typeKey, typeSpecificFormat);

    if (!result.success) {
      console.error(`${logPrefix} Failed to update default format:`, result.error);
      return;
    }

    if (typeKey === 'DATE' && typeSpecificFormat.dateInputFormat) {
      deps.canonicalValuesEngine.setDateInputFormat(typeSpecificFormat.dateInputFormat);
    }
  }

  // ============================================================================
  // LOADING FUNCTIONS
  // ============================================================================

  /**
   * Applies parsed spreadsheet state to the UI components.
   *
   * @param {Object} spreadsheet - Parsed spreadsheet data from parseXml()
   * @param {Object} options - Loading options
   * @param {boolean} [options.titleEditable=true] - Whether the title can be renamed
   * @param {string} [options.nameOverride=null] - Override name (uses spreadsheet.name if not provided)
   * @param {Array} [options.argValues=null] - Input values to populate (for drilldown)
   * @returns {Promise<{testCases: Array, name: string}>} Loaded state for orchestrator to capture
   */
  async function applySpreadsheetState(spreadsheet, options = {}) {
    const {
      titleEditable = true,
      nameOverride = null,
      argValues = null,
    } = options;

    const logPrefix = deps.config.logPrefix;
    const transformGridBounds = deps.hooks.transformGridBounds;

    // Set header title
    const name = nameOverride || spreadsheet.name;
    if (name) {
      deps.header.setTitle(name, titleEditable);
    }

    // Set grid bounds (with optional transformation for loop mode)
    if (spreadsheet.gridBounds) {
      const bounds = transformGridBounds
        ? transformGridBounds(spreadsheet.gridBounds)
        : spreadsheet.gridBounds;
      deps.grid.setGridBounds(bounds);
    }

    // Load custom function dependencies before restoring values,
    // so formulas can resolve custom functions on the first calc pass.
    if (spreadsheet.customFunctionIds && spreadsheet.customFunctionIds.length > 0) {
      try {
        const results = await deps.functionCompiler.loadFunctions(spreadsheet.customFunctionIds);
        const nameMap = spreadsheet.customFunctionNames || {};
        // Register one source at a time so multiple sources sharing a consumer
        // name merge into the entry's variant list rather than overwriting.
        // Restore is replaying known-good state — bypass collision checks.
        for (const [funcId, funcDef] of results) {
          if (funcDef.error) {
            console.warn(`${logPrefix} Failed to load function ${funcId}:`, funcDef.error);
            continue;
          }
          const consumerName = nameMap[funcId] || funcDef.name;
          deps.calculationEngine.registerFunction({ [consumerName]: funcDef }, { replace: true });
          const isSingleArray = funcDef.variants?.every(v =>
            v.argTypes.length === 1 && isArrayType(v.argTypes[0])
          );
          if (isSingleArray) {
            deps.canonicalValuesEngine.updateSingleArrayFunctions(consumerName, true);
          }
        }
      } catch (error) {
        console.error(`${logPrefix} Error loading custom functions:`, error);
      }
    }

    // Restore formatting
    deps.formattingEngine.restoreSnapshot({
      formatRules: spreadsheet.formatRules || [],
      cellStyles: spreadsheet.cellStyles || [],
      spreadsheetDefaults: spreadsheet.spreadsheetDefaults || {}
    });

    // Restore canonical values
    deps.canonicalValuesEngine.restoreSnapshot({
      canonicalValues: spreadsheet.canonicalValues || [],
      namedInputs: spreadsheet.namedInputs || []
    });

    // Capture test cases
    let testCases = spreadsheet.testCases && spreadsheet.testCases.length > 0
      ? spreadsheet.testCases
      : [];

    // Populate input values (for drilldown mode)
    // argValues are pre-serialized strings from getDrilldownInfo (or JSON round-tripped
    // through URL params), ready for setValue/detectType without further conversion.
    if (argValues) {
      const drilldownScenario = { inputs: {}, outputs: {}, drilldown: true };
      const namedInputs = spreadsheet.namedInputs || [];
      for (let i = 0; i < namedInputs.length && i < argValues.length; i++) {
        const inputName = namedInputs[i];
        const value = argValues[i] ?? '';
        deps.canonicalValuesEngine.setValue(inputName, value);
        drilldownScenario.inputs[inputName] = value;
      }
      // Prepend drilldown scenario so it appears first
      testCases = [drilldownScenario, ...testCases];
    }

    // Set output cells
    if (spreadsheet.outputCells && spreadsheet.outputCells.length > 0) {
      deps.panels.setOutputCells(spreadsheet.outputCells);
    }

    // Restore column names (display metadata for loop sheets)
    if (spreadsheet.columnNames && Object.keys(spreadsheet.columnNames).length > 0) {
      deps.grid.setColumnNames(spreadsheet.columnNames);
    }

    // Restore max iterations (loop sheets only)
    if (spreadsheet.maxIterations != null && deps.hooks.setMaxIterations) {
      deps.hooks.setMaxIterations(spreadsheet.maxIterations);
    }

    // Rebuild panels and load formula bar
    deps.panels.rebuildInputsList();
    const activeCell = deps.grid.getActiveCell();
    deps.formulaBar.loadCell(activeCell);

    return { testCases, name };
  }

  /**
   * Loads a custom function's definition spreadsheet for drill-down viewing.
   * Opens in scratchpad mode — ephemeral editing with no OPFS writes.
   *
   * @param {Object} config - Load configuration
   * @param {string} config.functionId - The function UUID
   * @param {string} [config.versionId] - The version UUID being previewed
   * @param {Array} [config.argValues] - Argument values to pre-fill
   * @returns {Promise<{name: string, testCases: Array}>} Loaded state for orchestrator to capture
   */
  async function loadDrilldown({ functionId, versionId, argValues }) {
    if (!functionId) {
      throw new Error('Could not load function: no functionId provided');
    }

    // Load current version from OPFS
    const funcDef = await deps.functionCompiler.loadFunction(functionId);
    const xmlContent = funcDef?.xmlContent;

    if (!xmlContent) {
      throw new Error(`Could not load function ${functionId}: no XML content available`);
    }

    // Check if we're showing a different version than requested
    if (versionId && funcDef.versionId && versionId !== funcDef.versionId) {
      deps.header.showSaveStatus('Note: Showing current version (may differ from when spreadsheet was built)', 5000);
    }

    const spreadsheet = parseXml(xmlContent);

    const resolvedFunctionName = funcDef?.name || spreadsheet.name;
    const resolvedVersionId = versionId || funcDef?.versionId;
    const resolvedVersionString = funcDef?.version || '1.0';
    const sourceSheetId = funcDef?.sourceSpreadsheetId;

    // Set scratchpad mode — no OPFS writes until fork/merge
    deps.storageEngine.setScratchpadMode(true);

    // Suppress markDirty during initial load
    deps.storageEngine.setLoading(true);
    const result = await applySpreadsheetState(spreadsheet, { argValues });
    deps.storageEngine.setLoading(false);

    // Set header to preview mode (UI unchanged, just wired to scratchpad)
    deps.header.setPreviewMode({
      functionId,
      versionId: resolvedVersionId,
      functionName: resolvedFunctionName,
      versionString: resolvedVersionString,
      basedOnSpreadsheetId: sourceSheetId,
    });

    // Call afterLoad hook (e.g., runIterationLoop for loop sheets)
    if (deps.hooks.afterLoad) {
      deps.hooks.afterLoad();
    }

    return {
      name: spreadsheet.name || deps.config.defaultName,
      testCases: result.testCases
    };
  }

  /**
   * Loads a spreadsheet from OPFS by ID.
   *
   * @param {string} id - The spreadsheet ID in OPFS
   * @returns {Promise<{name: string, testCases: Array}>} Loaded state for orchestrator to capture
   */
  async function loadFromOpfs(id) {
    const { xml, metadata } = await deps.storageEngine.loadSpreadsheetFromOpfs(id);
    const spreadsheet = parseXml(xml);

    deps.storageEngine.setCurrentSpreadsheetId(id, metadata);

    // Suppress markDirty during initial load
    deps.storageEngine.setLoading(true);
    const result = await applySpreadsheetState(spreadsheet, {
      nameOverride: metadata.name || deps.config.defaultName,
    });
    deps.storageEngine.setLoading(false);

    // Call afterLoad hook (e.g., runIterationLoop for loop sheets)
    if (deps.hooks.afterLoad) {
      deps.hooks.afterLoad();
    }

    return {
      name: result.name,
      testCases: result.testCases
    };
  }

  // ============================================================================
  // EXPORT AND PUBLISH
  // ============================================================================

  /**
   * Exports the current spreadsheet to an XML file for download.
   */
  async function exportSpreadsheet() {
    const logPrefix = deps.config.logPrefix;
    const spreadsheetId = deps.storageEngine.getCurrentSpreadsheetId();

    if (!spreadsheetId) {
      alert('No spreadsheet loaded');
      return;
    }

    try {
      const spreadsheetName = deps.hooks.getName();

      const { xml, versionId, functionId } = await assembleVersionedXml(spreadsheetName);

      await deps.storageEngine.clearUnpublished(spreadsheetId, versionId, functionId);
      const blob = new Blob([xml], { type: 'application/xml' });
      downloadBlob(blob, `${spreadsheetName}.xml`);

    } catch (error) {
      console.error(`${logPrefix} Export failed:`, error);
      alert(`Export failed: ${error.message}`);
    }
  }

  /**
   * Publishes the current spreadsheet using local-first approach.
   * Server only transpiles - all storage is local in OPFS.
   * Always publishes as the current sheet (functionId from manifest, name from sheet).
   *
   * @returns {Promise<{success: boolean, functionId?: string, versionId?: string, error?: string}>}
   */
  async function publishLocal() {
    const logPrefix = deps.config.logPrefix;

    // Validation
    if (deps.canonicalValuesEngine.getAllNamedInputs().length === 0) {
      return { success: false, error: 'Define at least one input first.' };
    }
    if (deps.panels.getOutputCells().length === 0) {
      return { success: false, error: 'Define at least one output first.' };
    }
    if (deps.hooks.getScenarios().length === 0) {
      return { success: false, error: 'Add at least one scenario first.' };
    }

    if (!deps.storageEngine.getCurrentSpreadsheetId()) {
      return { success: false, error: 'Spreadsheet must be saved first.' };
    }

    deps.header.showSaveStatus('Publishing...', 0);

    try {
      const spreadsheetName = deps.hooks.getName();
      const { xml, versionId, functionId, functionName, spreadsheetId, isNew, previousVersionString } = await assembleVersionedXml(spreadsheetName);

      // 1. Collect dependency XMLs for transpilation
      const customFunctions = await deps.storageEngine.collectDependenciesFromXml(xml);

      // 2. Transpile (server only - no storage)
      const transpileResult = await deps.functionCompiler.transpile(xml, 'javascript', customFunctions);

      if (transpileResult.error) {
        throw new Error(`Transpilation failed: ${transpileResult.error}`);
      }

      const jsCode = transpileResult.javascript;
      if (!jsCode) {
        throw new Error('Transpilation returned no JavaScript code');
      }

      // 3. Detect inputs the calculation graph never reads. The transpiler
      // drops these from the JS signature; if we leave them in the published
      // XML, drilldown would assign caller args to the wrong slots. Confirm
      // with the user, then strip them so the signature matches end to end.
      // The draft is untouched.
      const declaredInputs = deps.canonicalValuesEngine.getAllNamedInputs();
      const usedInputNames = new Set((transpileResult.signature?.inputs || []).map(i => i.name));
      const unusedInputs = declaredInputs.filter(name => !usedInputNames.has(name));

      let publishedXml = xml;
      if (unusedInputs.length > 0) {
        const list = unusedInputs.map(n => `  • ${n}`).join('\n');
        const msg =
          `These inputs aren't used by any output:\n\n${list}\n\n` +
          `They'll be removed from the published version (your draft is unchanged) ` +
          `so callers and drilldown stay in sync.\n\n` +
          `OK to publish and remove them? (Cancel to keep editing.)`;
        if (!confirm(msg)) {
          deps.header.hideSaveStatus();
          return { success: false, error: 'Publish cancelled' };
        }
        publishedXml = stripUnusedInputsFromXml(xml, unusedInputs);
      }

      // 3b. Save the published-XML snapshot. Done after the strip decision so
      // a cancelled publish (or transpile failure above) doesn't leave the
      // snapshot out of sync with the published JS — "discard to published"
      // then reverts to the last successful publish.
      await deps.storageEngine.savePublishedSnapshot(spreadsheetId, publishedXml);

      // 4. Verify transpiled JS against scenario outputs.
      // Use the transpiler's signature input order — that's the actual JS
      // parameter list. Passing args in declared order would misalign whenever
      // an unused input sits before a used one.
      const scenarios = deps.hooks.getScenarios();
      const inputNames = (transpileResult.signature?.inputs || []).map(i => i.name);
      if (scenarios.length > 0 && inputNames.length > 0) {
        deps.header.showSaveStatus('Verifying...', 0);

        // Load dependency JS for verification
        const dependencyJsCode = [];
        for (const depId of Object.keys(customFunctions)) {
          try {
            const depSheet = await deps.storageEngine.findSheetByFunctionId(depId);
            if (depSheet) {
              const depJs = await deps.hooks.getOpfsService().loadPublishedCode(depSheet.id);
              if (depJs) dependencyJsCode.push(depJs);
            }
          } catch (e) {
            console.warn(`${logPrefix} Could not load dependency JS for ${depId}:`, e.message);
          }
        }

        const verifyErrors = verifyTranspiledJs(jsCode, functionName, scenarios, inputNames, dependencyJsCode);
        if (verifyErrors.length > 0) {
          const summary = verifyErrors.slice(0, 5).join('\n');
          const more = verifyErrors.length > 5 ? `\n...and ${verifyErrors.length - 5} more` : '';
          throw new Error(`Transpiled code verification failed:\n${summary}${more}`);
        }
      }

      // 5. Save published version with signature from transpiler
      const versionString = nextVersionString(previousVersionString);
      await deps.storageEngine.publishSheet(spreadsheetId, publishedXml, jsCode, versionString, versionId, functionId, { signature: transpileResult.signature });

      deps.header.showSaveStatus('Published!', 3000);

      return {
        success: true,
        functionId,
        versionId,
        functionName,
        isNew
      };

    } catch (error) {
      console.error(`${logPrefix} Local publish failed:`, error);
      deps.header.hideSaveStatus();
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // SCRATCHPAD CALLBACKS (preview UI actions wired to scratchpad model)
  // ============================================================================

  function getPreviewCallbacks() {
    const logPrefix = deps.config.logPrefix;

    return {
      onPreviewMerge: async () => {
        const previewInfo = deps.header.getPreviewInfo();
        if (!previewInfo?.basedOnSpreadsheetId) {
          alert('Cannot merge: No source sheet found.');
          return;
        }

        if (!confirm('Merge changes to source sheet? This will replace the source content.')) {
          return;
        }

        try {
          deps.header.showSaveStatus('Merging...', 0);
          const spreadsheetName = deps.hooks.getName();
          const xml = deps.storageEngine.exportToXml(spreadsheetName);

          await deps.storageEngine.replaceSpreadsheetContent(previewInfo.basedOnSpreadsheetId, xml);
          deps.storageEngine.setScratchpadMode(false);

          window.location.href = sheetUrl(previewInfo.basedOnSpreadsheetId);

        } catch (error) {
          console.error(`${logPrefix} Merge failed:`, error);
          deps.header.hideSaveStatus();
          alert(`Merge failed: ${error.message}`);
        }
      },

      onPreviewDiscard: async () => {
        if (!confirm('Discard all changes?')) {
          return;
        }

        try {
          const previewInfo = deps.header.getPreviewInfo();
          deps.storageEngine.setScratchpadMode(false);

          if (previewInfo?.versionId || previewInfo?.functionId) {
            const params = new URLSearchParams();
            if (previewInfo.versionId) params.set('versionId', previewInfo.versionId);
            if (previewInfo.functionId) params.set('drilldown', previewInfo.functionId);
            window.location.href = `${appBasePath()}?${params.toString()}`;
          } else {
            window.location.reload();
          }

        } catch (error) {
          console.error(`${logPrefix} Discard failed:`, error);
          alert(`Discard failed: ${error.message}`);
        }
      },

      onPreviewSwitchToDraft: async () => {
        const previewInfo = deps.header.getPreviewInfo();
        if (!previewInfo?.basedOnSpreadsheetId) {
          alert('Cannot switch to draft: No source sheet found.');
          return;
        }

        if (deps.header.isDirty() && !confirm('Switch to draft and discard preview changes?')) {
          return;
        }

        try {
          const sheetId = previewInfo.basedOnSpreadsheetId;
          const metadata = await deps.storageEngine.getSheetMetadata(sheetId);
          if (metadata && metadata.hasDraft === false) {
            await deps.storageEngine.createDraftFromPublished(sheetId);
          }
          deps.storageEngine.setScratchpadMode(false);
          window.location.href = sheetUrl(sheetId);
        } catch (error) {
          console.error(`${logPrefix} Switch to draft failed:`, error);
          alert(`Switch to draft failed: ${error.message}`);
        }
      },

      onPreviewSaveAsNew: async () => {
        const currentName = deps.hooks.getName();
        const newName = prompt('Save preview as new sheet:', currentName);
        if (!newName || !newName.trim()) return;

        try {
          const xml = deps.storageEngine.exportToXml(newName);
          const newId = await deps.storageEngine.forkScratchpadToNewSheet(newName, xml);
          deps.header.exitPreviewMode();
          window.location.href = sheetUrl(newId);
        } catch (error) {
          console.error(`${logPrefix} Save as new failed:`, error);
          alert(`Save as new failed: ${error.message}`);
        }
      },

      onPreviewFork: async (newName) => {
        try {
          if (deps.storageEngine.isScratchpadMode()) {
            const spreadsheetName = deps.hooks.getName();
            const xml = deps.storageEngine.exportToXml(newName || spreadsheetName);
            await deps.storageEngine.forkScratchpadToNewSheet(newName, xml);
            deps.header.exitPreviewMode();
          } else {
            console.warn(`${logPrefix} Fork called but not in scratchpad mode`);
          }
        } catch (error) {
          console.error(`${logPrefix} Fork failed:`, error);
          alert(`Fork failed: ${error.message}`);
        }
      },
    };
  }

  // ============================================================================
  // SHARED CALLBACKS (replaces getCentralFunctions + createSharedCentralFunctions
  //                    + createSharedAdapters)
  // ============================================================================

  /**
   * Returns one flat bag of all shared callbacks for use in module configs.
   * Replaces the old getCentralFunctions() + createSharedCentralFunctions() +
   * createSharedAdapters() pattern.
   *
   * @returns {Object} All shared callback functions
   */
  function getSharedCallbacks() {
    const logPrefix = deps.config.logPrefix;

    return {
      // --- From old getCentralFunctions ---
      handleClearCells,
      handleUndo,
      handleRedo,
      recordScenarioOutputs,

      // --- From old createSharedCentralFunctions ---
      refreshHistoryButtons,
      handleApplyCellFormat,
      handleApplyDefaultFormat,

      // --- From old createSharedAdapters ---

      // Storage adapters
      getSpreadsheetName: () => deps.hooks.getName(),
      markDirty: () => deps.storageEngine.markDirty(),

      // Export
      onExportSelected: async ({ sheetIds }) => {
        if (!sheetIds || sheetIds.size === 0) return;

        try {
          const blob = await createExportPackage({
            sheetIds,
            storageEngine: deps.storageEngine,
            opfsService: deps.hooks.getOpfsService(),
          });

          const filename = generateExportFilename(sheetIds.size);
          downloadBlob(blob, filename);
        } catch (error) {
          console.error(`${logPrefix} Export failed:`, error);
          alert(`Export failed: ${error.message}`);
        }
      },

      // Publish (always targets the current sheet)
      onPublish: async () => {
        const result = await publishLocal();
        if (!result.success) {
          alert(`Publish failed: ${result.error}`);
        }
      },

      // Title
      onTitleChange: (name) => {
        deps.hooks.setName(name);
        const id = deps.storageEngine.getCurrentSpreadsheetId();
        if (id) {
          deps.storageEngine.renameSpreadsheet(id, name);
        }
      },

      // Custom function drill-down (from functions dialog "View" button)
      onDrillDown: ({ functionId, versionId, functionName, versionString, sheetType }) => {
        if (deps.hooks.onBreadcrumbReset && isBreadcrumbMode()) {
          if (deps.header.isInPreviewMode() && deps.header.isDirty()) {
            if (!confirm('You have unsaved changes to this preview. Discard changes and continue?')) return;
          }
          deps.hooks.onBreadcrumbReset({ functionId, versionId, functionName, versionString, sheetType });
        } else {
          openDrilldown({ functionId, versionId, functionName, versionString, sheetType });
        }
      },

      // Preview mode
      ...getPreviewCallbacks(),

      // Unpublished changes
      onUnpublishedChange: async (hasChanges) => {
        const currentId = deps.storageEngine.getCurrentSpreadsheetId();
        if (!currentId) {
          deps.header.setUnpublishedInfo({ hasChanges: false });
          return;
        }

        const metadata = await deps.storageEngine.getSheetMetadata(currentId);
        const functionId = metadata?.functionId || null;

        if (!hasChanges || deps.storageEngine.isScratchpadMode()) {
          deps.header.setUnpublishedInfo({ hasChanges: false, functionId });
          return;
        }

        const hasSnapshot = await deps.storageEngine.hasPublishedVersion(currentId);
        deps.header.setUnpublishedInfo({
          hasChanges: hasChanges && hasSnapshot,
          versionString: metadata?.publishedVersion?.versionString || null,
          functionId
        });
      },

      onViewBuiltVersion: async () => {
        const currentId = deps.storageEngine.getCurrentSpreadsheetId();
        const metadata = await deps.storageEngine.getSheetMetadata(currentId);
        const functionId = metadata?.functionId;
        if (!functionId) return;

        const funcMeta = await deps.storageEngine.getFunctionMetadata(functionId);
        const drilldownInfo = {
          functionId,
          versionId: funcMeta?.versionId,
          functionName: funcMeta?.name,
          versionString: funcMeta?.version,
          sheetType: funcMeta?.sheetType
        };
        if (deps.hooks.onBreadcrumbReset && isBreadcrumbMode()) {
          deps.hooks.onBreadcrumbReset(drilldownInfo);
        } else {
          openDrilldown(drilldownInfo);
        }
      },

      onDiscardToLastPublished: async () => {
        if (!confirm('Discard all changes since last publish? This cannot be undone.')) {
          return;
        }

        const currentId = deps.storageEngine.getCurrentSpreadsheetId();
        await deps.storageEngine.discardToPublished(currentId);
        window.location.reload();
      },

      // Export current sheet as .zip
      onExportCurrent: async () => {
        const currentId = deps.storageEngine.getCurrentSpreadsheetId();
        if (!currentId) return;

        try {
          // Record scenario outputs and re-save so the draft XML has populated outputs
          const scenarios = deps.hooks.getScenarios();
          const inputNames = deps.canonicalValuesEngine.getAllNamedInputs();
          const outputNames = deps.panels.getOutputCells();
          recordScenarioOutputs(scenarios, inputNames, outputNames);
          await deps.storageEngine.saveNow();

          const blob = await createExportPackage({
            sheetIds: new Set([currentId]),
            storageEngine: deps.storageEngine,
            opfsService: deps.hooks.getOpfsService(),
            entrySheetId: currentId,
          });
          const metadata = await deps.storageEngine.getSheetMetadata(currentId);
          const name = metadata?.name || 'sheet';
          downloadBlob(blob, `${name}.zip`);
        } catch (error) {
          console.error(`${logPrefix} Export current failed:`, error);
          alert(`Export failed: ${error.message}`);
        }
      },

      // Manage language packs
      onManageLanguagePacks: () => {
        deps.languagePackListDialog?.open();
      },

      // Export code in various languages
      onExportCode: async () => {
        const xml = deps.storageEngine.exportToXml(deps.hooks.getName());
        const customFunctions = await deps.storageEngine.collectDependenciesFromXml(xml);
        deps.codeExportDialog?.open(xml, customFunctions, deps.hooks.getName());
      },

      // Export current sheet as portable HTML (hosted builds only; the single-
      // bundle variant has no sibling export/index.html to fetch)
      onExportHtml: import.meta.env?.SC_SINGLE_BUNDLE ? undefined : async () => {
        // In preview mode the orchestrator runs against scratchpad memory and
        // never calls setCurrentSpreadsheetId, so fall back to the source sheet
        // the published function was built from — its OPFS files back the view.
        const currentId = deps.storageEngine.getCurrentSpreadsheetId()
          || (deps.header.isInPreviewMode() ? deps.header.getPreviewInfo()?.basedOnSpreadsheetId : null);
        if (!currentId) {
          alert('No spreadsheet loaded');
          return;
        }

        try {
          const metadata = await deps.storageEngine.getSheetMetadata(currentId);
          const { exportAsHtml } = await import('../../utils/htmlExporter.js');
          await exportAsHtml({
            currentId,
            storageEngine: deps.storageEngine,
            opfsService: deps.hooks.getOpfsService(),
            name: metadata?.name || 'spreadsheet',
          });
        } catch (error) {
          console.error(`${logPrefix} Export HTML failed:`, error);
          alert(`Export as HTML failed: ${error.message}`);
        }
      },

      // Delete current sheet and navigate away
      onDeleteCurrent: async () => {
        const currentId = deps.storageEngine.getCurrentSpreadsheetId();
        if (!currentId) return;

        if (!confirm('Delete this spreadsheet?\n\nThis cannot be undone.')) return;

        try {
          await deps.storageEngine.deleteSpreadsheet(currentId);
          window.location.href = appBasePath();
        } catch (error) {
          console.error(`${logPrefix} Delete current failed:`, error);
          alert(`Delete failed: ${error.message}`);
        }
      },

      // File browser navigation — overridable for viewer mode (in-place loading)
      onOpenSpreadsheet: async (id) => {
        if (deps.header.isInPreviewMode() && deps.header.isDirty()) {
          if (!confirm('You have unsaved changes to this preview. Discard changes and continue?')) return;
        }
        const meta = await deps.storageEngine.getSheetMetadata(id);
        const sheetType = meta?.type || 'standard';
        if (deps.hooks.onOpenSpreadsheet) {
          deps.hooks.onOpenSpreadsheet(id, sheetType);
        } else {
          window.location.href = sheetUrl(id, sheetType);
        }
      },

      // Import
      getOpfsService: () => deps.hooks.getOpfsService(),

      // Drop zone
      onZipDrop: async (file) => {
        await deps.importDialog.open(file);
      },
      onXmlDrop: async (file) => {
        try {
          const { id, type } = await deps.storageEngine.importFile(file);
          window.location.href = sheetUrl(id, type);
        } catch (error) {
          console.error(`${logPrefix} Failed to import file:`, error);
          alert('Failed to import file: ' + error.message);
        }
      },

      // HTML file import (portable HTML export)
      onHtmlDrop: async (file) => {
        try {
          const zipBlob = await extractZipFromHtml(file);
          const zipFile = new File([zipBlob], file.name.replace(/\.html?$/i, '.zip'), { type: 'application/zip' });
          await deps.importDialog.open(zipFile);
        } catch (error) {
          console.error(`${logPrefix} Failed to import HTML:`, error);
          alert('Failed to import HTML file: ' + error.message);
        }
      },

      // Folder import
      onFolderDrop: async (directoryEntry) => {
        try {
          const data = await parseImportFolderFromEntries(directoryEntry);
          await deps.importDialog.openWithData(data, directoryEntry.name);
        } catch (error) {
          console.error(`${logPrefix} Failed to import folder:`, error);
          alert('Failed to import folder: ' + error.message);
        }
      },
      onFolderPick: async (fileList) => {
        try {
          const data = await parseImportFolder(fileList);
          const folderName = fileList[0].webkitRelativePath.split('/')[0];
          await deps.importDialog.openWithData(data, folderName);
        } catch (error) {
          console.error(`${logPrefix} Failed to import folder:`, error);
          alert('Failed to import folder: ' + error.message);
        }
      },
    };
  }

  /**
   * Restore state from an XML string (for breadcrumb navigation).
   * Parses the XML and applies the full spreadsheet state.
   *
   * @param {string} xml - Serialized spreadsheet XML
   * @returns {Promise<{name: string, testCases: Array}>}
   */
  async function restoreFromXml(xml) {
    const spreadsheet = parseXml(xml);
    deps.storageEngine.setLoading(true);
    try {
      const result = await applySpreadsheetState(spreadsheet);
      deps.hooks.afterLoad?.();
      return result;
    } finally {
      deps.storageEngine.setLoading(false);
    }
  }

  return {
    init,
    getSharedCallbacks,
    loadDrilldown,
    loadFromOpfs,
    restoreFromXml,
    exportSpreadsheet,
    publishLocal,
  };
}
