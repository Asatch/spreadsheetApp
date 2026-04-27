/**
 * @file Export Packager
 * @description Creates zip packages from selected sheets.
 * Collects files from OPFS, builds a manifest, and triggers download.
 */

import JSZip from 'jszip';

/**
 * Expand a set of sheet IDs to include all transitive dependency sheets.
 * Parses each sheet's draft XML for CustomFunctions references, resolves
 * each functionId to a sheetId, and recurses into those sheets.
 * @param {Set<string>} sheetIds - User-selected sheet IDs
 * @param {Object} storageEngine - Storage engine instance
 * @param {Object} opfsService - OPFS service instance
 * @returns {Promise<Set<string>>} Expanded set including dependency sheets
 */
async function collectTransitiveDependencySheetIds(sheetIds, storageEngine, opfsService) {
  const allSheetIds = new Set(sheetIds);
  const visitedFunctionIds = new Set();
  let sheetsToScan = [...sheetIds];

  while (sheetsToScan.length > 0) {
    // Load and scan current batch in parallel
    const results = await Promise.all(sheetsToScan.map(async (sheetId) => {
      let xml;
      try {
        xml = await opfsService.loadSheet(sheetId);
      } catch {
        try {
          xml = await opfsService.loadPublishedXml(sheetId);
        } catch (e2) {
          console.warn(`[ExportPackager] Failed to load sheet ${sheetId} for dependency scan, skipping:`, e2.message);
          return [];
        }
      }

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, 'text/xml');

      return Array.from(xmlDoc.querySelectorAll('CustomFunctions > Function'))
        .map(func => func.getAttribute('id'))
        .filter(Boolean);
    }));

    // Collect new function IDs, resolve to sheets, queue new discoveries
    const newFunctionIds = results.flat().filter(id => !visitedFunctionIds.has(id));
    for (const id of newFunctionIds) visitedFunctionIds.add(id);

    // Resolve function IDs to sheet IDs in parallel
    const depSheets = await Promise.all(newFunctionIds.map(async (functionId) => {
      const depSheet = await storageEngine.findSheetByFunctionId(functionId);
      if (!depSheet) {
        console.warn(`[ExportPackager] Dependency function ${functionId} not found locally, skipping`);
        return null;
      }
      return depSheet;
    }));

    sheetsToScan = [];
    for (const depSheet of depSheets) {
      if (depSheet && !allSheetIds.has(depSheet.id)) {
        allSheetIds.add(depSheet.id);
        sheetsToScan.push(depSheet.id);
      }
    }
  }

  return allSheetIds;
}

/**
 * Create an export package from selected sheets.
 * Automatically includes transitive dependency sheets.
 * @param {Object} options - Export options
 * @param {Set<string>} options.sheetIds - Selected sheet IDs
 * @param {Object} options.storageEngine - Storage engine instance
 * @param {Object} options.opfsService - OPFS service instance
 * @param {string} [options.entrySheetId] - Sheet to open first on import (file menu export only)
 * @returns {Promise<Blob>} The zip file as a Blob
 */
export async function createExportPackage({
  sheetIds,
  storageEngine,
  opfsService,
  entrySheetId,
}) {
  const expandedSheetIds = await collectTransitiveDependencySheetIds(
    sheetIds, storageEngine, opfsService
  );

  const zip = new JSZip();

  // Build manifest (v2.1: optional scenarios section)
  const manifest = {
    version: '2.1',
    exportedAt: new Date().toISOString(),
    ...(entrySheetId ? { entrySheetId } : {}),
    folders: {},
    sheets: {}
  };

  // Get unified sheet manifest for folder info
  const sheetManifest = await storageEngine.getSheetManifest();

  // Compute which sheets are dependency-only (not user-selected)
  const dependencyOnlyIds = new Set(
    [...expandedSheetIds].filter(id => !sheetIds.has(id))
  );

  // Collect folders needed for selected items
  const neededFolders = new Set();

  // Process sheets in parallel (each reads from distinct OPFS files)
  const sheetsFolder = zip.folder('sheets');

  await Promise.all([...expandedSheetIds].map(async (id) => {
    const metadata = sheetManifest.sheets[id];
    if (!metadata) return;

    const isDependencyOnly = dependencyOnlyIds.has(id);
    const isPublished = metadata.functionId && metadata.publishedVersion;
    const hasDraft = metadata.hasDraft !== false;

    if (isDependencyOnly && isPublished) {
      // Dependency-only published sheet: export only published files, no draft
      let hasPublishedFiles = false;
      try {
        const publishedXml = await opfsService.loadPublishedXml(id);
        sheetsFolder.file(`${id}.published.xml`, publishedXml);
        hasPublishedFiles = true;
      } catch (e) {
        console.warn(`[ExportPackager] Failed to load published XML for dependency ${id}:`, e.message);
      }

      try {
        const publishedJs = await opfsService.loadPublishedCode(id);
        sheetsFolder.file(`${id}.published.js`, publishedJs);
      } catch (e) {
        console.warn(`[ExportPackager] Failed to load published JS for dependency ${id}:`, e.message);
      }

      if (hasPublishedFiles) {
        manifest.sheets[id] = {
          name: metadata.name,
          description: metadata.description || '',
          type: metadata.type || 'standard',
          folderId: metadata.folderId || null,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          functionId: metadata.functionId || null,
          publishedVersion: metadata.publishedVersion || null,
          hasUnpublishedChanges: false,
          hasDraft: false
        };
        if (metadata.folderId) {
          collectFolderChain(metadata.folderId, sheetManifest.folders, neededFolders);
        }
      }
    } else if (isDependencyOnly && !isPublished) {
      // Unpublished dependency — shouldn't normally happen, fall through to full export
      console.warn(`[ExportPackager] Dependency sheet ${id} (${metadata.name}) is not published — exporting with draft`);
      // Fall through handled below with the same logic as user-selected
      await exportSheetFull(id, metadata, hasDraft, sheetsFolder, manifest, sheetManifest, neededFolders, opfsService);
    } else {
      // User-selected sheet: full export
      await exportSheetFull(id, metadata, hasDraft, sheetsFolder, manifest, sheetManifest, neededFolders, opfsService);
    }
  }));

  // Add folders to manifest
  for (const folderId of neededFolders) {
    const folder = sheetManifest.folders[folderId];
    if (folder) {
      manifest.folders[folderId] = {
        name: folder.name,
        parentId: folder.parentId || null,
      };
    }
  }

  // Bundle any scenario analyses targeting functions in this export.
  // Scenarios are keyed by functionId, so we collect the functionIds of all
  // exported sheets and pull matching scenarios from the manifest + OPFS.
  const exportedFunctionIds = new Set();
  for (const id of expandedSheetIds) {
    const fid = sheetManifest.sheets[id]?.functionId;
    if (fid) exportedFunctionIds.add(fid);
  }

  const allScenarios = await storageEngine.listScenarioEntries();
  // Sort by id so manifest output is deterministic regardless of Promise.all timing.
  const scenariosToBundle = Object.entries(allScenarios)
    .filter(([, meta]) => meta.functionId && exportedFunctionIds.has(meta.functionId))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  if (scenariosToBundle.length > 0) {
    // Load all data in parallel, then add to zip + manifest sequentially in
    // sorted order. Avoids creating an empty `scenarios/` folder entry when
    // every load fails.
    const loaded = await Promise.all(scenariosToBundle.map(async ([scenarioId, meta]) => {
      try {
        const data = await opfsService.loadScenario(scenarioId);
        return { scenarioId, meta, data };
      } catch (e) {
        console.warn(`[ExportPackager] Failed to load scenario ${scenarioId}, skipping:`, e.message);
        return null;
      }
    }));

    const successful = loaded.filter(Boolean);
    if (successful.length > 0) {
      manifest.scenarios = {};
      for (const { scenarioId, meta, data } of successful) {
        zip.file(`scenarios/${scenarioId}.json`, JSON.stringify(data, null, 2));
        manifest.scenarios[scenarioId] = {
          name: meta.name,
          functionId: meta.functionId,
          functionName: meta.functionName,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          folderId: meta.folderId || null,
        };
      }
    }
  }

  // Add manifest to zip
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Generate zip
  const blob = await zip.generateAsync({ type: 'blob' });

  return blob;
}

/**
 * Export a sheet with full draft + published files.
 * Extracted to avoid duplication between user-selected and unpublished-dependency paths.
 */
async function exportSheetFull(id, metadata, hasDraft, sheetsFolder, manifest, sheetManifest, neededFolders, opfsService) {
  // Load draft XML — for draftless sheets, fall back to published XML
  let xml = null;
  if (hasDraft) {
    try {
      xml = await opfsService.loadSheet(id);
    } catch (e) {
      console.warn(`[ExportPackager] Failed to load draft for ${id}:`, e.message);
    }
  }

  if (!xml) {
    // No draft available — try published XML as fallback
    try {
      xml = await opfsService.loadPublishedXml(id);
    } catch (e) {
      console.warn(`[ExportPackager] Failed to load any XML for ${id}, skipping:`, e.message);
      return;
    }
  }

  if (hasDraft) {
    sheetsFolder.file(`${id}.xml`, xml);
  }

  manifest.sheets[id] = {
    name: metadata.name,
    description: metadata.description || '',
    type: metadata.type || 'standard',
    folderId: metadata.folderId || null,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    functionId: metadata.functionId || null,
    publishedVersion: metadata.publishedVersion || null,
    hasUnpublishedChanges: metadata.hasUnpublishedChanges || false,
    hasDraft
  };

  if (metadata.folderId) {
    collectFolderChain(metadata.folderId, sheetManifest.folders, neededFolders);
  }

  // Add published files if they exist
  if (metadata.functionId && metadata.publishedVersion) {
    try {
      const publishedXml = await opfsService.loadPublishedXml(id);
      sheetsFolder.file(`${id}.published.xml`, publishedXml);
    } catch (e) {
      console.warn(`[ExportPackager] Failed to load published XML for ${id}:`, e.message);
    }

    try {
      const publishedJs = await opfsService.loadPublishedCode(id);
      sheetsFolder.file(`${id}.published.js`, publishedJs);
    } catch (e) {
      console.warn(`[ExportPackager] Failed to load published JS for ${id}:`, e.message);
    }
  }
}

/**
 * Collect a folder and all its ancestors.
 * @param {string} folderId - Starting folder ID
 * @param {Object} folders - Folders map from manifest
 * @param {Set<string>} collected - Set to add folder IDs to
 */
function collectFolderChain(folderId, folders, collected) {
  let currentId = folderId;
  while (currentId) {
    collected.add(currentId);
    const folder = folders[currentId];
    currentId = folder?.parentId || null;
  }
}

/**
 * Trigger download of a blob as a file.
 * @param {Blob} blob - The file content
 * @param {string} filename - The filename to save as
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a filename for the export.
 * @param {number} sheetCount - Number of sheets
 * @returns {string} Filename
 */
export function generateExportFilename(sheetCount) {
  const date = new Date().toISOString().split('T')[0];
  if (sheetCount === 1) {
    return `sc-sheet-${date}.zip`;
  }
  return `sc-sheets-${date}.zip`;
}
