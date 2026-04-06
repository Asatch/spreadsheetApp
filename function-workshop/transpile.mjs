#!/usr/bin/env node
/**
 * Standalone transpiler for function-workshop workfolders.
 *
 * Transpiles XML → JavaScript using the frontend JS transpiler.
 * Reads/writes from workfolder directories. Manages registry.json.
 *
 * Usage:
 *   node transpile.mjs --workfolder workfolders/my-suite FUNCTION_NAME
 *   node transpile.mjs --workfolder workfolders/my-suite --all
 *   node transpile.mjs --workfolder workfolders/my-suite --register --xml FILE.xml FUNC --deps DEP1,DEP2
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// Polyfill DOM APIs before importing the transpiler
import './dom-polyfill.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_SRC = resolve(__dirname, '../frontend/src');
const { transpile } = await import(resolve(FRONTEND_SRC, 'transpiler/index.js'));

// ── Registry I/O ──────────────────────────────────────────────────────

function loadRegistry(workfolderDir) {
  const path = resolve(workfolderDir, 'registry.json');
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  return {};
}

function saveRegistry(workfolderDir, registry) {
  const path = resolve(workfolderDir, 'registry.json');
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n');
}

// ── Sheet type detection ──────────────────────────────────────────────

function detectSheetType(xmlContent) {
  const match = xmlContent.match(/sheetType="([^"]*)"/);
  return match ? match[1] : 'standard';
}

// ── Transpile a single function ───────────────────────────────────────

function transpileFunction(workfolderDir, funcName, registry) {
  funcName = funcName.toUpperCase();

  if (!registry[funcName]) {
    return { code: null, error: `Function ${funcName} not found in registry` };
  }

  const entry = registry[funcName];
  const xmlPath = resolve(workfolderDir, entry.xml);

  if (!existsSync(xmlPath)) {
    return { code: null, error: `XML file not found: ${xmlPath}` };
  }

  const xmlContent = readFileSync(xmlPath, 'utf-8');

  // Build custom_functions dict from transitive dependencies
  const customFunctions = {};
  const depsToProcess = [...(entry.dependencies || [])];
  const processed = new Set();

  while (depsToProcess.length > 0) {
    const depName = depsToProcess.pop();
    if (processed.has(depName)) continue;
    processed.add(depName);

    if (!registry[depName]) {
      return { code: null, error: `Dependency ${depName} not found in registry` };
    }

    const depEntry = registry[depName];
    const depXmlPath = resolve(workfolderDir, depEntry.xml);

    if (!existsSync(depXmlPath)) {
      return { code: null, error: `Dependency XML not found: ${depXmlPath}` };
    }

    const depXml = readFileSync(depXmlPath, 'utf-8');
    customFunctions[depEntry.uuid] = { name: depName, xml_content: depXml };

    for (const nestedDep of (depEntry.dependencies || [])) {
      if (!processed.has(nestedDep)) {
        depsToProcess.push(nestedDep);
      }
    }
  }

  // Run transpilation
  const result = transpile(
    xmlContent,
    Object.keys(customFunctions).length > 0 ? customFunctions : undefined,
  );

  if (result.error) {
    return { code: null, error: result.error, testResults: null };
  }

  return { code: result.javascript, error: null, testResults: result.testResults };
}

// ── Register a function ───────────────────────────────────────────────

function registerFunction(workfolderDir, funcName, xmlFilename, dependencies, script) {
  const registry = loadRegistry(workfolderDir);
  funcName = funcName.toUpperCase();

  // Read XML to detect sheet type
  const xmlPath = resolve(workfolderDir, xmlFilename);
  const xmlContent = readFileSync(xmlPath, 'utf-8');
  const sheetType = detectSheetType(xmlContent);

  const isFunction = hasOutputs(xmlContent);

  if (registry[funcName]) {
    // Update existing entry, preserve UUID
    const entry = registry[funcName];
    entry.xml = xmlFilename;
    entry.sheetType = sheetType;
    if (isFunction) {
      entry.js = funcName + '.js';
    } else {
      delete entry.js;
    }
    if (dependencies !== undefined) entry.dependencies = dependencies;
    if (script !== undefined) entry.script = script;
  } else {
    // New entry
    const entry = {
      uuid: randomUUID(),
      xml: xmlFilename,
      sheetType,
      dependencies: dependencies || [],
    };
    if (isFunction) entry.js = funcName + '.js';
    if (script !== undefined) entry.script = script;
    registry[funcName] = entry;
  }

  saveRegistry(workfolderDir, registry);
  return registry;
}

// ── Topological sort ──────────────────────────────────────────────────

function topoSort(funcNames, registry) {
  const targetSet = new Set(funcNames);
  const ordered = [];
  const visited = new Set();

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    if (registry[name]) {
      for (const dep of (registry[name].dependencies || [])) {
        if (targetSet.has(dep)) visit(dep);
      }
    }
    ordered.push(name);
  }

  for (const name of funcNames) {
    visit(name);
  }

  return ordered;
}

// ── Check if XML has outputs ──────────────────────────────────────────

function hasOutputs(xmlContent) {
  return /<Output\s/.test(xmlContent);
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    workfolder: null,
    func: null,
    all: false,
    register: false,
    xml: null,
    deps: null,
    script: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workfolder' && args[i + 1]) {
      opts.workfolder = args[++i];
    } else if (args[i] === '--all') {
      opts.all = true;
    } else if (args[i] === '--register') {
      opts.register = true;
    } else if (args[i] === '--xml' && args[i + 1]) {
      opts.xml = args[++i];
    } else if (args[i] === '--deps' && args[i + 1]) {
      opts.deps = args[++i];
    } else if (args[i] === '--script' && args[i + 1]) {
      opts.script = args[++i];
    } else if (!args[i].startsWith('-')) {
      opts.func = args[i];
    }
  }

  return opts;
}

function main() {
  const opts = parseArgs();

  if (!opts.workfolder) {
    console.error('Error: --workfolder is required');
    process.exit(1);
  }

  const workfolderDir = opts.workfolder;

  if (!existsSync(workfolderDir)) {
    console.error(`Error: Workfolder directory not found: ${workfolderDir}`);
    process.exit(1);
  }

  const registry = loadRegistry(workfolderDir);

  // --register mode
  if (opts.register) {
    if (!opts.func || !opts.xml) {
      console.error('Error: --register requires function name and --xml');
      process.exit(1);
    }
    const deps = opts.deps
      ? opts.deps.split(',').map(d => d.trim().toUpperCase())
      : [];
    const updatedRegistry = registerFunction(
      workfolderDir, opts.func, opts.xml, deps, opts.script,
    );
    const name = opts.func.toUpperCase();
    console.log(`Registered ${name} (uuid: ${updatedRegistry[name].uuid})`);
    return;
  }

  // Determine which functions to transpile
  let funcNames;
  if (opts.all) {
    funcNames = [];
    for (const [name, entry] of Object.entries(registry)) {
      const xmlPath = resolve(workfolderDir, entry.xml);
      if (!existsSync(xmlPath)) continue;
      const xmlContent = readFileSync(xmlPath, 'utf-8');
      if (!hasOutputs(xmlContent)) continue;
      funcNames.push(name);
    }
    if (funcNames.length === 0) {
      console.log('No functions in registry');
      return;
    }
  } else if (opts.func) {
    funcNames = [opts.func.toUpperCase()];
  } else {
    console.error('Usage: node transpile.mjs --workfolder <dir> [--all | FUNC_NAME]');
    process.exit(1);
  }

  // Topological sort: transpile dependencies before dependents
  funcNames = topoSort(funcNames, registry);

  let successCount = 0;
  let failCount = 0;
  let totalTestsPassed = 0;
  let totalTestsFailed = 0;

  for (const funcName of funcNames) {
    process.stdout.write(`Transpiling ${funcName}... `);
    const { code, error, testResults } = transpileFunction(workfolderDir, funcName, registry);

    if (error) {
      console.log(`FAILED: ${error}`);
      failCount++;
      continue;
    }

    // Write JS file
    const entry = registry[funcName];
    const jsPath = resolve(workfolderDir, entry.js);
    writeFileSync(jsPath, code);

    // Report test results inline
    let testSuffix = '';
    if (testResults) {
      const total = testResults.passed + testResults.failed;
      totalTestsPassed += testResults.passed;
      totalTestsFailed += testResults.failed;
      if (testResults.failed > 0) {
        testSuffix = ` (tests: ${testResults.passed}/${total} FAILED)`;
      } else {
        testSuffix = ` (tests: ${total}/${total} passed)`;
      }
      if (testResults.error) {
        testSuffix = ` (test error: ${testResults.error})`;
      }
    }

    console.log(`OK → ${entry.js}${testSuffix}`);
    successCount++;

    // Show failure details
    if (testResults && testResults.failures && testResults.failures.length > 0) {
      for (const f of testResults.failures) {
        const inputStr = JSON.stringify(f.inputs);
        const expectedStr = JSON.stringify(f.expected);
        const actualStr = f.error || JSON.stringify(f.actual);
        console.log(`  test ${f.testIndex + 1}: inputs=${inputStr} expected=${expectedStr} actual=${actualStr}`);
      }
    }
  }

  console.log(`\nDone: ${successCount} succeeded, ${failCount} failed`);
  if (totalTestsPassed + totalTestsFailed > 0) {
    console.log(`Tests: ${totalTestsPassed}/${totalTestsPassed + totalTestsFailed} passed${totalTestsFailed > 0 ? ` (${totalTestsFailed} FAILED)` : ''}`);
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
