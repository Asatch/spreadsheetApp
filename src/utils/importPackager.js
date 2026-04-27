/**
 * @file Import Packager
 * @description Parses and imports zip packages and folders into OPFS.
 * Handles conflict detection, resolution, and folder structure recreation.
 * Expects v2.0 unified `sheets/` packages; falls back to XML-only recovery
 * when manifest.json is missing or unparseable.
 */

import JSZip from 'jszip';
import { extractSignatureFromXml } from './xmlSerializer.js';

/**
 * Extract metadata from an XML file's root <CodeCalculation> element and <CustomFunctions>.
 * @param {string} xmlContent - Raw XML string
 * @returns {{name: string, sheetType: string, functionId: string|null, versionId: string|null, sourceSpreadsheetId: string|null, customFunctions: Array<{id: string, name: string, versionId: string, version: string}>}}
 */
function extractXmlMetadata(xmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');
  const root = doc.documentElement;

  const customFunctions = [];
  const funcRefs = doc.querySelectorAll('CustomFunctions > Function');
  for (const funcEl of funcRefs) {
    customFunctions.push({
      id: funcEl.getAttribute('id') || '',
      name: funcEl.getAttribute('name') || '',
      versionId: funcEl.getAttribute('versionId') || '',
      version: funcEl.getAttribute('version') || '',
    });
  }

  return {
    name: root.getAttribute('name') || 'Untitled',
    sheetType: root.getAttribute('sheetType') || 'standard',
    functionId: root.getAttribute('functionId') || null,
    versionId: root.getAttribute('versionId') || null,
    sourceSpreadsheetId: root.getAttribute('sourceSpreadsheetId') || null,
    customFunctions,
  };
}

/**
 * Parse import data from a file map (shared logic for zip and folder parsing).
 * Expects v2.0 packages (manifest.sheets + sheets/ directory).
 * Falls back to recovery mode (manifest-free) when manifest.json is missing or unparseable.
 * @param {Map<string, string>} fileMap - Map of relative path -> file content
 * @returns {{manifest: Object, sheets: Object, recoveryMode?: boolean}}
 */
function parseFromFileMap(fileMap) {
  const manifestText = fileMap.get('manifest.json');
  if (!manifestText) {
    return parseRecoveryFormat(fileMap);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    console.warn('[ImportPackager] Manifest parse failed, falling back to recovery mode:', err.message);
    return parseRecoveryFormat(fileMap);
  }

  if (manifest.sheets) {
    return parseUnifiedFormat(fileMap, manifest);
  }
  if (manifest.spreadsheets || manifest.functions) {
    throw new Error(
      'Package uses the legacy v1.0 format (spreadsheets/ + functions/). ' +
      'Re-export it with the current function-workshop or frontend to produce a v2.0 package.'
    );
  }

  return parseRecoveryFormat(fileMap);
}

/**
 * Parse unified v2.x format (sheets/ directory; v2.1+ also scenarios/).
 */
function parseUnifiedFormat(fileMap, manifest) {
  const sheets = {};

  for (const [id, meta] of Object.entries(manifest.sheets || {})) {
    const xml = fileMap.get(`sheets/${id}.xml`);
    const isPublishedOnly = meta.hasDraft === false;

    if (!xml && !isPublishedOnly) {
      console.warn(`[ImportPackager] Missing sheet file: ${id}.xml`);
      continue;
    }

    // Use draft XML for metadata extraction, or published XML for published-only sheets
    const xmlForMetadata = xml || fileMap.get(`sheets/${id}.published.xml`);
    if (!xmlForMetadata) {
      console.warn(`[ImportPackager] No XML found for sheet ${id}, skipping`);
      continue;
    }

    const xmlMeta = extractXmlMetadata(xmlForMetadata);
    sheets[id] = {
      meta: { ...meta, customFunctions: xmlMeta.customFunctions },
      xml: xml || null,
      publishedXml: fileMap.get(`sheets/${id}.published.xml`) || null,
      publishedJs: fileMap.get(`sheets/${id}.published.js`) || null,
    };
  }

  // Scenario analyses (v2.1+ optional section)
  const scenarios = {};
  const corruptScenarios = [];
  for (const [id, meta] of Object.entries(manifest.scenarios || {})) {
    const dataText = fileMap.get(`scenarios/${id}.json`);
    if (!dataText) {
      console.warn(`[ImportPackager] Missing scenario file: ${id}.json`);
      corruptScenarios.push({
        scenarioId: id,
        scenarioName: meta?.name || id,
        reason: 'missing-file',
      });
      continue;
    }
    let data;
    try {
      data = JSON.parse(dataText);
    } catch (err) {
      console.warn(`[ImportPackager] Failed to parse scenario ${id}: ${err.message}`);
      corruptScenarios.push({
        scenarioId: id,
        scenarioName: meta?.name || id,
        reason: 'parse-error',
      });
      continue;
    }
    scenarios[id] = { meta, data };
  }

  return { manifest, sheets, scenarios, corruptScenarios };
}

/**
 * Recovery parser: reconstruct manifest from XML file metadata when manifest.json is missing/broken.
 * @param {Map<string, string>} fileMap - Map of relative path -> file content
 * @returns {{manifest: Object, sheets: Object, recoveryMode: boolean}}
 */
function parseRecoveryFormat(fileMap) {
  const sheets = {};
  const LOCAL_UUID_PATTERN = /^local-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // Collect draft XMLs (not .published.xml)
  const draftEntries = [];
  for (const [path, content] of fileMap) {
    if (path.endsWith('.xml') && !path.endsWith('.published.xml')) {
      draftEntries.push({ path, content });
    }
  }

  if (draftEntries.length === 0) {
    throw new Error('No XML files found in package');
  }

  // Track directory paths for folder reconstruction
  const dirPaths = new Set();

  for (const { path, content } of draftEntries) {
    const meta = extractXmlMetadata(content);

    // Derive sheetId from filename
    const filename = path.split('/').pop().replace(/\.xml$/, '');
    const sheetId = LOCAL_UUID_PATTERN.test(filename) ? filename : 'local-' + crypto.randomUUID();

    // Check for sibling published files
    const pathPrefix = path.replace(/\.xml$/, '');
    const publishedXml = fileMap.get(`${pathPrefix}.published.xml`) || null;
    const publishedJs = fileMap.get(`${pathPrefix}.published.js`) || null;

    // Record directory path
    const dirPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    if (dirPath) dirPaths.add(dirPath);

    sheets[sheetId] = {
      meta: {
        name: meta.name,
        type: meta.sheetType === 'loop' ? 'loop' : 'standard',
        folderId: null, // Set after folder structure is built
        functionId: meta.functionId || null,
        publishedVersion: meta.functionId ? {
          versionId: meta.versionId || meta.functionId,
          versionString: '1.0',
          publishedAt: new Date().toISOString(),
        } : null,
        customFunctions: meta.customFunctions,
      },
      xml: content,
      publishedXml,
      publishedJs,
      _dirPath: dirPath, // Temporary, for folder assignment
    };
  }

  // Build folder structure from directory paths
  const folders = {};
  const dirToFolderId = new Map();

  // Sort by depth so parents are created before children
  const sortedDirs = [...dirPaths].sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthA - depthB;
  });

  for (const dirPath of sortedDirs) {
    const segments = dirPath.split('/');
    const folderName = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parentId = parentPath ? (dirToFolderId.get(parentPath) || null) : null;

    const folderId = crypto.randomUUID();
    folders[folderId] = { name: folderName, parentId };
    dirToFolderId.set(dirPath, folderId);
  }

  // Assign sheets to folders and clean up temp field
  for (const [, sheetData] of Object.entries(sheets)) {
    if (sheetData._dirPath && dirToFolderId.has(sheetData._dirPath)) {
      sheetData.meta.folderId = dirToFolderId.get(sheetData._dirPath);
    }
    delete sheetData._dirPath;
  }

  const manifest = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    folders,
    sheets: Object.fromEntries(
      Object.entries(sheets).map(([id, data]) => [id, data.meta])
    ),
  };

  return { manifest, sheets, recoveryMode: true };
}

/**
 * Parse an import zip file.
 * @param {File} file - The zip file
 * @returns {Promise<{manifest: Object, sheets: Object, recoveryMode?: boolean}>}
 */
export async function parseImportZip(file) {
  const zip = await JSZip.loadAsync(file);

  // Build fileMap from zip entries
  const fileMap = new Map();
  const nonDirEntries = Object.entries(zip.files).filter(([, e]) => !e.dir);
  const contents = await Promise.all(
    nonDirEntries.map(async ([path, zipEntry]) => [path, await zipEntry.async('string')])
  );
  for (const [path, text] of contents) {
    fileMap.set(path, text);
  }

  return parseFromFileMap(fileMap);
}

/**
 * Extract the embedded data zip from a portable HTML file.
 * Reads the file as text, finds the sc-embedded-data div,
 * and decodes the base64 content into a zip Blob.
 * @param {File} file - The HTML file
 * @returns {Promise<Blob>} The extracted zip as a Blob
 */
export async function extractZipFromHtml(file) {
  const html = await file.text();
  const match = html.match(/<div\s+id="sc-embedded-data"[^>]*>([\s\S]*?)<\/div>/);
  if (!match || !match[1].trim()) {
    throw new Error('No embedded spreadsheet data found in HTML file');
  }

  const base64Content = match[1].trim();
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: 'application/zip' });
}

/**
 * Parse an import folder from a file picker (webkitdirectory).
 * @param {FileList} fileList - Files from <input webkitdirectory>
 * @returns {Promise<{manifest: Object, sheets: Object}>}
 */
export async function parseImportFolder(fileList) {
  const fileMap = new Map();

  const entries = await Promise.all(
    Array.from(fileList).map(async (file) => {
      // webkitRelativePath is like "myFolder/manifest.json" — strip root folder prefix
      const parts = file.webkitRelativePath.split('/');
      const relativePath = parts.slice(1).join('/');
      return relativePath ? [relativePath, await file.text()] : null;
    })
  );
  for (const entry of entries) {
    if (entry) fileMap.set(entry[0], entry[1]);
  }

  return parseFromFileMap(fileMap);
}

/**
 * Recursively read all files from a FileSystemDirectoryEntry.
 * Note: DirectoryReader.readEntries() returns max ~100 entries per call,
 * so we must loop until an empty array is returned.
 * @param {FileSystemDirectoryEntry} dirEntry - Directory entry
 * @param {string} basePath - Current path prefix
 * @param {Map<string, string>} fileMap - Accumulator map
 * @returns {Promise<void>}
 */
async function readDirectoryRecursively(dirEntry, basePath, fileMap) {
  const reader = dirEntry.createReader();

  // readEntries may return partial results; loop until empty
  const readAll = () => new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
        } else {
          entries.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });

  const entries = await readAll();

  await Promise.all(entries.map(async (entry) => {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isFile) {
      const fileContent = await new Promise((resolve, reject) => {
        entry.file(async (file) => {
          try {
            resolve(await file.text());
          } catch (e) {
            reject(e);
          }
        }, reject);
      });
      fileMap.set(entryPath, fileContent);
    } else if (entry.isDirectory) {
      await readDirectoryRecursively(entry, entryPath, fileMap);
    }
  }));
}

/**
 * Parse an import folder from a drag-and-drop directory entry.
 * @param {FileSystemDirectoryEntry} directoryEntry - From webkitGetAsEntry()
 * @returns {Promise<{manifest: Object, sheets: Object}>}
 */
export async function parseImportFolderFromEntries(directoryEntry) {
  const fileMap = new Map();
  await readDirectoryRecursively(directoryEntry, '', fileMap);
  return parseFromFileMap(fileMap);
}

/**
 * Detect UUID conflicts with existing OPFS items.
 * @param {Object} importData - Parsed import data
 * @param {Object} storageEngine - Storage engine instance
 * @returns {Promise<{sheets: Array, total: number}>}
 */
export async function detectConflicts(importData, storageEngine) {
  const sheetConflicts = [];

  for (const [id, data] of Object.entries(importData.sheets)) {
    const existing = await storageEngine.getSheetMetadata(id);
    if (existing) {
      sheetConflicts.push({
        id,
        type: 'sheet',
        importName: data.meta.name,
        importType: data.meta.type,
        existingName: existing.name,
        existingType: existing.type
      });
    }
  }

  return {
    sheets: sheetConflicts,
    total: sheetConflicts.length,
  };
}

/**
 * Check imported sheets for missing function dependencies.
 * @param {Object} importData - The import data
 * @param {Object} storageEngine - Storage engine
 * @returns {Promise<Array<{sheetName: string, missingFunctions: Array}>>}
 */
export async function checkMissingDependencies(importData, storageEngine) {
  const warnings = [];

  // Build lookup sets once to avoid repeated linear scans
  const localFuncIds = new Set(
    (await storageEngine.listSheets({ publishedOnly: true }))
      .map(s => s.functionId)
  );
  const importFuncIds = new Set(
    Object.values(importData.sheets)
      .map(s => s.meta.functionId)
      .filter(Boolean)
  );

  for (const [id, data] of Object.entries(importData.sheets)) {
    const xmlToParse = data.xml || data.publishedXml;
    if (!xmlToParse) continue;

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlToParse, 'application/xml');
    const funcRefs = doc.querySelectorAll('CustomFunctions > Function');

    const missing = [];
    for (const funcEl of funcRefs) {
      const funcId = funcEl.getAttribute('id');
      if (!funcId) continue;

      if (!localFuncIds.has(funcId) && !importFuncIds.has(funcId)) {
        const funcName = funcEl.getAttribute('name') || funcId;
        missing.push(funcName);
      }
    }

    if (missing.length > 0) {
      warnings.push({
        sheetId: id,
        sheetName: data.meta.name,
        missingFunctions: missing
      });
    }
  }

  return warnings;
}

/**
 * Check imported scenarios for missing host functions.
 * A scenario is "broken" if its functionId is neither in the import nor in
 * local storage — opening it would fail. Mirrors checkMissingDependencies
 * so the dialog can surface both kinds of warnings the same way.
 * @param {Object} importData - The import data (with optional .scenarios)
 * @param {Object} storageEngine - Storage engine
 * @returns {Promise<Array<{scenarioName: string, functionName: string, functionId: string}>>}
 */
export async function checkMissingScenarioFunctions(importData, storageEngine) {
  const scenarios = importData.scenarios || {};
  if (Object.keys(scenarios).length === 0) return [];

  const localFuncIds = new Set(
    (await storageEngine.listSheets({ publishedOnly: true }))
      .map(s => s.functionId)
      .filter(Boolean)
  );
  const importFuncIds = new Set(
    Object.values(importData.sheets || {})
      .map(s => s.meta.functionId)
      .filter(Boolean)
  );

  const warnings = [];
  for (const { meta } of Object.values(scenarios)) {
    const fid = meta.functionId;
    if (!fid) continue;  // shouldn't happen, but skip rather than warn
    if (!localFuncIds.has(fid) && !importFuncIds.has(fid)) {
      warnings.push({
        scenarioName: meta.name,
        functionName: meta.functionName,
        functionId: fid,
      });
    }
  }
  return warnings;
}

/**
 * Rewrite function IDs in XML content.
 * Used when forking functions to update references in sheets.
 * @param {string} xmlContent - Original XML
 * @param {Map<string, string>} idRemapping - Map of old ID -> new ID
 * @returns {string} Modified XML
 */
function rewriteFunctionIds(xmlContent, idRemapping) {
  if (!idRemapping || idRemapping.size === 0) {
    return xmlContent;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');

  // Find all Function elements in CustomFunctions
  const functionElements = doc.querySelectorAll('CustomFunctions > Function');

  let modified = false;
  for (const funcEl of functionElements) {
    const oldId = funcEl.getAttribute('id');
    if (oldId && idRemapping.has(oldId)) {
      const newId = idRemapping.get(oldId);
      funcEl.setAttribute('id', newId);
      modified = true;
    }
  }

  if (!modified) {
    return xmlContent;
  }

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

/**
 * Generate a unique import folder name.
 * @param {string} baseName - Base name (e.g., zip filename)
 * @returns {string} Folder name
 */
export function generateImportFolderName(baseName) {
  // Remove .zip extension if present
  let name = baseName.replace(/\.zip$/i, '');

  // Add timestamp for uniqueness
  const date = new Date();
  const timestamp = date.toISOString().split('T')[0];

  if (name && name !== 'export') {
    return `${name} (${timestamp})`;
  }

  return `Import ${timestamp}`;
}

/**
 * Execute the import with conflict resolutions.
 * @param {Object} options
 * @param {Object} options.importData - Parsed import data (with .sheets and optional .scenarios)
 * @param {Map<string, string>} options.resolutions - Map of id -> 'fork'|'replace'|'skip'
 * @param {string} options.folderName - Name for top-level import folder
 * @param {string|null} [options.parentFolderId] - Parent folder ID (null for root)
 * @param {string|null} [options.packageId] - Package ID for deduplication of URL imports
 * @param {Object} options.storageEngine - Storage engine
 * @param {Object} options.opfsService - OPFS service
 * @returns {Promise<{imported: number, skipped: number, scenariosImported: number, warnings: Array, folderIdMap: Map, sheetIdMap: Map, functionIdMap: Map, scenarioIdMap: Map, importFolderId: string|null}>}
 */
export async function executeImport(options) {
  const { importData, resolutions, folderName, storageEngine, opfsService } = options;
  const parentFolderId = options.parentFolderId || null;
  const packageId = options.packageId || null;
  const { manifest, sheets } = importData;
  const scenarios = importData.scenarios || {};

  // Track ID remapping for forked items
  const folderIdMap = new Map();  // old ID -> new ID
  const sheetIdMap = new Map();
  const functionIdMap = new Map();  // old functionId -> new functionId
  const scenarioIdMap = new Map(); // old scenarioId -> new scenarioId

  let imported = 0;
  let skipped = 0;
  let scenariosImported = 0;
  const warnings = [];

  // 1. Create top-level import folder
  let importFolderId = null;
  if (Object.keys(sheets).length > 0) {
    importFolderId = await storageEngine.createFolder(
      folderName, parentFolderId, { packageId }
    );
  }

  // 2. Recreate folder structure from import (inside import folder)
  // Sort folders by depth (parents before children)
  const sortedFolders = Object.entries(manifest.folders || {}).sort((a, b) => {
    const depthA = getFolderDepth(a[0], manifest.folders);
    const depthB = getFolderDepth(b[0], manifest.folders);
    return depthA - depthB;
  });

  for (const [oldFolderId, folderMeta] of sortedFolders) {
    // Determine parent: if folder had a parent in import, use remapped ID; else use import folder
    let newParentId = importFolderId;
    if (folderMeta.parentId && folderIdMap.has(folderMeta.parentId)) {
      newParentId = folderIdMap.get(folderMeta.parentId);
    }

    const newFolderId = await storageEngine.createFolder(
      folderMeta.name,
      newParentId
    );
    folderIdMap.set(oldFolderId, newFolderId);
  }

  // 3. Pre-compute forked IDs so all remappings are known before any imports.
  for (const [oldId, data] of Object.entries(sheets)) {
    const resolution = resolutions.get(oldId) || 'fork';
    if (resolution === 'fork') {
      sheetIdMap.set(oldId, 'local-' + crypto.randomUUID());
      // Also remap functionId if this sheet has one
      if (data.meta.functionId) {
        functionIdMap.set(data.meta.functionId, crypto.randomUUID());
      }
    }
  }

  // 4. Import sheets
  const sheetEntries = Object.entries(sheets);
  const skippedEntries = sheetEntries.filter(([oldId]) => (resolutions.get(oldId) || 'fork') === 'skip');
  skipped = skippedEntries.length;

  const toImport = sheetEntries.filter(([oldId]) => (resolutions.get(oldId) || 'fork') !== 'skip');

  // Prepare sheet data and create all manifest entries in a single write
  const prepared = toImport.map(([oldId, data]) => {
    const targetId = sheetIdMap.get(oldId) || oldId;

    let targetFolderId = importFolderId;
    if (data.meta.folderId && folderIdMap.has(data.meta.folderId)) {
      targetFolderId = folderIdMap.get(data.meta.folderId);
    }

    let xmlContent = data.xml;
    if (xmlContent && functionIdMap.size > 0) {
      xmlContent = rewriteFunctionIds(xmlContent, functionIdMap);
    }

    let functionId = data.meta.functionId || null;
    if (functionId && functionIdMap.has(functionId)) {
      functionId = functionIdMap.get(functionId);
    }

    const dependencies = (data.meta.customFunctions || []).map(f => functionIdMap.get(f.id) || f.id);

    // For sheets with published JS but no signature in the manifest,
    // extract it from the XML so buildFuncDef gets the correct types.
    let publishedVersion = data.meta.publishedVersion || null;
    if (publishedVersion && data.publishedJs && !publishedVersion.signature && data.publishedXml) {
      const signature = extractSignatureFromXml(data.publishedXml);
      publishedVersion = { ...publishedVersion, signature };
    }

    return { oldId, data, targetId, targetFolderId, xmlContent, functionId, dependencies, publishedVersion };
  });

  await storageEngine.createSpreadsheetBatch(prepared.map(({ targetId, data, targetFolderId, xmlContent, functionId, dependencies, publishedVersion }) => ({
    id: targetId,
    options: {
      name: data.meta.name,
      type: data.meta.type || 'standard',
      folderId: targetFolderId,
      functionId,
      publishedVersion,
      hasUnpublishedChanges: data.meta.hasUnpublishedChanges || false,
      hasDraft: xmlContent !== null,
      dependencies,
    },
  })));

  // Write sheet files in parallel (each writes to distinct files, no contention)
  await Promise.all(prepared.map(async ({ targetId, data, xmlContent }) => {
    if (xmlContent) {
      await opfsService.saveSheet(targetId, xmlContent);
    }

    if (data.publishedXml) {
      let publishedXml = data.publishedXml;
      if (functionIdMap.size > 0) {
        publishedXml = rewriteFunctionIds(publishedXml, functionIdMap);
      }
      await opfsService.savePublishedVersion(targetId, publishedXml, data.publishedJs || '');
    }
  }));
  imported = toImport.length;

  // 5. Import scenarios. Always assign new IDs to avoid collisions on
  //    re-import of the same package; remap functionId when the host function
  //    was forked. Sequential because createScenarioEntry mutates the shared
  //    sheet manifest (read-modify-write).
  //
  //    Build the set of functionIds that will exist after this import so we
  //    can warn about scenarios whose target won't resolve.
  const importedFunctionIds = new Set();
  for (const data of Object.values(sheets)) {
    const fid = data.meta.functionId;
    if (!fid) continue;
    importedFunctionIds.add(functionIdMap.get(fid) || fid);
  }

  for (const [oldId, { meta, data }] of Object.entries(scenarios)) {
    const newId = 'scenario-' + crypto.randomUUID();
    scenarioIdMap.set(oldId, newId);

    let functionId = meta.functionId || null;
    if (functionId && functionIdMap.has(functionId)) {
      functionId = functionIdMap.get(functionId);
    }

    if (functionId && !importedFunctionIds.has(functionId)) {
      // Not in this import — check if it's already in local storage
      const existing = await storageEngine.findSheetByFunctionId(functionId);
      if (!existing) {
        warnings.push({
          type: 'scenario-missing-function',
          scenarioName: meta.name,
          functionName: meta.functionName,
          functionId,
        });
        console.warn(`[ImportPackager] Scenario "${meta.name}" references function ${meta.functionName} (${functionId}) which is not in this import or local storage; the scenario will be broken.`);
      }
    }

    await storageEngine.createScenarioEntry(newId, {
      name: meta.name,
      functionId,
      functionName: meta.functionName,
      createdAt: meta.createdAt || new Date().toISOString(),
      updatedAt: meta.updatedAt || new Date().toISOString(),
      folderId: meta.folderId ?? null,
    });

    await opfsService.saveScenario(newId, {
      inputs: data.inputs || {},
      results: data.results ?? null,
    });

    scenariosImported++;
  }

  return {
    imported,
    skipped,
    scenariosImported,
    warnings,
    folderIdMap,
    sheetIdMap,
    functionIdMap,
    scenarioIdMap,
    importFolderId,
  };
}

/**
 * Build a topological publish order for imported sheets based on their inter-dependencies.
 * Uses Kahn's algorithm. Only considers dependencies within the provided sheets.
 * @param {Object} sheets - sheetId → { meta, xml, ... }
 * @param {Map<string, string>} [functionIdMap] - Old functionId → new functionId remapping
 * @returns {string[]} Ordered array of sheetIds (leaves/no-deps first)
 */
function buildPublishOrder(sheets, functionIdMap) {
  // Map functionId → sheetId for sheets in this import
  const funcToSheet = new Map();
  for (const [sheetId, data] of Object.entries(sheets)) {
    const funcId = data.meta?.functionId;
    if (funcId) {
      funcToSheet.set(funcId, sheetId);
    }
  }

  // Build adjacency: sheetId → Set of sheetIds it depends on (within this import)
  const inDegree = new Map();
  const dependents = new Map(); // depSheetId → Set of sheetIds that depend on it

  for (const sheetId of Object.keys(sheets)) {
    inDegree.set(sheetId, 0);
    dependents.set(sheetId, new Set());
  }

  for (const [sheetId, data] of Object.entries(sheets)) {
    for (const dep of (data.meta.customFunctions || [])) {
      const depId = functionIdMap?.get(dep.id) || dep.id;
      const depSheetId = funcToSheet.get(depId);
      if (depSheetId && depSheetId !== sheetId) {
        inDegree.set(sheetId, (inDegree.get(sheetId) || 0) + 1);
        dependents.get(depSheetId).add(sheetId);
      }
    }
  }

  // Kahn's algorithm — returns levels (arrays of sheet IDs that can run in parallel)
  let queue = [];
  for (const [sheetId, degree] of inDegree) {
    if (degree === 0) queue.push(sheetId);
  }

  const levels = [];
  let totalOrdered = 0;
  while (queue.length > 0) {
    levels.push(queue);
    totalOrdered += queue.length;
    const nextQueue = [];
    for (const current of queue) {
      for (const dependent of dependents.get(current)) {
        const newDegree = inDegree.get(dependent) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) nextQueue.push(dependent);
      }
    }
    queue = nextQueue;
  }

  if (totalOrdered < inDegree.size) {
    const ordered = new Set(levels.flat());
    const cycleSheets = [...inDegree.keys()].filter(id => !ordered.has(id));
    const names = cycleSheets.map(id => sheets[id]?.meta?.name || id).join(', ');
    throw new Error(`Circular dependency detected among sheets: ${names}`);
  }

  return levels;
}

/**
 * Batch-publish imported sheets that need transpilation.
 * Publishes in dependency order so cross-sheet references resolve.
 * @param {Object} options
 * @param {Object} options.importData - Parsed import data (sheets with XMLs and metadata)
 * @param {Object} options.importResult - Result from executeImport (ID mappings)
 * @param {Object} options.storageEngine - Storage engine instance
 * @param {Object} options.opfsService - OPFS service for loading draft XMLs
 * @param {Object} options.functionCompiler - Function compiler with transpile()
 * @returns {Promise<{published: number, failed: Array<{sheetId: string, name: string, error: string}>}>}
 */
export async function publishImportedSheets({ importData, importResult, storageEngine, opfsService, functionCompiler }) {
  const { sheets } = importData;
  const { sheetIdMap, functionIdMap } = importResult;

  // Build a set of functionIds referenced by other sheets in this import
  const referencedFuncIds = new Set();
  for (const [, data] of Object.entries(sheets)) {
    for (const dep of (data.meta.customFunctions || [])) {
      referencedFuncIds.add(dep.id);
    }
  }

  // Identify sheets needing publish: have a functionId OR are referenced, AND lack published JS
  const sheetsToPublish = {};
  for (const [oldId, data] of Object.entries(sheets)) {
    const hasFuncId = !!data.meta.functionId;
    const isReferenced = data.meta.functionId && referencedFuncIds.has(data.meta.functionId);
    const alreadyHasJs = !!data.publishedJs;

    if ((hasFuncId || isReferenced) && !alreadyHasJs) {
      const finalId = sheetIdMap.get(oldId) || oldId;
      sheetsToPublish[finalId] = {
        meta: {
          ...data.meta,
          functionId: data.meta.functionId && functionIdMap.has(data.meta.functionId)
            ? functionIdMap.get(data.meta.functionId)
            : data.meta.functionId,
        },
        xml: data.xml,
        oldId,
      };
    }
  }

  if (Object.keys(sheetsToPublish).length === 0) {
    return { published: 0, failed: [] };
  }

  // Topological sort — returns levels of sheets that can be published in parallel
  let publishLevels;
  try {
    publishLevels = buildPublishOrder(sheetsToPublish, functionIdMap);
  } catch (err) {
    console.warn('[ImportPackager] Publish order failed:', err.message);
    // Fall back to single level — some may fail but import still succeeds
    publishLevels = [Object.keys(sheetsToPublish)];
  }

  let published = 0;
  const failed = [];

  for (const level of publishLevels) {
    const results = await Promise.all(level.map(async (sheetId) => {
      const entry = sheetsToPublish[sheetId];
      if (!entry) return;

      try {
        // Load draft XML from OPFS (stored by executeImport with remapped function IDs)
        const xml = await opfsService.loadSheet(sheetId);
        if (!xml) {
          throw new Error('Draft XML not found in OPFS');
        }

        // Collect dependency XMLs (use pre-parsed metadata, remap IDs)
        const depIds = (entry.meta.customFunctions || []).map(f => functionIdMap.get(f.id) || f.id);
        const customFunctions = depIds.length > 0
          ? await storageEngine.collectDependencyXmls(depIds)
          : {};

        // Transpile
        const result = await functionCompiler.transpile(xml, 'javascript', customFunctions);
        if (result.error) {
          throw new Error(result.error);
        }

        const js = result.javascript;
        const funcId = entry.meta.functionId;
        const versionId = entry.meta.publishedVersion?.versionId || funcId;
        const versionString = entry.meta.publishedVersion?.versionString || '1.0';

        await storageEngine.publishSheet(sheetId, xml, js, versionString, versionId, funcId, { signature: result.signature });
        published++;

      } catch (err) {
        console.warn(`[ImportPackager] Failed to publish ${entry.meta.name}:`, err.message);
        failed.push({ sheetId, name: entry.meta.name, error: err.message });
      }
    }));
  }

  return { published, failed };
}

/**
 * Find the "top-level" sheet in an import — the one that isn't called by other sheets.
 * Prefers display-only sheets (no functionId) over callable functions.
 * @param {Object} importData - Parsed import data
 * @param {Object} importResult - Result from executeImport
 * @returns {{id: string, type: string, name: string}|null}
 */
export function findTopLevelSheet(importData, importResult) {
  const { sheetIdMap } = importResult;
  const { sheets } = importData;

  // Build set of functionIds referenced by any sheet in this import
  const referencedFuncIds = new Set();
  for (const [, data] of Object.entries(sheets)) {
    for (const dep of (data.meta.customFunctions || [])) {
      referencedFuncIds.add(dep.id);
    }
  }

  // Find sheets whose functionId is NOT referenced by others
  const candidates = [];
  for (const [oldId, data] of Object.entries(sheets)) {
    const funcId = data.meta.functionId;
    const isReferenced = funcId && referencedFuncIds.has(funcId);

    if (!isReferenced) {
      const finalId = sheetIdMap.get(oldId) || oldId;
      candidates.push({
        id: finalId,
        type: data.meta.type || 'standard',
        name: data.meta.name,
        _hasFunctionId: !!funcId,
      });
    }
  }

  // Prefer display-only sheets (no functionId) over callable functions
  candidates.sort((a, b) => {
    if (a._hasFunctionId !== b._hasFunctionId) return a._hasFunctionId ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  if (!candidates[0]) return null;
  const result = { ...candidates[0] };
  delete result._hasFunctionId;
  return result;
}

/**
 * Get the depth of a folder in the hierarchy.
 * @param {string} folderId - Folder ID
 * @param {Object} folders - Folders map from manifest
 * @returns {number} Depth (0 for root-level folders)
 */
function getFolderDepth(folderId, folders) {
  let depth = 0;
  let currentId = folderId;
  const visited = new Set();

  while (currentId && folders[currentId]) {
    if (visited.has(currentId)) break; // cycle guard
    visited.add(currentId);
    const parentId = folders[currentId].parentId;
    if (!parentId) break;
    depth++;
    currentId = parentId;
  }

  return depth;
}
