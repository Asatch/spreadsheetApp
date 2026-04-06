#!/usr/bin/env node
/**
 * Language pack test runner.
 *
 * Transpiles XML spreadsheet functions using a language pack, generates a
 * target-language test harness, executes it, and compares outputs against
 * the XML's embedded test cases.
 *
 * Usage:
 *   node test-pack.mjs <pack.json> [options] [xml-files...]
 *
 * Options:
 *   --verbose          Show generated code on failure
 *   --dump <dir>       Save generated harness files to <dir> instead of /tmp
 *   --workfolder <dir> Resolve custom function deps from a workfolder
 *   --from-zip <zip>   Extract and test XMLs from a zip file (repeatable)
 *   --baseline         Compare against JS evaluation baseline
 *
 * Files that fail transpilation or have no test cases are skipped.
 *
 * Requires the target language interpreter on PATH (e.g. python3).
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

// Polyfill DOMParser for Node — must come before transpiler imports
import './dom-polyfill.mjs';

import { parseXML } from './xml-parser.mjs';
import { loadRegistry, buildTranspilerCustomFunctions } from './function-loader.mjs';
import { transpileToLang } from '../frontend/src/transpiler/index.js';
import { reconstructSyntaxObject } from '../frontend/src/transpiler/codegenJavascript.js';
import { runTests as runJsTests } from './eval.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Pack loading ────────────────────────────────────────────────────────────

function loadPack(packPath) {
  const raw = JSON.parse(readFileSync(resolve(packPath), 'utf-8'));

  if (raw.type !== 'sc-language-pack') {
    throw new Error(`Not a language pack: ${packPath}`);
  }

  const syntaxObj = reconstructSyntaxObject(raw.syntax);
  const functionsData = typeof raw.functions === 'string'
    ? JSON.parse(raw.functions)
    : raw.functions;

  if (raw.overrides) {
    functionsData.customFunctionOverrides = reconstructSyntaxObject(raw.overrides);
  }

  return { syntaxObj, functionsData, meta: raw.meta };
}

// ─── Zip extraction ──────────────────────────────────────────────────────────

async function extractXmlsFromZip(zipPath) {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const JSZip = require('jszip');

  const zipData = readFileSync(resolve(zipPath));
  const zip = await JSZip.loadAsync(zipData);

  // Collect all entries, deduplicating: functions/{uuid}.xml and
  // spreadsheets/local-{uuid}.xml are identical copies. Keep only one,
  // preferring the functions/ version. Local-only entries (display sheets
  // with no functions/ counterpart) are kept.
  const funcEntries = new Map();   // uuid → { name, content, path, uuid }
  const localEntries = new Map();  // uuid → { name, content, path, uuid }

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!path.endsWith('.xml') || entry.dir) continue;
    const content = await entry.async('string');
    const name = basename(path);
    const rawUuid = basename(path, '.xml');

    if (path.startsWith('functions/')) {
      funcEntries.set(rawUuid, { name, content, zipPath: path, uuid: rawUuid });
    } else {
      const baseUuid = rawUuid.replace(/^local-/, '');
      localEntries.set(baseUuid, { name, content, zipPath: path, uuid: rawUuid });
    }
  }

  // Prefer functions/ entries; fall back to local-only (display sheets)
  const xmlEntries = [...funcEntries.values()];
  for (const [uuid, entry] of localEntries) {
    if (!funcEntries.has(uuid)) {
      xmlEntries.push(entry);
    }
  }
  return xmlEntries;
}

// ─── Custom function loading ─────────────────────────────────────────────────

function buildCustomFunctionsFromXmls(xmlEntries) {
  const customFunctions = {};
  for (const { content, uuid } of xmlEntries) {
    try {
      const parsed = parseXML(content);
      if (parsed.outputs && parsed.outputs.length > 0) {
        const funcName = parsed.name.toUpperCase();
        // Key by UUID (matches the id in <CustomFunctions> declarations)
        customFunctions[uuid] = {
          name: funcName,
          xml_content: content
        };
      }
    } catch { /* skip unparseable entries */ }
  }
  return customFunctions;
}

// ─── Interpreter detection ───────────────────────────────────────────────────

const EXTENSION_INTERPRETERS = {
  '.py': 'python3',
  '.js': 'node',
  '.rb': 'ruby',
  '.sql': 'sqlite3'
};

function getInterpreter(meta) {
  const ext = meta.fileExtension || '.py';
  const interpreter = EXTENSION_INTERPRETERS[ext];
  if (!interpreter) {
    throw new Error(
      `No known interpreter for extension "${ext}". ` +
      `Supported: ${Object.keys(EXTENSION_INTERPRETERS).join(', ')}`
    );
  }
  return interpreter;
}

// ─── Harness generation ─────────────────────────────────────────────────────

/**
 * Convert {1,2,3} array literal strings to actual JS arrays so they serialize
 * as native lists in the target language harness (Python list, etc.).
 */
function coerceArrayLiterals(value) {
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    return value.slice(1, -1).split(',').map(s => {
      const n = Number(s.trim());
      return isNaN(n) ? s.trim() : n;
    });
  }
  return value;
}

function generatePythonHarness(transpiled, funcName, inputs, testCases) {
  const argCount = inputs.length;
  const testCasesJson = JSON.stringify(testCases.map(tc => ({
    inputs: tc.inputs.slice(0, argCount).map(coerceArrayLiterals),
    expected: Array.isArray(tc.expected) ? tc.expected : [tc.expected]
  })));

  return `import json
import sys

${transpiled}

_TEST_CASES = json.loads(${JSON.stringify(testCasesJson)})
_results = []

for _tc in _TEST_CASES:
    try:
        _result = ${funcName}(*_tc["inputs"])
        if isinstance(_result, dict):
            _outputs = list(_result.values())
        elif isinstance(_result, (list, tuple)):
            _outputs = list(_result)
        else:
            _outputs = [_result]
        _results.append({"outputs": _outputs, "error": None})
    except Exception as _e:
        _results.append({"outputs": None, "error": str(_e)})

print(json.dumps(_results))
`;
}

// SQLite reserved words — must match the set in build-sqlite-pack.mjs
const SQL_RESERVED = new Set([
  'abort', 'action', 'add', 'after', 'all', 'alter', 'and', 'as', 'asc',
  'attach', 'autoincrement', 'before', 'begin', 'between', 'by', 'cascade',
  'case', 'cast', 'check', 'collate', 'column', 'commit', 'conflict',
  'constraint', 'create', 'cross', 'current', 'default', 'deferrable',
  'deferred', 'delete', 'desc', 'detach', 'distinct', 'drop', 'each',
  'else', 'end', 'escape', 'except', 'exclusive', 'exists', 'explain',
  'fail', 'filter', 'following', 'for', 'foreign', 'from', 'full', 'glob',
  'group', 'having', 'if', 'ignore', 'immediate', 'in', 'index', 'indexed',
  'initially', 'inner', 'insert', 'instead', 'intersect', 'into', 'is',
  'isnull', 'join', 'key', 'left', 'like', 'limit', 'match', 'natural',
  'no', 'not', 'nothing', 'notnull', 'null', 'of', 'offset', 'on', 'or',
  'order', 'outer', 'over', 'partition', 'plan', 'pragma', 'preceding',
  'primary', 'query', 'raise', 'range', 'recursive', 'references',
  'regexp', 'reindex', 'release', 'rename', 'replace', 'restrict',
  'right', 'rollback', 'row', 'rows', 'savepoint', 'select', 'set',
  'table', 'temp', 'temporary', 'then', 'to', 'transaction', 'trigger',
  'unbounded', 'union', 'unique', 'update', 'using', 'vacuum', 'values',
  'view', 'virtual', 'when', 'where', 'window', 'with', 'without'
]);

function sqlSafeName(name) {
  let safe = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z_]/.test(safe)) safe = '_' + safe;
  if (SQL_RESERVED.has(safe)) safe = safe + '_';
  return safe;
}

function generateSqlHarness(transpiled, funcName, inputs, testCases) {
  // The transpiled SQL operates on an _input table. We create the table,
  // insert one row per test case, run the transpiled code, then SELECT results.

  const inputNames = inputs.map(inp => sqlSafeName(inp.name));

  function sqlLiteral(value) {
    if (typeof value === 'string') {
      // Convert {1,2,3} array literals to JSON array format for SQLite
      if (value.startsWith('{') && value.endsWith('}')) {
        const inner = value.slice(1, -1);
        return `'[${inner}]'`;
      }
      return `'${value.replace(/'/g, "''")}'`;
    }
    const s = String(value);
    return (s.includes('.') || s.includes('e') || s.includes('E')) ? s : s + '.0';
  }

  // Create _input table with input columns
  const colDefs = inputNames.map(n => `${n} REAL`).join(', ');
  let harness = `.headers off\n`;
  harness += `CREATE TEMP TABLE _input (${colDefs});\n`;

  // Insert all test cases as rows (only use as many inputs as the function accepts)
  const argCount = inputs.length;
  for (const tc of testCases) {
    const values = tc.inputs.slice(0, argCount).map(v => sqlLiteral(v)).join(', ');
    harness += `INSERT INTO _input VALUES (${values});\n`;
  }

  // Strip comment lines from transpiled code and append
  const code = transpiled.replace(/^--[^\n]*\n/gm, '');
  harness += code;

  // Clean up
  harness += `DROP TABLE IF EXISTS _input;\n`;

  return harness;
}

const HARNESS_GENERATORS = {
  '.py': generatePythonHarness,
  '.sql': generateSqlHarness
};

// ─── Execution ───────────────────────────────────────────────────────────────

function executeHarness(harnessCode, interpreter, fileExtension, opts = {}) {
  const dir = opts.dumpDir || tmpdir();
  const tmpName = `sc-test-pack-${Date.now()}${fileExtension}`;
  const tmpPath = resolve(dir, tmpName);

  try {
    writeFileSync(tmpPath, harnessCode, 'utf-8');

    let stdout;
    if (interpreter === 'sqlite3') {
      // sqlite3 reads SQL from stdin — each query outputs one line
      stdout = execFileSync(interpreter, [':memory:'], {
        input: harnessCode,
        encoding: 'utf-8',
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // Parse one result per line into standard format.
      // Each line is either a scalar value or a JSON object (multi-output).
      const lines = stdout.trim().split('\n').filter(l => l.trim() !== '');
      const results = lines.map(line => {
        const val = line.trim();
        // Try JSON parse for multi-output results (JSON objects)
        if (val.startsWith('{')) {
          try {
            const obj = JSON.parse(val);
            return { outputs: Object.values(obj), error: null };
          } catch { /* fall through to scalar */ }
        }
        const num = Number(val);
        return {
          outputs: [isNaN(num) ? val : num],
          error: null
        };
      });
      return { success: true, results, harnessPath: tmpPath };
    } else {
      stdout = execFileSync(interpreter, [tmpPath], {
        encoding: 'utf-8',
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, results: JSON.parse(stdout.trim()), harnessPath: tmpPath };
    }
  } catch (err) {
    const stderr = err.stderr || '';
    return { success: false, error: stderr || err.message, harnessPath: tmpPath };
  } finally {
    if (!opts.dumpDir) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function compareValue(actual, expected) {
  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return actual === expected;
  }
  const tolerance = Math.abs(expected) * 1e-6 || 1e-6;
  return Math.abs(actual - expected) < tolerance;
}

// ─── Console suppression during transpilation ────────────────────────────────

function silenced(fn) {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

// ─── Transpile error summarization ───────────────────────────────────────────

function summarizeTranspileError(error) {
  // "Missing conversion instructions for some functions: { JSON }"
  const missingMatch = error.match(/^Missing conversion instructions.*?:\s*\{/);
  if (missingMatch) {
    try {
      const jsonStart = error.indexOf('{');
      const obj = JSON.parse(error.slice(jsonStart));
      const funcNames = Object.keys(obj);
      return `missing signatures: ${funcNames.join(', ')}`;
    } catch { /* fall through */ }
  }

  // Truncate long messages
  if (error.length > 120) {
    return error.slice(0, 117) + '...';
  }
  return error;
}

// ─── JS baseline check ──────────────────────────────────────────────────────

async function checkJsBaseline(xmlString, testCases, workfolderDir) {
  const jsResult = await runJsTests(xmlString, workfolderDir);
  if (jsResult.error) return { available: false, reason: jsResult.error };

  const mismatches = [];
  for (let i = 0; i < jsResult.results.length; i++) {
    if (!jsResult.results[i].passed) {
      mismatches.push({
        testCase: i + 1,
        expected: testCases[i].expected,
        jsActual: jsResult.results[i].actual,
        jsError: jsResult.results[i].error
      });
    }
  }

  return { available: true, allPass: mismatches.length === 0, mismatches };
}

// ─── Per-file test runner ────────────────────────────────────────────────────

function testOneXml(pack, xmlString, fileName, customFunctions, opts) {
  const parsed = parseXML(xmlString);

  if (!parsed.testCases || parsed.testCases.length === 0) {
    return { fileName, status: 'skip', reason: 'no test cases' };
  }

  // Transpile (suppress noisy DAG build warnings)
  const { code, error } = silenced(() =>
    transpileToLang(xmlString, customFunctions, pack.syntaxObj, pack.functionsData)
  );

  if (error) {
    return { fileName, status: 'skip', reason: summarizeTranspileError(error) };
  }

  // Generate harness
  const ext = pack.meta.fileExtension || '.py';
  const generator = HARNESS_GENERATORS[ext];
  if (!generator) {
    return { fileName, status: 'skip', reason: `no harness generator for ${ext}` };
  }

  const funcName = parsed.name.toUpperCase();

  // The transpiler may inline some inputs as constants, so the generated
  // function can have fewer parameters than the XML declares inputs.
  // Extract the actual parameter count from the generated code.
  const defMatch = code.match(new RegExp(`def ${funcName}\\(([^)]*)\\)`));
  const actualArgCount = defMatch
    ? defMatch[1].split(',').filter(s => s.trim()).length
    : parsed.inputs.length;
  const effectiveInputs = parsed.inputs.slice(0, actualArgCount);

  const harness = generator(code, funcName, effectiveInputs, parsed.testCases);

  // Execute
  const interpreter = getInterpreter(pack.meta);
  const execResult = executeHarness(harness, interpreter, ext, opts);

  if (!execResult.success) {
    return {
      fileName,
      status: 'fail',
      passed: 0,
      failed: parsed.testCases.length,
      total: parsed.testCases.length,
      error: execResult.error,
      generatedCode: code,
      harnessPath: execResult.harnessPath
    };
  }

  // Compare results
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < parsed.testCases.length; i++) {
    const tc = parsed.testCases[i];
    const result = execResult.results[i];

    if (result.error) {
      failed++;
      failures.push({ testCase: i + 1, error: result.error });
      continue;
    }

    const expectedArr = Array.isArray(tc.expected) ? tc.expected : [tc.expected];
    let allMatch = true;

    for (let j = 0; j < expectedArr.length; j++) {
      if (!compareValue(result.outputs[j], expectedArr[j])) {
        allMatch = false;
        failures.push({
          testCase: i + 1,
          output: j,
          expected: expectedArr[j],
          actual: result.outputs[j]
        });
      }
    }

    if (allMatch) passed++;
    else failed++;
  }

  return {
    fileName,
    status: failed === 0 ? 'pass' : 'fail',
    passed,
    failed,
    total: parsed.testCases.length,
    failures,
    generatedCode: code,
    harnessPath: execResult.harnessPath
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(rawArgs) {
  const opts = { verbose: false, dumpDir: null, workfolderDir: null, zipPaths: [], baseline: false };
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    switch (rawArgs[i]) {
      case '--verbose':
        opts.verbose = true;
        break;
      case '--dump':
        opts.dumpDir = resolve(rawArgs[++i]);
        break;
      case '--workfolder':
        opts.workfolderDir = resolve(rawArgs[++i]);
        break;
      case '--from-zip':
        opts.zipPaths.push(resolve(rawArgs[++i]));
        break;
      case '--baseline':
        opts.baseline = true;
        break;
      default:
        positional.push(rawArgs[i]);
    }
  }

  return { opts, positional };
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));

  if (positional.length === 0) {
    console.error(
      'Usage: node test-pack.mjs <pack.json> [options] [xml-files...]\n\n' +
      'Options:\n' +
      '  --verbose          Show generated code on failure\n' +
      '  --dump <dir>       Save harness files to <dir>\n' +
      '  --workfolder <dir> Resolve custom function deps\n' +
      '  --from-zip <zip>   Test XMLs extracted from a zip (repeatable)\n' +
      '  --baseline         Compare against JS evaluation baseline'
    );
    process.exit(1);
  }

  const packPath = positional[0];
  const xmlPaths = positional.slice(1);

  if (opts.dumpDir) {
    mkdirSync(opts.dumpDir, { recursive: true });
  }

  // Load pack
  const pack = loadPack(packPath);
  const packName = pack.meta.name || basename(packPath);

  // Check interpreter availability
  const interpreter = getInterpreter(pack.meta);
  try {
    execFileSync(interpreter, ['--version'], { stdio: 'pipe' });
  } catch {
    console.error(`Error: interpreter "${interpreter}" not found on PATH.`);
    process.exit(1);
  }

  // Build XML items to test, each with its own custom function scope.
  // xmlItems: { name, content, source, customFunctions }
  const xmlItems = [];

  // Build base custom functions from --workfolder if provided
  const baseFuncs = opts.workfolderDir
    ? buildTranspilerCustomFunctions(resolve(opts.workfolderDir))
    : {};

  // From zip files — each zip gets its own custom function scope
  for (const zipPath of opts.zipPaths) {
    const zipXmls = await extractXmlsFromZip(zipPath);
    const zipName = basename(zipPath);
    const zipFuncs = buildCustomFunctionsFromXmls(zipXmls);
    const scopedFuncs = { ...baseFuncs, ...zipFuncs };

    for (const { name, content } of zipXmls) {
      xmlItems.push({ name, content, source: zipName, customFunctions: scopedFuncs });
    }
  }

  // From explicit file paths
  for (const p of xmlPaths) {
    const content = readFileSync(resolve(p), 'utf-8');
    xmlItems.push({ name: basename(p), content, source: 'file', customFunctions: baseFuncs });
  }

  // From workfolder registry (same approach as rebuild)
  if (xmlItems.length === 0 && opts.workfolderDir) {
    const registry = loadRegistry(resolve(opts.workfolderDir));
    for (const [name, entry] of Object.entries(registry)) {
      const xmlPath = resolve(opts.workfolderDir, entry.xml || `${name}.xml`);
      if (!existsSync(xmlPath)) continue;
      const content = readFileSync(xmlPath, 'utf-8');
      xmlItems.push({ name: `${name}.xml`, content, source: basename(opts.workfolderDir), customFunctions: baseFuncs });
    }
  }


  console.log(`Testing ${packName} language pack against ${xmlItems.length} XML files...\n`);

  // Run tests
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let filesWithTests = 0;
  let baselineWarnings = 0;

  for (const item of xmlItems) {
    const displayName = item.source !== 'file'
      ? `${item.source}/${item.name}`
      : item.name;

    const result = testOneXml(pack, item.content, displayName, item.customFunctions, {
      dumpDir: opts.dumpDir
    });

    if (result.status === 'skip') {
      totalSkipped++;
      console.log(`  ${displayName.padEnd(50)} SKIP  (${result.reason})`);
      continue;
    }

    filesWithTests++;
    const dots = '.'.repeat(result.total);

    if (result.status === 'pass') {
      totalPassed += result.passed;

      let baselineNote = '';
      if (opts.baseline) {
        const bl = await checkJsBaseline(item.content, parseXML(item.content).testCases, opts.workfolderDir);
        if (bl.available && !bl.allPass) {
          baselineNote = '  (JS baseline also fails)';
          baselineWarnings++;
        }
      }

      console.log(`  ${displayName.padEnd(50)} ${dots}  ${result.passed}/${result.total} passed${baselineNote}`);
    } else {
      totalPassed += result.passed;
      totalFailed += result.failed;

      let baselineNote = '';
      if (opts.baseline) {
        const bl = await checkJsBaseline(item.content, parseXML(item.content).testCases, opts.workfolderDir);
        if (bl.available && !bl.allPass) {
          baselineNote = ' (JS baseline also fails — test case may be wrong)';
          baselineWarnings++;
        }
      }

      console.log(`  ${displayName.padEnd(50)} ${dots}  ${result.passed}/${result.total} passed  FAIL${baselineNote}`);

      if (result.error) {
        const lines = result.error.split('\n').filter(l => l.trim());
        const last = lines[lines.length - 1] || result.error;
        console.log(`    Error: ${last}`);
      }

      for (const f of (result.failures || [])) {
        if (f.error) {
          console.log(`    Test ${f.testCase}: runtime error: ${f.error}`);
        } else {
          console.log(`    Test ${f.testCase}, output ${f.output}: expected ${f.expected}, got ${f.actual}`);
        }
      }

      if (opts.verbose && result.generatedCode) {
        console.log(`    ── Generated code ──`);
        for (const line of result.generatedCode.split('\n')) {
          console.log(`    | ${line}`);
        }
        console.log(`    ── End ──`);
      }

      if (result.harnessPath && opts.dumpDir) {
        console.log(`    Harness saved: ${result.harnessPath}`);
      }
    }
  }

  // Summary
  console.log();
  const parts = [];
  if (totalPassed > 0) parts.push(`${totalPassed} passed`);
  if (totalFailed > 0) parts.push(`${totalFailed} failed`);
  if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
  if (baselineWarnings > 0) parts.push(`${baselineWarnings} JS baseline warnings`);
  console.log(`Results: ${parts.join(', ')} (${filesWithTests} files tested)`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
