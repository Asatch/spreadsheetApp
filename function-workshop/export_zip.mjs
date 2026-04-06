#!/usr/bin/env node
/**
 * Export a function-workshop workfolder to a zip compatible with frontend import.
 *
 * Reads the workfolder registry, resolves transitive dependencies, and produces:
 *   - manifest.json
 *   - functions/{uuid}.xml + functions/{uuid}.js
 *   - spreadsheets/local-{uuid}.xml
 *
 * Usage:
 *   node export_zip.mjs --workfolder workfolders/my-suite
 *   node export_zip.mjs --workfolder workfolders/my-suite --output my-package.zip
 *   node export_zip.mjs --workfolder workfolders/my-suite FUNC1 FUNC2
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename, normalize } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

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

// ── Manifest builder ──────────────────────────────────────────────────

function buildManifest(callableNames, displayNames, registry) {
  const now = new Date().toISOString();

  const spreadsheets = {};
  const functions = {};

  const allNames = [...callableNames, ...displayNames].sort();

  for (const name of allNames) {
    const entry = registry[name];
    if (!entry) continue;

    const uid = entry.uuid;
    const sheetType = entry.sheetType || 'standard';
    const manifestType = sheetType === 'loop' ? 'loop' : 'standard';
    const manifestFuncType = sheetType === 'loop' ? 'loop' : 'spreadsheet';
    const description = entry.description || '';

    spreadsheets[`local-${uid}`] = {
      name,
      description,
      type: manifestType,
      folderId: null,
      createdAt: now,
      updatedAt: now,
    };

    if (callableNames.has(name)) {
      functions[uid] = {
        name,
        description,
        version: '1.0',
        sheetType: manifestFuncType,
        folderId: null,
      };
    }
  }

  return {
    version: '1.0',
    packageId: randomUUID(),
    exportedAt: now,
    folders: {},
    spreadsheets,
    functions,
  };
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
    if (!entry) { missing.push(`${name}: not in registry`); continue; }
    const xmlPath = resolve(workfolderDir, entry.xml);
    const jsPath = resolve(workfolderDir, entry.js);
    if (!existsSync(xmlPath)) missing.push(`${name}: missing ${entry.xml}`);
    if (!existsSync(jsPath)) missing.push(`${name}: missing ${entry.js} (run transpile.mjs first)`);
  }

  for (const name of [...displayNames].sort()) {
    const entry = registry[name];
    if (!entry) { missing.push(`${name}: not in registry`); continue; }
    const xmlPath = resolve(workfolderDir, entry.xml);
    if (!existsSync(xmlPath)) missing.push(`${name}: missing ${entry.xml}`);
  }

  if (missing.length > 0) {
    console.error('Error: Missing files:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  // Build manifest
  const manifest = buildManifest(callableNames, displayNames, registry);

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

  // Create zip
  const zip = new JSZip();

  // Callable functions: XML + JS in functions/, XML in spreadsheets/
  for (const name of [...callableNames].sort()) {
    const entry = registry[name];
    const uid = entry.uuid;
    const xmlContent = readFileSync(resolve(workfolderDir, entry.xml), 'utf-8');
    const jsContent = readFileSync(resolve(workfolderDir, entry.js), 'utf-8');

    zip.file(`functions/${uid}.xml`, xmlContent);
    zip.file(`functions/${uid}.js`, jsContent);
    zip.file(`spreadsheets/local-${uid}.xml`, xmlContent);
  }

  // Display-only sheets: XML in spreadsheets/ only
  for (const name of [...displayNames].sort()) {
    const entry = registry[name];
    const uid = entry.uuid;
    const xmlContent = readFileSync(resolve(workfolderDir, entry.xml), 'utf-8');

    zip.file(`spreadsheets/local-${uid}.xml`, xmlContent);
  }

  // manifest.json
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Write zip
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(zipPath, zipBuffer);

  const total = callableNames.size + displayNames.size;
  const parts = [`${callableNames.size} function(s)`];
  if (displayNames.size > 0) parts.push(`${displayNames.size} display sheet(s)`);
  console.log(`Exported ${parts.join(' + ')} → ${zipPath}`);
}

main();
