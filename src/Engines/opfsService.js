/**
 * OPFS SERVICE
 * =============
 * Low-level engine providing controlled access to Origin Private File System.
 *
 * Requires instantiation and orchestrator wiring to prevent bypassing StorageEngine.
 * Even if someone imports createOpfsService, they get an uninitialized instance
 * that won't work without calling init().
 *
 * OPFS Structure:
 *   /sc-data/
 *     sheet-manifest.json
 *     language-pack-manifest.json
 *     sheets/
 *       {sheetId}.xml                  # Draft
 *       {sheetId}.published.xml        # Published snapshot
 *       {sheetId}.published.js         # Transpiled code
 *     scenarios/
 *       {scenarioId}.json              # Scenario analysis data
 *     language-packs/
 *       {packId}.syntax.js             # Syntax object as JS source string
 *       {packId}.functions.json        # Functions data as JSON
 */

import { DEFAULT_SHEET_MANIFEST, DEFAULT_LANGUAGE_PACK_MANIFEST } from './opfsDefaults.js';

/**
 * Creates a new OPFS service instance.
 * Must be initialized via init() before use.
 */
export function createOpfsService() {
  // Directory handles - private, only usable after init()
  let rootHandle = null;
  let scDataHandle = null;
  let sheetsHandle = null;
  let scenariosHandle = null;
  let languagePacksHandle = null;

  /**
   * Initialize the OPFS service.
   * Creates directory structure if it doesn't exist.
   * @throws {Error} If OPFS is not available
   */
  async function init() {
    if (!navigator.storage?.getDirectory) {
      throw new Error('OPFS not available in this browser');
    }

    try {
      rootHandle = await navigator.storage.getDirectory();
      scDataHandle = await rootHandle.getDirectoryHandle('sc-data', { create: true });
      sheetsHandle = await scDataHandle.getDirectoryHandle('sheets', { create: true });
      scenariosHandle = await scDataHandle.getDirectoryHandle('scenarios', { create: true });
      languagePacksHandle = await scDataHandle.getDirectoryHandle('language-packs', { create: true });

    } catch (error) {
      console.error('[OpfsService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Check if service is initialized.
   * @throws {Error} If not initialized
   */
  function assertInitialized() {
    if (!scDataHandle) {
      throw new Error('[OpfsService] Not initialized. Call init() first.');
    }
  }

  // ============================================================================
  // SHEET MANIFEST
  // ============================================================================

  /**
   * Read the unified sheet manifest file.
   * @returns {Promise<Object>} The sheet manifest object
   */
  async function readSheetManifest() {
    assertInitialized();

    try {
      const fileHandle = await scDataHandle.getFileHandle('sheet-manifest.json');
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text) return { ...DEFAULT_SHEET_MANIFEST, folders: {}, sheets: {} };
      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'NotFoundError') {
        return { ...DEFAULT_SHEET_MANIFEST, folders: {}, sheets: {} };
      }
      console.error('[OpfsService] Failed to read sheet manifest:', error);
      throw error;
    }
  }

  /**
   * Write the unified sheet manifest file.
   * @param {Object} manifest - The sheet manifest object to write
   */
  async function writeSheetManifest(manifest) {
    assertInitialized();

    try {
      const fileHandle = await scDataHandle.getFileHandle('sheet-manifest.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(manifest, null, 2));
      await writable.close();
    } catch (error) {
      console.error('[OpfsService] Failed to write sheet manifest:', error);
      throw error;
    }
  }

  // ============================================================================
  // SHEET OPERATIONS
  // ============================================================================

  /**
   * Save a sheet's draft XML file.
   * @param {string} id - Sheet ID
   * @param {string} xml - XML content to save
   */
  async function saveSheet(id, xml) {
    assertInitialized();

    try {
      const fileHandle = await sheetsHandle.getFileHandle(`${id}.xml`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(xml);
      await writable.close();
    } catch (error) {
      console.error(`[OpfsService] Failed to save sheet ${id}:`, error);
      throw error;
    }
  }

  /**
   * Load a sheet's draft XML file.
   * @param {string} id - Sheet ID
   * @returns {Promise<string>} The XML content
   */
  async function loadSheet(id) {
    assertInitialized();

    try {
      const fileHandle = await sheetsHandle.getFileHandle(`${id}.xml`);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (error) {
      if (error.name === 'NotFoundError') {
        throw new Error(`Sheet not found: ${id}`);
      }
      throw error;
    }
  }

  /**
   * Delete a sheet and all its files (draft, published XML, published JS).
   * @param {string} id - Sheet ID
   */
  async function deleteSheet(id) {
    assertInitialized();

    const filesToDelete = [`${id}.xml`, `${id}.published.xml`, `${id}.published.js`];
    await Promise.all(filesToDelete.map(filename =>
      sheetsHandle.removeEntry(filename).catch(e => {
        if (e.name !== 'NotFoundError') {
          console.warn(`[OpfsService] Failed to delete ${filename}:`, e.message);
        }
      })
    ));
  }

  // ============================================================================
  // PUBLISHED VERSION OPERATIONS
  // ============================================================================

  /**
   * Save a sheet's published version (XML + JS).
   * @param {string} id - Sheet ID
   * @param {string} xml - Published XML content
   * @param {string} js - Transpiled JavaScript code
   */
  async function savePublishedVersion(id, xml, js) {
    assertInitialized();

    try {
      const xmlHandle = await sheetsHandle.getFileHandle(`${id}.published.xml`, { create: true });
      const xmlWritable = await xmlHandle.createWritable();
      await xmlWritable.write(xml);
      await xmlWritable.close();

      const jsHandle = await sheetsHandle.getFileHandle(`${id}.published.js`, { create: true });
      const jsWritable = await jsHandle.createWritable();
      await jsWritable.write(js);
      await jsWritable.close();
    } catch (error) {
      console.error(`[OpfsService] Failed to save published version ${id}:`, error);
      throw error;
    }
  }

  /**
   * Save just the published XML snapshot (without JS).
   * Used to save the pre-transpile snapshot so "discard to published" works
   * even if transpilation fails.
   * @param {string} id - Sheet ID
   * @param {string} xml - Published XML content
   */
  async function savePublishedSnapshot(id, xml) {
    assertInitialized();
    try {
      const fileHandle = await sheetsHandle.getFileHandle(`${id}.published.xml`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(xml);
      await writable.close();
    } catch (error) {
      console.error(`[OpfsService] Failed to save published snapshot ${id}:`, error);
      throw error;
    }
  }

  /**
   * Load a sheet's published XML.
   * @param {string} id - Sheet ID
   * @returns {Promise<string>} The published XML content
   */
  async function loadPublishedXml(id) {
    assertInitialized();

    try {
      const fileHandle = await sheetsHandle.getFileHandle(`${id}.published.xml`);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (error) {
      if (error.name === 'NotFoundError') {
        throw new Error(`Published XML not found for sheet: ${id}`);
      }
      throw error;
    }
  }

  /**
   * Load a sheet's published JavaScript code.
   * @param {string} id - Sheet ID
   * @returns {Promise<string>} The JavaScript code
   */
  async function loadPublishedCode(id) {
    assertInitialized();

    try {
      const fileHandle = await sheetsHandle.getFileHandle(`${id}.published.js`);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (error) {
      if (error.name === 'NotFoundError') {
        throw new Error(`Published code not found for sheet: ${id}`);
      }
      throw error;
    }
  }

  /**
   * Check if a sheet has published files.
   * @param {string} id - Sheet ID
   * @returns {Promise<boolean>}
   */
  async function hasPublishedVersion(id) {
    assertInitialized();

    try {
      await sheetsHandle.getFileHandle(`${id}.published.xml`);
      return true;
    } catch (e) {
      if (e.name === 'NotFoundError') return false;
      throw e;
    }
  }

  /**
   * Delete a sheet's published files (XML + JS), keeping the draft.
   * @param {string} id - Sheet ID
   */
  async function deletePublishedFiles(id) {
    assertInitialized();

    for (const filename of [`${id}.published.xml`, `${id}.published.js`]) {
      try {
        await sheetsHandle.removeEntry(filename);
      } catch (e) {
        if (e.name !== 'NotFoundError') {
          console.warn(`[OpfsService] Failed to delete ${filename}:`, e.message);
        }
      }
    }
  }

  // ============================================================================
  // SCENARIO OPERATIONS
  // ============================================================================

  async function saveScenario(id, data) {
    assertInitialized();
    try {
      const fileHandle = await scenariosHandle.getFileHandle(`${id}.json`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
    } catch (error) {
      console.error(`[OpfsService] Failed to save scenario ${id}:`, error);
      throw error;
    }
  }

  async function loadScenario(id) {
    assertInitialized();
    try {
      const fileHandle = await scenariosHandle.getFileHandle(`${id}.json`);
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text) throw new Error(`Scenario file empty: ${id}`);
      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'NotFoundError') {
        throw new Error(`Scenario not found: ${id}`);
      }
      throw error;
    }
  }

  async function deleteScenarioFile(id) {
    assertInitialized();
    try {
      await scenariosHandle.removeEntry(`${id}.json`);
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        console.warn(`[OpfsService] Failed to delete scenario ${id}:`, e.message);
      }
    }
  }

  // ============================================================================
  // LANGUAGE PACK OPERATIONS
  // ============================================================================

  async function readLanguagePackManifest() {
    assertInitialized();
    try {
      const fileHandle = await scDataHandle.getFileHandle('language-pack-manifest.json');
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text) return { ...DEFAULT_LANGUAGE_PACK_MANIFEST, packs: {} };
      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'NotFoundError') {
        return { ...DEFAULT_LANGUAGE_PACK_MANIFEST, packs: {} };
      }
      console.error('[OpfsService] Failed to read language pack manifest:', error);
      throw error;
    }
  }

  async function writeLanguagePackManifest(manifest) {
    assertInitialized();
    try {
      const fileHandle = await scDataHandle.getFileHandle('language-pack-manifest.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(manifest, null, 2));
      await writable.close();
    } catch (error) {
      console.error('[OpfsService] Failed to write language pack manifest:', error);
      throw error;
    }
  }

  async function saveLanguagePackFile(packId, suffix, content) {
    assertInitialized();
    try {
      const fileHandle = await languagePacksHandle.getFileHandle(`${packId}.${suffix}`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (error) {
      console.error(`[OpfsService] Failed to save language pack file ${packId}.${suffix}:`, error);
      throw error;
    }
  }

  async function loadLanguagePackFile(packId, suffix) {
    assertInitialized();
    try {
      const fileHandle = await languagePacksHandle.getFileHandle(`${packId}.${suffix}`);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (error) {
      if (error.name === 'NotFoundError') {
        throw new Error(`Language pack file not found: ${packId}.${suffix}`);
      }
      throw error;
    }
  }

  async function deleteLanguagePackFiles(packId) {
    assertInitialized();
    for (const suffix of ['syntax.js', 'functions.json', 'overrides.js']) {
      try {
        await languagePacksHandle.removeEntry(`${packId}.${suffix}`);
      } catch (e) {
        if (e.name !== 'NotFoundError') {
          console.warn(`[OpfsService] Failed to delete ${packId}.${suffix}:`, e.message);
        }
      }
    }
  }

  // ============================================================================
  // ADMIN
  // ============================================================================

  /**
   * Delete all OPFS data (sc-data directory) and re-initialize.
   */
  async function clearAllData() {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('sc-data', { recursive: true });
    // Re-initialize empty directories
    scDataHandle = await root.getDirectoryHandle('sc-data', { create: true });
    sheetsHandle = await scDataHandle.getDirectoryHandle('sheets', { create: true });
    scenariosHandle = await scDataHandle.getDirectoryHandle('scenarios', { create: true });
    languagePacksHandle = await scDataHandle.getDirectoryHandle('language-packs', { create: true });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    init,

    // Sheet manifest
    readSheetManifest,
    writeSheetManifest,

    // Sheet operations
    saveSheet,
    loadSheet,
    deleteSheet,

    // Published version operations
    savePublishedVersion,
    savePublishedSnapshot,
    loadPublishedXml,
    loadPublishedCode,
    hasPublishedVersion,
    deletePublishedFiles,

    // Scenario operations
    saveScenario,
    loadScenario,
    deleteScenarioFile,

    // Language pack operations
    readLanguagePackManifest,
    writeLanguagePackManifest,
    saveLanguagePackFile,
    loadLanguagePackFile,
    deleteLanguagePackFiles,

    // Admin
    clearAllData,
  };
}
