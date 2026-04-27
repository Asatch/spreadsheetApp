#!/usr/bin/env node
/**
 * Export a function-workshop workfolder to a zip compatible with frontend import.
 *
 * Reads the workfolder registry, resolves transitive dependencies, and produces
 * a v2.1 unified package:
 *   - manifest.json (version 2.1, with manifest.sheets[sheetId] and optional
 *     manifest.scenarios[scenarioId])
 *   - sheets/{sheetId}.xml              (draft — all sheets)
 *   - sheets/{sheetId}.published.xml    (callable functions only)
 *   - sheets/{sheetId}.published.js     (callable functions only)
 *   - scenarios/{scenarioId}.json       (one per workfolder scenario file)
 *
 * Sheet IDs are `local-{uuid}`; functionIds are the bare `{uuid}` that
 * CustomFunctions references in XML use.
 *
 * Scenario sources: `<workfolder>/scenarios/*.json` (single-file format,
 * see CLAUDE.md). UUIDs and timestamps are assigned at export time.
 *
 * Usage:
 *   node export_zip.mjs --workfolder workfolders/my-suite
 *   node export_zip.mjs --workfolder workfolders/my-suite --output my-package.zip
 *   node export_zip.mjs --workfolder workfolders/my-suite FUNC1 FUNC2
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, basename, normalize } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Registry ──────────────────────────────────────────────────────────

function loadRegistry(workfolderDir) {
  const path = resolve(workfolderDir, 'registry.json');
  if (!existsSync(path)) {
    console.error(`Error: No registry.json in ${workfolderDir}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ── Transitive dependency resolution ──────────────────────────────────

function resolveTransitiveDeps(funcNames, registry) {
  const allNames = new Set();
  const toProcess = [...funcNames];

  while (toProcess.length > 0) {
    const name = toProcess.pop();
    if (allNames.has(name)) continue;
    allNames.add(name);

    const entry = registry[name];
    if (!entry) {
      console.error(`Warning: ${name} not in registry, skipping`);
      continue;
    }

    for (const dep of (entry.dependencies || [])) {
      if (!allNames.has(dep)) toProcess.push(dep);
    }
  }

  return allNames;
}

// ── Display-only check ────────────────────────────────────────────────

function isDisplayOnly(xmlPath) {
  const content = readFileSync(xmlPath, 'utf-8');
  return !/<Output\s/.test(content);
}

// ── Scenario file loading ─────────────────────────────────────────────

const VALID_SCENARIO_CATEGORIES = new Set(['fixed', 'decision', 'unknown']);

/**
 * Validate a parsed scenario file. Throws Error with a clear message on any
 * problem. Pure (no I/O, no process.exit) so it's directly unit-testable.
 *
 * @param {*} parsed - The result of JSON.parse on the scenario file
 * @param {string} sourcePath - Path used in error messages
 */
export function validateScenarioFile(parsed, sourcePath) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${sourcePath}: scenario file must be a JSON object`);
  }
  if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
    throw new Error(`${sourcePath}: missing or invalid "name" field (must be a non-empty string)`);
  }
  if (typeof parsed.functionName !== 'string' || parsed.functionName.length === 0) {
    throw new Error(`${sourcePath}: missing or invalid "functionName" field (must be a non-empty string)`);
  }
  if (!parsed.inputs || typeof parsed.inputs !== 'object' || Array.isArray(parsed.inputs)) {
    throw new Error(`${sourcePath}: missing or invalid "inputs" object`);
  }

  for (const [inputName, entry] of Object.entries(parsed.inputs)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${sourcePath}: input "${inputName}" must be an object`);
    }
    if (!VALID_SCENARIO_CATEGORIES.has(entry.category)) {
      throw new Error(`${sourcePath}: input "${inputName}" has invalid category ${JSON.stringify(entry.category)} (expected fixed|decision|unknown)`);
    }
    if (!Array.isArray(entry.values) || entry.values.length === 0) {
      throw new Error(`${sourcePath}: input "${inputName}" must have a non-empty "values" array`);
    }
    if (entry.category === 'fixed' && entry.values.length !== 1) {
      throw new Error(`${sourcePath}: input "${inputName}" with category "fixed" must have exactly 1 value (got ${entry.values.length})`);
    }
  }
}

/**
 * Load workfolder scenario files. Each file is a single-file scenario:
 *
 *   {
 *     "name": "Retire-age × Healthcare-inflation sweep",
 *     "functionName": "RETIREMENT_SENSITIVITY",
 *     "folderId": null,                  // optional
 *     "inputs": {
 *       "M_RETIRE_AGE":            { "category": "decision", "values": [54,56,58] },
 *       "HEALTHCARE_INFLATION_DIFF": { "category": "unknown",  "values": [0.02,0.05] },
 *       "SPENDING":                { "category": "fixed",    "values": [110000] }
 *     }
 *   }
 *
 * Returns an array of { sourceFile, name, functionName, folderId, inputs }.
 * Returns [] when the workfolder has no scenarios/ directory.
 */
function loadWorkfolderScenarios(workfolderDir) {
  const dir = resolve(workfolderDir, 'scenarios');
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const scenarios = [];

  for (const file of files) {
    const path = resolve(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (e) {
      console.error(`Error: Invalid JSON in ${path}: ${e.message}`);
      process.exit(1);
    }

    try {
      validateScenarioFile(parsed, path);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }

    scenarios.push({
      sourceFile: file,
      name: parsed.name,
      functionName: parsed.functionName.toUpperCase(),
      folderId: parsed.folderId ?? null,
      inputs: parsed.inputs,
    });
  }

  return scenarios;
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { workfolder: null, output: null, functions: [] };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workfolder' && args[i + 1]) {
      opts.workfolder = args[++i];
    } else if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
      opts.output = args[++i];
    } else if (!args[i].startsWith('-')) {
      opts.functions.push(args[i]);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!opts.workfolder) {
    console.error('Error: --workfolder is required');
    process.exit(1);
  }

  const workfolderDir = opts.workfolder;
  const registry = loadRegistry(workfolderDir);

  if (Object.keys(registry).length === 0) {
    console.error('Error: Registry is empty');
    process.exit(1);
  }

  // Determine which functions to export
  let funcNames;
  if (opts.functions.length > 0) {
    funcNames = new Set(opts.functions.map(n => n.toUpperCase()));
    funcNames = resolveTransitiveDeps(funcNames, registry);
  } else {
    funcNames = new Set(Object.keys(registry));
  }

  // Separate callable functions from display-only sheets
  const displayNames = new Set();
  const callableNames = new Set();
  const notFound = [];

  for (const name of [...funcNames].sort()) {
    const entry = registry[name];
    if (!entry) {
      notFound.push(name);
      continue;
    }
    const xmlPath = resolve(workfolderDir, entry.xml);
    if (!existsSync(xmlPath)) {
      notFound.push(`${name} (missing ${entry.xml})`);
      continue;
    }
    if (isDisplayOnly(xmlPath)) {
      displayNames.add(name);
    } else {
      callableNames.add(name);
    }
  }

  if (notFound.length > 0) {
    console.error('Error: Not found:');
    for (const item of notFound) console.error(`  ${item}`);
    process.exit(1);
  }

  // Validate: callable functions need XML + JS, display sheets need only XML
  const missing = [];
  for (const name of [...callableNames].sort()) {
    const entry = registry[name];
    const xmlPath = resolve(workfolderDir, entry.xml);
    const jsPath = resolve(workfolderDir, entry.js);
    if (!existsSync(xmlPath)) missing.push(`${name}: missing ${entry.xml}`);
    if (!existsSync(jsPath)) missing.push(`${name}: missing ${entry.js} (run transpile.mjs first)`);
  }

  for (const name of [...displayNames].sort()) {
    const entry = registry[name];
    const xmlPath = resolve(workfolderDir, entry.xml);
    if (!existsSync(xmlPath)) missing.push(`${name}: missing ${entry.xml}`);
  }

  if (missing.length > 0) {
    console.error('Error: Missing files:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  // Determine output path
  let zipPath;
  if (opts.output) {
    zipPath = opts.output;
  } else {
    const workfolderName = basename(normalize(workfolderDir));
    const zipDir = resolve(__dirname, 'examples');
    mkdirSync(zipDir, { recursive: true });
    zipPath = resolve(zipDir, `${workfolderName}.zip`);
  }

  // Build manifest (v2.1 unified format) and zip contents
  const now = new Date().toISOString();
  // Stable packageId = `workfolder:<basename>`. Re-exports of the same workfolder
  // produce the same packageId, allowing the frontend to dedup imports.
  const packageId = `workfolder:${basename(normalize(workfolderDir))}`;
  const manifest = {
    version: '2.1',
    exportedAt: now,
    packageId,
    folders: {},
    sheets: {},
  };
  const zip = new JSZip();

  const allNames = [...callableNames, ...displayNames].sort();
  for (const name of allNames) {
    const entry = registry[name];
    const uid = entry.uuid;
    const sheetId = `local-${uid}`;
    const sheetType = entry.sheetType === 'loop' ? 'loop' : 'standard';
    const description = entry.description || '';
    const isCallable = callableNames.has(name);

    const xmlContent = readFileSync(resolve(workfolderDir, entry.xml), 'utf-8');

    zip.file(`sheets/${sheetId}.xml`, xmlContent);

    if (isCallable) {
      const jsContent = readFileSync(resolve(workfolderDir, entry.js), 'utf-8');
      zip.file(`sheets/${sheetId}.published.xml`, xmlContent);
      zip.file(`sheets/${sheetId}.published.js`, jsContent);
    }

    manifest.sheets[sheetId] = {
      name,
      description,
      type: sheetType,
      folderId: null,
      createdAt: now,
      updatedAt: now,
      functionId: isCallable ? uid : null,
      publishedVersion: isCallable ? {
        versionId: uid,
        versionString: '1.0',
        publishedAt: now,
      } : null,
      hasUnpublishedChanges: false,
      hasDraft: true,
    };
  }

  // Scenarios: load from workfolder, validate against bundled functions,
  // assign UUIDs/timestamps, emit data files + manifest entries.
  const scenarios = loadWorkfolderScenarios(workfolderDir);
  if (scenarios.length > 0) {
    manifest.scenarios = {};
    for (const s of scenarios) {
      const entry = registry[s.functionName];
      if (!entry) {
        console.error(`Error: Scenario ${s.sourceFile} references unknown function ${s.functionName}`);
        process.exit(1);
      }
      if (!callableNames.has(s.functionName)) {
        console.error(`Error: Scenario ${s.sourceFile} references ${s.functionName}, which is not a callable function being exported (display sheets and uncalled functions can't host scenarios)`);
        process.exit(1);
      }

      const scenarioId = `scenario-${randomUUID()}`;
      manifest.scenarios[scenarioId] = {
        name: s.name,
        functionId: entry.uuid,
        functionName: s.functionName,
        createdAt: now,
        updatedAt: now,
        folderId: s.folderId,
      };
      zip.file(`scenarios/${scenarioId}.json`, JSON.stringify({
        inputs: s.inputs,
        results: null,
      }, null, 2));
    }
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Write zip
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(zipPath, zipBuffer);

  const parts = [`${callableNames.size} function(s)`];
  if (displayNames.size > 0) parts.push(`${displayNames.size} display sheet(s)`);
  if (scenarios.length > 0) parts.push(`${scenarios.length} scenario(s)`);
  console.log(`Exported ${parts.join(' + ')} → ${zipPath}`);
}

// Only run main() when invoked directly as a CLI — allows the module to be
// imported by tests without triggering CLI side effects.
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
