/**
 * SERVER OPFS SERVICE
 * ====================
 * Storage implementation that persists data via a local HTTP server.
 * Used in disk-persistence mode where a Python server provides /persist/ endpoints.
 *
 * Provides the same API as opfsService.js and memoryOpfsService.js.
 *
 * Server file layout (mirrors OPFS structure):
 *   persist/
 *     sheet-manifest.json
 *     language-pack-manifest.json
 *     sheets/
 *       {sheetId}.xml
 *       {sheetId}.published.xml
 *       {sheetId}.published.js
 *     scenarios/
 *       {scenarioId}.json
 *     language-packs/
 *       {packId}.syntax.js
 *       {packId}.functions.json
 */

import { DEFAULT_SHEET_MANIFEST, DEFAULT_LANGUAGE_PACK_MANIFEST } from './opfsDefaults.js';

const BASE = '/persist';

/**
 * Creates a new server-backed storage service instance.
 * @returns {Object} Same interface as createOpfsService()
 */
export function createServerOpfsService() {
  // ── Helpers ──────────────────────────────────────────────────────────────

  async function readJSON(path, fallback) {
    const res = await fetch(`${BASE}/${path}`);
    if (!res.ok) return { ...fallback };
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { ...fallback }; }
  }

  async function writeFile(path, content) {
    const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const res = await fetch(`${BASE}/${path}`, {
      method: 'PUT',
      body
    });
    if (!res.ok) throw new Error(`Server write failed: ${path} (${res.status})`);
  }

  async function readText(path) {
    const res = await fetch(`${BASE}/${path}`);
    if (!res.ok) throw new Error(`Not found: ${path}`);
    return await res.text();
  }

  async function deleteFile(path) {
    await fetch(`${BASE}/${path}`, { method: 'DELETE' });
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    // No-op: server is already running, persist/ already exists
  }

  // ── Sheet Manifest ───────────────────────────────────────────────────────

  async function readSheetManifest() {
    return readJSON('sheet-manifest.json', DEFAULT_SHEET_MANIFEST);
  }

  async function writeSheetManifest(manifest) {
    await writeFile('sheet-manifest.json', manifest);
  }

  // ── Sheet Operations ─────────────────────────────────────────────────────

  async function saveSheet(id, xml) {
    await writeFile(`sheets/${id}.xml`, xml);
  }

  async function loadSheet(id) {
    return readText(`sheets/${id}.xml`);
  }

  async function deleteSheet(id) {
    await deleteFile(`sheets/${id}.xml`);
  }

  // ── Published Version Operations ─────────────────────────────────────────

  async function savePublishedVersion(id, xml, js) {
    await Promise.all([
      writeFile(`sheets/${id}.published.xml`, xml),
      writeFile(`sheets/${id}.published.js`, js)
    ]);
  }

  async function savePublishedSnapshot(id, xml) {
    await writeFile(`sheets/${id}.published.xml`, xml);
  }

  async function loadPublishedXml(id) {
    return readText(`sheets/${id}.published.xml`);
  }

  async function loadPublishedCode(id) {
    return readText(`sheets/${id}.published.js`);
  }

  async function hasPublishedVersion(id) {
    const res = await fetch(`${BASE}/sheets/${id}.published.xml`);
    return res.ok;
  }

  async function deletePublishedFiles(id) {
    await Promise.all([
      deleteFile(`sheets/${id}.published.xml`),
      deleteFile(`sheets/${id}.published.js`)
    ]);
  }

  // ── Scenario Operations ──────────────────────────────────────────────────

  async function saveScenario(id, data) {
    await writeFile(`scenarios/${id}.json`, data);
  }

  async function loadScenario(id) {
    const text = await readText(`scenarios/${id}.json`);
    return JSON.parse(text);
  }

  async function deleteScenarioFile(id) {
    await deleteFile(`scenarios/${id}.json`);
  }

  // ── Language Pack Operations ─────────────────────────────────────────────

  async function readLanguagePackManifest() {
    return readJSON('language-pack-manifest.json', DEFAULT_LANGUAGE_PACK_MANIFEST);
  }

  async function writeLanguagePackManifest(manifest) {
    await writeFile('language-pack-manifest.json', manifest);
  }

  async function saveLanguagePackFile(packId, suffix, content) {
    await writeFile(`language-packs/${packId}.${suffix}`, content);
  }

  async function loadLanguagePackFile(packId, suffix) {
    return readText(`language-packs/${packId}.${suffix}`);
  }

  async function deleteLanguagePackFiles(packId) {
    const suffixes = ['syntax.js', 'functions.json', 'overrides.js'];
    await Promise.all(suffixes.map(s => deleteFile(`language-packs/${packId}.${s}`)));
  }

  async function clearAllData() {
    const res = await fetch(BASE + '/');
    if (!res.ok) return;
    const files = await res.json();
    await Promise.all(files.map(deleteFile));
  }

  // ── Public API ───────────────────────────────────────────────────────────

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
