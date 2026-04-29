/**
 * @file Shared Orchestrator Utilities
 * @description Common factories and configurations shared between
 * spreadsheet-orchestrator and loop-sheet-orchestrator.
 */

import { createCalculationEngine } from '../../Engines/calculationEngine.js';
import { createFormattingEngine } from '../../Engines/formattingEngine.js';
import { createStorageEngine } from '../../Engines/storageEngine.js';
import { createHistoryEngine } from '../../Engines/historyEngine.js';
import { createCanonicalValuesEngine, PREVIEW_KEY } from '../../Engines/canonicalValuesEngine.js';
import { createClipboardEngine } from '../../Engines/clipboardEngine.js';
import { getBuiltInFunctions } from '../../utils/functions.js';
import { createScenarioEngine } from '../../Engines/scenarioEngine.js';
import { appBasePath } from '../../utils/appMode.js';
import { createGrid } from '../../components/grid.js';
import { createFormulaBar } from '../../components/formula-bar.js';
import { createHeader, createToolbar } from '../../components/top-controls.js';
import { createPanelsComponent } from '../../components/panels.js';
import { createFormatDialog } from '../../components/format-dialog.js';
import { createFunctionsDialog } from '../../components/functions-dialog.js';
import { createImportDialog } from '../../components/import-dialog.js';
import { createDropZone } from '../../components/drop-zone.js';
import { createNamedRangesDialog } from '../../components/named-ranges-dialog.js';
import { createCodeExportDialog } from '../../components/code-export-dialog.js';
import { createLanguagePackListDialog } from '../../components/language-pack-list-dialog.js';
import { createLanguagePackEditor } from '../../components/language-pack-editor.js';
import { createLanguagePackEngine } from '../../Engines/languagePackEngine.js';
import { normalizeName, isValidNameSyntax } from '../../utils/nameValidation.js';
import { isArrayType } from '../../utils/typeService.js';
import { updateInputReference } from '../../utils/clipboardUtils.js';
import {
  parseImportZip,
  detectConflicts,
  checkMissingDependencies,
  checkMissingScenarioFunctions,
  executeImport,
  generateImportFolderName,
  publishImportedSheets,
  findTopLevelSheet,
} from '../../utils/importPackager.js';
import { openDrilldown } from './orchestration-core.js';
import { isBreadcrumbMode } from '../../utils/appMode.js';

/**
 * Creates all engine instances.
 * @returns {Object} Object containing all engine instances
 */
export function createEngines() {
  const calculationEngine = createCalculationEngine();
  calculationEngine.markSkipDisplay(PREVIEW_KEY);
  return {
    canonicalValuesEngine: createCanonicalValuesEngine(),
    formattingEngine: createFormattingEngine(),
    calculationEngine,
    storageEngine: createStorageEngine(),
    historyEngine: createHistoryEngine(),
    clipboardEngine: createClipboardEngine(),
    scenarioEngine: createScenarioEngine(),
    languagePackEngine: createLanguagePackEngine(),
  };
}

/**
 * Creates all component instances.
 * @returns {Object} Object containing all component instances
 */
export function createComponents({ gridInitialBounds } = {}) {
  return {
    ...createPersistentComponents(),
    grid: createGrid(gridInitialBounds),
  };
}

/**
 * Creates components that persist across orchestrator swaps.
 * Grid is excluded — its DOM container changes when switching sheet types.
 * @returns {Object} Component instances (everything except grid)
 */
export function createPersistentComponents() {
  return {
    formulaBar: createFormulaBar(),
    panels: createPanelsComponent(),
    header: createHeader(),
    toolbar: createToolbar(),
    formatDialog: createFormatDialog(),
    functionsDialog: createFunctionsDialog(),
    importDialog: createImportDialog(),
    dropZone: createDropZone(),
    namedRangesDialog: createNamedRangesDialog(),
    codeExportDialog: createCodeExportDialog(),
    languagePackListDialog: createLanguagePackListDialog(),
    languagePackEditor: createLanguagePackEditor(),
  };
}

/**
 * Initializes all modules with their configs.
 * Validates types and calls init() on each module.
 *
 * @param {Object} modules - Map of module name to module instance
 * @param {Object} moduleConfigs - Map of module name to config object
 * @param {string} logPrefix - Prefix for log messages (e.g., '[Orchestrator]')
 */
export function initializeModules(modules, moduleConfigs, logPrefix = '[Orchestrator]') {
  for (const [moduleName, moduleConfig] of Object.entries(moduleConfigs)) {
    const module = modules[moduleName];

    if (!module) {
      throw new Error(`${logPrefix} ${moduleName} not created`);
    }

    if (typeof module.init !== 'function') {
      throw new Error(`${logPrefix} ${moduleName}.init is not a function`);
    }

    // Validate each dependency and build clean init config
    const initConfig = {};
    for (const [depName, spec] of Object.entries(moduleConfig)) {
      const { type, value } = spec;

      if (value === null || value === undefined) {
        throw new Error(`${logPrefix} ${moduleName}.${depName} is null or undefined`);
      }

      // Type validation
      switch (type) {
        case 'function':
          if (typeof value !== 'function') {
            throw new Error(`${logPrefix} ${moduleName}.${depName} expected function, got ${typeof value}`);
          }
          break;
        case 'map':
          if (!(value instanceof Map)) {
            throw new Error(`${logPrefix} ${moduleName}.${depName} expected Map, got ${value.constructor.name}`);
          }
          break;
        case 'array':
          if (!Array.isArray(value)) {
            throw new Error(`${logPrefix} ${moduleName}.${depName} expected Array, got ${typeof value}`);
          }
          break;
        case 'number':
          if (typeof value !== 'number') {
            throw new Error(`${logPrefix} ${moduleName}.${depName} expected number, got ${typeof value}`);
          }
          break;
        case 'object':
          if (typeof value !== 'object' || value === null) {
            throw new Error(`${logPrefix} ${moduleName}.${depName} expected object, got ${typeof value}`);
          }
          break;
        case 'string':
          if (typeof value !== 'string') {
            throw new Error(`${logPrefix} ${moduleName}.${depName} expected string, got ${typeof value}`);
          }
          break;
        default:
          throw new Error(`${logPrefix} ${moduleName}.${depName} has unknown type specification: ${type}`);
      }

      initConfig[depName] = value;
    }

    module.init(initConfig);
  }
}

/**
 * Creates the module configs that are completely identical between orchestrators.
 *
 * @param {Object} deps - All dependencies needed by the configs
 * @returns {Object} Module configs for identical modules
 */
export function createIdenticalModuleConfigs({
  // Engines
  calculationEngine,
  formattingEngine,
  canonicalValuesEngine,
  clipboardEngine,
  storageEngine,
  scenarioEngine,
  // Components
  grid,
  panels,
  formatDialog,
  functionsDialog,
  namedRangesDialog,
  formulaBar,
  // Services
  functionCompiler,
  // Callbacks (shared + orchestrator-specific)
  callbacks,
  // Config
  maxHistorySize = 50,
}) {
  return {
    calculationEngine: {
      computeDisplayValue: { type: 'function', value: formattingEngine.computeDisplayValue },
      onDeleteAnonymous: { type: 'function', value: (key) => canonicalValuesEngine.deleteAnonymousExpression(key) },
    },

    historyEngine: {
      maxSize: { type: 'number', value: maxHistorySize },
      onHistoryStateChange: { type: 'function', value: callbacks.refreshHistoryButtons },
    },

    toolbar: {
      onBold: { type: 'function', value: () => formattingEngine.applyBold() },
      onItalic: { type: 'function', value: () => formattingEngine.applyItalic() },
      onFontSizeIncrease: { type: 'function', value: () => formattingEngine.increaseFontSize() },
      onFontSizeDecrease: { type: 'function', value: () => formattingEngine.decreaseFontSize() },
      onAlignLeft: { type: 'function', value: () => formattingEngine.alignLeft() },
      onAlignCenter: { type: 'function', value: () => formattingEngine.alignCenter() },
      onAlignRight: { type: 'function', value: () => formattingEngine.alignRight() },
      onCopyOrCut: { type: 'function', value: (isCut) => clipboardEngine.performCopyOrCut(isCut) },
      onPaste: { type: 'function', value: () => clipboardEngine.paste() },
      onPasteValues: { type: 'function', value: () => clipboardEngine.paste(undefined, { valuesOnly: true }) },
      onCancelCut: { type: 'function', value: () => clipboardEngine.cancelCut() },
      onUndo: { type: 'function', value: callbacks.handleUndo },
      onRedo: { type: 'function', value: callbacks.handleRedo },
      onFormat: { type: 'function', value: () => formatDialog.open() },
      onClearFormatting: { type: 'function', value: () => formattingEngine.clearFormatting() },
      onCustomFunctions: { type: 'function', value: () => functionsDialog.open({ tab: 'loaded' }) },
      onTogglePanels: { type: 'function', value: () => panels.toggle() },
      onNamedRanges: { type: 'function', value: () => namedRangesDialog.open() },
      onHighlight: { type: 'function', value: (name) => formattingEngine.applyHighlight(name) },
    },

    formatDialog: {
      onApplyCellFormat: { type: 'function', value: callbacks.handleApplyCellFormat },
      onApplyDefaultFormat: { type: 'function', value: callbacks.handleApplyDefaultFormat },
      getSpreadsheetDefaults: { type: 'function', value: () => formattingEngine.getSpreadsheetDefaults() },
      getSelection: { type: 'function', value: () => grid.getSelection() },
      getCellFormatRules: { type: 'function', value: (cellKey) => formattingEngine.getCellFormatRules(cellKey) },
    },

    functionsDialog: {
      // Sheet browsing
      listSheets: { type: 'function', value: () => storageEngine.listSheets() },
      listFolderContents: { type: 'function', value: (folderId) => storageEngine.listFolderContents(folderId) },
      getFolderPath: { type: 'function', value: (folderId) => storageEngine.getFolderPath(folderId) },
      deleteSpreadsheetBatch: { type: 'function', value: (ids) => storageEngine.deleteSpreadsheetBatch(ids) },
      updateSheetMetadata: { type: 'function', value: (id, updates) => storageEngine.updateSheetMetadata(id, updates) },
      moveSheetToFolder: { type: 'function', value: (id, folderId) => storageEngine.moveSheetToFolder(id, folderId) },
      moveFolderToFolder: { type: 'function', value: (id, targetFolderId) => storageEngine.moveFolderToFolder(id, targetFolderId) },
      getCurrentSheetId: { type: 'function', value: () => storageEngine.getCurrentSpreadsheetId() },
      // Sheet creation/opening
      onOpen: { type: 'function', value: callbacks.onOpenSpreadsheet },
      onNewStandard: { type: 'function', value: (folderId) => {
        const url = new URL(appBasePath('standard'), window.location.origin);
        url.searchParams.set('new', 'standard');
        if (folderId) url.searchParams.set('folder', folderId);
        window.location.href = url.toString();
      }},
      onNewLoop: { type: 'function', value: (folderId) => {
        const url = new URL(appBasePath('loop'), window.location.origin);
        url.searchParams.set('new', 'loop');
        if (folderId) url.searchParams.set('folder', folderId);
        window.location.href = url.toString();
      }},
      onOpenScenario: { type: 'function', value: (scenarioId) => {
        const url = new URL(import.meta.env.BASE_URL + 'scenario.html', window.location.origin);
        url.searchParams.set('id', scenarioId);
        window.location.href = url.toString();
      }},
      listScenarios: { type: 'function', value: () => scenarioEngine.listScenarios() },
      deleteScenarioBatch: { type: 'function', value: (ids) => scenarioEngine.deleteScenarioBatch(ids) },
      moveScenarioToFolder: { type: 'function', value: (id, folderId) => scenarioEngine.moveScenarioToFolder(id, folderId) },
      createScenario: { type: 'function', value: (name, functionId, functionName, folderId) =>
        scenarioEngine.createScenario(name, functionId, functionName, { folderId })
      },
      // Folder CRUD
      createFolder: { type: 'function', value: (name, parentId) => storageEngine.createFolder(name, parentId) },
      renameFolder: { type: 'function', value: (folderId, newName) => storageEngine.renameFolder(folderId, newName) },
      deleteFolder: { type: 'function', value: (folderId) => storageEngine.deleteFolder(folderId) },
      // Function loading
      loadFunctionById: { type: 'function', value: (id) => functionCompiler.loadFunction(id) },
      registerFunction: { type: 'function', value: (functions, options) => {
        // Check if any registered function has a single-array signature,
        // and re-normalize dependent formulas if so
        for (const [name, funcDef] of Object.entries(functions)) {
          const isSingleArray = funcDef.variants?.every(v =>
            v.argTypes.length === 1 && isArrayType(v.argTypes[0])
          );
          if (isSingleArray) {
            canonicalValuesEngine.updateSingleArrayFunctions(name, true);
            const dependents = Array.from(calculationEngine.getDependentsOf(name));
            if (dependents.length > 0) {
              canonicalValuesEngine.renormalizeFormulas(dependents);
            }
          }
        }
        const result = calculationEngine.registerFunction(functions, options);
        storageEngine.markDirty();
        return result;
      }},
      getFunctionsWithMetadata: { type: 'function', value: () => calculationEngine.getFunctionsWithMetadata() },
      unregisterFunction: { type: 'function', value: (functionId) => {
        const result = calculationEngine.unregisterFunctionById(functionId);
        if (!result) return result;
        if (result.fullyRemoved) {
          canonicalValuesEngine.updateSingleArrayFunctions(result.name, false);
        }
        if (result.dependents.length > 0) {
          canonicalValuesEngine.renormalizeFormulas(result.dependents);
        }
        storageEngine.markDirty();
        return result;
      }},
      getNodeCalcData: { type: 'function', value: () => calculationEngine.getNodeCalcData() },
      onDrillDown: { type: 'function', value: callbacks.onDrillDown || (() => {}) },
      deleteFunction: { type: 'function', value: (id) => storageEngine.deleteFunction(id) },
      onExport: { type: 'function', value: callbacks.onExportSelected || (() => {}) },
      onImport: { type: 'function', value: () => storageEngine.open({
        onZipFile: async (file) => {
          await callbacks.onZipDrop?.(file);
          functionsDialog.refresh();
        },
      }) },
      onImportFromUrl: { type: 'function', value: (url) => {
        const opfsService = callbacks.getOpfsService?.();
        return fetchAndImportFromUrl(url, { storageEngine, opfsService, functionCompiler });
      } },
      duplicateSpreadsheet: { type: 'function', value: (sourceId, newName, targetFolderId) => storageEngine.duplicateSpreadsheet(sourceId, newName, targetFolderId) },
      createDraftFromPublished: { type: 'function', value: (id) => storageEngine.createDraftFromPublished(id) },
    },

    importDialog: {
      storageEngine: { type: 'object', value: storageEngine },
      getOpfsService: { type: 'function', value: callbacks.getOpfsService || (() => null) },
      parseImportZip: { type: 'function', value: parseImportZip },
      detectConflicts: { type: 'function', value: detectConflicts },
      checkMissingDependencies: { type: 'function', value: checkMissingDependencies },
      checkMissingScenarioFunctions: { type: 'function', value: checkMissingScenarioFunctions },
      executeImport: { type: 'function', value: executeImport },
      generateImportFolderName: { type: 'function', value: generateImportFolderName },
      functionCompiler: { type: 'object', value: functionCompiler },
      publishImportedSheets: { type: 'function', value: publishImportedSheets },
    },

    dropZone: {
      onZipDrop: { type: 'function', value: callbacks.onZipDrop || (() => {}) },
      onXmlDrop: { type: 'function', value: callbacks.onXmlDrop || (() => {}) },
      onFolderDrop: { type: 'function', value: callbacks.onFolderDrop || (() => {}) },
      onHtmlDrop: { type: 'function', value: callbacks.onHtmlDrop || (() => {}) },
    },

    namedRangesDialog: {
      getAllNamedRanges: { type: 'function', value: () => canonicalValuesEngine.getAllNamedRanges() },
      renameNamedRange: { type: 'function', value: (oldName, newName) => canonicalValuesEngine.renameNamedRange(oldName, newName) },
      deleteNamedRange: { type: 'function', value: (name) => canonicalValuesEngine.deleteNamedRange(name) },
      onRefreshNamedRangeDisplay: { type: 'function', value: () => {
        const notation = grid.getSelectionNotation();
        formulaBar.updateCellNameDisplay(notation);
        grid.refreshNamedRangeOverlays();
      }},
    },
  };
}

/**
 * Creates the base clipboard engine config.
 * Orchestrator can spread this and override setBatch if needed.
 */
export function createBaseClipboardConfig({
  grid,
  canonicalValuesEngine,
  formulaBar,
  toolbar,
  formattingEngine,
  calculationEngine,
  historyEngine,
  callbacks,
}) {
  return {
    getSelection: { type: 'function', value: () => grid.getSelection() },
    getValue: { type: 'function', value: (cellKey) => canonicalValuesEngine.getValue(cellKey) },
    setBatch: { type: 'function', value: callbacks.setBatch },
    getActiveCell: { type: 'function', value: () => grid.getActiveCell() },
    refreshFormulaBar: { type: 'function', value: (cellKey) => formulaBar.loadCell(cellKey) },
    getGridBounds: { type: 'function', value: () => grid.getGridBounds() },
    onCutMarked: { type: 'function', value: (selection) => grid.markCellsAsCut(selection) },
    onCutStateChange: { type: 'function', value: (isCut) => toolbar.setCancelCutVisible(isCut) },
    getAllNamedRanges: { type: 'function', value: () => canonicalValuesEngine.getAllNamedRanges() },
    moveNamedRange: { type: 'function', value: (name, newNotation) => canonicalValuesEngine.moveNamedRange(name, newNotation) },
    onRefreshNamedRangeDisplay: { type: 'function', value: () => {
      const selection = grid.getSelection();
      const notation = selection.start === selection.end ? selection.start : `${selection.start}:${selection.end}`;
      formulaBar.updateCellNameDisplay(notation);
      grid.refreshNamedRangeOverlays();
    }},
    getDependentsOf: { type: 'function', value: (cellKey) => calculationEngine.getDependentsOf(cellKey) },
    getFormattingBatch: { type: 'function', value: (cellKeys) => formattingEngine.getFormattingBatch(cellKeys) },
    setFormattingBatch: { type: 'function', value: (updates) => formattingEngine.setFormattingBatch(updates) },
    clearFormattingBatch: { type: 'function', value: (cellKeys) => formattingEngine.clearFormattingBatch(cellKeys) },
    beginHistoryBatch: { type: 'function', value: () => historyEngine.beginBatch() },
    endHistoryBatch: { type: 'function', value: () => historyEngine.endBatch() },
    getCalcNode: { type: 'function', value: (cellKey) => calculationEngine.getNode(cellKey) },
  };
}

/**
 * Creates the base formula bar config.
 * Orchestrator can spread this and add isCellEditable/onDisabledClick for loop sheets.
 */
export function createBaseFormulaBarConfig({
  canonicalValuesEngine,
  calculationEngine,
  grid,
  callbacks,
}) {
  return {
    loadValue: { type: 'function', value: (cellKey) => canonicalValuesEngine.getValue(cellKey) },
    onCommit: { type: 'function', value: callbacks.onCommit },
    focusActiveCell: { type: 'function', value: () => grid.focusActiveCell() },
    collapseToActiveCell: { type: 'function', value: () => grid.collapseToActiveCell() },
    stepSelectionAnchor: { type: 'function', value: (direction) => grid.stepSelectionAnchor(direction) },
    moveActiveCell: { type: 'function', value: (direction) => grid.moveActiveCell(direction) },
    lookupRangeName: { type: 'function', value: (notation) => canonicalValuesEngine.lookupRangeName(notation) },
    isNamedReference: { type: 'function', value: (name) => {
      const upper = (name || '').toUpperCase();
      return canonicalValuesEngine.resolveNamedRange(upper) !== null
        || canonicalValuesEngine.getAllNamedInputs().includes(upper);
    }},
    createNamedRange: { type: 'function', value: (name, notation) => {
      const result = canonicalValuesEngine.createNamedRange(name, notation);
      if (result.success) grid.refreshNamedRangeOverlays();
      return result;
    }},
    renameNamedRange: { type: 'function', value: (oldName, newName) => {
      const result = canonicalValuesEngine.renameNamedRange(oldName, newName);
      if (!result.success) return result;

      // Rewrite dependent formulas so =SUM(oldName) becomes =SUM(newName). Same
      // pattern as renameNamedInput — the engine doesn't touch dependents.
      const dependents = calculationEngine.getDependentsOf(oldName);
      if (dependents.size > 0) {
        const updates = [];
        for (const cellKey of dependents) {
          const value = canonicalValuesEngine.getValue(cellKey);
          if (value && value.startsWith('=')) {
            const newFormula = updateInputReference(value, oldName, result.newName);
            if (newFormula !== value) {
              updates.push([cellKey, newFormula]);
            }
          }
        }
        if (updates.length > 0) {
          canonicalValuesEngine.setBatch(updates);
        }
      }

      grid.refreshNamedRangeOverlays();
      return result;
    }},
    deleteNamedRange: { type: 'function', value: (name) => {
      const result = canonicalValuesEngine.deleteNamedRange(name);
      if (result.success) grid.refreshNamedRangeOverlays();
      return result;
    }},
    commitUnhandledPointers: { type: 'function', value: () => grid.commitUnhandledPointers() },
    onRefColorsChanged: { type: 'function', value: (refColorMap) => {
      if (refColorMap) {
        grid.updateFormulaRefOverlays(refColorMap, (name) => canonicalValuesEngine.resolveNamedRange(name));
      } else {
        grid.clearFormulaRefOverlays();
      }
    }},
    getErrorSpans: { type: 'function', value: (cellKey) =>
      canonicalValuesEngine.findErrorSpans(cellKey, (key) => calculationEngine.getNode(key))
    },
    previewEvaluate: { type: 'function', value: (rawValue, tokens) =>
      canonicalValuesEngine.previewEvaluate(rawValue, tokens)
    },
    previewClear: { type: 'function', value: () =>
      canonicalValuesEngine.previewClear()
    },
    getNodeValue: { type: 'function', value: (key) =>
      calculationEngine.getNode(key)
    },
    getNodeEntries: { type: 'function', value: () => calculationEngine.getNodeCalcData() },
    getExpressionProvenance: { type: 'function', value: (key) =>
      canonicalValuesEngine.getExpressionProvenance(key)
    }
  };
}

/**
 * Creates the base panels config.
 * Orchestrator can spread this and override getCellDisplay for loop sheets.
 */
export function createBasePanelsConfig({
  canonicalValuesEngine,
  calculationEngine,
  formulaBar,
  toolbar,
  storageEngine,
  callbacks,
}) {
  return {
    createNamedInput: { type: 'function', value: (name) => canonicalValuesEngine.createNamedInput(name) },
    renameNamedInput: { type: 'function', value: (oldName, newName) => {
      const result = canonicalValuesEngine.renameNamedInput(oldName, newName);
      if (!result.success) return result;

      // Update all formulas that reference the old input name
      const dependents = calculationEngine.getDependentsOf(oldName);
      if (dependents.size > 0) {
        const updates = [];
        for (const cellKey of dependents) {
          const value = canonicalValuesEngine.getValue(cellKey);
          if (value && value.startsWith('=')) {
            const newFormula = updateInputReference(value, oldName, result.newName);
            if (newFormula !== value) {
              updates.push([cellKey, newFormula]);
            }
          }
        }
        if (updates.length > 0) {
          canonicalValuesEngine.setBatch(updates);
        }
      }

      return result;
    }},
    deleteNamedInput: { type: 'function', value: (name) => canonicalValuesEngine.deleteNamedInput(name) },
    getValue: { type: 'function', value: (cellKey) => canonicalValuesEngine.getValue(cellKey) },
    setValue: { type: 'function', value: callbacks.setValue },
    getAllNamedInputs: { type: 'function', value: () => canonicalValuesEngine.getAllNamedInputs() },
    reorderNamedInputs: { type: 'function', value: (orderedArray) => canonicalValuesEngine.reorderNamedInputs(orderedArray) },
    getCellDisplay: { type: 'function', value: callbacks.getCellDisplay },
    resolveNamedRange: { type: 'function', value: (name) => canonicalValuesEngine.resolveNamedRange(name) },
    onVisibilityChange: { type: 'function', value: (visible) => toolbar.updatePanelToggleState(visible) },
    markDirty: { type: 'function', value: callbacks.markDirty },
    setBatchSkipHistory: { type: 'function', value: (entries) => canonicalValuesEngine.setBatch(entries, { skipHistory: true }) },
    isFormulaEditingMode: { type: 'function', value: () => formulaBar.isEditingFormula() },
    insertReference: { type: 'function', value: (notation) => formulaBar.insertReference(notation) },
    isPublished: { type: 'function', value: async () => {
      const sheetId = storageEngine.getCurrentSpreadsheetId();
      if (!sheetId) return false;
      const meta = await storageEngine.getSheetMetadata(sheetId);
      return !!(meta?.functionId && meta?.publishedVersion);
    }},
    onAnalyze: { type: 'function', value: async () => {
      const sheetId = storageEngine.getCurrentSpreadsheetId();
      if (!sheetId) return;
      const meta = await storageEngine.getSheetMetadata(sheetId);
      if (!meta?.functionId) return;
      const url = new URL(import.meta.env.BASE_URL + 'scenario.html', window.location.origin);
      url.searchParams.set('functionId', meta.functionId);
      window.open(url.toString(), '_blank');
    }},
  };
}

/**
 * Creates the base grid config.
 * Orchestrator can spread this and override onInputDetected/focusFormulaBar for loop sheets.
 */
export function createBaseGridConfig({
  formattingEngine,
  formulaBar,
  clipboardEngine,
  calculationEngine,
  canonicalValuesEngine,
  toolbar,
  callbacks,
}) {
  return {
    getAllNamedRanges: { type: 'function', value: () => canonicalValuesEngine.getAllNamedRanges() },
    getCellDisplay: { type: 'function', value: (cellKey) => formattingEngine.getCellDisplay(cellKey) },
    onSelectionChange: { type: 'function', value: () => toolbar.updateHighlightState(formattingEngine.getActiveHighlight()) },
    onClearCells: { type: 'function', value: callbacks.handleClearCells },
    onInputDetected: { type: 'function', value: callbacks.onInputDetected },
    isFormulaEditingMode: { type: 'function', value: () => formulaBar.isEditingFormula() },
    revertReferencePicking: { type: 'function', value: () => formulaBar.revertReferencePicking() },
    insertReference: { type: 'function', value: (notation) => formulaBar.insertReference(notation) },
    focusFormulaBar: { type: 'function', value: callbacks.focusFormulaBar },
    loadCellInFormulaBar: { type: 'function', value: (cellKey) => formulaBar.loadCell(cellKey) },
    updateCellNameDisplay: { type: 'function', value: (notation) => formulaBar.updateCellNameDisplay(notation) },
    commitFormulaBarCell: { type: 'function', value: () => formulaBar.commitCurrentCell() },
    applyBold: { type: 'function', value: () => formattingEngine.applyBold() },
    applyItalic: { type: 'function', value: () => formattingEngine.applyItalic() },
    alignLeft: { type: 'function', value: () => formattingEngine.alignLeft() },
    alignCenter: { type: 'function', value: () => formattingEngine.alignCenter() },
    alignRight: { type: 'function', value: () => formattingEngine.alignRight() },
    onCopyOrCut: { type: 'function', value: (isCut) => clipboardEngine.performCopyOrCut(isCut) },
    onPaste: { type: 'function', value: (clipboardText) => clipboardEngine.paste(clipboardText) },
    onPasteValues: { type: 'function', value: () => clipboardEngine.paste(undefined, { valuesOnly: true }) },
    hasInternalClipboard: { type: 'function', value: () => clipboardEngine.hasClipboardData() },
    cancelCut: { type: 'function', value: () => clipboardEngine.cancelCut() },
    onUndo: { type: 'function', value: callbacks.handleUndo },
    onRedo: { type: 'function', value: callbacks.handleRedo },
    onDrilldown: { type: 'function', value: (cellKey) => {
      const drilldownInfo = calculationEngine.getDrilldownInfo(cellKey);
      if (drilldownInfo) {
        const { functionId, versionId, functionName, argValues, sheetType } = drilldownInfo;
        if (callbacks.onBreadcrumbDrilldown && isBreadcrumbMode()) {
          callbacks.onBreadcrumbDrilldown({ functionId, versionId, functionName, argValues, sheetType });
        } else {
          openDrilldown({ functionId, versionId, functionName, args: argValues, sheetType });
        }
      }
    }},
    canDrilldown: { type: 'function', value: (cellKey) => !!calculationEngine.getDrilldownInfo(cellKey) },
  };
}

/**
 * Creates the base formattingEngine config.
 */
export function createBaseFormattingEngineConfig({
  sourceData,
  grid,
  calculationEngine,
  historyEngine,
  storageEngine,
  callbacks,
}) {
  return {
    formatRules: { type: 'map', value: sourceData.formatRules },
    cellStyles: { type: 'map', value: sourceData.cellStyles },
    spreadsheetDefaults: { type: 'object', value: sourceData.spreadsheetDefaults },
    refreshCell: { type: 'function', value: callbacks.refreshCell },
    getSelection: { type: 'function', value: () => grid.getSelection() },
    getNode: { type: 'function', value: (cellKey) => calculationEngine.getNode(cellKey) },
    recordChanges: { type: 'function', value: (mapName, keys) => historyEngine.recordChanges(mapName, keys) },
    onRegisterHistoryMap: { type: 'function', value: (mapName, mapInstance, rebuildCallback) => {
      historyEngine.registerMap(mapName, mapInstance);
      historyEngine.registerRebuildCallback(mapName, rebuildCallback);
    }},
    onFormattingChange: { type: 'function', value: () => storageEngine.markDirty() },
  };
}

/**
 * Derive the set of built-in function names that take a single ARRAY argument.
 * Excludes ARRAY itself (which is a variadic constructor, not an array consumer).
 */
function deriveSingleArrayFunctions() {
  const builtins = getBuiltInFunctions();
  const result = [];
  for (const [name, def] of Object.entries(builtins)) {
    if (!def.variants) continue;
    const allSingleArray = def.variants.every(v =>
      v.argTypes.length === 1 && isArrayType(v.argTypes[0])
    );
    if (allSingleArray) result.push(name);
  }
  return result;
}

/**
 * Creates the base canonicalValuesEngine config.
 */
export function createBaseCanonicalValuesEngineConfig({
  sourceData,
  calculationEngine,
  historyEngine,
  callbacks,
}) {
  return {
    onValueChange: { type: 'function', value: callbacks.onValueChange },
    singleArrayFunctions: { type: 'object', value: deriveSingleArrayFunctions() },
    dateInputFormat: { type: 'string', value: sourceData.spreadsheetDefaults.DATE?.dateInputFormat || 'US' },
    normalizeName: { type: 'function', value: normalizeName },
    isValidNameSyntax: { type: 'function', value: isValidNameSyntax },
    onCheckIfFunction: { type: 'function', value: (name) => {
      const node = calculationEngine.getNode(name);
      return node?.type === 'function';
    }},
    recordChanges: { type: 'function', value: callbacks.recordChanges },
    onRegisterHistoryMap: {
      type: 'function',
      value: Object.assign(
        (mapName, mapInstance, rebuildCallback) => {
          historyEngine.registerMap(mapName, mapInstance);
          historyEngine.registerRebuildCallback(mapName, rebuildCallback);
        },
        {
          registerSnapshotProvider: (name, getter, restorer) => {
            historyEngine.registerSnapshotProvider(name, getter, restorer);
          }
        }
      )
    },
  };
}

/**
 * Creates the base storageEngine config.
 */
export function createBaseStorageEngineConfig({
  canonicalValuesEngine,
  formattingEngine,
  calculationEngine,
  grid,
  panels,
  header,
  callbacks,
}) {
  return {
    getCanonicalSnapshot: { type: 'function', value: callbacks.getCanonicalSnapshot },
    getFormattingSnapshot: { type: 'function', value: () => formattingEngine.getSnapshot() },
    getGridBounds: { type: 'function', value: () => grid.getGridBounds() },
    getOutputCells: { type: 'function', value: () => panels.getOutputCells() },
    getOutputModes: { type: 'function', value: callbacks.getOutputModes },
    getCalcSnapshot: { type: 'function', value: callbacks.getCalcSnapshot },
    getCustomFunctions: { type: 'function', value: () => calculationEngine.getFunctionsWithMetadata() },
    getSpreadsheetName: { type: 'function', value: callbacks.getSpreadsheetName },
    getTestCases: { type: 'function', value: () => panels.getScenarios() },
    getInputNames: { type: 'function', value: () => canonicalValuesEngine.getAllNamedInputs() },
    getOutputNames: { type: 'function', value: () => panels.getOutputCells() },
    recordTestCaseOutputs: { type: 'function', value: callbacks.recordScenarioOutputs },
    onDirtyChange: { type: 'function', value: (isDirty) => header?.setDirty(isDirty) },
    onUnpublishedChange: { type: 'function', value: callbacks.onUnpublishedChange || (() => {}) },
    getColumnNames: { type: 'function', value: callbacks.getColumnNames || (() => ({})) },
    getMaxIterations: { type: 'function', value: callbacks.getMaxIterations || (() => null) },
  };
}

/**
 * Creates the base header config.
 */
export function createBaseHeaderConfig({
  functionsDialog,
  storageEngine,
  callbacks,
}) {
  return {
    onOpen: { type: 'function', value: () => functionsDialog.open() },
    onPublish: { type: 'function', value: callbacks.onPublish },
    onTitleChange: { type: 'function', value: callbacks.onTitleChange },
    // Preview mode callbacks
    onPreviewMerge: { type: 'function', value: callbacks.onPreviewMerge || (() => {}) },
    onPreviewDiscard: { type: 'function', value: callbacks.onPreviewDiscard || (() => {}) },
    onPreviewSwitchToDraft: { type: 'function', value: callbacks.onPreviewSwitchToDraft || (() => {}) },
    onPreviewSaveAsNew: { type: 'function', value: callbacks.onPreviewSaveAsNew || (() => {}) },
    onPreviewFork: { type: 'function', value: callbacks.onPreviewFork || (() => {}) },
    // Unpublished changes callbacks
    onViewBuiltVersion: { type: 'function', value: callbacks.onViewBuiltVersion || (() => {}) },
    onDiscardToLastPublished: { type: 'function', value: callbacks.onDiscardToLastPublished || (() => {}) },
    // File menu callbacks
    onCopy: { type: 'function', value: () => {
      const id = storageEngine.getCurrentSpreadsheetId();
      if (!id) return;
      storageEngine.getSheetMetadata(id).then(meta => {
        functionsDialog.open({ copyMode: true, copySheetId: id, copySheetName: meta?.name || 'Sheet' });
      });
    }},
    onExportCurrent: { type: 'function', value: callbacks.onExportCurrent || (() => {}) },
    onExportHtml: { type: 'function', value: callbacks.onExportHtml || (() => {}) },
    onExportCode: { type: 'function', value: callbacks.onExportCode || (() => {}) },
    onManageLanguagePacks: { type: 'function', value: callbacks.onManageLanguagePacks || (() => {}) },
    onDeleteCurrent: { type: 'function', value: callbacks.onDeleteCurrent || (() => {}) },
    onScenarioAnalysis: { type: 'function', value: async () => {
      const sheetId = storageEngine.getCurrentSpreadsheetId();
      if (!sheetId) return;
      const meta = await storageEngine.getSheetMetadata(sheetId);
      if (!meta?.functionId) return;
      const url = new URL(import.meta.env.BASE_URL + 'scenario.html', window.location.origin);
      url.searchParams.set('functionId', meta.functionId);
      window.location.href = url.toString();
    }},
    // Admin
    onClearAllData: { type: 'function', value: () => storageEngine.clearAllData() },
  };
}

// ============================================================================
// URL IMPORT — shared logic for URL-based import into Downloads folder
// ============================================================================

/**
 * Validate that an import URL uses a safe protocol.
 * @param {string} urlString - URL to validate
 * @returns {URL} Parsed URL object
 * @throws {Error} If URL is invalid or uses an unsafe protocol
 */
export function validateImportUrl(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${url.protocol} — only http and https URLs are allowed`);
  }
  return url;
}

/**
 * Fetch a zip from a URL and import it into the Downloads folder.
 * Deduplicates by packageId — if already downloaded, returns the existing copy.
 *
 * @param {string} url - URL to fetch the zip from
 * @param {Object} deps
 * @param {Object} deps.storageEngine - Storage engine instance
 * @param {Object} deps.opfsService - OPFS service instance
 * @param {Object} deps.functionCompiler - Function compiler for transpilation
 * @returns {Promise<{entrySheetId: string|null, entrySheetType: string, alreadyDownloaded: boolean}>}
 */
export async function fetchAndImportFromUrl(url, { storageEngine, opfsService, functionCompiler }) {
  const validUrl = validateImportUrl(url);

  const response = await fetch(validUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const fileName = decodeURIComponent(validUrl.pathname.split('/').pop() || 'import');
  const file = new File([blob], fileName, { type: 'application/zip' });

  let importData;
  try {
    importData = await parseImportZip(file);
  } catch {
    throw new Error('The URL did not return a valid zip file.');
  }

  // Check for existing download by packageId. If found, delete it so the
  // new import replaces the old one in place — this is what users want when
  // re-clicking "Import" on an example after the source zip has been updated.
  const packageId = importData.manifest?.packageId || null;
  if (packageId) {
    const existing = await storageEngine.findFolderByPackageId(packageId);
    if (existing) {
      try {
        await storageEngine.deleteFolder(existing.folderId);
      } catch (err) {
        console.warn('[fetchAndImportFromUrl] Failed to delete existing copy, proceeding with new import:', err);
      }
    }
  }

  // New download — import into Downloads folder
  const downloadsFolderId = await storageEngine.ensureDownloadsFolder();
  const folderName = generateImportFolderName(fileName);

  // Build fork-all resolutions (no conflict dialog)
  const resolutions = new Map();
  for (const id of Object.keys(importData.sheets)) {
    resolutions.set(id, 'fork');
  }

  const importResult = await executeImport({
    importData,
    resolutions,
    folderName,
    storageEngine,
    opfsService,
    parentFolderId: downloadsFolderId,
    packageId,
  });

  await publishImportedSheets({ importData, importResult, storageEngine, opfsService, functionCompiler });

  // Use manifest's entrySheetId if present, otherwise fall back to heuristic
  const { sheetIdMap } = importResult;
  const manifestEntryId = importData.manifest?.entrySheetId;
  let entrySheetId = null;
  let entrySheetType = 'standard';

  if (manifestEntryId && sheetIdMap.has(manifestEntryId)) {
    entrySheetId = sheetIdMap.get(manifestEntryId);
    entrySheetType = importData.sheets[manifestEntryId]?.meta?.type || 'standard';
  } else {
    const entrySheet = findTopLevelSheet(importData, importResult);
    entrySheetId = entrySheet?.id || null;
    entrySheetType = entrySheet?.type || 'standard';
  }

  // Store entry sheet in folder metadata for dedup lookups
  if (importResult.importFolderId && entrySheetId) {
    await storageEngine.updateFolderMetadata(importResult.importFolderId, {
      entrySheetId,
      entrySheetType,
    });
  }

  return { entrySheetId, entrySheetType, importFolderId: importResult.importFolderId, alreadyDownloaded: false };
}
