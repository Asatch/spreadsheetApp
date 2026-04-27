/*
 * STORAGE ENGINE
 * ==============
 *
 * Handles long-term persistence - save and load operations.
 * Manages OPFS storage, manifest, and auto-save functionality.
 *
 * v3.0: Unified sheet manifest. All data stored in sheets/ directory.
 * Each sheet has a draft (editable) and optional published version (XML + JS).
 * Functions are just published sheets — no separate storage.
 */

import { generateXml, extractXmlMetadata } from '../utils/xmlSerializer.js';
import { sheetUrl } from '../utils/appMode.js';

export function createStorageEngine() {
  // === Existing dependencies (snapshot providers) ===
  let getCanonicalSnapshot = null;
  let getFormattingSnapshot = null;
  let getGridBounds = null;
  let getOutputCells = null;
  let getOutputModes = null;
  let getCalcSnapshot = null;
  let getCustomFunctions = null;
  let getSpreadsheetName = null;
  let getTestCases = null;
  let getInputNames = null;
  let getColumnNames = null;
  let getMaxIterations = null;
  let onDirtyChange = null;

  // OPFS dependencies
  let opfsService = null;
  let sheetManifest = null;  // Unified v3.0 manifest cache

  // === Current spreadsheet state ===
  let currentSpreadsheetId = null;
  let autoSaveTimeout = null;
  let markUnpublishedTimeout = null;
  let isCreatingNew = false;
  const AUTO_SAVE_DELAY = 4000;

  // === VERSIONING STATE ===
  let hasUnpublishedChanges = false;
  let onUnpublishedChange = null;

  // === SCRATCHPAD STATE ===
  // Scratchpad mode: ephemeral editing of a published version (drilldown).
  // No OPFS writes until explicitly forked or merged.
  let scratchpadMode = false;

  // === LOADING STATE ===
  let isLoading = false;

  // === DOWNLOADS FOLDER ===
  const DOWNLOADS_FOLDER_NAME = 'Downloads';

  // ============================================================================
  // SHEET MANIFEST
  // ============================================================================

  /**
   * Get the cached sheet manifest, loading from OPFS if needed.
   * @returns {Promise<Object>} The sheet manifest { version, folders, sheets }
   */
  async function getSheetManifest() {
    if (!sheetManifest) {
      sheetManifest = await opfsService.readSheetManifest();
    }
    return sheetManifest;
  }

  /**
   * Write the sheet manifest to OPFS and update cache.
   */
  async function writeSheetManifest(manifest) {
    sheetManifest = manifest;
    await opfsService.writeSheetManifest(manifest);
  }

  // ============================================================================
  // SHEET OPERATIONS
  // ============================================================================

  /**
   * Get metadata for a sheet.
   * @param {string} id - Sheet ID
   * @returns {Promise<Object|null>} Sheet entry or null
   */
  async function getSheetMetadata(id) {
    const m = await getSheetManifest();
    return m.sheets[id] || null;
  }

  /**
   * List all sheets with metadata.
   * @param {Object} [filter] - Optional filter
   * @param {boolean} [filter.publishedOnly] - Only return published sheets
   * @returns {Promise<Array<{id: string, ...metadata}>>}
   */
  async function listSheets(filter = {}) {
    const m = await getSheetManifest();
    let entries = Object.entries(m.sheets);

    if (filter.publishedOnly) {
      entries = entries.filter(([, sheet]) => sheet.functionId && sheet.publishedVersion);
    }

    return entries.map(([id, metadata]) => ({ id, ...metadata }));
  }

  /**
   * Find a sheet by its functionId (stable UUID used in XML references).
   * @param {string} functionId - The function UUID
   * @returns {Promise<{id: string, ...metadata}|null>}
   */
  async function findSheetByFunctionId(functionId) {
    const m = await getSheetManifest();
    for (const [id, sheet] of Object.entries(m.sheets)) {
      if (sheet.functionId === functionId) {
        return { id, ...sheet };
      }
    }
    return null;
  }

  /**
   * Publish a sheet: save published XML + JS, update manifest.
   * @param {string} sheetId - Sheet ID
   * @param {string} xml - Published XML
   * @param {string} js - Transpiled JS
   * @param {string} versionString - Human-readable version
   * @param {string} versionId - Version UUID
   * @param {string} functionId - Function UUID (stable across versions)
   * @param {Object} [options] - Additional publish options
   * @param {Object} [options.signature] - Function signature { inputs: [{name, type}], outputs: [{name, type}] }
   */
  async function publishSheet(sheetId, xml, js, versionString, versionId, functionId, options = {}) {
    // Save published files
    await opfsService.savePublishedVersion(sheetId, xml, js);

    // Update manifest
    const m = await getSheetManifest();
    const sheet = m.sheets[sheetId];
    if (sheet) {
      sheet.functionId = functionId;
      sheet.publishedVersion = {
        versionId,
        versionString,
        publishedName: sheet.name,
        publishedAt: new Date().toISOString(),
        ...(options.signature ? { signature: options.signature } : {}),
      };
      sheet.hasUnpublishedChanges = false;
      await writeSheetManifest(m);
    }

    // Update in-memory state
    if (sheetId === currentSpreadsheetId) {
      hasUnpublishedChanges = false;
      onUnpublishedChange?.(false);
    }

  }

  /**
   * Load a sheet's published version data for functionCompiler integration.
   * @param {string} sheetId - Sheet ID
   * @returns {Promise<{code: string, definition: string, metadata: Object}|null>}
   */
  async function loadPublishedVersion(sheetId) {
    const metadata = await getSheetMetadata(sheetId);
    if (!metadata || !metadata.functionId) return null;

    try {
      const code = await opfsService.loadPublishedCode(sheetId);
      const definition = await opfsService.loadPublishedXml(sheetId);
      return {
        code,
        definition,
        metadata: {
          name: metadata.name,
          publishedName: metadata.publishedVersion?.publishedName || metadata.name,
          version: metadata.publishedVersion?.versionString || '1.0',
          versionId: metadata.publishedVersion?.versionId || null,
          sheetType: metadata.type || 'standard',
          sourceSpreadsheetId: sheetId,
          ...(metadata.publishedVersion?.signature ? { signature: metadata.publishedVersion.signature } : {}),
        }
      };
    } catch (e) {
      console.warn(`[StorageEngine] Failed to load published version for ${sheetId}:`, e.message);
      return null;
    }
  }

  // ============================================================================
  // XML EXPORT
  // ============================================================================

  /**
   * Export spreadsheet to XML format.
   */
  function exportToXml(sheetName = 'Untitled', options = {}) {
    const canonical = getCanonicalSnapshot();
    const { nodeCalcData, namedInputs } = getCalcSnapshot();

    const state = {
      sheetName,
      canonicalValues: canonical.canonicalValues,
      nodeCalcData,
      namedInputs,
      namedInputsOrdered: canonical.namedInputs,
      outputCells: getOutputCells(),
      outputModes: getOutputModes(),
      gridBounds: getGridBounds(),
      formatting: getFormattingSnapshot(),
      customFunctions: getCustomFunctions(),
      testCases: getTestCases(),
      inputNames: getInputNames(),
      sheetType: canonical.type,
      columnNames: getColumnNames(),
      maxIterations: getMaxIterations ? getMaxIterations() : null,
    };

    return generateXml(state, options);
  }

  /**
   * Import a single XML/JSON file directly.
   */
  async function importFile(file) {
    const xml = await file.text();
    const metadata = extractXmlMetadata(xml);
    const name = metadata.name || file.name.replace(/\.xml$/i, '') || 'Imported';
    const type = metadata.type || 'standard';

    const id = await createSpreadsheet(name, type);
    await saveSpreadsheetToOpfs(id, xml);

    return { id, type };
  }

  /**
   * Open a file picker to import files.
   */
  function open(options = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml,.zip,.html,.htm';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.name.toLowerCase().endsWith('.zip')) {
        if (options.onZipFile) {
          options.onZipFile(file);
        } else {
          alert('Zip import not available');
        }
        return;
      }

      // HTML files contain an embedded zip — extract and treat as zip import
      if (file.name.toLowerCase().match(/\.html?$/)) {
        if (options.onHtmlFile) {
          options.onHtmlFile(file);
        } else if (options.onZipFile) {
          // Fall back: extract zip from HTML and pass to zip handler
          try {
            const { extractZipFromHtml } = await import('../utils/importPackager.js');
            const zipBlob = await extractZipFromHtml(file);
            const zipFile = new File([zipBlob], file.name.replace(/\.html?$/i, '.zip'), { type: 'application/zip' });
            options.onZipFile(zipFile);
          } catch (err) {
            alert('Failed to extract data from HTML file: ' + err.message);
          }
        } else {
          alert('HTML import not available');
        }
        return;
      }

      try {
        const { id, type } = await importFile(file);
        window.location.href = sheetUrl(id, type);
      } catch (error) {
        console.error('[StorageEngine] Failed to load file:', error);
        alert('Failed to load file: ' + error.message);
      }
    };

    input.click();
  }

  function openFolder(options = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.onchange = (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      if (options.onFolder) options.onFolder(files);
    };
    input.click();
  }

  // ============================================================================
  // OPFS-BASED OPERATIONS
  // ============================================================================

  function generateLocalId() {
    return 'local-' + crypto.randomUUID();
  }

  /**
   * Normalize a sheet name to a valid function identifier.
   * This is the single source of truth for name normalization —
   * applied at write boundaries so all stored names are canonical.
   */
  function normalizeSheetName(name) {
    return name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'UNTITLED';
  }

  /**
   * Create a new spreadsheet entry in the unified sheet manifest.
   */
  async function createSpreadsheet(name, type = 'standard', options = {}) {
    const id = generateLocalId();
    const now = new Date().toISOString();
    const normalized = normalizeSheetName(name);

    const m = await getSheetManifest();
    m.sheets[id] = {
      name: normalized,
      type,
      description: '',
      createdAt: now,
      updatedAt: now,
      folderId: options.folderId || null,
      hasDraft: true,
      hasUnpublishedChanges: true,
      functionId: null,
      publishedVersion: null,
      dependencies: [],
    };
    await writeSheetManifest(m);

    return id;
  }

  /**
   * Create a spreadsheet entry with a specific ID (for import).
   */
  async function createSpreadsheetWithId(id, options) {
    const { name, type = 'standard', folderId = null } = options;
    const now = new Date().toISOString();
    const normalized = normalizeSheetName(name);

    const m = await getSheetManifest();
    m.sheets[id] = {
      name: normalized,
      type,
      description: options.description || '',
      createdAt: now,
      updatedAt: now,
      folderId,
      hasDraft: options.hasDraft ?? true,
      hasUnpublishedChanges: options.hasUnpublishedChanges ?? true,
      functionId: options.functionId || null,
      publishedVersion: options.publishedVersion || null,
      dependencies: options.dependencies || [],
    };
    await writeSheetManifest(m);

    return id;
  }

  /**
   * Create multiple spreadsheet entries in a single manifest write (for bulk import).
   * @param {Array<{id: string, options: Object}>} entries - Array of {id, options} to create
   */
  async function createSpreadsheetBatch(entries) {
    const m = await getSheetManifest();
    const now = new Date().toISOString();

    for (const { id, options } of entries) {
      const { name, type = 'standard', folderId = null } = options;
      m.sheets[id] = {
        name: normalizeSheetName(name),
        type,
        description: options.description || '',
        createdAt: now,
        updatedAt: now,
        folderId,
        hasDraft: options.hasDraft ?? true,
        hasUnpublishedChanges: options.hasUnpublishedChanges ?? true,
        functionId: options.functionId || null,
        publishedVersion: options.publishedVersion || null,
        dependencies: options.dependencies || [],
      };
    }

    await writeSheetManifest(m);
  }

  async function saveSpreadsheetToOpfs(id, xml) {
    await opfsService.saveSheet(id, xml);

    const m = await getSheetManifest();
    m.sheets[id].updatedAt = new Date().toISOString();
    m.sheets[id].dependencies = extractDependencyIds(xml);
    await writeSheetManifest(m);
  }

  /**
   * Extract function IDs from <CustomFunctions><Function id="..."> elements in XML.
   * @param {string} xml - Spreadsheet XML content
   * @returns {string[]} Array of function ID strings
   */
  function extractDependencyIds(xml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      return Array.from(doc.querySelectorAll('CustomFunctions > Function'))
        .map(el => el.getAttribute('id'))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function loadSpreadsheetFromOpfs(id) {
    const m = await getSheetManifest();
    const metadata = m.sheets?.[id];
    if (!metadata) {
      throw new Error(`Spreadsheet ${id} not found in manifest`);
    }
    if (metadata.hasDraft === false) {
      throw new Error(`Spreadsheet ${id} has no draft. Use createDraftFromPublished() first.`);
    }
    const xml = await opfsService.loadSheet(id);
    return { xml, metadata };
  }

  async function renameSpreadsheet(id, newName) {
    const m = await getSheetManifest();
    m.sheets[id].name = normalizeSheetName(newName);
    m.sheets[id].updatedAt = new Date().toISOString();
    await writeSheetManifest(m);
  }

  async function deleteSpreadsheet(id) {
    await opfsService.deleteSheet(id);

    const m = await getSheetManifest();
    delete m.sheets[id];
    await writeSheetManifest(m);

  }

  async function deleteSpreadsheetBatch(ids) {
    if (ids.length === 0) return;

    // Delete all OPFS files in parallel
    await Promise.all(ids.map(id => opfsService.deleteSheet(id)));

    // Single manifest update
    const m = await getSheetManifest();
    for (const id of ids) {
      delete m.sheets[id];
    }
    await writeSheetManifest(m);

  }

  // ============================================================================
  // PUBLISHED SNAPSHOT OPERATIONS
  // ============================================================================

  async function savePublishedSnapshot(id, xml) {
    await opfsService.savePublishedSnapshot(id, xml);
  }

  async function loadPublishedXml(id) {
    return await opfsService.loadPublishedXml(id);
  }

  async function hasPublishedVersion(id) {
    return await opfsService.hasPublishedVersion(id);
  }

  async function discardToPublished(spreadsheetId) {
    const hasSnapshot = await opfsService.hasPublishedVersion(spreadsheetId);
    if (!hasSnapshot) {
      throw new Error('No published version to discard to');
    }

    const publishedXml = await opfsService.loadPublishedXml(spreadsheetId);
    await opfsService.saveSheet(spreadsheetId, publishedXml);

    const m = await getSheetManifest();
    if (m.sheets[spreadsheetId]) {
      m.sheets[spreadsheetId].hasUnpublishedChanges = false;
      m.sheets[spreadsheetId].updatedAt = new Date().toISOString();
      await writeSheetManifest(m);
    }

    if (spreadsheetId === currentSpreadsheetId) {
      hasUnpublishedChanges = false;
      onUnpublishedChange?.(false);
    }

    return publishedXml;
  }

  /**
   * Create a draft from a published-only sheet (hasDraft === false).
   * Copies the published XML as the new draft and marks hasDraft = true.
   * @param {string} sheetId - Sheet ID
   */
  async function createDraftFromPublished(sheetId) {
    const m = await getSheetManifest();
    const metadata = m.sheets[sheetId];
    if (!metadata) throw new Error(`Sheet not found: ${sheetId}`);
    if (metadata.hasDraft !== false) throw new Error(`Sheet ${sheetId} already has a draft`);

    const publishedXml = await opfsService.loadPublishedXml(sheetId);
    await opfsService.saveSheet(sheetId, publishedXml);

    metadata.hasDraft = true;
    metadata.hasUnpublishedChanges = false;
    metadata.updatedAt = new Date().toISOString();
    await writeSheetManifest(m);

  }

  // ============================================================================
  // FUNCTION OPERATIONS
  // These operate on the "published" aspect of sheets. A function is just
  // a published sheet, identified by its functionId.
  // ============================================================================

  /**
   * Check if a function exists locally (has a published sheet with this functionId).
   * @param {string} functionId - The function UUID
   * @returns {Promise<boolean>}
   */
  async function hasFunction(functionId) {
    const sheet = await findSheetByFunctionId(functionId);
    return !!sheet;
  }

  /**
   * Delete a function's published state.
   * Removes published files and clears the sheet's published metadata.
   * @param {string} functionId - The function UUID
   */
  async function deleteFunction(functionId) {
    const sheet = await findSheetByFunctionId(functionId);
    if (sheet) {
      await opfsService.deletePublishedFiles(sheet.id);

      const m = await getSheetManifest();
      const entry = m.sheets[sheet.id];
      if (entry) {
        entry.functionId = null;
        entry.publishedVersion = null;
        await writeSheetManifest(m);
      }
    }

  }

  /**
   * Get metadata for a function by its functionId.
   * @param {string} functionId - The function UUID
   * @returns {Promise<Object|null>} Function metadata or null
   */
  async function getFunctionMetadata(functionId) {
    const sheet = await findSheetByFunctionId(functionId);
    if (sheet) {
      return {
        name: sheet.name,
        version: sheet.publishedVersion?.versionString || '1.0',
        versionId: sheet.publishedVersion?.versionId || null,
        sheetType: sheet.type || 'standard',
        importedAt: sheet.publishedVersion?.publishedAt || sheet.updatedAt,
        folderId: sheet.folderId || null,
        sourceSpreadsheetId: sheet.id,
      };
    }
    return null;
  }

  /**
   * List all stored functions (published sheets as function entries).
   * @returns {Promise<Array>} Function entries
   */
  async function listFunctions() {
    const published = await listSheets({ publishedOnly: true });
    return published.map(sheet => ({
      id: sheet.functionId,
      name: sheet.name,
      version: sheet.publishedVersion?.versionString || '1.0',
      versionId: sheet.publishedVersion?.versionId || null,
      sheetType: sheet.type || 'standard',
      importedAt: sheet.publishedVersion?.publishedAt || sheet.updatedAt,
      folderId: sheet.folderId || null,
    }));
  }

  /**
   * Load complete function data for functionCompiler integration.
   * @param {string} functionId - The function UUID
   * @returns {Promise<{code: string, definition: string, metadata: Object}|null>}
   */
  async function loadFunction(functionId) {
    const sheet = await findSheetByFunctionId(functionId);
    if (sheet) {
      return await loadPublishedVersion(sheet.id);
    }
    return null;
  }

  /**
   * Load a function's XML definition by functionId.
   * Used internally by collectDependencyXmls.
   * @param {string} functionId - The function UUID
   * @returns {Promise<string>} XML content
   */
  async function loadFunctionDefinition(functionId) {
    const sheet = await findSheetByFunctionId(functionId);
    if (sheet) {
      return await opfsService.loadPublishedXml(sheet.id);
    }
    throw new Error(`Function not found: ${functionId}`);
  }

  // ============================================================================
  // DEPENDENCY COLLECTION
  // ============================================================================

  /**
   * Recursively collect dependency XMLs from OPFS for transpilation.
   */
  async function collectDependencyXmls(directDepIds) {
    const result = {};
    let toLoad = [...directDepIds];
    const loaded = new Set();

    while (toLoad.length > 0) {
      const batch = toLoad.filter(id => !loaded.has(id));
      if (batch.length === 0) break;
      for (const id of batch) loaded.add(id);
      toLoad = [];

      const entries = await Promise.all(batch.map(async (id) => {
        const metadata = await getFunctionMetadata(id);
        if (!metadata) return null;

        let xml;
        try {
          xml = await loadFunctionDefinition(id);
        } catch { return null; }

        // Parse this function's XML for transitive deps
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');
        const transitiveDeps = [];
        for (const func of doc.querySelectorAll('CustomFunctions > Function')) {
          const depId = func.getAttribute('id');
          if (depId && !loaded.has(depId)) transitiveDeps.push(depId);
        }

        return { id, name: metadata.name, xml, transitiveDeps };
      }));

      for (const entry of entries) {
        if (!entry) continue;
        result[entry.id] = { name: entry.name, xml_content: entry.xml };
        toLoad.push(...entry.transitiveDeps);
      }
    }

    return result;
  }

  /**
   * Convenience: extract dependency IDs from XML and collect their XMLs.
   * Combines extractDependencyIds + collectDependencyXmls in a single call.
   */
  async function collectDependenciesFromXml(xml) {
    const depIds = extractDependencyIds(xml);
    return depIds.length > 0 ? collectDependencyXmls(depIds) : {};
  }

  // ============================================================================
  // AUTO-SAVE
  // ============================================================================

  function isBlankSpreadsheet() {
    const canonical = getCanonicalSnapshot();
    return canonical.canonicalValues.length === 0;
  }

  function markDirty() {
    if (isLoading) return;

    onDirtyChange?.(true);

    // Update in-memory state immediately for responsive UI
    if (currentSpreadsheetId && !hasUnpublishedChanges) {
      hasUnpublishedChanges = true;
      onUnpublishedChange?.(true);
    }
    // Debounce the OPFS manifest write
    clearTimeout(markUnpublishedTimeout);
    markUnpublishedTimeout = setTimeout(() => persistUnpublishedFlag(), 1000);

    // In scratchpad mode, don't auto-save to OPFS
    if (scratchpadMode) {
      return;
    }

    if (!currentSpreadsheetId && isBlankSpreadsheet()) {
      return;
    }

    if (!currentSpreadsheetId && !isCreatingNew) {
      createAndSaveNew();
      return;
    }

    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => autoSave(), AUTO_SAVE_DELAY);
  }

  function setLoading(loading) {
    isLoading = loading;
  }

  async function createAndSaveNew() {
    isCreatingNew = true;
    try {
      const name = getSpreadsheetName();
      const type = getCanonicalSnapshot().type || 'standard';
      const urlParams = new URLSearchParams(window.location.search);
      const folderId = urlParams.get('folder') || null;
      currentSpreadsheetId = await createSpreadsheet(name, type, { folderId });
      await autoSave();
    } finally {
      isCreatingNew = false;
    }
  }

  async function autoSave() {
    const xml = exportToXml(getSpreadsheetName());
    await saveSpreadsheetToOpfs(currentSpreadsheetId, xml);
    onDirtyChange?.(false);
  }

  function getCurrentSpreadsheetId() {
    return currentSpreadsheetId;
  }

  function setCurrentSpreadsheetId(id, metadata = null) {
    currentSpreadsheetId = id;

    if (metadata) {
      hasUnpublishedChanges = metadata.hasUnpublishedChanges ?? true;
    } else {
      hasUnpublishedChanges = true;
    }
    onUnpublishedChange?.(hasUnpublishedChanges);
  }

  // ============================================================================
  // VERSIONING
  // ============================================================================

  /**
   * Persist the unpublished flag to the OPFS manifest.
   * Called on a debounce from markDirty — the in-memory state is updated immediately there.
   */
  async function persistUnpublishedFlag() {
    if (!currentSpreadsheetId) return;

    const m = await getSheetManifest();
    if (m.sheets[currentSpreadsheetId]) {
      m.sheets[currentSpreadsheetId].hasUnpublishedChanges = true;
      await writeSheetManifest(m);
    }
  }

  async function clearUnpublished(spreadsheetId, newVersionId, functionId = null, versionString = null) {
    const m = await getSheetManifest();
    if (m.sheets[spreadsheetId]) {
      m.sheets[spreadsheetId].hasUnpublishedChanges = false;
      // Update published version info on the sheet
      if (newVersionId) {
        if (!m.sheets[spreadsheetId].publishedVersion) {
          m.sheets[spreadsheetId].publishedVersion = {};
        }
        m.sheets[spreadsheetId].publishedVersion.versionId = newVersionId;
      }
      if (functionId) {
        m.sheets[spreadsheetId].functionId = functionId;
      }
      if (versionString) {
        if (!m.sheets[spreadsheetId].publishedVersion) {
          m.sheets[spreadsheetId].publishedVersion = {};
        }
        m.sheets[spreadsheetId].publishedVersion.versionString = versionString;
        m.sheets[spreadsheetId].publishedVersion.publishedAt = new Date().toISOString();
      }
      await writeSheetManifest(m);
    }

    if (spreadsheetId === currentSpreadsheetId) {
      hasUnpublishedChanges = false;
      onUnpublishedChange?.(false);
    }
  }

  // ============================================================================
  // SCRATCHPAD MODE
  // ============================================================================

  function setScratchpadMode(enabled) {
    scratchpadMode = enabled;
  }

  function isScratchpadMode() {
    return scratchpadMode;
  }

  /**
   * Fork scratchpad content into a new regular sheet.
   * Creates a new sheet entry and saves the current XML to OPFS.
   * @param {string} name - Name for the new sheet
   * @param {string} xmlContent - Current XML content to save
   * @returns {Promise<string>} The new sheet ID
   */
  async function forkScratchpadToNewSheet(name, xmlContent) {
    const type = getCanonicalSnapshot?.()?.type || 'standard';
    const newId = await createSpreadsheet(name, type);
    await saveSpreadsheetToOpfs(newId, xmlContent);
    scratchpadMode = false;
    currentSpreadsheetId = newId;
    return newId;
  }

  async function replaceSpreadsheetContent(spreadsheetId, xmlContent) {
    await opfsService.saveSheet(spreadsheetId, xmlContent);

    const m = await getSheetManifest();
    if (m.sheets[spreadsheetId]) {
      m.sheets[spreadsheetId].updatedAt = new Date().toISOString();
      m.sheets[spreadsheetId].hasDraft = true;
      await writeSheetManifest(m);
    }
  }

  // ============================================================================
  // FOLDER OPERATIONS
  // ============================================================================

  function generateFolderId() {
    return 'folder-' + crypto.randomUUID();
  }

  /**
   * Create a new folder.
   * @param {string} name
   * @param {string|null} parentId
   * @param {Object} [options]
   * @param {string} [options.packageId] - Package ID for deduplication of URL imports
   */
  async function createFolder(name, parentId = null, options = {}) {
    const m = await getSheetManifest();

    if (parentId && !m.folders[parentId]) {
      throw new Error(`Parent folder not found: ${parentId}`);
    }

    const folderId = generateFolderId();
    const now = new Date().toISOString();

    m.folders[folderId] = {
      name,
      parentId,
      createdAt: now
    };
    if (options.packageId) {
      m.folders[folderId].packageId = options.packageId;
    }

    await writeSheetManifest(m);
    return folderId;
  }

  async function renameFolder(folderId, newName) {
    const m = await getSheetManifest();

    const folder = m.folders[folderId];
    if (!folder) {
      throw new Error(`Folder not found: ${folderId}`);
    }

    // If renaming the root-level Downloads folder, clear packageId on all
    // direct children — the dedup lookup keys off the "Downloads" name, so
    // these IDs would become orphaned. Same logic as move-out-of-Downloads.
    if (folder.name === DOWNLOADS_FOLDER_NAME && !folder.parentId && newName !== DOWNLOADS_FOLDER_NAME) {
      for (const [, child] of Object.entries(m.folders)) {
        if (child.parentId === folderId && child.packageId) {
          delete child.packageId;
        }
      }
    }

    folder.name = newName;
    await writeSheetManifest(m);
  }

  async function deleteFolder(folderId) {
    const m = await getSheetManifest();

    if (!m.folders[folderId]) {
      throw new Error(`Folder not found: ${folderId}`);
    }

    // Collect all descendant folder IDs and sheet IDs
    const folderIds = [];
    const sheetIds = [];

    function collectDescendants(parentId) {
      for (const [id, f] of Object.entries(m.folders)) {
        if (f.parentId === parentId) {
          folderIds.push(id);
          collectDescendants(id);
        }
      }
      for (const [id, s] of Object.entries(m.sheets)) {
        if (s.folderId === parentId) {
          sheetIds.push(id);
        }
      }
    }

    collectDescendants(folderId);
    folderIds.push(folderId);

    // Cascade: any scenario pointing at a function in a deleted sheet would
    // become a broken reference, so delete those scenarios too.
    // (Note: local OPFS manifest uses `scenarioAnalyses`; the export/import zip
    // format uses `manifest.scenarios` — same data, different namespaces.)
    const removedFunctionIds = new Set();
    for (const id of sheetIds) {
      const fid = m.sheets[id]?.functionId;
      if (fid) removedFunctionIds.add(fid);
    }
    const scenariosToRemove = [];
    if (removedFunctionIds.size > 0 && m.scenarioAnalyses) {
      for (const [id, entry] of Object.entries(m.scenarioAnalyses)) {
        if (entry.functionId && removedFunctionIds.has(entry.functionId)) {
          scenariosToRemove.push(id);
        }
      }
    }

    // Delete all OPFS sheet + scenario files in parallel
    await Promise.all([
      ...sheetIds.map(id => opfsService.deleteSheet(id)),
      ...scenariosToRemove.map(id => opfsService.deleteScenarioFile(id)),
    ]);

    // Single manifest update for all sheets, folders, and scenarios
    for (const id of sheetIds) {
      delete m.sheets[id];
    }
    for (const id of folderIds) {
      delete m.folders[id];
    }
    if (m.scenarioAnalyses) {
      for (const id of scenariosToRemove) {
        delete m.scenarioAnalyses[id];
      }
    }
    await writeSheetManifest(m);
  }

  /**
   * List contents of a folder.
   * @param {string|null} folderId - Folder ID (null for root)
   * @param {Object} [options] - Filter options
   * @param {boolean} [options.publishedOnly] - Only return published sheets (with function-shaped items)
   * @returns {Promise<{folders: Array, items: Array}>}
   */
  async function listFolderContents(folderId = null, options = {}) {
    const m = await getSheetManifest();

    const folders = Object.entries(m.folders)
      .filter(([, f]) => f.parentId === folderId)
      .map(([id, f]) => ({ id, ...f }));

    if (options.publishedOnly) {
      // Return published sheets as function-shaped items
      const items = Object.entries(m.sheets)
        .filter(([, s]) => (s.folderId || null) === folderId && s.functionId && s.publishedVersion)
        .map(([, s]) => ({
          id: s.functionId,
          name: s.name,
          version: s.publishedVersion?.versionString || '1.0',
          versionId: s.publishedVersion?.versionId || null,
          sheetType: s.type || 'standard',
          description: s.description || '',
          folderId: s.folderId || null,
        }));

      return { folders, items };
    }

    // Default: return all sheets + scenarios
    const sheets = Object.entries(m.sheets)
      .filter(([, s]) => (s.folderId || null) === folderId)
      .map(([id, s]) => ({ id, ...s }));

    const scenarios = Object.entries(m.scenarioAnalyses || {})
      .filter(([, s]) => (s.folderId || null) === folderId)
      .map(([id, s]) => ({ id, ...s, type: 'scenario' }));

    return { folders, items: [...sheets, ...scenarios] };
  }

  /**
   * Update metadata fields on a sheet (name and/or description).
   * @param {string} sheetId - Sheet ID
   * @param {Object} updates - Fields to update
   * @param {string} [updates.name] - New name (will be normalized)
   * @param {string} [updates.description] - New description
   */
  async function updateSheetMetadata(sheetId, updates) {
    const m = await getSheetManifest();
    const sheet = m.sheets[sheetId];
    if (!sheet) throw new Error(`Sheet not found: ${sheetId}`);

    if (updates.name !== undefined) {
      sheet.name = normalizeSheetName(updates.name);
    }
    if (updates.description !== undefined) {
      sheet.description = updates.description;
    }
    sheet.updatedAt = new Date().toISOString();
    await writeSheetManifest(m);
  }

  /**
   * Duplicate a spreadsheet into a new sheet entry.
   * Copies draft XML content but NOT published state — the copy is a fresh draft.
   * @param {string} sourceId - Source sheet ID
   * @param {string} newName - Name for the copy
   * @param {string|null} targetFolderId - Folder to place the copy in (null for root)
   * @returns {Promise<string>} The new sheet ID
   */
  async function duplicateSpreadsheet(sourceId, newName, targetFolderId = null) {
    const sourceMeta = await getSheetMetadata(sourceId);
    if (!sourceMeta) throw new Error(`Source sheet not found: ${sourceId}`);

    // If source has no draft, use published XML instead
    let xml;
    if (sourceMeta.hasDraft === false) {
      xml = await opfsService.loadPublishedXml(sourceId);
    } else {
      xml = await opfsService.loadSheet(sourceId);
    }

    const newId = await createSpreadsheet(newName, sourceMeta.type, { folderId: targetFolderId });
    await opfsService.saveSheet(newId, xml);

    return newId;
  }

  async function moveSheetToFolder(sheetId, targetFolderId) {
    const m = await getSheetManifest();
    const sheet = m.sheets[sheetId];
    if (!sheet) throw new Error(`Sheet not found: ${sheetId}`);

    if (targetFolderId !== null && !m.folders[targetFolderId]) {
      throw new Error(`Target folder not found: ${targetFolderId}`);
    }

    sheet.folderId = targetFolderId;
    sheet.updatedAt = new Date().toISOString();
    await writeSheetManifest(m);
  }

  /**
   * Move a folder to a different parent folder.
   * @param {string} folderId - Folder ID to move
   * @param {string|null} targetFolderId - New parent folder ID (null for root)
   */
  async function moveFolderToFolder(folderId, targetFolderId) {
    const m = await getSheetManifest();
    const folder = m.folders[folderId];
    if (!folder) throw new Error(`Folder not found: ${folderId}`);

    if (targetFolderId !== null && !m.folders[targetFolderId]) {
      throw new Error(`Target folder not found: ${targetFolderId}`);
    }

    // Prevent moving a folder into itself or a descendant
    let checkId = targetFolderId;
    const visited = new Set();
    while (checkId) {
      if (checkId === folderId) {
        throw new Error('Cannot move a folder into itself or a descendant');
      }
      if (visited.has(checkId)) break; // cycle guard
      visited.add(checkId);
      checkId = m.folders[checkId]?.parentId || null;
    }

    // Clear packageId when moving out of Downloads (user is taking ownership)
    const oldParent = folder.parentId ? m.folders[folder.parentId] : null;
    if (oldParent?.name === DOWNLOADS_FOLDER_NAME && !oldParent?.parentId && folder.packageId) {
      delete folder.packageId;
    }

    folder.parentId = targetFolderId;
    await writeSheetManifest(m);
  }

  async function getFolderPath(folderId) {
    const m = await getSheetManifest();

    const path = [{ id: null, name: 'Home' }];

    if (!folderId) return path;

    const ancestors = [];
    let currentId = folderId;

    while (currentId) {
      const folder = m.folders[currentId];
      if (!folder) break;
      ancestors.unshift({ id: currentId, name: folder.name });
      currentId = folder.parentId;
    }

    return [...path, ...ancestors];
  }

  // ============================================================================
  // DOWNLOADS FOLDER OPERATIONS
  // ============================================================================

  /**
   * Ensure the root-level Downloads folder exists. Returns its ID.
   */
  async function ensureDownloadsFolder() {
    const m = await getSheetManifest();
    const existing = Object.entries(m.folders)
      .find(([, f]) => f.name === DOWNLOADS_FOLDER_NAME && !f.parentId);
    if (existing) return existing[0];
    return createFolder(DOWNLOADS_FOLDER_NAME);
  }

  /**
   * Update metadata fields on a folder.
   * @param {string} folderId
   * @param {Object} updates - Key/value pairs to merge into folder metadata
   */
  async function updateFolderMetadata(folderId, updates) {
    const m = await getSheetManifest();
    const folder = m.folders[folderId];
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    Object.assign(folder, updates);
    await writeSheetManifest(m);
  }

  /**
   * Find a folder in Downloads that has a matching packageId.
   * Note: linear scan over all folders. Fine for typical use (tens of folders).
   * If Downloads accumulates hundreds of entries, consider an index.
   * @param {string} packageId
   * @returns {Promise<{folderId: string, folder: Object}|null>}
   */
  async function findFolderByPackageId(packageId) {
    if (!packageId) return null;
    const m = await getSheetManifest();
    // Search the entire folder tree, not just Downloads — a package might be
    // imported into root (file/zip drop) or into Downloads (URL fetch).
    const match = Object.entries(m.folders)
      .find(([, f]) => f.packageId === packageId);
    if (!match) return null;
    return { folderId: match[0], folder: match[1] };
  }

  // ============================================================================
  // SCENARIO ANALYSIS MANIFEST
  // ============================================================================

  function ensureScenarioSection(m) {
    if (!m.scenarioAnalyses) m.scenarioAnalyses = {};
    return m.scenarioAnalyses;
  }

  async function createScenarioEntry(id, entry) {
    const m = await getSheetManifest();
    ensureScenarioSection(m);
    m.scenarioAnalyses[id] = entry;
    await writeSheetManifest(m);
  }

  async function getScenarioEntry(id) {
    const m = await getSheetManifest();
    return m.scenarioAnalyses?.[id] || null;
  }

  async function updateScenarioEntry(id, updates) {
    const m = await getSheetManifest();
    if (!m.scenarioAnalyses?.[id]) throw new Error(`Scenario not found: ${id}`);
    Object.assign(m.scenarioAnalyses[id], updates);
    await writeSheetManifest(m);
  }

  async function deleteScenarioEntry(id) {
    const m = await getSheetManifest();
    if (m.scenarioAnalyses) {
      delete m.scenarioAnalyses[id];
      await writeSheetManifest(m);
    }
  }

  async function deleteScenarioEntryBatch(ids) {
    if (ids.length === 0) return;
    const m = await getSheetManifest();
    if (!m.scenarioAnalyses) return;
    for (const id of ids) {
      delete m.scenarioAnalyses[id];
    }
    await writeSheetManifest(m);
  }

  async function listScenarioEntries() {
    const m = await getSheetManifest();
    return m.scenarioAnalyses || {};
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    init(deps) {
      ({
        getCanonicalSnapshot,
        getFormattingSnapshot,
        getGridBounds,
        getOutputCells,
        getOutputModes,
        getCalcSnapshot,
        getCustomFunctions,
        getSpreadsheetName,
        getTestCases,
        getInputNames,
        onDirtyChange,
        onUnpublishedChange,
        getColumnNames,
        getMaxIterations,
      } = deps);

      // Reset state (but keep opfsService - it persists)
      sheetManifest = null;
      currentSpreadsheetId = null;
      hasUnpublishedChanges = false;
      clearTimeout(autoSaveTimeout);
      clearTimeout(markUnpublishedTimeout);

    },

    // === File-based operations (original) ===
    open,
    openFolder,
    importFile,
    exportToXml,

    // === Unified sheet operations ===
    getSheetManifest,
    getSheetMetadata,
    listSheets,
    findSheetByFunctionId,
    publishSheet,
    loadPublishedVersion,

    // === OPFS-based spreadsheet operations ===
    createSpreadsheetWithId,
    createSpreadsheetBatch,
    loadSpreadsheetFromOpfs,
    renameSpreadsheet,
    deleteSpreadsheet,
    deleteSpreadsheetBatch,

    // === Published version operations ===
    savePublishedSnapshot,
    loadPublishedXml,
    hasPublishedVersion,
    discardToPublished,
    createDraftFromPublished,

    // === Function operations (published sheet state) ===
    loadFunction,
    hasFunction,
    deleteFunction,
    getFunctionMetadata,
    listFunctions,
    collectDependencyXmls,
    collectDependenciesFromXml,

    // === Auto-save ===
    markDirty,
    getCurrentSpreadsheetId,
    setCurrentSpreadsheetId,
    async saveNow() {
      if (scratchpadMode || !currentSpreadsheetId) return;
      clearTimeout(autoSaveTimeout);
      await autoSave();
    },

    // === Versioning ===
    clearUnpublished,
    replaceSpreadsheetContent,
    setLoading,

    // === Scratchpad mode ===
    setScratchpadMode,
    isScratchpadMode,
    forkScratchpadToNewSheet,

    // === Sheet metadata ===
    updateSheetMetadata,
    moveSheetToFolder,
    moveFolderToFolder,
    duplicateSpreadsheet,

    // === Folder operations ===
    createFolder,
    renameFolder,
    deleteFolder,
    listFolderContents,
    getFolderPath,

    // === Downloads folder operations ===
    ensureDownloadsFolder,
    findFolderByPackageId,
    updateFolderMetadata,

    // === Scenario analysis manifest ===
    createScenarioEntry,
    getScenarioEntry,
    updateScenarioEntry,
    deleteScenarioEntry,
    deleteScenarioEntryBatch,
    listScenarioEntries,

    // === Admin ===
    async clearAllData() {
      if (!opfsService) throw new Error('OPFS not available');
      await opfsService.clearAllData();
      sheetManifest = null;
      currentSpreadsheetId = null;
    },

    // === Late initialization ===
    setOpfsService(service) {
      opfsService = service;
      sheetManifest = null;
    },
  };
}
