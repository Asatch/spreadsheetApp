#!/usr/bin/env node
/**
 * Headless evaluator for spreadsheet functions.
 *
 * Thin wrapper around the frontend orchestrators in headless mode. The
 * orchestrators handle engine init, custom-function loading, loop iteration,
 * input pushing, and output harvesting — this file just translates between
 * CLI args and orchestrator calls.
 */

import './dom-polyfill.mjs';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseXML } from './xml-parser.mjs';
import { createFilesystemFunctionCompiler } from './fs-function-compiler.mjs';
import { readout as readoutSpreadsheet } from './readout.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_PATH = resolve(__dirname, '../src');

const { createSpreadsheetOrchestrator } = await import(
  resolve(FRONTEND_PATH, 'orchestrators/spreadsheet-orchestrator.js')
);
const { createLoopSheetOrchestrator } = await import(
  resolve(FRONTEND_PATH, 'orchestrators/loop-sheet-orchestrator.js')
);

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build a headless orchestrator for the given XML's sheet type, with custom
 * functions resolved from the workfolder if provided.
 */
function buildOrchestrator(sheetType, workfolderDir) {
  const functionCompiler = workfolderDir
    ? createFilesystemFunctionCompiler(workfolderDir)
    : undefined;
  const factory = sheetType === 'loop'
    ? createLoopSheetOrchestrator
    : createSpreadsheetOrchestrator;
  return factory({ headless: true, functionCompiler });
}

/**
 * Normalize input overrides to {name: value} keyed by input name.
 * Accepts either an array (positional, by input_order) or an object.
 */
function normalizeInputs(inputDefs, overrides) {
  if (!overrides) return {};
  if (Array.isArray(overrides)) {
    const ordered = [...inputDefs].sort((a, b) => (a.input_order ?? 0) - (b.input_order ?? 0));
    const result = {};
    for (let i = 0; i < overrides.length && i < ordered.length; i++) {
      result[ordered[i].input_name || ordered[i].key] = overrides[i];
    }
    return result;
  }
  return overrides;
}

// =============================================================================
// EVALUATION FUNCTIONS (importable for programmatic use)
// =============================================================================

/**
 * Evaluate an XML function definition with given inputs.
 */
export async function evaluate(xmlString, inputOverrides = {}, workfolderDir = null) {
  try {
    const parsed = parseXML(xmlString);
    const orchestrator = buildOrchestrator(parsed.sheetType, workfolderDir);
    await orchestrator.loadFromXml(xmlString);

    const namedInputs = normalizeInputs(parsed.inputs, inputOverrides);
    for (const [name, value] of Object.entries(namedInputs)) {
      orchestrator.setValue(name, String(value));
    }

    const iter = orchestrator.runIteration();
    const outputs = orchestrator.getOutputs();

    const result = { success: true, outputs };
    if (parsed.sheetType === 'loop') result.iterationCount = iter.iterationCount;
    return result;
  } catch (error) {
    return { success: false, error: error.message, stack: error.stack };
  }
}

/**
 * Run all test cases in the XML.
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

      if (typeof actual !== 'number' || typeof expected !== 'number') {
        if (actual !== expected) {
          allPassed = false;
          errors.push(`Output ${i}: expected ${expected}, got ${actual}`);
        }
      } else {
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
 * Validate a spreadsheet for cell errors (uses first test case inputs or defaults).
 */
export async function validate(xmlString, workfolderDir = null) {
  const parsed = parseXML(xmlString);
  const orchestrator = buildOrchestrator(parsed.sheetType, workfolderDir);
  await orchestrator.loadFromXml(xmlString);

  const inputs = parsed.testCases?.[0]?.inputs;
  if (inputs) {
    const namedInputs = normalizeInputs(parsed.inputs, inputs);
    for (const [name, value] of Object.entries(namedInputs)) {
      orchestrator.setValue(name, String(value));
    }
    orchestrator.runIteration();
  }

  const cells = orchestrator.getAllCells();
  const errors = orchestrator.getErrors();
  return { errors, cellCount: cells.length };
}

/**
 * Evaluate a single formula with given context.
 *
 * Uses a temporary spreadsheet with cells set from context, then reads the
 * formula's result. Constructs values via the orchestrator's setValue path.
 */
export async function evalFormula(formula, context = {}) {
  try {
    const orchestrator = createSpreadsheetOrchestrator({ headless: true });
    for (const [key, value] of Object.entries(context)) {
      orchestrator.setValue(key, String(value));
    }
    orchestrator.setValue('__RESULT__', formula);
    const value = orchestrator.getValue('__RESULT__');
    return { success: true, value };
  } catch (error) {
    return { success: false, error: error.message };
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
        output(await evalFormula(formula, context));
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
            'node eval.mjs [--workfolder <dir>] evaluate-stdin [inputs-json]'
          ]
        });
        process.exit(1);
    }
  } catch (error) {
    output({ success: false, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) main();
