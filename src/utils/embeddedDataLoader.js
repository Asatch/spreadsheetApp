/**
 * @file Embedded Data Loader
 * @description Reads embedded data from a hidden div in the HTML,
 * decodes and unzips it, then populates a memoryOpfsService with the contents.
 *
 * The embedded data is a base64-encoded zip file containing:
 * - manifest.json (v2.0 export format)
 * - sheets/{id}.xml
 * - sheets/{id}.published.xml
 * - sheets/{id}.published.js
 */

import JSZip from 'jszip';

/**
 * Extract function IDs from <CustomFunctions><Function id="..."> elements in XML.
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

/**
 * Load embedded data from the HTML and populate a memory OPFS service.
 *
 * @param {Object} memoryOpfs - A memoryOpfsService instance
 * @returns {Promise<{entrySheetId: string|null, entrySheetType: string}>}
 */
export async function loadEmbeddedData(memoryOpfs) {
  const dataEl = document.getElementById('sc-embedded-data');
  const base64Content = dataEl?.textContent?.trim();

  if (!base64Content) {
    console.warn('[EmbeddedDataLoader] No embedded data found');
    return { entrySheetId: null, entrySheetType: 'standard' };
  }

  // Decode base64 to binary
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Unzip
  const zip = await JSZip.loadAsync(bytes);

  // Parse manifest
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Embedded data missing manifest.json');
  }
  const manifest = JSON.parse(await manifestFile.async('string'));

  // Populate memory OPFS with sheet files, tracking XML per sheet for dependency extraction
  const sheetXmls = new Map();

  await Promise.all(Object.entries(manifest.sheets || {}).map(async ([id, meta]) => {
    const hasDraft = meta.hasDraft !== false;

    // Load draft XML
    if (hasDraft) {
      const draftFile = zip.file(`sheets/${id}.xml`);
      if (draftFile) {
        const xml = await draftFile.async('string');
        await memoryOpfs.saveSheet(id, xml);
        sheetXmls.set(id, xml);
      }
    }

    // Load published XML
    const pubXmlFile = zip.file(`sheets/${id}.published.xml`);
    if (pubXmlFile) {
      const pubXml = await pubXmlFile.async('string');
      const pubJsFile = zip.file(`sheets/${id}.published.js`);
      if (pubJsFile) {
        await memoryOpfs.savePublishedVersion(id, pubXml, await pubJsFile.async('string'));
      } else {
        await memoryOpfs.savePublishedSnapshot(id, pubXml);
      }

      // In viewer mode, published-only sheets have no draft XML.
      // Use the published XML as the draft so they're openable.
      if (!hasDraft) {
        await memoryOpfs.saveSheet(id, pubXml);
        meta.hasDraft = true;
      }

      // Use published XML for dependency extraction if no draft was loaded
      if (!sheetXmls.has(id)) {
        sheetXmls.set(id, pubXml);
      }
    }
  }));

  // Translate v2.0 export manifest to v3.0 OPFS manifest format
  const opfsManifest = {
    version: '3.0',
    folders: manifest.folders || {},
    sheets: {},
    scenarioAnalyses: {},
    entrySheetId: manifest.entrySheetId || null,
  };

  for (const [id, meta] of Object.entries(manifest.sheets || {})) {
    opfsManifest.sheets[id] = {
      name: meta.name,
      description: meta.description || '',
      type: meta.type || 'standard',
      folderId: meta.folderId || null,
      createdAt: meta.createdAt || new Date().toISOString(),
      updatedAt: meta.updatedAt || new Date().toISOString(),
      functionId: meta.functionId || null,
      publishedVersion: meta.publishedVersion || null,
      hasDraft: meta.hasDraft !== false,
      hasUnpublishedChanges: meta.hasUnpublishedChanges || false,
      dependencies: meta.dependencies || extractDependencyIds(sheetXmls.get(id) || ''),
    };
  }

  await memoryOpfs.writeSheetManifest(opfsManifest);

  const entrySheetId = manifest.entrySheetId || null;
  const entrySheetType = entrySheetId
    ? (manifest.sheets[entrySheetId]?.type || 'standard')
    : 'standard';

  return { entrySheetId, entrySheetType };
}
