#!/usr/bin/env node
/**
 * One-time migration: normalize XMLs through canonicalValuesEngine to add
 * ARRAY wrapping for aggregation functions (SUM, MIN, MAX, AND, OR).
 *
 * Usage: node migrate-array-wrapping.mjs --workfolder workfolders/tax [FUNC1 FUNC2 ...]
 *        Without function names, processes all no-script functions in the workfolder.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import shared infrastructure
const frontendUtils = resolve(__dirname, '../src/utils');
const frontendEngines = resolve(__dirname, '../src/Engines');

const { generateXml } = await import(pathToFileURL(resolve(frontendUtils, 'xmlSerializer.js')).href);
const { parseFormula } = await import(pathToFileURL(resolve(frontendUtils, 'formulaParser.js')).href);
const {
  getBuiltInFunctions,
  deriveSingleArrayFunctions,
  inferReturnType
} = await import(pathToFileURL(resolve(frontendUtils, 'functions.js')).href);
const { createCanonicalValuesEngine } = await import(pathToFileURL(resolve(frontendEngines, 'canonicalValuesEngine.js')).href);
const { isLiteral, convertLiteral } = await import(pathToFileURL(resolve(frontendEngines, 'calculationEngine.js')).href);
const { parseXML } = await import(pathToFileURL(resolve(__dirname, 'xml-parser.mjs')).href);

/**
 * Parse test cases from XML, supporting multiple outputs.
 * Returns array of { inputs: {name: value}, outputs: {name: value} }
 * in the format generateXml expects.
 */
function parseTestCasesForGenerate(xmlString, inputNames, outputKeys) {
  const testCases = [];
  const tcRegex = /<test_case[^>]*>[\s\S]*?<\/test_case>/gi;
  let match;

  while ((match = tcRegex.exec(xmlString)) !== null) {
    const tcXml = match[0];

    const inputValues = [];
    const inputRegex = /<input_value[^>]*Value="([^"]*)"[^>]*\/>/gi;
    let m;
    while ((m = inputRegex.exec(tcXml)) !== null) {
      inputValues.push(parseFloat(m[1]));
    }

    const outputValues = [];
    const outputRegex = /<output_value[^>]*Value="([^"]*)"[^>]*\/>/gi;
    while ((m = outputRegex.exec(tcXml)) !== null) {
      outputValues.push(parseFloat(m[1]));
    }

    if (inputValues.length === 0) continue;

    // Convert to object format keyed by name
    const inputs = {};
    inputNames.forEach((name, i) => {
      if (i < inputValues.length) inputs[name] = inputValues[i];
    });

    const outputs = {};
    outputKeys.forEach((key, i) => {
      if (i < outputValues.length) outputs[key] = outputValues[i];
    });

    testCases.push({ inputs, outputs });
  }

  return testCases;
}

// --- Extract formatting from XML (not covered by parseXML) ---

function extractFormatting(xmlString) {
  const formatRules = [];
  const cellStyles = [];
  let spreadsheetDefaults = {};
  let gridBounds = { maxRow: 30, maxCol: 'O' };
  const columnNames = {};

  // Grid bounds from SpreadsheetMeta
  const metaMatch = xmlString.match(/<SpreadsheetMeta[^>]*>/);
  if (metaMatch) {
    const rows = metaMatch[0].match(/gridRows="(\d+)"/);
    const cols = metaMatch[0].match(/gridCols="([A-Z]+)"/);
    if (rows) gridBounds.maxRow = parseInt(rows[1]);
    if (cols) gridBounds.maxCol = cols[1];
  }

  // FormatRules
  const formatRegex = /<FormatRule\s+cellKey="([^"]+)"\s+formats="([^"]+)"\/>/g;
  let match;
  while ((match = formatRegex.exec(xmlString)) !== null) {
    const formats = match[2]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    formatRules.push([match[1], JSON.parse(formats)]);
  }

  // CellStyles
  const styleRegex = /<CellStyle\s+([^/]+)\/>/g;
  while ((match = styleRegex.exec(xmlString)) !== null) {
    const attrs = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    const cellKey = attrs.cellKey;
    delete attrs.cellKey;
    // Convert numeric strings
    if (attrs.fontSize) attrs.fontSize = parseInt(attrs.fontSize);
    // Convert boolean strings
    if (attrs.bold === 'true') attrs.bold = true;
    if (attrs.italic === 'true') attrs.italic = true;
    cellStyles.push([cellKey, attrs]);
  }

  // Default format
  const defaultMatch = xmlString.match(/<Default\s+type="([^"]+)"\s+settings="([^"]+)"\/>/);
  if (defaultMatch) {
    const settings = defaultMatch[2]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    spreadsheetDefaults[defaultMatch[1]] = JSON.parse(settings);
  }

  // Column names (loop sheets)
  const headerRegex = /<ColumnName\s+column="([^"]+)"\s+name="([^"]+)"\/>/g;
  while ((match = headerRegex.exec(xmlString)) !== null) {
    columnNames[match[1]] = match[2];
  }

  return { formatRules, cellStyles, spreadsheetDefaults, gridBounds, columnNames };
}

// --- Build state from parsed XML ---

function buildStateFromXml(xmlString) {
  const parsed = parseXML(xmlString);
  const fmt = extractFormatting(xmlString);

  // Build canonicalValues and nodeCalcData from nodes
  const canonicalValues = new Map();
  const nodeCalcData = new Map();

  for (const node of parsed.nodes) {
    if (!node.key) {
      // Anonymous constant — use a synthetic key
      // These get their key from the canonical value or lack thereof
      // generateXml handles keyless constants via precedent references
      continue;
    }

    const canonical = node.canonical || '';
    canonicalValues.set(node.key, canonical);

    if (canonical.startsWith('=')) {
      const result = parseFormula(canonical);
      const funcName = result.precedents[0];
      const childTypes = result.precedents.slice(1).map(() => 'Number');
      const type = inferReturnType(funcName, childTypes) || node.data_type || 'Number';
      nodeCalcData.set(node.key, {
        type: node.data_type || type,
        refValue: 0,
        precedents: result.precedents
      });
    } else if (canonical.startsWith("'")) {
      nodeCalcData.set(node.key, {
        type: 'Text',
        refValue: canonical.substring(1)
      });
    } else {
      nodeCalcData.set(node.key, {
        type: node.data_type || 'Number',
        refValue: isNaN(parseFloat(canonical)) ? canonical : parseFloat(canonical)
      });
    }
  }

  // Handle anonymous constants (no key) — these are literals used in formulas
  // generateXml discovers them from precedents, so we don't need to track them separately

  // Build output info
  const outputCells = parsed.outputs.map(o => o.key);
  const outputModes = {};
  for (const o of parsed.outputs) {
    outputModes[o.key] = o.output_mode || 'last';
  }

  // Build input info
  const namedInputs = new Set(parsed.inputs.map(i => i.key));
  const namedInputsOrdered = parsed.inputs.map(i => i.key);
  const inputNames = parsed.inputs.map(i => i.name || i.key);

  return {
    sheetName: parsed.name,
    canonicalValues,
    nodeCalcData,
    namedInputs,
    namedInputsOrdered,
    outputCells,
    outputModes,
    gridBounds: fmt.gridBounds,
    formatting: {
      formatRules: fmt.formatRules,
      cellStyles: fmt.cellStyles,
      spreadsheetDefaults: fmt.spreadsheetDefaults
    },
    customFunctions: parsed.customFunctions,
    testCases: parseTestCasesForGenerate(xmlString, namedInputsOrdered, outputCells),
    inputNames,
    sheetType: parsed.sheetType === 'spreadsheet' ? null : parsed.sheetType,
    columnNames: fmt.columnNames
  };
}

// --- Normalize through canonicalValuesEngine ---

function normalizeState(canonicalValues, nodeCalcData) {
  const engine = createCanonicalValuesEngine();
  const normalizedCalcData = new Map();

  engine.init({
    onValueChange: (changedInfo) => {
      for (const [key, info] of changedInfo) {
        let type;
        if (info.type === 'formula') {
          const precedents = info.parsed;
          const childTypes = precedents.slice(1).map(p => {
            if (isLiteral(p)) return convertLiteral(p).type;
            const childData = nodeCalcData.get(p) || normalizedCalcData.get(p);
            return childData?.type || 'Number';
          });
          if (precedents?.[0] === 'ARRAY') {
            type = `ARRAY[${childTypes[0] || 'Number'}]`;
          } else {
            const origData = nodeCalcData.get(key);
            type = origData?.type || inferReturnType(precedents[0], childTypes);
          }
        } else {
          type = info.type;
        }
        normalizedCalcData.set(key, {
          type,
          refValue: Array.isArray(info.parsed) ? 0 : (info.parsed ?? 0),
          precedents: Array.isArray(info.parsed) ? info.parsed : undefined
        });
      }
    },
    singleArrayFunctions: deriveSingleArrayFunctions(),
    dateInputFormat: 'US',
    normalizeName: null,
    isValidNameSyntax: null,
    onCheckIfFunction: null,
    recordChanges: null,
    onRegisterHistoryMap: null
  });

  engine.setBatch(Array.from(canonicalValues.entries()));

  const normalizedCanonicals = new Map();
  for (const key of normalizedCalcData.keys()) {
    normalizedCanonicals.set(key, engine.getValue(key));
  }

  return { canonicalValues: normalizedCanonicals, nodeCalcData: normalizedCalcData };
}

// --- Main ---

const args = process.argv.slice(2);
const wfIdx = args.indexOf('--workfolder');
if (wfIdx === -1 || !args[wfIdx + 1]) {
  console.error('Usage: node migrate-array-wrapping.mjs --workfolder <path> [FUNC1 FUNC2 ...]');
  process.exit(1);
}

const workfolderDir = resolve(args[wfIdx + 1]);
const specificFuncs = args.filter((a, i) => i !== wfIdx && i !== wfIdx + 1);

const regPath = resolve(workfolderDir, 'registry.json');
if (!existsSync(regPath)) {
  console.error(`No registry.json in ${workfolderDir}`);
  process.exit(1);
}

const registry = JSON.parse(readFileSync(regPath, 'utf-8'));

// Determine which functions to migrate
let funcsToMigrate;
if (specificFuncs.length > 0) {
  funcsToMigrate = specificFuncs.map(f => f.toUpperCase());
} else {
  // All no-script functions that have XML
  funcsToMigrate = Object.entries(registry)
    .filter(([, entry]) => !entry.script && entry.xml)
    .map(([name]) => name);
}

console.log(`Migrating ${funcsToMigrate.length} functions in ${workfolderDir}`);

let migrated = 0;
let unchanged = 0;
let errors = 0;

for (const funcName of funcsToMigrate) {
  const entry = registry[funcName];
  if (!entry?.xml) {
    console.log(`  ${funcName}: no XML, skipping`);
    continue;
  }

  const xmlPath = resolve(workfolderDir, entry.xml);
  if (!existsSync(xmlPath)) {
    console.log(`  ${funcName}: XML file missing, skipping`);
    continue;
  }

  try {
    const originalXml = readFileSync(xmlPath, 'utf-8');
    const state = buildStateFromXml(originalXml);

    // Normalize
    const normalized = normalizeState(state.canonicalValues, state.nodeCalcData);

    // Check if anything changed
    const oldKeys = new Set(state.canonicalValues.keys());
    const newKeys = new Set(normalized.canonicalValues.keys());
    const addedKeys = [...newKeys].filter(k => !oldKeys.has(k));

    if (addedKeys.length === 0) {
      console.log(`  ${funcName}: already normalized`);
      unchanged++;
      continue;
    }

    // Generate new XML
    const newXml = generateXml({
      ...state,
      canonicalValues: normalized.canonicalValues,
      nodeCalcData: normalized.nodeCalcData
    });

    writeFileSync(xmlPath, newXml);
    console.log(`  ${funcName}: migrated (added ${addedKeys.length} ARRAY nodes)`);
    migrated++;
  } catch (err) {
    console.error(`  ${funcName}: ERROR - ${err.message}\n${err.stack}`);
    errors++;
  }
}

console.log(`\nDone: ${migrated} migrated, ${unchanged} unchanged, ${errors} errors`);
