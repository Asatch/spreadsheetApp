#!/usr/bin/env node
/**
 * Spreadsheet CLI
 * ===============
 * A minimal CLI for building spreadsheet functions via script commands.
 *
 * Commands:
 *   new <name> [loop]       - Start a new spreadsheet (add "loop" for loop sheets)
 *   input <name> <default>  - Define an input parameter
 *   write <cell> <value>    - Write a value or formula to a cell
 *   csv <startCell> <file>  - Load CSV file starting at cell
 *   fill <range>            - Copy first cell's formula down the range
 *   output <cell|name> [mode] - Mark output (cell/alias for standard, column for loops; mode: last|all)
 *   name <cell> <alias>     - Name a cell (creates alias for formulas and output names)
 *   header <col> <name>     - Name a loop column (e.g., header B taxable_balance)
 *   default-format <type> [decimals] - Set default format (currency, percent, number)
 *   format <cell> <type> [decimals] - Format a cell (overrides default)
 *   justify <cell> <alignment>      - Set text alignment (left, center, right)
 *   test "inputs" "expected" - Add a test case
 *   use <FUNCTION_NAME>     - Declare dependency on another workfolder function
 *   save [path]             - Export to XML (path optional with --workfolder)
 *
 * Usage:
 *   node spreadsheet-cli.js script.txt
 *   node spreadsheet-cli.js --workfolder ../workfolders/my-suite script.txt
 *   echo "new TEST\nwrite A1 hello\nsave test.xml" | node spreadsheet-cli.js
 *
 * With --workfolder:
 *   - `use` looks up function UUIDs from registry.json
 *   - `save` writes XML to workfolder and auto-transpiles
 *
 * Examples:
 *   default-format currency 0 - Default format for all cells
 *   format B10 percent 1     - Override default for a cell
 *   test "100000, 10000" "11363.64, 1363.64"  - Add test case
 *   use PROGRESSIVE_TAX      - Declare dependency on PROGRESSIVE_TAX
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendUtils = resolve(__dirname, '../../src/utils');

const { generateXml } = await import(pathToFileURL(resolve(frontendUtils, 'xmlSerializer.js')).href);
const { adjustTokensByOffset } = await import(pathToFileURL(resolve(frontendUtils, 'clipboardUtils.js')).href);
const { tokenize, serializeTokens } = await import(pathToFileURL(resolve(frontendUtils, 'formulaTokenizer.js')).href);
const { normalizeName, isValidNameSyntax } = await import(pathToFileURL(resolve(frontendUtils, 'nameValidation.js')).href);

function adjustFormulaByOffset(formula, rowOffset, colOffset) {
  const tokens = tokenize(formula);
  const adjusted = adjustTokensByOffset(tokens, rowOffset, colOffset);
  return serializeTokens(adjusted);
}
const {
  parseCellReference,
  columnToNumber,
  numberToColumn,
  isCellReference,
  expandRange
} = await import(pathToFileURL(resolve(frontendUtils, 'cellUtils.js')).href);
const { getNumberFormatDefaults } = await import(pathToFileURL(resolve(frontendUtils, 'numberFormatter.js')).href);
const {
  getBuiltInFunctions,
  deriveSingleArrayFunctions,
  inferReturnType: inferBuiltInReturnType
} = await import(pathToFileURL(resolve(frontendUtils, 'functions.js')).href);

const frontendEngines = resolve(__dirname, '../../src/Engines');
const { createCanonicalValuesEngine } = await import(pathToFileURL(resolve(frontendEngines, 'canonicalValuesEngine.js')).href);
const { parseXML } = await import(pathToFileURL(resolve(__dirname, '..', 'xml-parser.mjs')).href);

/**
 * Look up the return type of a function given its actual argument types.
 * Checks custom functions first, then falls back to built-in signatures.
 */
function inferReturnType(funcName, argTypes) {
  if (customFunctionReturnTypes[funcName]) return customFunctionReturnTypes[funcName];
  return inferBuiltInReturnType(funcName, argTypes);
}

// Tracks return types for custom functions declared via `use`.
let customFunctionReturnTypes = {};

/**
 * Create a canonicalValuesEngine wired to populate a nodeCalcData Map.
 * The engine handles formula parsing, ARRAY wrapping, and anonymous expressions.
 * Type resolution uses inferReturnType (signature-based, no evaluation).
 */
function createEngineWithCalcData() {
  const canonicalEngine = createCanonicalValuesEngine();
  const nodeCalcData = new Map();

  canonicalEngine.init({
    onValueChange: (changedInfo) => {
      // Iterate until types stabilize — within a single batch, parent
      // entries (e.g. ARRAY) can appear before their children (e.g.
      // GREATEREQUAL), so a single pass may resolve children as 'Number'
      // instead of their true type. Repeated passes let later-resolved
      // child types propagate upward.
      let settled = false;
      while (!settled) {
        settled = true;
        for (const [key, info] of changedInfo) {
          let type;
          if (info.type === 'formula') {
            const precedents = info.parsed;
            const childTypes = precedents.slice(1).map(p => {
              return nodeCalcData.get(p)?.type || 'Number';
            });
            if (precedents?.[0] === 'ARRAY') {
              type = `ARRAY[${childTypes[0] || 'Number'}]`;
            } else {
              type = inferReturnType(precedents[0], childTypes);
            }
          } else {
            type = info.type;
          }
          const existing = nodeCalcData.get(key);
          if (!existing || existing.type !== type) {
            settled = false;
            nodeCalcData.set(key, {
              type,
              refValue: info.type === 'formula' ? 0 : (Array.isArray(info.parsed) ? info.parsed : (info.parsed ?? 0)),
              precedents: info.type === 'formula' ? info.parsed : undefined
            });
          }
        }
      }
    },
    singleArrayFunctions: deriveSingleArrayFunctions(),
    dateInputFormat: 'US',
    normalizeName,
    isValidNameSyntax,
    onCheckIfFunction: () => false,
    recordChanges: () => {},
    onRegisterHistoryMap: Object.assign(() => {}, { registerSnapshotProvider: () => {} })
  });

  return { canonicalEngine, nodeCalcData };
}

// ============================================================================
// SPREADSHEET STATE
// ============================================================================

// Workfolder mode state (set via --workfolder flag)
let workfolderDir = null;
let scriptPath = null;  // path to the script file being executed

// Engine — primary storage for canonical values, with nodeCalcData for types
let engine = createEngineWithCalcData();

let state = {
  name: 'Untitled',
  sheetType: null,             // null for standard, 'loop' for loop sheets
  namedInputs: new Set(),
  namedInputsOrdered: [],
  outputCells: [],
  outputModes: {},
  columnNames: {},             // column letter -> display name (loop sheets only)
  gridBounds: { maxRow: 1, maxCol: 'A' },
  formatRules: [],             // [cellKey, formatObj] tuples
  cellStyles: [],              // [cellKey, styleObj] tuples for colors/styling
  spreadsheetDefaults: {},     // e.g. { NUMBER: { subCategory: 'currency', decimalPlaces: 0 } }
  testCases: [],               // { inputs: {...}, outputs: {...} }
  customFunctions: [],         // { name, id, version } — declared via `use`
  dependencies: []             // dependency names for registry tracking
};

function resetState() {
  engine = createEngineWithCalcData();
  customFunctionReturnTypes = {};
  state = {
    name: 'Untitled',
    sheetType: null,
    namedInputs: new Set(),
    namedInputsOrdered: [],
    outputCells: [],
    outputModes: {},
    columnNames: {},
    gridBounds: { maxRow: 1, maxCol: 'A' },
    formatRules: [],
    cellStyles: [],
    spreadsheetDefaults: {},
    testCases: [],
    customFunctions: [],
    dependencies: []
  };
}

let registryCache = null;

function loadRegistry() {
  if (!workfolderDir) return {};
  if (registryCache) return registryCache;
  const regPath = resolve(workfolderDir, 'registry.json');
  if (!existsSync(regPath)) return {};
  registryCache = JSON.parse(readFileSync(regPath, 'utf-8'));
  return registryCache;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function updateGridBounds(cellKey) {
  const parsed = parseCellReference(cellKey);
  if (!parsed) return;

  const currentMaxCol = columnToNumber(state.gridBounds.maxCol);
  if (parsed.col > currentMaxCol) {
    state.gridBounds.maxCol = numberToColumn(parsed.col);
  }
  if (parsed.row > state.gridBounds.maxRow) {
    state.gridBounds.maxRow = parsed.row;
  }
}

function inferType(value) {
  if (value === 'TRUE' || value === 'FALSE') return 'Boolean';
  if (!isNaN(parseFloat(value)) && isFinite(value)) return 'Number';
  return 'Text';
}

function setEngineValue(cellKey, canonical) {
  const upperKey = cellKey.toUpperCase();
  updateGridBounds(upperKey);
  engine.canonicalEngine.setValue(upperKey, canonical);
}

function parseRange(rangeStr) {
  // Parse "A1:A10" or "A1:B10" format
  const parts = rangeStr.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid range format: ${rangeStr}`);
  }

  const start = parseCellReference(parts[0].toUpperCase());
  const end = parseCellReference(parts[1].toUpperCase());

  if (!start || !end) {
    throw new Error(`Invalid cell reference in range: ${rangeStr}`);
  }

  return { start, end, startCell: parts[0].toUpperCase(), endCell: parts[1].toUpperCase() };
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

function cmdNew(name, type) {
  resetState();
  state.name = name.toUpperCase();
  if (type && type.toLowerCase() === 'loop') {
    state.sheetType = 'loop';
    console.log(`Created new loop spreadsheet: ${state.name}`);
  } else {
    console.log(`Created new spreadsheet: ${state.name}`);
  }
}

function cmdInput(name, defaultValue) {
  const upperName = name.toUpperCase();
  state.namedInputs.add(upperName);
  state.namedInputsOrdered.push(upperName);

  const canonical = defaultValue || '0';
  setEngineValue(upperName, canonical);

  console.log(`Added input: ${upperName} = ${canonical}`);
}

function cmdWrite(cellKey, value) {
  const upperKey = cellKey.toUpperCase();

  // Determine canonical form
  let canonical;
  if (value.startsWith('=')) {
    canonical = value.toUpperCase();
  } else if (value.startsWith("'")) {
    canonical = value;  // Text literal, keep as-is
  } else if (inferType(value) === 'Text' && !isCellReference(value)) {
    canonical = "'" + value;  // Add text prefix
  } else {
    canonical = value;
  }

  setEngineValue(upperKey, canonical);
  console.log(`Write ${upperKey} = ${canonical}`);
}

function cmdCsv(startCell, filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  const start = parseCellReference(startCell.toUpperCase());
  if (!start) {
    throw new Error(`Invalid start cell: ${startCell}`);
  }

  let rowOffset = 0;
  for (const line of lines) {
    const values = line.split(',').map(v => v.trim());
    let colOffset = 0;

    for (const value of values) {
      const cellKey = numberToColumn(start.col + colOffset) + (start.row + rowOffset);
      cmdWrite(cellKey, value);
      colOffset++;
    }
    rowOffset++;
  }

  console.log(`Loaded CSV from ${filepath}: ${lines.length} rows`);
}

function cmdFill(rangeStr) {
  const { start, end, startCell, endCell } = parseRange(rangeStr);

  // Get the formula from the first cell
  const firstCellKey = startCell;
  const canonical = engine.canonicalEngine.getValue(firstCellKey);

  if (!canonical || !canonical.startsWith('=')) {
    throw new Error(`First cell ${firstCellKey} must contain a formula`);
  }

  // Fill down (and optionally right)
  const { cells } = expandRange(startCell, endCell);

  // Skip the first cell (it's already set)
  for (let i = 1; i < cells.length; i++) {
    const targetCell = cells[i];
    const targetParsed = parseCellReference(targetCell);

    // Calculate offset from first cell
    const rowOffset = targetParsed.row - start.row;
    const colOffset = targetParsed.col - start.col;

    // Adjust formula
    const adjustedFormula = adjustFormulaByOffset(canonical, rowOffset, colOffset);
    setEngineValue(targetCell, adjustedFormula);
  }

  console.log(`Filled ${rangeStr}: ${cells.length} cells`);
}

function cmdOutput(cellKey, mode) {
  const upperKey = cellKey.toUpperCase();
  const outputMode = (mode && mode.toLowerCase() === 'all') ? 'all' : 'last';

  if (!state.outputCells.includes(upperKey)) {
    state.outputCells.push(upperKey);
  }
  state.outputModes[upperKey] = outputMode;
  console.log(`Marked output: ${upperKey} (mode: ${outputMode})`);
}

function cmdHeader(col, name) {
  const upperCol = col.toUpperCase();
  if (!state.sheetType) {
    console.error('Error: `header` is only valid for loop sheets (use `new <name> loop`)');
    return;
  }
  state.columnNames[upperCol] = name;
  console.log(`Header ${upperCol} = ${name}`);
}

function cmdName(cellKey, aliasName) {
  const upperKey = cellKey.toUpperCase();
  const upperAlias = aliasName.toUpperCase();
  // Create a PROCEED node with the alias as key — same representation as the frontend.
  // This makes the alias a regular node in the graph, so dependency resolution and
  // transpilation work without special alias handling.
  cmdWrite(upperAlias, `=${upperKey}`);
  console.log(`Name ${upperKey} = ${upperAlias}`);
}

// Maps CLI format type names to internal subCategory values
const FORMAT_SUBCATEGORIES = {
  'currency': 'currency',
  'percent': 'percentage',
  'percentage': 'percentage',
  'number': 'number',
  'scientific': 'scientific'
};

// Valid digit separator options (must match DIGIT_SEPARATOR_OPTIONS in numberFormatter.js)
const VALID_SEPARATORS = ['period-only', 'comma-only', 'comma-period', 'period-comma', 'space-period'];

function applyFormatOptions(formatSettings, decimals, separator) {
  formatSettings.decimalPlaces = decimals;
  formatSettings.useAdaptiveDecimals = false;
  if (separator) {
    if (!VALID_SEPARATORS.includes(separator)) {
      console.error(`Unknown separator: ${separator}. Use: ${VALID_SEPARATORS.join(', ')}`);
      return false;
    }
    formatSettings.digitSeparatorOption = separator;
  }
  return true;
}

function cmdFormat(cellKey, formatType, decimalPlaces = 0, separator) {
  const upperKey = cellKey.toUpperCase();
  const decimals = parseInt(decimalPlaces, 10) || 0;

  const subCategory = FORMAT_SUBCATEGORIES[formatType.toLowerCase()];
  if (!subCategory) {
    console.error(`Unknown format type: ${formatType}. Use: currency, percent, number, or scientific`);
    return;
  }

  // Build complete format object matching what the GUI would produce.
  // Start from defaults for this subcategory, then override.
  const formatSettings = getNumberFormatDefaults(subCategory);
  if (!applyFormatOptions(formatSettings, decimals, separator)) return;

  // Format: [cellKey, formatObject] tuple
  state.formatRules.push([upperKey, { NUMBER: formatSettings }]);

  const sepNote = separator ? `, separator: ${separator}` : '';
  console.log(`Format ${upperKey} = ${subCategory} (${decimals} decimals${sepNote})`);
}

function cmdDefaultFormat(formatType, decimalPlaces = 0, separator) {
  const decimals = parseInt(decimalPlaces, 10) || 0;

  const subCategory = FORMAT_SUBCATEGORIES[formatType.toLowerCase()];
  if (!subCategory) {
    console.error(`Unknown format type: ${formatType}. Use: currency, percent, number, or scientific`);
    return;
  }

  // Build complete format object matching what the GUI would produce
  const formatSettings = getNumberFormatDefaults(subCategory);
  if (!applyFormatOptions(formatSettings, decimals, separator)) return;

  state.spreadsheetDefaults.NUMBER = formatSettings;
  const sepNote = separator ? `, separator: ${separator}` : '';
  console.log(`Default format = ${subCategory} (${decimals} decimals${sepNote})`);
}

// ---- Styling commands ----

const HIGHLIGHT_NAMES = ['yellow', 'blue', 'green', 'pink', 'orange', 'gray'];

function cmdHighlight(cellKey, color) {
  const upperKey = cellKey.toUpperCase();
  const lowerColor = color.toLowerCase();
  if (!HIGHLIGHT_NAMES.includes(lowerColor)) {
    console.error(`Unknown highlight color: ${color}. Use: ${HIGHLIGHT_NAMES.join(', ')}`);
    return;
  }
  setStyle(upperKey, 'highlight', lowerColor);
  console.log(`Highlight ${upperKey} = ${lowerColor}`);
}

const ALIGNMENT_VALUES = ['left', 'center', 'right'];

function cmdJustify(cellKey, alignment) {
  const upperKey = cellKey.toUpperCase();
  const lowerAlign = alignment.toLowerCase();
  if (!ALIGNMENT_VALUES.includes(lowerAlign)) {
    console.error(`Unknown alignment: ${alignment}. Use: ${ALIGNMENT_VALUES.join(', ')}`);
    return;
  }
  setStyle(upperKey, 'alignment', lowerAlign);
  console.log(`Justify ${upperKey} = ${lowerAlign}`);
}

function cmdStyle(cellKey, property, value) {
  const upperKey = cellKey.toUpperCase();
  const prop = property.toLowerCase();
  const styleMap = {
    'bold': () => setStyle(upperKey, 'bold', true),
    'italic': () => setStyle(upperKey, 'italic', true),
    'align': () => setStyle(upperKey, 'alignment', value),
    'alignment': () => setStyle(upperKey, 'alignment', value),
    'color': () => setStyle(upperKey, 'color', value),
    'bg': () => setStyle(upperKey, 'backgroundColor', value),
    'background': () => setStyle(upperKey, 'backgroundColor', value),
    'fontsize': () => setStyle(upperKey, 'fontSize', parseInt(value, 10)),
  };
  if (!styleMap[prop]) {
    console.error(`Unknown style property: ${property}. Use: bold, italic, align, color, bg, fontsize`);
    return;
  }
  styleMap[prop]();
  console.log(`Style ${upperKey} ${prop} = ${value || 'true'}`);
}

function setStyle(cellKey, property, value) {
  // Find existing style tuple for this cell, or create one
  let existing = state.cellStyles.find(([key]) => key === cellKey);
  if (!existing) {
    existing = [cellKey, {}];
    state.cellStyles.push(existing);
  }
  existing[1][property] = value;
}

/**
 * Split a test value string into individual values, respecting array literals.
 * Uses {1,2,3} syntax for arrays (matching the engine's array literal format).
 * e.g., "{1,2,3}, 5" → ["{1,2,3}", "5"]
 *       "100, 200"   → ["100", "200"]
 */
function splitTestValues(str) {
  const values = [];
  let current = '';
  let braceDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;

    if (ch === ',' && braceDepth === 0) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

/**
 * Parse a single test value token. Array literals like {1,2,3} are preserved
 * as strings for XML storage — the transpiler's buildTestCases handles typing.
 */
function parseTestValue(token) {
  if (token.startsWith('{') && token.endsWith('}')) {
    return token;  // Array literal — store as string for XML
  }
  const num = parseFloat(token);
  return isNaN(num) ? token : num;
}

function cmdTest(inputsStr, expectedStr) {
  const inputValues = splitTestValues(inputsStr).map(parseTestValue);
  const expectedValues = splitTestValues(expectedStr).map(parseTestValue);

  // Build inputs object keyed by input name
  const inputs = {};
  state.namedInputsOrdered.forEach((name, i) => {
    if (i < inputValues.length) {
      inputs[name] = inputValues[i];
    }
  });

  // Build outputs object keyed by output cell
  const outputs = {};
  state.outputCells.forEach((cell, i) => {
    if (i < expectedValues.length) {
      outputs[cell] = expectedValues[i];
    }
  });

  state.testCases.push({ inputs, outputs });
  console.log(`Test case: inputs=${JSON.stringify(inputs)} outputs=${JSON.stringify(outputs)}`);
}

function cmdUse(funcName) {
  const upperName = funcName.toUpperCase();

  if (!workfolderDir) {
    console.error('Error: `use` requires --workfolder flag');
    return;
  }

  const registry = loadRegistry();
  const entry = registry[upperName];

  if (!entry) {
    console.error(`Error: Function ${upperName} not found in workfolder registry`);
    return;
  }

  // Add to customFunctions list (for XML generation)
  if (!state.customFunctions.find(f => f.name === upperName)) {
    state.customFunctions.push({
      name: upperName,
      id: entry.uuid,
      version: '1.0.0'
    });
  }

  // Track dependency name
  if (!state.dependencies.includes(upperName)) {
    state.dependencies.push(upperName);
  }

  // Derive return type from the function's XML outputs
  if (!customFunctionReturnTypes[upperName] && entry.xml) {
    const xmlPath = resolve(workfolderDir, entry.xml);
    if (existsSync(xmlPath)) {
      const parsed = parseXML(readFileSync(xmlPath, 'utf-8'));
      const outputTypes = parsed.outputs.map(o => o.data_type || 'Number');
      if (outputTypes.length === 1) {
        customFunctionReturnTypes[upperName] = outputTypes[0];
      } else if (outputTypes.length > 1) {
        customFunctionReturnTypes[upperName] = `Object[${outputTypes.join(', ')}]`;
      }
    }
  }

  console.log(`Using ${upperName} (uuid: ${entry.uuid}, returns: ${customFunctionReturnTypes[upperName] || 'Number'})`);
}

function cmdSave(filepath) {
  // In workfolder mode, default save path to workfolder
  if (!filepath && workfolderDir) {
    filepath = resolve(workfolderDir, `${state.name}.xml`);
  } else if (!filepath) {
    console.error('Error: save requires a path (or use --workfolder)');
    return;
  }

  // Snapshot engine state — already normalized (ARRAY wrapping, anonymous expressions, types)
  const snapshot = engine.canonicalEngine.getSnapshot();
  const canonicalValues = new Map(snapshot.canonicalValues);
  const nodeCalcData = engine.nodeCalcData;

  const xml = generateXml({
    sheetName: state.name,
    canonicalValues,
    nodeCalcData,
    namedInputs: state.namedInputs,
    namedInputsOrdered: state.namedInputsOrdered,
    outputCells: state.outputCells,
    outputModes: state.outputModes,
    gridBounds: state.gridBounds,
    formatting: { formatRules: state.formatRules, cellStyles: state.cellStyles, spreadsheetDefaults: state.spreadsheetDefaults },
    customFunctions: state.customFunctions,
    testCases: state.testCases,
    inputNames: state.namedInputsOrdered,
    sheetType: state.sheetType,
    columnNames: state.columnNames
  });

  writeFileSync(filepath, xml);
  console.log(`Saved to ${filepath}`);

  // In workfolder mode: register and auto-transpile
  if (workfolderDir) {
    const xmlFilename = `${state.name}.xml`;
    const transpileScript = resolve(__dirname, '..', 'transpile.mjs');
    const isDisplaySheet = state.outputCells.length === 0;

    // Register the function (always — even display sheets need registry tracking)
    try {
      const registerArgs = [
        transpileScript,
        '--workfolder', workfolderDir,
        '--register',
        '--xml', xmlFilename
      ];
      if (state.dependencies.length > 0) {
        registerArgs.push('--deps', state.dependencies.join(','));
      }
      if (scriptPath) {
        registerArgs.push('--script', scriptPath);
      }
      registerArgs.push(state.name);
      execFileSync('node', registerArgs, { stdio: 'inherit' });
    } catch (e) {
      console.error(`Registration failed: ${e.message}`);
      return;
    }

    // Auto-transpile (only functions with outputs)
    if (isDisplaySheet) {
      console.log('No outputs defined — skipping transpilation.');
    } else {
      try {
        execFileSync('node', [
          transpileScript,
          '--workfolder', workfolderDir,
          state.name
        ], { stdio: 'inherit' });
      } catch (e) {
        console.error(`Auto-transpile failed: ${e.message}`);
        process.exit(1);
      }
    }
  }
}

// ============================================================================
// COMMAND PARSER & EXECUTOR
// ============================================================================

function executeCommand(line) {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) {
    return;
  }

  // Parse command and arguments
  // Handle quoted strings and formulas with spaces
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote && parts.length < 4) {
      // Split on first four spaces (command, arg1, arg2, arg3, rest...)
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }

  const [cmd, ...args] = parts;

  switch (cmd.toLowerCase()) {
    case 'new':
      cmdNew(args[0], args[1]);
      break;
    case 'input':
      cmdInput(args[0], args[1]);
      break;
    case 'write': {
      // Re-extract value from original line to preserve quotes in formulas.
      // The generic parser strips quote characters, but for write commands,
      // quotes inside formulas are syntax (e.g., =INDEX(B1,"key")), not delimiters.
      const writeMatch = trimmed.match(/^\S+\s+(\S+)\s+([\s\S]+)/);
      if (!writeMatch) throw new Error('write requires a cell and value (e.g., write A1 =B1+1)');
      cmdWrite(writeMatch[1], writeMatch[2]);
      break;
    }
    case 'csv':
      cmdCsv(args[0], args[1]);
      break;
    case 'fill':
      cmdFill(args[0]);
      break;
    case 'output':
      cmdOutput(args[0], args[1]);
      break;
    case 'header':
      cmdHeader(args[0], args[1]);
      break;
    case 'name':
      cmdName(args[0], args[1]);
      break;
    case 'format':
      cmdFormat(args[0], args[1], args[2], args[3]);
      break;
    case 'default-format':
      cmdDefaultFormat(args[0], args[1], args[2]);
      break;
    case 'highlight':
      cmdHighlight(args[0], args[1]);
      break;
    case 'justify':
      cmdJustify(args[0], args[1]);
      break;
    case 'style':
      cmdStyle(args[0], args[1], args[2]);
      break;
    case 'test':
      // test "inputs" "expected"
      cmdTest(args[0], args[1]);
      break;
    case 'use':
      cmdUse(args[0]);
      break;
    case 'save':
      cmdSave(args[0]);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
  }
}

function executeScript(script) {
  const lines = script.split('\n');
  for (const line of lines) {
    try {
      executeCommand(line);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      console.error(`  Line: ${line}`);
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse --workfolder flag
  const workfolderIdx = args.indexOf('--workfolder');
  if (workfolderIdx !== -1) {
    workfolderDir = resolve(args[workfolderIdx + 1]);
    args.splice(workfolderIdx, 2);
  }

  if (args.length > 0) {
    // Read from file — resolve to path relative to function-workshop root
    const workshopRoot = resolve(__dirname, '..');
    const absScriptPath = resolve(args[0]);
    scriptPath = relative(workshopRoot, absScriptPath);
    const script = readFileSync(args[0], 'utf-8');
    executeScript(script);
  } else {
    // Read from stdin
    let script = '';
    process.stdin.setEncoding('utf-8');

    for await (const chunk of process.stdin) {
      script += chunk;
    }

    executeScript(script);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
