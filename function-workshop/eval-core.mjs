/**
 * Shared evaluation logic for headless spreadsheet evaluation.
 *
 * Uses the same engine pipeline as the frontend GUI:
 *   canonicalValuesEngine.setBatch() → calculationEngine.processInputs()
 *
 * This ensures identical behavior between the CLI tools and the interactive
 * spreadsheet, including correct handling of anonymous sub-expressions,
 * formula parsing, and evaluation ordering.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_PATH = resolve(__dirname, '../src');

const { createCalculationEngine } = await import(
  resolve(FRONTEND_PATH, 'Engines/calculationEngine.js')
);
const { createCanonicalValuesEngine } = await import(
  resolve(FRONTEND_PATH, 'Engines/canonicalValuesEngine.js')
);
const { adjustTokensByOffset } = await import(
  resolve(FRONTEND_PATH, 'utils/clipboardUtils.js')
);
const { tokenize, serializeTokens } = await import(
  resolve(FRONTEND_PATH, 'utils/formulaTokenizer.js')
);

function adjustFormulaByOffset(formula, rowOffset, colOffset) {
  const tokens = tokenize(formula);
  const adjusted = adjustTokensByOffset(tokens, rowOffset, colOffset);
  return serializeTokens(adjusted);
}
const { parseCellKey } = await import(
  resolve(FRONTEND_PATH, 'utils/cellUtils.js')
);
const { getBuiltInFunctions } = await import(
  resolve(FRONTEND_PATH, 'utils/functions.js')
);
const { normalizeName, isValidNameSyntax } = await import(
  resolve(FRONTEND_PATH, 'utils/nameValidation.js')
);

const MAX_ITERATIONS = 1000;

/**
 * Derive the set of built-in function names that take a single ARRAY argument.
 * These need special normalization: scalar args get wrapped into ARRAY expressions.
 */
function deriveSingleArrayFunctions() {
  const builtins = getBuiltInFunctions();
  const result = [];
  for (const [name, def] of Object.entries(builtins)) {
    if (!def.variants) continue;
    const allSingleArray = def.variants.every(v =>
      v.argTypes.length === 1 && v.argTypes[0].startsWith('ARRAY[')
    );
    if (allSingleArray) result.push(name);
  }
  return result;
}

/**
 * Create and wire the engine pair (same pipeline as the frontend).
 *
 * canonicalValuesEngine interprets raw values and formulas, discovers
 * anonymous sub-expressions, and notifies calculationEngine via processInputs.
 *
 * @returns {{ calcEngine: Object, canonicalEngine: Object }}
 */
export function createEngines() {
  const calcEngine = createCalculationEngine();
  const canonicalEngine = createCanonicalValuesEngine();

  calcEngine.init({
    computeDisplayValue: () => {},
    onDeleteAnonymous: (key) => canonicalEngine.deleteAnonymousExpression(key)
  });

  canonicalEngine.init({
    onValueChange: (changedInfo) => calcEngine.processInputs(changedInfo),
    singleArrayFunctions: deriveSingleArrayFunctions(),
    dateInputFormat: 'US',
    normalizeName,
    isValidNameSyntax,
    onCheckIfFunction: () => false,
    recordChanges: () => {},
    onRegisterHistoryMap: Object.assign(() => {}, { registerSnapshotProvider: () => {} })
  });

  return { calcEngine, canonicalEngine };
}

/**
 * Normalize input overrides to an object keyed by input key.
 *
 * @param {Array} inputs - Parsed inputs from XML ({key, name, ...})
 * @param {Object|Array} inputOverrides - Input values (object keyed by name/key, or array in order)
 * @returns {Object} Normalized {inputKey: value} object
 */
export function normalizeInputOverrides(inputs, inputOverrides) {
  if (!inputOverrides) return {};

  if (Array.isArray(inputOverrides)) {
    const values = {};
    inputs.forEach((inp, i) => {
      if (i < inputOverrides.length) values[inp.key] = inputOverrides[i];
    });
    return values;
  }

  const values = {};
  for (const [name, value] of Object.entries(inputOverrides)) {
    const inp = inputs.find(i => i.name === name || i.key === name);
    if (inp) values[inp.key] = value;
    else values[name] = value;
  }
  return values;
}

/**
 * Load XML nodes into the engine pair.
 *
 * Converts parsed XML nodes into [key, rawCanonical] entries and feeds them
 * through canonicalValuesEngine.setBatch(), which handles formula parsing,
 * anonymous expression discovery, and notification to the calc engine —
 * exactly as the frontend GUI does.
 *
 * @param {Object} canonicalEngine - The canonical values engine
 * @param {Array} nodes - Parsed nodes from XML
 * @param {Object} inputValues - Normalized {inputKey: value} object
 */
export function loadNodes(canonicalEngine, nodes, inputValues) {
  const entries = [];

  for (const node of nodes) {
    const key = node.key;
    if (!key) continue;

    if (node.node_type === 'input') {
      const value = inputValues[key] ?? node.default ?? 0;
      entries.push([key, String(value)]);
    } else if (node.node_type === 'constant') {
      if (node.data_type === 'Text') {
        entries.push([key, `'${node.value || ''}`]);
      } else {
        entries.push([key, String(node.value || 0)]);
      }
    } else if (node.canonical) {
      // Formulas (starting with =) and any other canonical values
      entries.push([key, node.canonical]);
    }
  }

  canonicalEngine.setBatch(entries);
}

/**
 * Run the iteration loop for loop sheets.
 *
 * Uses canonicalValuesEngine.setBatch() for each iteration row, matching
 * the frontend's loop-sheet-orchestrator flow: adjust Row 1 formulas by
 * offset, feed through setBatch, let the engine pipeline handle parsing
 * and anonymous expression ordering.
 *
 * @param {Object} calcEngine - The calculation engine
 * @param {Object} canonicalEngine - The canonical values engine
 * @param {Array} nodes - Parsed nodes from XML
 * @returns {number} Final iteration count (row number of last iteration)
 */
export function runLoopIteration(calcEngine, canonicalEngine, nodes) {
  const row1Cells = [];
  for (const node of nodes) {
    if (!node.key) continue;
    const parsed = parseCellKey(node.key);
    if (parsed && parsed.row === 1) {
      row1Cells.push({ col: parsed.col, key: node.key, canonical: node.canonical });
    }
  }

  const isStopConditionMet = (row) => {
    const value = calcEngine.getCellValue(`_STOP${row}`);
    return value !== false;
  };

  const hasValidStopCondition = (row) => {
    const node = nodes.find(n => n.key === `_STOP${row}`);
    if (!node || !node.canonical) return false;
    const value = calcEngine.getCellValue(`_STOP${row}`);
    if (typeof value === 'string' && value.startsWith('#')) return false;
    return true;
  };

  if (hasValidStopCondition(0) && isStopConditionMet(0)) return 0;
  if (!hasValidStopCondition(1)) return 1;
  if (isStopConditionMet(1)) return 1;

  let currentRow = 2;
  while (currentRow < MAX_ITERATIONS) {
    const offset = currentRow - 1;
    const entries = [];

    for (const cell of row1Cells) {
      const newKey = `${cell.col}${currentRow}`;
      if (cell.canonical?.startsWith('=')) {
        const adjustedFormula = adjustFormulaByOffset(cell.canonical, offset, 0);
        entries.push([newKey, adjustedFormula]);
      } else if (cell.canonical) {
        entries.push([newKey, cell.canonical]);
      }
    }

    canonicalEngine.setBatch(entries);
    if (isStopConditionMet(currentRow)) return currentRow;
    currentRow++;
  }

  console.warn(`[eval-core] Hit max iterations (${MAX_ITERATIONS})`);
  return MAX_ITERATIONS - 1;
}

/**
 * Collect output values from the engine after evaluation.
 *
 * @param {Object} calcEngine - The calculation engine
 * @param {Array} outputs - Parsed outputs from XML
 * @param {string} sheetType - 'loop' or 'spreadsheet'
 * @param {number} iterationCount - Loop iteration count (0 for standard sheets)
 * @returns {Array<{name, key, value}>} Output results
 */
export function collectOutputs(calcEngine, outputs, sheetType, iterationCount) {
  return outputs.map(o => {
    let value;
    if (sheetType === 'loop') {
      const col = o.key.toUpperCase();
      if (o.output_mode === 'all') {
        value = [];
        for (let row = 0; row <= iterationCount; row++) {
          value.push(calcEngine.getCellValue(`${col}${row}`));
        }
      } else {
        value = calcEngine.getCellValue(`${col}${iterationCount}`);
      }
    } else {
      value = calcEngine.getCellValue(o.key);
    }
    return { name: o.name, key: o.key, value };
  });
}
