/**
 * Spreadsheet readout renderer.
 * Parses XML, evaluates all cells, and renders a human-readable text layout.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_PATH = resolve(__dirname, '../src');

const { createFormattingEngine } = await import(
  resolve(FRONTEND_PATH, 'Engines/formattingEngine.js')
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

import { parseXML } from './xml-parser.mjs';
import { loadAndRegisterCustomFunctions } from './function-loader.mjs';
import {
  createEngines,
  normalizeInputOverrides,
  loadNodes,
  runLoopIteration,
} from './eval-core.mjs';

// --- XML extensions (format rules, grid dimensions) ---

/**
 * Parse FormatRule entries and grid dimensions from SpreadsheetMeta.
 * @param {string} xmlString
 * @returns {{ formatRules: Map<string, Object>, gridRows: number, gridCols: string }}
 */
function parseSpreadsheetMeta(xmlString) {
  const formatRules = new Map();
  const spreadsheetDefaults = {};

  const metaMatch = xmlString.match(/<SpreadsheetMeta[^>]*>/);
  let gridRows = 0;
  let gridCols = 'A';
  if (metaMatch) {
    const rowsMatch = metaMatch[0].match(/gridRows="(\d+)"/);
    const colsMatch = metaMatch[0].match(/gridCols="([A-Z]+)"/);
    if (rowsMatch) gridRows = parseInt(rowsMatch[1]);
    if (colsMatch) gridCols = colsMatch[1];
  }

  const ruleRegex = /<FormatRule\s+([^>]+)\/>/g;
  let match;
  while ((match = ruleRegex.exec(xmlString)) !== null) {
    const attrs = parseFormatAttrs(match[1]);
    if (attrs.cellKey && attrs.formats) {
      try {
        const formats = JSON.parse(attrs.formats);
        formatRules.set(attrs.cellKey, formats);
      } catch {
        // Skip malformed format rules
      }
    }
  }

  // Parse spreadsheet-level default formats
  const defaultRegex = /<Default\s+([^>]+)\/>/g;
  while ((match = defaultRegex.exec(xmlString)) !== null) {
    const attrs = parseFormatAttrs(match[1]);
    if (attrs.type && attrs.settings) {
      try {
        spreadsheetDefaults[attrs.type] = JSON.parse(attrs.settings);
      } catch {
        // Skip malformed defaults
      }
    }
  }

  // Parse column names
  const columnNames = {};
  const colNameRegex = /<ColumnName\s+([^>]+)\/>/g;
  while ((match = colNameRegex.exec(xmlString)) !== null) {
    const attrs = parseFormatAttrs(match[1]);
    if (attrs.column && attrs.name) {
      columnNames[attrs.column] = attrs.name;
    }
  }

  // Parse cell styles (colors, bold, fontSize, etc.)
  const cellStyles = new Map();
  const styleRegex = /<CellStyle\s+([^>]+)\/>/g;
  while ((match = styleRegex.exec(xmlString)) !== null) {
    const attrs = parseFormatAttrs(match[1]);
    if (attrs.cellKey) {
      const styleObj = {};
      if (attrs.bold === 'true') styleObj.bold = true;
      if (attrs.italic === 'true') styleObj.italic = true;
      if (attrs.fontSize) styleObj.fontSize = parseInt(attrs.fontSize, 10);
      if (attrs.alignment) styleObj.alignment = attrs.alignment;
      if (attrs.color) styleObj.color = attrs.color;
      if (attrs.backgroundColor) styleObj.backgroundColor = attrs.backgroundColor;
      if (attrs.highlight) styleObj.highlight = attrs.highlight;
      cellStyles.set(attrs.cellKey, styleObj);
    }
  }

  return { formatRules, gridRows, gridCols, spreadsheetDefaults, columnNames, cellStyles };
}

function parseFormatAttrs(attrString) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return attrs;
}

// --- Formatting ---

/**
 * Format a cell value using the frontend's formatting engine.
 * @param {string} cellKey - Cell address (e.g., "B5")
 * @param {Object} engine - Calculation engine instance
 * @param {Object} fmtEngine - Formatting engine instance
 * @returns {string} Formatted display text
 */
function formatCell(cellKey, engine, fmtEngine) {
  const node = engine.getNode(cellKey);
  if (!node) return '';
  if (node.refValue === undefined || node.refValue === null) return '';

  fmtEngine.computeDisplayValue(node, cellKey);
  const display = fmtEngine.getCellDisplay(cellKey);
  return display?.text || String(node.refValue);
}

// --- Column helpers ---

function colLetterToIndex(col) {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index;
}

function indexToColLetter(index) {
  let result = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

// --- Grid rendering ---

/**
 * Build a compact style annotation like "{blue,bold,24px}" for a cell.
 * Returns empty string if no styles.
 */
function styleAnnotation(cellKey, cellStyles) {
  const style = cellStyles.get(cellKey);
  if (!style) return '';
  const parts = [];
  if (style.highlight) parts.push(style.highlight);
  if (style.bold) parts.push('bold');
  if (style.italic) parts.push('italic');
  if (style.fontSize) parts.push(`${style.fontSize}px`);
  if (style.alignment) parts.push(style.alignment);
  if (style.color) parts.push(`color:${style.color}`);
  if (style.backgroundColor) parts.push(`bg:${style.backgroundColor}`);
  if (parts.length === 0) return '';
  return `{${parts.join(',')}} `;
}

/**
 * Determine what to display for a cell.
 * @param {Object} node - Parsed XML node
 * @param {string} cellKey - Cell address (e.g., "B5")
 * @param {Object} engine - Calculation engine instance
 * @param {Object} fmtEngine - Formatting engine instance
 * @param {Map} cellStyles - Cell styles map
 * @returns {string} Display string like "{blue} =A1*0.08 -> $4.00" or "'Label" or "(blank)"
 */
function cellDisplay(node, cellKey, engine, fmtEngine, cellStyles) {
  const prefix = styleAnnotation(cellKey, cellStyles);

  if (!node) return '(blank)';

  const canonical = node.canonical || '';

  // Text label
  if (node.data_type === 'Text' || canonical.startsWith("'")) {
    const text = node.value || canonical.replace(/^'/, '');
    return `${prefix}"${text}"`;
  }

  // Formula
  if (canonical.startsWith('=')) {
    const formula = canonical.substring(1);
    const formatted = formatCell(cellKey, engine, fmtEngine);
    return `${prefix}${formula} -> ${formatted}`;
  }

  // Constant number or Input display (PROCEED)
  return `${prefix}${formatCell(cellKey, engine, fmtEngine)}`;
}

/**
 * Print a spreadsheet XML as human-readable text.
 * @param {string} xmlString
 * @param {Object|Array} [inputOverrides] - Optional input overrides (defaults to first test case or defaults)
 * @param {string|null} [workfolderDir] - Workfolder directory for custom function resolution
 * @returns {Promise<string>} The readout text
 */
export async function readout(xmlString, inputOverrides, workfolderDir = null) {
  const { formatRules, gridRows, gridCols, spreadsheetDefaults, columnNames, cellStyles } = parseSpreadsheetMeta(xmlString);
  const parsed = parseXML(xmlString);

  // Determine inputs: use provided overrides, or first test case, or defaults
  let inputs = inputOverrides;
  if (!inputs && parsed.testCases && parsed.testCases.length > 0) {
    inputs = parsed.testCases[0].inputs;
  }

  // Suppress engine log noise during evaluation and formatting setup
  const origLog = console.log;
  console.log = (...args) => {
    if (typeof args[0] === 'string' && (
      args[0].startsWith('[CalcEngine]') || args[0].startsWith('[FormattingEngine]')
    )) return;
    origLog(...args);
  };

  // Set up formatting engine with per-cell rules and sheet defaults
  const fmtEngine = createFormattingEngine();
  const formatRulesMap = new Map(formatRules);

  // For loop sheets, propagate row 1 format overrides to generated rows (2+)
  const getInheritedFormatting = parsed.sheetType === 'loop' ? (cellKey) => {
    const match = cellKey.match(/^([A-Z]+)(\d+)$/);
    if (!match || parseInt(match[2], 10) <= 1) return null;
    const row1Key = `${match[1]}1`;
    const rules = formatRulesMap.get(row1Key);
    if (!rules) return null;
    return { styles: null, formatRules: JSON.parse(JSON.stringify(rules)) };
  } : null;

  fmtEngine.init({
    formatRules: formatRulesMap,
    cellStyles,
    spreadsheetDefaults: { ...spreadsheetDefaults },
    refreshCell: () => {},
    getSelection: () => null,
    getNode: () => null,
    recordChanges: () => {},
    onRegisterHistoryMap: null,
    onFormattingChange: null,
    getInheritedFormatting,
  });

  // Evaluate
  const { calcEngine, canonicalEngine } = createEngines();
  const { nodes, sheetType, customFunctions } = parsed;

  if (customFunctions && customFunctions.length > 0 && workfolderDir) {
    loadAndRegisterCustomFunctions(calcEngine, customFunctions, workfolderDir);
  }

  const inputValues = normalizeInputOverrides(parsed.inputs, inputs || {});

  let iterationCount = 0;
  try {
    loadNodes(canonicalEngine, nodes, inputValues);
    if (sheetType === 'loop') {
      iterationCount = runLoopIteration(calcEngine, canonicalEngine, nodes);
    }
  } finally {
    console.log = origLog;
  }

  // Build node lookup by cell key
  const nodeByKey = new Map();
  for (const node of parsed.nodes) {
    if (node.key) nodeByKey.set(node.key, node);
  }

  const lines = [];

  // --- Header ---
  lines.push(`== ${parsed.name} ==`);
  lines.push(`Type: ${parsed.sheetType || 'spreadsheet'}`);
  lines.push('');

  // --- Inputs ---
  if (parsed.inputs.length > 0) {
    lines.push('INPUTS');
    for (const inp of parsed.inputs) {
      const actualValue = inputs
        ? (Array.isArray(inputs) ? inputs[inp.order] : (inputs[inp.name] ?? inputs[inp.key]))
        : inp.default;
      lines.push(`  ${inp.name}: ${actualValue ?? inp.default}`);
    }
    lines.push('');
  }

  // --- Grid ---
  let notes = [];
  if (parsed.sheetType === 'loop') {
    notes = renderLoopGrid(lines, parsed, calcEngine, fmtEngine, nodeByKey, formatRules, gridCols, iterationCount, columnNames, cellStyles);
  } else {
    notes = renderStandardGrid(lines, parsed, calcEngine, fmtEngine, nodeByKey, formatRules, gridRows, gridCols, cellStyles);
  }

  // --- Formatting ---
  const hasDefaults = spreadsheetDefaults.NUMBER && Object.keys(spreadsheetDefaults.NUMBER).length > 0;
  if (hasDefaults) {
    const { subCategory, decimalPlaces } = spreadsheetDefaults.NUMBER;
    lines.push(`Default format: ${subCategory}, ${decimalPlaces} decimals`);
    lines.push('');
  }

  // --- Outputs ---
  if (parsed.outputs.length > 0) {
    lines.push('OUTPUTS');
    for (const o of parsed.outputs) {
      let value;
      let cellKey;
      if (parsed.sheetType === 'loop') {
        const col = o.key.toUpperCase();
        cellKey = `${col}${iterationCount}`;
        if (o.output_mode === 'all') {
          value = [];
          for (let row = 0; row <= iterationCount; row++) {
            value.push(calcEngine.getCellValue(`${col}${row}`));
          }
        } else {
          value = calcEngine.getCellValue(cellKey);
        }
      } else {
        cellKey = o.key;
        value = calcEngine.getCellValue(o.key);
      }
      const formatted = Array.isArray(value)
        ? JSON.stringify(value)
        : formatCell(cellKey, calcEngine, fmtEngine);
      lines.push(`  ${o.name} (${o.key}): ${formatted}`);
    }
    lines.push('');
  }

  // --- Test Cases ---
  if (parsed.testCases && parsed.testCases.length > 0) {
    lines.push(`TEST CASES (${parsed.testCases.length})`);
    for (const tc of parsed.testCases) {
      lines.push(`  [${tc.inputs.join(', ')}] -> ${tc.expected}`);
    }
    lines.push('');
  }

  // --- Notes (full formulas for truncated cells) ---
  if (notes.length > 0) {
    lines.push('NOTES');
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      lines.push(`  [${i + 1}] ${n.key}: ${n.formula}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const MAX_COL_WIDTH = 80;

function renderStandardGrid(lines, parsed, engine, fmtEngine, nodeByKey, formatRules, gridRows, gridCols, cellStyles) {
  const maxCol = colLetterToIndex(gridCols);
  const notes = [];

  // Build the grid content: grid[row][colIndex] = display string
  const grid = [];
  for (let row = 1; row <= gridRows; row++) {
    const rowCells = [];
    for (let col = 1; col <= maxCol; col++) {
      const colLetter = indexToColLetter(col);
      const key = `${colLetter}${row}`;
      const node = nodeByKey.get(key);
      const value = engine.getCellValue(key);

      if (!node && value === undefined) {
        rowCells.push({ key, display: '(blank)' });
      } else {
        rowCells.push({ key, display: cellDisplay(node, key, engine, fmtEngine, cellStyles) });
      }
    }
    grid.push(rowCells);
  }

  // Truncate cells that exceed MAX_COL_WIDTH, adding footnotes for long formulas
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const cell = grid[row][col];
      const fullStr = `${cell.key}: ${cell.display}`;
      if (fullStr.length <= MAX_COL_WIDTH) continue;
      if (!cell.display.includes(' -> ')) continue;

      const arrowIdx = cell.display.lastIndexOf(' -> ');
      const formula = cell.display.substring(0, arrowIdx);
      const result = cell.display.substring(arrowIdx); // " -> $8,114.00"

      const noteNum = notes.length + 1;
      notes.push({ key: cell.key, formula });

      const prefix = `${cell.key}: `;
      const ellipsis = '... ';

      // Try [note N] first, fall back to [N]
      const longRef = `[note ${noteNum}]`;
      const shortRef = `[${noteNum}]`;

      let ref = longRef;
      let available = MAX_COL_WIDTH - prefix.length - ellipsis.length - ref.length - result.length;
      if (available < 10) {
        ref = shortRef;
        available = MAX_COL_WIDTH - prefix.length - ellipsis.length - ref.length - result.length;
      }
      if (available < 1) available = 1;

      cell.display = `${formula.substring(0, available)}${ellipsis}${ref}${result}`;
    }
  }

  // Calculate column widths (including the "A1: " prefix), capped at MAX_COL_WIDTH
  const colWidths = [];
  for (let col = 0; col < maxCol; col++) {
    let maxWidth = 0;
    for (let row = 0; row < grid.length; row++) {
      const cell = grid[row][col];
      const fullStr = `${cell.key}: ${cell.display}`;
      if (fullStr.length > maxWidth) maxWidth = fullStr.length;
    }
    colWidths.push(Math.min(maxWidth, MAX_COL_WIDTH));
  }

  // Render
  lines.push('GRID');
  for (let row = 0; row < grid.length; row++) {
    const parts = [];
    for (let col = 0; col < grid[row].length; col++) {
      const cell = grid[row][col];
      const fullStr = `${cell.key}: ${cell.display}`;
      parts.push(fullStr.padEnd(colWidths[col]));
    }
    lines.push('  ' + parts.join('  '));
  }
  lines.push('');

  return notes;
}

const MAX_LOOP_DISPLAY_ROWS = 50;
const MAX_FORMULA_ROWS = 4;

function renderLoopGrid(lines, parsed, engine, fmtEngine, nodeByKey, formatRules, gridCols, iterationCount, columnNames = {}, cellStyles = new Map()) {
  const maxCol = colLetterToIndex(gridCols);

  // Determine which columns have data in any row
  const activeCols = [];
  for (let col = 1; col <= maxCol; col++) {
    const colLetter = indexToColLetter(col);
    let hasData = false;
    for (let row = 0; row <= iterationCount; row++) {
      const key = `${colLetter}${row}`;
      if (nodeByKey.has(key) || engine.getCellValue(key) !== undefined) {
        hasData = true;
        break;
      }
    }
    if (hasData) activeCols.push(colLetter);
  }

  // Build row 1 template lookup for generating adjusted formulas on rows 2+
  const row1Templates = new Map();
  for (const colLetter of activeCols) {
    const node = nodeByKey.get(`${colLetter}1`);
    if (node && node.canonical) {
      row1Templates.set(colLetter, node.canonical);
    }
  }

  // --- Section 1: Formula rows (row 0 through min(iterationCount, MAX_FORMULA_ROWS-1)) ---
  const formulaRowCount = Math.min(iterationCount + 1, MAX_FORMULA_ROWS);

  // Build formula display: "FORMULA -> VALUE" for each cell
  const formulaTable = [];
  for (let row = 0; row < formulaRowCount; row++) {
    const rowData = [];
    for (const colLetter of activeCols) {
      const key = `${colLetter}${row}`;
      const node = nodeByKey.get(key);
      const value = engine.getCellValue(key);
      const formatted = formatCell(key, engine, fmtEngine);

      if (node && node.canonical?.startsWith('=')) {
        const formula = node.canonical.substring(1);
        rowData.push(`${formula} -> ${formatted}`);
      } else if (node && node.canonical) {
        rowData.push(formatted);
      } else if (!node && row >= 2 && row1Templates.has(colLetter)) {
        const template = row1Templates.get(colLetter);
        if (template.startsWith('=')) {
          const offset = row - 1;
          const adjusted = adjustFormulaByOffset(template, offset, 0);
          const formula = adjusted.substring(1);
          rowData.push(`${formula} -> ${formatted}`);
        } else {
          rowData.push(formatted);
        }
      } else if (value !== undefined) {
        rowData.push(formatted);
      } else {
        rowData.push('');
      }
    }
    formulaTable.push(rowData);
  }

  // Column header helper: "A: Name" or just "A"
  const colHeader = (col) => columnNames[col] ? `${col}: ${columnNames[col]}` : col;

  // Calculate formula column widths, capped at MAX_COL_WIDTH
  const formulaColWidths = activeCols.map((colLetter, i) => {
    let maxWidth = colHeader(colLetter).length;
    for (const rowData of formulaTable) {
      if (rowData[i].length > maxWidth) maxWidth = rowData[i].length;
    }
    return Math.min(maxWidth, MAX_COL_WIDTH);
  });

  // Truncate long formula cells (same logic as standard grid)
  const notes = [];
  for (let row = 0; row < formulaTable.length; row++) {
    for (let i = 0; i < formulaTable[row].length; i++) {
      const cellStr = formulaTable[row][i];
      if (cellStr.length <= formulaColWidths[i]) continue;
      if (!cellStr.includes(' -> ')) continue;

      const arrowIdx = cellStr.lastIndexOf(' -> ');
      const formula = cellStr.substring(0, arrowIdx);
      const result = cellStr.substring(arrowIdx);

      const noteNum = notes.length + 1;
      notes.push({ key: `${activeCols[i]}${row}`, formula });

      const ellipsis = '... ';
      const longRef = `[note ${noteNum}]`;
      const shortRef = `[${noteNum}]`;

      let ref = longRef;
      let available = formulaColWidths[i] - ellipsis.length - ref.length - result.length;
      if (available < 10) {
        ref = shortRef;
        available = formulaColWidths[i] - ellipsis.length - ref.length - result.length;
      }
      if (available < 1) available = 1;

      formulaTable[row][i] = `${formula.substring(0, available)}${ellipsis}${ref}${result}`;
    }
  }

  const formulaRowNumWidth = String(formulaRowCount - 1).length;

  // Stop condition — determine mode from _STOP0 presence
  const stopNode = nodeByKey.get('_STOP1');
  const stop0Node = nodeByKey.get('_STOP0');
  const hasStop0 = stop0Node && stop0Node.canonical && stop0Node.canonical.startsWith('=');
  const stopFormula = stopNode ? stopNode.canonical : null;
  const stopAnnotation = hasStop0 ? '(skip if already true)' : '(do at least once)';

  // Render formula section
  lines.push('GRID (Loop Sheet)');
  lines.push('');
  lines.push('  Formulas:');
  const fHeaderParts = activeCols.map((col, i) => colHeader(col).padEnd(formulaColWidths[i]));
  lines.push('  ' + ''.padEnd(formulaRowNumWidth + 2) + fHeaderParts.join('  '));

  for (let row = 0; row < formulaRowCount; row++) {
    // Divider between template rows (0-1) and generated rows (2+)
    if (row === 2) {
      const lineWidth = formulaRowNumWidth + 2 + formulaColWidths.reduce((a, b) => a + b, 0) + (formulaColWidths.length - 1) * 2;
      lines.push('  ' + '─ '.repeat(Math.floor(lineWidth / 2)).trimEnd());
    }
    const rowLabel = String(row).padStart(formulaRowNumWidth);
    const parts = formulaTable[row].map((val, i) => val.padEnd(formulaColWidths[i]));
    lines.push('  ' + rowLabel + ': ' + parts.join('  '));
  }
  if (stopFormula) {
    lines.push(`  Stop when: ${stopFormula} ${stopAnnotation}`);
  }
  lines.push('');

  // --- Section 2: Full schedule (values only) ---
  const displayRows = Math.min(iterationCount + 1, MAX_LOOP_DISPLAY_ROWS);
  const table = [];
  for (let row = 0; row < displayRows; row++) {
    const rowData = [];
    for (const colLetter of activeCols) {
      const key = `${colLetter}${row}`;
      const value = engine.getCellValue(key);
      if (value === undefined) {
        rowData.push('');
      } else {
        rowData.push(formatCell(key, engine, fmtEngine));
      }
    }
    table.push(rowData);
  }

  // Calculate value column widths
  const valColWidths = activeCols.map((colLetter, i) => {
    let maxWidth = colHeader(colLetter).length;
    for (const rowData of table) {
      if (rowData[i].length > maxWidth) maxWidth = rowData[i].length;
    }
    return maxWidth;
  });

  const rowNumWidth = String(displayRows - 1).length;

  lines.push('  Schedule:');
  const headerParts = activeCols.map((col, i) => colHeader(col).padEnd(valColWidths[i]));
  lines.push('  ' + ''.padEnd(rowNumWidth + 2) + headerParts.join('  '));

  for (let row = 0; row < displayRows; row++) {
    const rowLabel = String(row).padStart(rowNumWidth);
    const parts = table[row].map((val, i) => val.padEnd(valColWidths[i]));
    lines.push('  ' + rowLabel + ': ' + parts.join('  '));
  }

  if (iterationCount + 1 > MAX_LOOP_DISPLAY_ROWS) {
    lines.push(`  ... (${iterationCount + 1 - MAX_LOOP_DISPLAY_ROWS} more rows)`);
  }

  lines.push(`  Total iterations: ${iterationCount}`);
  lines.push('');

  return notes;
}
