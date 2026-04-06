/**
 * MEMORY OPFS SERVICE
 * ====================
 * In-memory implementation of the opfsService interface.
 * Used in viewer mode where real OPFS is unavailable (file:// protocol).
 *
 * Provides the same API as opfsService.js, backed by Maps.
 * Write methods work (needed for population and scratchpad edits).
 * Destructive admin operations are no-ops.
 */

/**
 * Creates a new in-memory OPFS service instance.
 * Ready to use immediately — no init() required.
 * @returns {Object} Same interface as createOpfsService()
 */
export function createMemoryOpfsService() {
  const DEFAULT_SHEET_MANIFEST = {
    version: '3.0',
    folders: {},
    sheets: {},
    scenarioAnalyses: {}
  };

  const DEFAULT_LANGUAGE_PACK_MANIFEST = {
    version: '1.0',
    packs: {}
  };

  // In-memory storage
  let manifest = { ...DEFAULT_SHEET_MANIFEST };
  let langPackManifest = { ...DEFAULT_LANGUAGE_PACK_MANIFEST };
  const sheets = new Map();         // id -> xml string
  const publishedXml = new Map();   // id -> xml string
  const publishedJs = new Map();    // id -> js string
  const scenarios = new Map();      // id -> data object
  const langPackFiles = new Map();  // "packId.suffix" -> content string

  // ============================================================================
  // INIT (no-op — no filesystem to initialize)
  // ============================================================================

  async function init() {
    // No-op: memory storage is ready immediately
  }

  // ============================================================================
  // SHEET MANIFEST
  // ============================================================================

  async function readSheetManifest() {
    return manifest;
  }

  async function writeSheetManifest(m) {
    manifest = m;
  }

  // ============================================================================
  // SHEET OPERATIONS
  // ============================================================================

  async function saveSheet(id, xml) {
    sheets.set(id, xml);
  }

  async function loadSheet(id) {
    const xml = sheets.get(id);
    if (xml === undefined) {
      throw new Error(`Sheet not found: ${id}`);
    }
    return xml;
  }

  async function deleteSheet(id) {
    sheets.delete(id);
  }

  // ============================================================================
  // PUBLISHED VERSION OPERATIONS
  // ============================================================================

  async function savePublishedVersion(id, xml, js) {
    publishedXml.set(id, xml);
    publishedJs.set(id, js);
  }

  async function savePublishedSnapshot(id, xml) {
    publishedXml.set(id, xml);
  }

  async function loadPublishedXml(id) {
    const xml = publishedXml.get(id);
    if (xml === undefined) {
      throw new Error(`Published XML not found for sheet: ${id}`);
    }
    return xml;
  }

  async function loadPublishedCode(id) {
    const js = publishedJs.get(id);
    if (js === undefined) {
      throw new Error(`Published code not found for sheet: ${id}`);
    }
    return js;
  }

  async function hasPublishedVersion(id) {
    return publishedXml.has(id);
  }

  async function deletePublishedFiles(/* id */) {
    // No-op in viewer mode
  }

  // ============================================================================
  // SCENARIO OPERATIONS
  // ============================================================================

  async function saveScenario(id, data) {
    scenarios.set(id, data);
  }

  async function loadScenario(id) {
    const data = scenarios.get(id);
    if (data === undefined) {
      throw new Error(`Scenario not found: ${id}`);
    }
    return data;
  }

  async function deleteScenarioFile(/* id */) {
    // No-op in viewer mode
  }

  // ============================================================================
  // LANGUAGE PACK OPERATIONS
  // ============================================================================

  async function readLanguagePackManifest() {
    return langPackManifest;
  }

  async function writeLanguagePackManifest(m) {
    langPackManifest = m;
  }

  async function saveLanguagePackFile(packId, suffix, content) {
    langPackFiles.set(`${packId}.${suffix}`, content);
  }

  async function loadLanguagePackFile(packId, suffix) {
    const key = `${packId}.${suffix}`;
    const content = langPackFiles.get(key);
    if (content === undefined) {
      throw new Error(`Language pack file not found: ${key}`);
    }
    return content;
  }

  async function deleteLanguagePackFiles(packId) {
    for (const key of langPackFiles.keys()) {
      if (key.startsWith(`${packId}.`)) {
        langPackFiles.delete(key);
      }
    }
  }

  // ============================================================================
  // ADMIN
  // ============================================================================

  async function clearAllData() {
    // No-op in viewer mode
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
    clearAllData
  };
}
