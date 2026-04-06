#!/usr/bin/env node
/**
 * Import a zip package into a function-workshop workfolder.
 *
 * Unpacks functions from a zip (created by the frontend export or export_zip.mjs)
 * into a workfolder directory and reconstructs registry.json.
 *
 * Usage:
 *   node import_zip.mjs --workfolder workfolders/my-suite path/to/package.zip
 *   node import_zip.mjs --list path/to/package.zip
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

// ── XML dependency parsing ────────────────────────────────────────────

function parseCustomFunctionsFromXml(xmlContent) {
  const deps = [];
  // Match <Function name="..."> inside <CustomFunctions>
  const cfMatch = xmlContent.match(/<CustomFunctions>([\s\S]*?)<\/CustomFunctions>/);
  if (!cfMatch) return deps;

  const funcRegex = /<Function\s[^>]*name="([^"]*)"[^>]*>/g;
  let m;
  while ((m = funcRegex.exec(cfMatch[1])) !== null) {
    if (m[1]) deps.push(m[1].toUpperCase());
  }
  return deps;
}

// ── Sheet type detection ──────────────────────────────────────────────

function detectSheetType(xmlContent) {
  const match = xmlContent.match(/sheetType="([^"]*)"/);
  return match ? match[1] : 'standard';
}

// ── Read manifest entries (v1 + v2 formats) ───────────────────────────

function readManifestEntries(manifest) {
  const entries = [];

  // v1 format: manifest.functions
  const functions = manifest.functions || {};
  if (Object.keys(functions).length > 0) {
    for (const [uid, meta] of Object.entries(functions)) {
      entries.push({
        uid,
        name: (meta.name || '').toUpperCase(),
        description: meta.description || '',
        sheetType: meta.sheetType || 'standard',
      });
    }
    return entries;
  }

  // v2 format: manifest.sheets
  const sheets = manifest.sheets || {};
  for (const [sheetId, meta] of Object.entries(sheets)) {
    entries.push({
      uid: sheetId,
      functionId: meta.functionId || null,
      name: (meta.name || '').toUpperCase(),
      description: meta.description || '',
      sheetType: meta.type || 'standard',
    });
  }

  // Also check manifest.spreadsheets (v1 without functions)
  if (entries.length === 0) {
    const spreadsheets = manifest.spreadsheets || {};
    for (const [sheetId, meta] of Object.entries(spreadsheets)) {
      entries.push({
        uid: sheetId,
        name: (meta.name || '').toUpperCase(),
        description: meta.description || '',
        sheetType: meta.type || 'standard',
      });
    }
  }

  return entries;
}

// ── List zip contents ─────────────────────────────────────────────────

async function listZipContents(zipPath) {
  const zipData = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipData);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    console.error('Error: Zip has no manifest.json');
    process.exit(1);
  }

  const manifest = JSON.parse(await manifestFile.async('string'));
  const entries = readManifestEntries(manifest);

  if (entries.length === 0) {
    console.log('(empty package)');
    return;
  }

  const nameWidth = Math.max(...entries.map(e => e.name.length));
  const typeWidth = Math.max(...entries.map(e => e.sheetType.length));

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name.padEnd(nameWidth);
    const stype = entry.sheetType.padEnd(typeWidth);
    const desc = entry.description;
    if (desc) {
      console.log(`  ${name}  ${stype}  ${desc}`);
    } else {
      console.log(`  ${name}  ${stype}`);
    }
  }
}

// ── Import zip into workfolder ────────────────────────────────────────

async function importZip(workfolderDir, zipPath) {
  if (!existsSync(zipPath)) {
    console.error(`Error: Zip not found: ${zipPath}`);
    process.exit(1);
  }

  mkdirSync(workfolderDir, { recursive: true });

  // Load existing registry (if any)
  const regPath = resolve(workfolderDir, 'registry.json');
  let registry = {};
  if (existsSync(regPath)) {
    registry = JSON.parse(readFileSync(regPath, 'utf-8'));
  }

  const zipData = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipData);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    console.error('Error: Zip has no manifest.json');
    process.exit(1);
  }

  const manifest = JSON.parse(await manifestFile.async('string'));
  const entries = readManifestEntries(manifest);
  let imported = 0;

  for (const entry of entries) {
    const uid = entry.uid;
    const funcName = entry.name;

    // Try v1 path first, then v2
    let xmlContent = null;
    for (const xmlZipPath of [`functions/${uid}.xml`, `sheets/${uid}.xml`, `sheets/${uid}.published.xml`, `spreadsheets/${uid}.xml`]) {
      const file = zip.file(xmlZipPath);
      if (file) {
        xmlContent = await file.async('string');
        break;
      }
    }

    if (xmlContent === null) {
      console.error(`Warning: No XML found for ${funcName}, skipping`);
      continue;
    }

    // Extract JS (may not exist)
    let jsContent = null;
    for (const jsZipPath of [`functions/${uid}.js`, `sheets/${uid}.published.js`]) {
      const file = zip.file(jsZipPath);
      if (file) {
        jsContent = await file.async('string');
        break;
      }
    }

    // Write to workfolder directory (sanitize name to prevent path traversal)
    const safeName = basename(funcName);
    const xmlFilename = `${safeName}.xml`;
    const jsFilename = `${safeName}.js`;

    writeFileSync(resolve(workfolderDir, xmlFilename), xmlContent);

    if (jsContent) {
      writeFileSync(resolve(workfolderDir, jsFilename), jsContent);
    }

    // Detect dependencies from XML
    const depNames = parseCustomFunctionsFromXml(xmlContent);

    // Detect sheet type
    let sheetType = entry.sheetType;
    if (sheetType === 'spreadsheet') sheetType = 'standard';

    // Build registry entry
    // Use functionId (from manifest) when available — this is the ID that
    // other XMLs reference in <CustomFunctions id="...">, so the transpiler
    // can resolve DAGs by the same key. Fall back to sheet ID for unpublished
    // sheets (display sheets, drafts) that have no functionId.
    const regEntry = {
      uuid: entry.functionId || uid,
      xml: xmlFilename,
      js: jsFilename,
      sheetType,
      dependencies: depNames,
    };
    if (entry.description) regEntry.description = entry.description;

    registry[funcName] = regEntry;

    const status = jsContent ? 'xml+js' : 'xml only';
    console.log(`  Imported ${funcName} (${status})`);
    imported++;
  }

  // Save registry
  writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n');

  console.log(`\nImported ${imported} function(s) into ${workfolderDir}`);

  const hasNoJs = Object.values(registry).some(
    r => r.js && !existsSync(resolve(workfolderDir, r.js))
  );
  if (hasNoJs) {
    console.log(`Note: Some functions have no JS — run \`node transpile.mjs --workfolder ${workfolderDir} --all\` to transpile`);
  }
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { workfolder: null, list: false, zipfile: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workfolder' && args[i + 1]) {
      opts.workfolder = args[++i];
    } else if (args[i] === '--list') {
      opts.list = true;
    } else if (!args[i].startsWith('-')) {
      opts.zipfile = args[i];
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!opts.zipfile) {
    console.error('Error: Zip file path is required');
    process.exit(1);
  }

  if (opts.list) {
    await listZipContents(opts.zipfile);
  } else if (opts.workfolder) {
    await importZip(opts.workfolder, opts.zipfile);
  } else {
    console.error('Error: Either --list or --workfolder is required');
    process.exit(1);
  }
}

main();
