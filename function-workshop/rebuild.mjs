#!/usr/bin/env node
/**
 * Rebuild workfolder from source scripts.
 *
 * Reads the workfolder registry, builds a dependency DAG, topologically sorts,
 * and rebuilds each function from its source script. Then exports the zip,
 * runs all tests, and shows readouts of changed sheets.
 *
 * Usage:
 *   node rebuild.mjs --workfolder workfolders/retirement          # rebuild all
 *   node rebuild.mjs --workfolder workfolders/retirement FUNC_NAME  # rebuild one + deps
 *   node rebuild.mjs --workfolder workfolders/retirement --review  # comprehensive review of all sheets
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';
import { createHash } from 'crypto';

// Polyfill DOM APIs before importing the transpiler
import './dom-polyfill.mjs';

import { loadRegistry, buildTranspilerCustomFunctions } from './function-loader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_SRC = resolve(__dirname, '../src');
const { transpile } = await import(resolve(FRONTEND_SRC, 'transpiler/index.js'));

// =============================================================================
// REGISTRY & DAG
// =============================================================================

function loadRegistryOrDie(workfolderDir) {
  const registry = loadRegistry(workfolderDir);
  if (Object.keys(registry).length === 0) {
    console.error(`Error: No registry.json in ${workfolderDir}`);
    process.exit(1);
  }
  return registry;
}

function topoSort(names, registry) {
  const visited = new Set();
  const sorted = [];

  function visit(name, path) {
    if (path.has(name)) {
      console.error(`Cycle detected: ${[...path, name].join(' -> ')}`);
      process.exit(1);
    }
    if (visited.has(name)) return;
    path.add(name);
    const entry = registry[name];
    if (entry && entry.dependencies) {
      for (const dep of entry.dependencies) {
        if (registry[dep]) visit(dep, path);
      }
    }
    path.delete(name);
    visited.add(name);
    sorted.push(name);
  }

  for (const name of names) {
    visit(name, new Set());
  }
  return sorted;
}

function getTransitiveDeps(target, registry) {
  const result = new Set();

  function collect(name) {
    if (result.has(name)) return;
    result.add(name);
    const entry = registry[name];
    if (entry && entry.dependencies) {
      for (const dep of entry.dependencies) {
        if (registry[dep]) collect(dep);
      }
    }
  }

  collect(target);
  return [...result];
}

function hashFile(filepath) {
  if (!existsSync(filepath)) return null;
  let content = readFileSync(filepath, 'utf-8');
  // Strip timestamp from SpreadsheetMeta so rebuilds don't show as "changed"
  // when only the timestamp differs
  content = content.replace(/\s*timestamp="[^"]*"/g, '');
  return createHash('md5').update(content).digest('hex');
}

// =============================================================================
// REBUILD
// =============================================================================

function rebuildFromScript(workfolderDir, scriptPath) {
  const cliPath = resolve(__dirname, 'cli/spreadsheet-cli.js');
  try {
    execFileSync('node', [cliPath, '--workfolder', workfolderDir, scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });
    return true;
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const stdout = e.stdout ? e.stdout.toString() : '';
    console.error(`  FAILED: ${stderr || stdout || e.message}`);
    return false;
  }
}

// =============================================================================
// TEST
// =============================================================================

function extractJson(output) {
  // eval.mjs mixes [CalcEngine] log lines with JSON output on stdout.
  // Bound the JSON from both ends: first '{'-starting line to last '}'-ending
  // line. This avoids corruption from trailing output after the JSON.
  const lines = output.split('\n');
  const jsonStart = lines.findIndex(l => l.trimStart().startsWith('{'));
  if (jsonStart === -1) return null;
  let jsonEnd = -1;
  for (let i = lines.length - 1; i >= jsonStart; i--) {
    if (lines[i].trimEnd().endsWith('}')) {
      jsonEnd = i;
      break;
    }
  }
  if (jsonEnd === -1) return null;
  const jsonStr = lines.slice(jsonStart, jsonEnd + 1).join('\n');
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function runTests(workfolderDir, funcName, xmlPath) {
  const evalPath = resolve(__dirname, 'eval.mjs');
  try {
    const result = execFileSync('node', [
      evalPath, '--workfolder', workfolderDir, 'test', xmlPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });
    const json = extractJson(result.toString());
    if (json) return { passed: json.passed, failed: json.failed, total: json.total };
    return { passed: 0, failed: 0, total: 0, error: 'Could not parse test output' };
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : '';
    const json = extractJson(stdout);
    if (json) return { passed: json.passed, failed: json.failed, total: json.total };
    return { passed: 0, failed: 0, total: 0, error: e.message };
  }
}

// =============================================================================
// VALIDATE
// =============================================================================

function validateSheet(workfolderDir, xmlPath) {
  const evalPath = resolve(__dirname, 'eval.mjs');
  try {
    const result = execFileSync('node', [
      evalPath, '--workfolder', workfolderDir, 'validate', xmlPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });
    const json = extractJson(result.toString());
    if (json) return json;
    return { errors: [], cellCount: 0, parseError: 'Could not parse validate output' };
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : '';
    const json = extractJson(stdout);
    if (json) return json;
    return { errors: [], cellCount: 0, parseError: e.message };
  }
}

// =============================================================================
// READOUT
// =============================================================================

function getReadout(workfolderDir, xmlPath) {
  const evalPath = resolve(__dirname, 'eval.mjs');
  try {
    const result = execFileSync('node', [
      evalPath, '--workfolder', workfolderDir, 'readout', xmlPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });
    // Filter engine log lines from readout
    return result.toString()
      .split('\n')
      .filter(l => !l.startsWith('[CalcEngine]') && !l.startsWith('[CanonicalValuesEngine]'))
      .join('\n');
  } catch (e) {
    const output = e.stdout ? e.stdout.toString() : `Error: ${e.message}`;
    return output
      .split('\n')
      .filter(l => !l.startsWith('[CalcEngine]') && !l.startsWith('[CanonicalValuesEngine]'))
      .join('\n');
  }
}

// =============================================================================
// EXPORT
// =============================================================================

function exportZip(workfolderDir) {
  const exportScript = resolve(__dirname, 'export_zip.mjs');
  try {
    const result = execFileSync('node', [exportScript, '--workfolder', workfolderDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });
    return result.toString().trim();
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    return stdout || stderr || `Export failed: ${e.message}`;
  }
}

// =============================================================================
// TRANSPILER SELF-TEST
// =============================================================================

function transpileAndTest(workfolderDir, funcName, registry) {
  const entry = registry[funcName];
  if (!entry) return null;

  const xmlPath = resolve(workfolderDir, entry.xml);
  if (!existsSync(xmlPath)) return null;

  const xmlContent = readFileSync(xmlPath, 'utf-8');
  const customFunctions = buildTranspilerCustomFunctions(workfolderDir, registry);

  const result = transpile(
    xmlContent,
    Object.keys(customFunctions).length > 0 ? customFunctions : undefined
  );

  if (result.error) return { error: result.error, testResults: null };
  return { error: null, testResults: result.testResults };
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let workfolderDir = null;
  let target = null;
  let reviewMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workfolder' && i + 1 < args.length) {
      workfolderDir = resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--review') {
      reviewMode = true;
    } else if (!args[i].startsWith('-')) {
      target = args[i].toUpperCase();
    }
  }

  if (!workfolderDir) {
    console.error('Usage: node rebuild.mjs --workfolder <dir> [FUNCTION_NAME] [--review]');
    process.exit(1);
  }

  const registry = loadRegistryOrDie(workfolderDir);
  const allNames = Object.keys(registry);

  // Determine which functions to rebuild
  let toBuild;
  if (target) {
    if (!registry[target]) {
      console.error(`Error: ${target} not found in registry`);
      process.exit(1);
    }
    toBuild = getTransitiveDeps(target, registry);
  } else {
    toBuild = allNames;
  }

  // Topo sort
  const buildOrder = topoSort(toBuild, registry);

  // Separate into scriptable and non-scriptable
  const withScript = buildOrder.filter(n => registry[n].script);
  const withoutScript = buildOrder.filter(n => !registry[n].script);

  console.log('=== REBUILD ===');
  console.log(`Workfolder: ${workfolderDir}`);
  console.log(`Functions: ${buildOrder.length} total (${withScript.length} from scripts, ${withoutScript.length} imported)`);
  if (withoutScript.length > 0) {
    console.log(`  Imported (no script): ${withoutScript.join(', ')}`);
  }
  console.log();

  // Hash XMLs before rebuild (to detect changes)
  const hashBefore = {};
  for (const name of buildOrder) {
    const entry = registry[name];
    const xmlPath = resolve(workfolderDir, entry.xml);
    hashBefore[name] = hashFile(xmlPath);
  }

  // Rebuild from scripts in dependency order
  let rebuildOk = 0;
  let rebuildFail = 0;
  const changed = [];

  for (const name of withScript) {
    const entry = registry[name];
    const script = resolve(__dirname, entry.script);

    if (!existsSync(script)) {
      console.log(`  ${name}: SKIP (script not found: ${entry.script})`);
      rebuildFail++;
      continue;
    }

    process.stdout.write(`  ${name}...`);
    const ok = rebuildFromScript(workfolderDir, script);
    if (ok) {
      // Re-read registry (may have been updated by CLI)
      const updatedRegistry = loadRegistryOrDie(workfolderDir);
      const updatedEntry = updatedRegistry[name];
      const xmlPath = resolve(workfolderDir, updatedEntry ? updatedEntry.xml : entry.xml);
      const hashAfter = hashFile(xmlPath);
      const isChanged = hashAfter !== hashBefore[name];
      if (isChanged) changed.push(name);
      console.log(` OK${isChanged ? ' (changed)' : ''}`);
      rebuildOk++;
    } else {
      rebuildFail++;
    }
  }

  console.log();
  console.log(`Rebuilt: ${rebuildOk} OK, ${rebuildFail} failed`);
  if (changed.length > 0) {
    console.log(`Changed: ${changed.join(', ')}`);
  }

  // Export zip
  console.log();
  console.log('=== EXPORT ===');
  const exportResult = exportZip(workfolderDir);
  console.log(exportResult);

  // Run tests on all functions that have test cases
  console.log();
  console.log('=== TESTS ===');

  // Re-read registry after rebuild (scripts may have changed names/entries)
  const finalRegistry = loadRegistryOrDie(workfolderDir);
  const testableNames = Object.keys(finalRegistry).filter(name => {
    const entry = finalRegistry[name];
    const xmlPath = resolve(workfolderDir, entry.xml);
    if (!existsSync(xmlPath)) return false;
    const xml = readFileSync(xmlPath, 'utf-8');
    return xml.includes('<test_case>');
  });

  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;

  for (const name of testableNames) {
    const entry = finalRegistry[name];
    const xmlPath = resolve(workfolderDir, entry.xml);
    const result = runTests(workfolderDir, name, xmlPath);
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalTests += result.total;

    const status = result.failed > 0 ? 'FAIL' : 'pass';
    const icon = result.failed > 0 ? 'X' : ' ';
    console.log(`  [${icon}] ${name}: ${result.passed}/${result.total} passed${result.error ? ` (${result.error})` : ''}`);
  }

  console.log();
  console.log(`Total: ${totalPassed}/${totalTests} passed${totalFailed > 0 ? `, ${totalFailed} FAILED` : ''}`);

  // Run transpiler self-tests
  console.log();
  console.log('=== TRANSPILER TESTS ===');

  let transpilerPassed = 0;
  let transpilerFailed = 0;
  let transpilerTotal = 0;

  for (const name of testableNames) {
    const result = transpileAndTest(workfolderDir, name, finalRegistry);
    if (!result) continue;
    if (result.error) {
      console.log(`  [!] ${name}: transpile error — ${result.error}`);
      continue;
    }
    if (!result.testResults) continue;

    const tr = result.testResults;
    const total = tr.passed + tr.failed;
    transpilerPassed += tr.passed;
    transpilerFailed += tr.failed;
    transpilerTotal += total;

    if (tr.error) {
      console.log(`  [!] ${name}: test error — ${tr.error}`);
    } else if (tr.failed > 0) {
      console.log(`  [X] ${name}: ${tr.passed}/${total} passed`);
      for (const f of tr.failures) {
        console.log(`      test ${f.testIndex + 1}: expected=${JSON.stringify(f.expected)} actual=${f.error || JSON.stringify(f.actual)}`);
      }
    } else {
      console.log(`  [ ] ${name}: ${total}/${total} passed`);
    }
  }

  console.log();
  console.log(`Total: ${transpilerPassed}/${transpilerTotal} passed${transpilerFailed > 0 ? `, ${transpilerFailed} FAILED` : ''}`);

  // Validate all sheets for cell errors
  console.log();
  console.log('=== VALIDATE ===');
  const allSheetNames = Object.keys(finalRegistry);
  let totalErrors = 0;
  const sheetsWithErrors = [];

  for (const name of allSheetNames) {
    const entry = finalRegistry[name];
    const xmlPath = resolve(workfolderDir, entry.xml);
    if (!existsSync(xmlPath)) continue;

    const result = validateSheet(workfolderDir, xmlPath);
    if (result.parseError) {
      console.log(`  ${name}: SKIP (${result.parseError})`);
      continue;
    }
    if (result.errors.length > 0) {
      const cells = result.errors.map(e => `${e.cell} (${e.error})`).join(', ');
      console.log(`  [!] ${name}: ${result.errors.length} error(s) — ${cells}`);
      totalErrors += result.errors.length;
      sheetsWithErrors.push(name);
    } else {
      console.log(`  [✓] ${name}: ${result.cellCount} cells OK`);
    }
  }

  console.log();
  if (totalErrors > 0) {
    console.log(`Validation: ${totalErrors} cell error(s) in ${sheetsWithErrors.length} sheet(s)`);
  } else {
    console.log(`Validation: all cells clean across ${allSheetNames.length} sheets`);
  }

  // Show readouts
  const sheetsToReadout = reviewMode ? Object.keys(finalRegistry) : changed;

  if (sheetsToReadout.length > 0) {
    console.log();
    console.log(reviewMode ? '=== COMPREHENSIVE REVIEW ===' : '=== READOUT (changed sheets) ===');

    for (const name of sheetsToReadout) {
      const entry = finalRegistry[name];
      if (!entry) continue;
      const xmlPath = resolve(workfolderDir, entry.xml);
      if (!existsSync(xmlPath)) continue;

      console.log();
      console.log(`--- ${name} ---`);
      const readout = getReadout(workfolderDir, xmlPath);
      console.log(readout);
    }
  } else if (!reviewMode) {
    console.log();
    console.log('No sheets changed — readout skipped.');
  }

  // Summary
  console.log();
  console.log('=== SUMMARY ===');
  console.log(`Rebuilt: ${rebuildOk}/${withScript.length} from scripts`);
  console.log(`Imported: ${withoutScript.length} (no script)`);
  console.log(`Engine tests: ${totalPassed}/${totalTests}${totalFailed > 0 ? ` (${totalFailed} FAILED)` : ' all passing'}`);
  console.log(`Transpiler tests: ${transpilerPassed}/${transpilerTotal}${transpilerFailed > 0 ? ` (${transpilerFailed} FAILED)` : transpilerTotal > 0 ? ' all passing' : ' none'}`);
  console.log(`Validation: ${totalErrors > 0 ? `${totalErrors} cell error(s) in ${sheetsWithErrors.join(', ')}` : 'all cells clean'}`);
  console.log(`Changed: ${changed.length > 0 ? changed.join(', ') : 'none'}`);

  if (rebuildFail > 0 || totalFailed > 0) {
    process.exit(1);
  }
}

main();
