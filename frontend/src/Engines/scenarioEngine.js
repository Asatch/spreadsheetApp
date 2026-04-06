/**
 * SCENARIO ENGINE
 * ===============
 *
 * Manages scenario analysis artifacts: CRUD operations via storageEngine
 * (which owns the manifest cache), and scenario data files in OPFS.
 *
 * Manifest entry (in manifest.scenarioAnalyses, managed by storageEngine):
 *   { name, functionId, functionName, createdAt, updatedAt, folderId }
 *
 * Scenario data file ({id}.json in OPFS scenarios/):
 *   { inputs: { INPUT_NAME: { category, values } }, results: null | { runs, timestamp } }
 */

import { extractSignatureFromXml } from '../utils/xmlSerializer.js';

export function createScenarioEngine() {
  let storageEngine = null;
  let opfsService = null;

  // ============================================================================
  // SCENARIO CRUD
  // ============================================================================

  async function createScenario(name, functionId, functionName, options = {}) {
    const id = 'scenario-' + crypto.randomUUID();
    const now = new Date().toISOString();

    await storageEngine.createScenarioEntry(id, {
      name,
      functionId,
      functionName,
      createdAt: now,
      updatedAt: now,
      folderId: options.folderId || null,
    });

    // Create initial data file
    await opfsService.saveScenario(id, {
      inputs: {},
      results: null,
    });

    console.log(`[ScenarioEngine] Created scenario: ${id} (${name})`);
    return id;
  }

  async function listScenarios() {
    const entries = await storageEngine.listScenarioEntries();
    return Object.entries(entries).map(([id, entry]) => ({
      id,
      ...entry,
    }));
  }

  async function getScenarioMetadata(id) {
    return await storageEngine.getScenarioEntry(id);
  }

  async function loadScenarioData(id) {
    return await opfsService.loadScenario(id);
  }

  async function saveScenarioData(id, data) {
    await opfsService.saveScenario(id, data);

    const entry = await storageEngine.getScenarioEntry(id);
    if (entry) {
      await storageEngine.updateScenarioEntry(id, {
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async function renameScenario(id, newName) {
    await storageEngine.updateScenarioEntry(id, {
      name: newName,
      updatedAt: new Date().toISOString(),
    });
  }

  async function deleteScenario(id) {
    await opfsService.deleteScenarioFile(id);
    await storageEngine.deleteScenarioEntry(id);
    console.log(`[ScenarioEngine] Deleted scenario: ${id}`);
  }

  async function deleteScenarioBatch(ids) {
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => opfsService.deleteScenarioFile(id)));
    await storageEngine.deleteScenarioEntryBatch(ids);
    console.log(`[ScenarioEngine] Batch deleted ${ids.length} scenarios`);
  }

  // ============================================================================
  // FOLDER CONTENTS (for file dialog integration)
  // ============================================================================

  async function listScenariosForFunction(functionId) {
    const entries = await storageEngine.listScenarioEntries();
    return Object.entries(entries)
      .filter(([, s]) => s.functionId === functionId)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async function listScenariosInFolder(folderId = null) {
    const entries = await storageEngine.listScenarioEntries();
    return Object.entries(entries)
      .filter(([, s]) => (s.folderId || null) === folderId)
      .map(([id, s]) => ({ id, ...s }));
  }

  async function moveScenarioToFolder(id, targetFolderId) {
    await storageEngine.updateScenarioEntry(id, {
      folderId: targetFolderId,
      updatedAt: new Date().toISOString(),
    });
  }

  // ============================================================================
  // FUNCTION LOADING
  // ============================================================================

  /**
   * Load a published function's transpiled JS and create a callable.
   * Returns { callable, signature, name } where callable accepts raw values.
   */
  async function loadPublishedFunction(functionId) {
    const sheet = await storageEngine.findSheetByFunctionId(functionId);
    if (!sheet) throw new Error(`Function not found: ${functionId}`);

    // Load published JS code
    const code = await opfsService.loadPublishedCode(sheet.id);

    // Extract function name and compile
    const publishedName = (sheet.publishedVersion?.publishedName || sheet.name).toUpperCase();
    const namePattern = new RegExp(`function\\s+(${publishedName})\\s*\\(`);
    const match = code.match(namePattern);
    const funcName = match ? match[1] : publishedName;

    const compiledFn = new Function(`${code}\nreturn ${funcName};`)();

    // Extract signature — fall back to parsing published XML if manifest lacks it.
    // Always enrich from XML for canonical/testValues (inputs) and format (outputs)
    // since the manifest snapshot may predate these fields.
    let signature = sheet.publishedVersion?.signature || null;
    if (!signature) {
      try {
        const xml = await opfsService.loadPublishedXml(sheet.id);
        signature = extractSignatureFromXml(xml);
      } catch (e) {
        console.warn(`[ScenarioEngine] Could not extract signature from XML for ${functionId}:`, e.message);
      }
    } else {
      // Enrich cached signature with data only available from XML
      const needsInputEnrichment = signature.inputs?.length && signature.inputs.some(i => i.canonical === undefined);
      const needsOutputEnrichment = signature.outputs?.length && signature.outputs.some(o => !o.format);
      if (needsInputEnrichment || needsOutputEnrichment) {
        signature = structuredClone(signature);
        try {
          const xml = await opfsService.loadPublishedXml(sheet.id);
          const extracted = extractSignatureFromXml(xml);
          if (needsInputEnrichment) {
            for (const input of signature.inputs) {
              const match = extracted.inputs?.find(i => i.name === input.name);
              if (match) {
                if (input.canonical === undefined) input.canonical = match.canonical;
                if (!input.testValues && match.testValues) input.testValues = match.testValues;
              }
            }
          }
          if (needsOutputEnrichment) {
            for (const output of signature.outputs) {
              if (!output.format) {
                const match = extracted.outputs?.find(o => o.name === output.name);
                if (match?.format) output.format = match.format;
              }
            }
          }
        } catch (e) { console.warn(`[ScenarioEngine] Signature enrichment failed for ${functionId}:`, e.message); }
      }
    }

    return {
      callable: compiledFn,
      signature,
      name: funcName,
      sheetId: sheet.id,
      sheetType: sheet.type,
    };
  }

  // ============================================================================
  // LIST PUBLISHED FUNCTIONS (for function picker)
  // ============================================================================

  async function listPublishedFunctions() {
    const sheets = await storageEngine.listSheets({ publishedOnly: true });
    return sheets.map(s => ({
      sheetId: s.id,
      functionId: s.functionId,
      name: s.publishedVersion?.publishedName || s.name,
      version: s.publishedVersion?.versionString || '1.0',
      signature: s.publishedVersion?.signature || null,
      type: s.type,
    }));
  }

  // ============================================================================
  // SHEET XML ACCESS (for writing scenarios back to spreadsheet)
  // ============================================================================

  async function getSheetMetadata(sheetId) {
    return await storageEngine.getSheetMetadata(sheetId);
  }

  async function loadSheetXml(sheetId) {
    return await opfsService.loadSheet(sheetId);
  }

  async function saveSheetXml(sheetId, xml) {
    await opfsService.saveSheet(sheetId, xml);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    setDependencies({ storageEngine: se, opfsService: ops }) {
      storageEngine = se;
      opfsService = ops;
    },

    // Scenario CRUD
    createScenario,
    listScenarios,
    getScenarioMetadata,
    loadScenarioData,
    saveScenarioData,
    renameScenario,
    deleteScenario,
    deleteScenarioBatch,

    // Folder integration
    listScenariosForFunction,
    listScenariosInFolder,
    moveScenarioToFolder,

    // Function access
    loadPublishedFunction,
    listPublishedFunctions,

    // Sheet access
    getSheetMetadata,
    loadSheetXml,
    saveSheetXml,
  };
}
