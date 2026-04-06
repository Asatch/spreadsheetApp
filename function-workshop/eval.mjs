#!/usr/bin/env node
/**
 * Headless evaluator for spreadsheet functions.
 *
 * Usage:
 *   node eval.mjs [--workfolder <dir>] evaluate <xml-file> [inputs-json]
 *   node eval.mjs [--workfolder <dir>] test <xml-file>
 *   node eval.mjs [--workfolder <dir>] eval-formula <formula> [context-json]
 *   node eval.mjs [--workfolder <dir>] readout <xml-file> [inputs-json]
 *   node eval.mjs [--workfolder <dir>] evaluate-stdin [inputs-json]
 *
 * Outputs JSON to stdout (except readout, which outputs text).
 * Use --workfolder to specify a workfolder directory, or omit it to auto-detect from the XML file path.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_PATH = resolve(__dirname, '../frontend/src');

const { parseFormula } = await import(
  resolve(FRONTEND_PATH, 'utils/formulaParser.js')
);

import { parseXML } from './xml-parser.mjs';
import { loadAndRegisterCustomFunctions } from './function-loader.mjs';
import {
  createEngines,
  normalizeInputOverrides,
  loadNodes,
  runLoopIteration,
  collectOutputs,
} from './eval-core.mjs';
import { readout as readoutSpreadsheet } from './readout.mjs';

// =============================================================================
// EVALUATION FUNCTIONS (importable for programmatic use)
// =============================================================================

/**
 * Evaluate an XML function definition with given inputs.
 *
 * @param {string} xmlString - The XML function definition
 * @param {Object|Array} inputOverrides - Input values (object keyed by name, or array in order)
 * @param {string|null} workfolderDir - Workfolder directory for custom function resolution
 * @returns {{ outputs: Array, success: boolean, error?: string, iterationCount?: number }}
 */
export async function evaluate(xmlString, inputOverrides = {}, workfolderDir = null) {
  try {
    const { calcEngine, canonicalEngine } = createEngines();
    const { nodes, outputs, inputs, sheetType, customFunctions } = parseXML(xmlString);

    if (customFunctions?.length > 0 && workfolderDir) {
      loadAndRegisterCustomFunctions(calcEngine, customFunctions, workfolderDir);
    }

    const inputValues = normalizeInputOverrides(inputs, inputOverrides);
    loadNodes(canonicalEngine, nodes, inputValues);

    let iterationCount = 0;
    if (sheetType === 'loop') {
      iterationCount = runLoopIteration(calcEngine, canonicalEngine, nodes);
    }

    const results = collectOutputs(calcEngine, outputs, sheetType, iterationCount);
    const result = { success: true, outputs: results };
    if (sheetType === 'loop') result.iterationCount = iterationCount;
    return result;

  } catch (error) {
    return { success: false, error: error.message, stack: error.stack };
  }
}

/**
 * Run test cases defined in XML.
 *
 * @param {string} xmlString - The XML function definition with TestCases
 * @param {string|null} workfolderDir - Workfolder directory for custom function resolution
 * @returns {{ passed: number, failed: number, results: Array }}
 */
export async function runTests(xmlString, workfolderDir = null) {
  const { testCases } = parseXML(xmlString);

  if (!testCases || testCases.length === 0) {
    return { passed: 0, failed: 0, results: [], error: 'No test cases found' };
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = await evaluate(xmlString, testCase.inputs, workfolderDir);

    if (!result.success) {
      results.push({
        inputs: testCase.inputs, expected: testCase.expected,
        actual: null, passed: false, error: result.error
      });
      failed++;
      continue;
    }

    // Compare each output against expected values
    const expectedValues = Array.isArray(testCase.expected)
      ? testCase.expected
      : [testCase.expected];

    let allPassed = true;
    const actuals = [];
    const errors = [];

    for (let i = 0; i < expectedValues.length; i++) {
      const actual = result.outputs[i]?.value;
      const expected = expectedValues[i];
      actuals.push(actual);

      // For non-numeric values, use strict equality
      if (typeof actual !== 'number' || typeof expected !== 'number') {
        if (actual !== expected) {
          allPassed = false;
          errors.push(`Output ${i}: expected ${expected}, got ${actual}`);
        }
      } else {
        // For numbers, use tolerance-based comparison
        const tolerance = Math.abs(expected) * 1e-6 || 1e-6;
        if (Math.abs(actual - expected) >= tolerance) {
          allPassed = false;
          errors.push(`Output ${i}: expected ${expected}, got ${actual}`);
        }
      }
    }

    results.push({
      inputs: testCase.inputs,
      expected: expectedValues.length === 1 ? expectedValues[0] : expectedValues,
      actual: actuals.length === 1 ? actuals[0] : actuals,
      passed: allPassed,
      error: allPassed ? null : errors.join('; ')
    });

    if (allPassed) passed++;
    else failed++;
  }

  return { passed, failed, total: testCases.length, results };
}

/**
 * Evaluate a single formula with given context.
 *
 * @param {string} formula - Formula string (e.g., "=A1*RATE")
 * @param {Object} context - Values for referenced cells/names
 * @returns {{ value: any, success: boolean, error?: string }}
 */
export function evalFormula(formula, context = {}) {
  try {
    const { calcEngine, canonicalEngine } = createEngines();

    const entries = [];
    for (const [key, value] of Object.entries(context)) {
      entries.push([key, String(value)]);
    }
    entries.push(['__RESULT__', formula]);

    canonicalEngine.setBatch(entries);
    const value = calcEngine.getCellValue('__RESULT__');

    return { success: true, value };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Validate a spreadsheet for cell errors.
 *
 * Evaluates the sheet (using first test case inputs or defaults) and scans
 * all grid cells for error values (#REF!, #NAME!, #SYNTAX!, etc.).
 * Catches errors that tests miss because they only check output-connected cells.
 *
 * @param {string} xmlString - The XML function definition
 * @param {string|null} workfolderDir - Workfolder directory for custom function resolution
 * @returns {{ errors: Array<{cell: string, error: string}>, cellCount: number }}
 */
export async function validate(xmlString, workfolderDir = null) {
  const { calcEngine, canonicalEngine } = createEngines();
  const parsed = parseXML(xmlString);

  if (parsed.customFunctions?.length > 0 && workfolderDir) {
    loadAndRegisterCustomFunctions(calcEngine, parsed.customFunctions, workfolderDir);
  }

  // Use first test case inputs or defaults
  let inputs;
  if (parsed.testCases && parsed.testCases.length > 0) {
    inputs = parsed.testCases[0].inputs;
  }

  const inputValues = normalizeInputOverrides(parsed.inputs, inputs || {});

  // Suppress engine log noise
  const origLog = console.log;
  console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[CalcEngine]')) return;
    origLog(...args);
  };

  try {
    loadNodes(canonicalEngine, parsed.nodes, inputValues);

    let iterationCount = 0;
    if (parsed.sheetType === 'loop') {
      iterationCount = runLoopIteration(calcEngine, canonicalEngine, parsed.nodes);
    }

    // Collect all cell keys to check
    const cellKeys = new Set();

    // All authored grid cells (A1, B3, etc.)
    for (const node of parsed.nodes) {
      if (node.key && /^[A-Z]+\d+$/.test(node.key)) {
        cellKeys.add(node.key);
      }
    }

    // For loop sheets, also check generated rows
    if (parsed.sheetType === 'loop' && iterationCount > 1) {
      const row1Cols = parsed.nodes
        .filter(n => n.key && /^[A-Z]+1$/.test(n.key))
        .map(n => n.key.replace(/\d+$/, ''));

      for (let row = 2; row <= iterationCount; row++) {
        for (const col of row1Cols) {
          cellKeys.add(`${col}${row}`);
        }
      }
    }

    // Scan for errors
    const errors = [];
    for (const key of cellKeys) {
      const node = calcEngine.getNode(key);
      if (!node) continue;

      if (node.errorMeta && node.errorMeta.length > 0) {
        const errorStr = typeof node.refValue === 'string' && node.refValue.startsWith('#')
          ? node.refValue
          : node.errorMeta[0]?.error || 'unknown error';
        errors.push({ cell: key, error: errorStr });
      }
    }

    return { errors, cellCount: cellKeys.size };
  } finally {
    console.log = origLog;
  }
}

// =============================================================================
// CLI
// =============================================================================

function output(result) {
  console.log(JSON.stringify(result, null, 2));
}

function readInput(arg) {
  if (!arg) return {};
  if (arg.startsWith('{') || arg.startsWith('[')) return JSON.parse(arg);
  return JSON.parse(readFileSync(arg, 'utf-8'));
}

/**
 * Find a workfolder directory by walking up from a file path, looking for registry.json.
 */
function detectWorkfolderDir(filePath) {
  let dir = dirname(resolve(filePath));
  const root = resolve('/');
  while (dir !== root) {
    if (existsSync(resolve(dir, 'registry.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // Parse --workfolder flag
  let workfolderDir = null;
  const workfolderIdx = rawArgs.indexOf('--workfolder');
  if (workfolderIdx !== -1) {
    workfolderDir = resolve(rawArgs[workfolderIdx + 1]);
    rawArgs.splice(workfolderIdx, 2);
  }

  const [command, ...rest] = rawArgs;

  try {
    switch (command) {
      case 'evaluate': {
        const [xmlPath, inputsArg] = rest;
        if (!xmlPath) { output({ success: false, error: 'Missing XML file path' }); process.exit(1); }
        if (!workfolderDir) workfolderDir = detectWorkfolderDir(xmlPath);
        const xml = readFileSync(resolve(xmlPath), 'utf-8');
        const inputs = readInput(inputsArg);
        output(await evaluate(xml, inputs, workfolderDir));
        break;
      }

      case 'test': {
        const [xmlPath] = rest;
        if (!xmlPath) { output({ success: false, error: 'Missing XML file path' }); process.exit(1); }
        if (!workfolderDir) workfolderDir = detectWorkfolderDir(xmlPath);
        const xml = readFileSync(resolve(xmlPath), 'utf-8');
        output(await runTests(xml, workfolderDir));
        break;
      }

      case 'eval-formula': {
        const [formula, contextArg] = rest;
        if (!formula) { output({ success: false, error: 'Missing formula' }); process.exit(1); }
        const context = readInput(contextArg);
        output(evalFormula(formula, context));
        break;
      }

      case 'readout': {
        const [xmlPath, inputsArg] = rest;
        if (!xmlPath) { output({ success: false, error: 'Missing XML file path' }); process.exit(1); }
        if (!workfolderDir) workfolderDir = detectWorkfolderDir(xmlPath);
        const xml = readFileSync(resolve(xmlPath), 'utf-8');
        const inputs = inputsArg ? readInput(inputsArg) : undefined;
        const text = await readoutSpreadsheet(xml, inputs, workfolderDir);
        console.log(text);
        break;
      }

      case 'validate': {
        const [xmlPath] = rest;
        if (!xmlPath) { output({ success: false, error: 'Missing XML file path' }); process.exit(1); }
        if (!workfolderDir) workfolderDir = detectWorkfolderDir(xmlPath);
        const xml = readFileSync(resolve(xmlPath), 'utf-8');
        output(await validate(xml, workfolderDir));
        break;
      }

      case 'evaluate-stdin': {
        const chunks = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const xml = Buffer.concat(chunks).toString('utf-8');
        const inputs = readInput(rest[0]);
        output(await evaluate(xml, inputs, workfolderDir));
        break;
      }

      default:
        output({
          success: false, error: `Unknown command: ${command}`,
          usage: [
            'node eval.mjs [--workfolder <dir>] evaluate <xml-file> [inputs-json]',
            'node eval.mjs [--workfolder <dir>] test <xml-file>',
            'node eval.mjs [--workfolder <dir>] eval-formula <formula> [context-json]',
            'node eval.mjs [--workfolder <dir>] readout <xml-file> [inputs-json]',
            'node eval.mjs [--workfolder <dir>] evaluate-stdin [inputs-json]  (reads XML from stdin)'
          ]
        });
        process.exit(1);
    }
  } catch (error) {
    output({ success: false, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Only run CLI when executed directly (not when imported as a library)
const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) main();
