/**
 * Tests for exportPackager.js and round-trip with importPackager.js
 * Verifies export creates valid zip packages that import can parse back correctly.
 */

import { createExportPackage, generateExportFilename } from '../../utils/exportPackager.js';
import { parseImportZip } from '../../utils/importPackager.js';
import { vi } from 'vitest';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a minimal XML string for testing.
 */
function buildXml({ name, functionId, sheetType = 'standard', customFunctions = [] }) {
  const attrs = [`name="${name}"`, `sheetType="${sheetType}"`];
  if (functionId) attrs.push(`functionId="${functionId}"`);

  const cfBlock = customFunctions.length > 0
    ? `<CustomFunctions>${customFunctions.map(f =>
        `<Function id="${f.id}" name="${f.name}" versionId="v1" version="1.0"/>`
      ).join('')}</CustomFunctions>`
    : '';

  return `<CodeCalculation ${attrs.join(' ')}>${cfBlock}<Node node_id="1" data_type="Number" node_type="constant" canonical="42"/></CodeCalculation>`;
}

/**
 * Create mock storageEngine and opfsService that serve from a sheets config object.
 */
function createMocks(sheetsConfig, foldersConfig = {}) {
  const storageEngine = {
    getSheetManifest: vi.fn(async () => {
      const sheets = {};
      for (const [id, config] of Object.entries(sheetsConfig)) {
        sheets[id] = {
          ...config.metadata,
          hasDraft: config.draftXml !== null
        };
      }
      return { sheets, folders: foldersConfig };
    }),
    findSheetByFunctionId: vi.fn(async (funcId) => {
      for (const [id, config] of Object.entries(sheetsConfig)) {
        if (config.metadata.functionId === funcId) {
          return { id };
        }
      }
      return null;
    })
  };

  const opfsService = {
    loadSheet: vi.fn(async (id) => {
      const config = sheetsConfig[id];
      if (!config?.draftXml) throw new Error(`No draft for ${id}`);
      return config.draftXml;
    }),
    loadPublishedXml: vi.fn(async (id) => {
      const config = sheetsConfig[id];
      if (!config?.publishedXml) throw new Error(`No published XML for ${id}`);
      return config.publishedXml;
    }),
    loadPublishedCode: vi.fn(async (id) => {
      const config = sheetsConfig[id];
      if (!config?.publishedJs) throw new Error(`No published JS for ${id}`);
      return config.publishedJs;
    })
  };

  return { storageEngine, opfsService };
}

/** Export and re-import, returning the parsed importData */
async function roundTrip(sheetsConfig, foldersConfig, exportOpts = {}) {
  const { storageEngine, opfsService } = createMocks(sheetsConfig, foldersConfig);
  const sheetIds = new Set(Object.keys(sheetsConfig).filter(
    id => !exportOpts.excludeFromSelection?.has(id)
  ));

  const blob = await createExportPackage({
    sheetIds,
    storageEngine,
    opfsService,
    ...exportOpts
  });

  return parseImportZip(blob);
}

// ============================================================================
// ROUND-TRIP TESTS: export → import parse
// ============================================================================

describe('export → import round-trip', () => {
  test('simple draft-only sheet: all manifest fields and content preserved', async () => {
    const xml = buildXml({ name: 'MySheet' });

    const importData = await roundTrip({
      'sheet-1': {
        metadata: {
          name: 'MySheet',
          description: 'A test sheet',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: xml,
        publishedXml: null,
        publishedJs: null
      }
    });

    // Top-level manifest fields
    expect(importData.manifest.version).toBe('2.0');
    expect(importData.manifest.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(importData.manifest.folders).toEqual({});
    expect(importData.manifest.entrySheetId).toBeUndefined();

    // All per-sheet manifest fields
    expect(importData.manifest.sheets['sheet-1']).toEqual({
      name: 'MySheet',
      description: 'A test sheet',
      type: 'standard',
      folderId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      functionId: null,
      publishedVersion: null,
      hasUnpublishedChanges: false,
      hasDraft: true
    });

    // File content
    expect(importData.sheets['sheet-1'].xml).toBe(xml);
    expect(importData.sheets['sheet-1'].publishedXml).toBeNull();
    expect(importData.sheets['sheet-1'].publishedJs).toBeNull();
  });

  test('published function: all fields including publishedVersion preserved', async () => {
    const draftXml = buildXml({ name: 'MY_FUNC', functionId: 'func-1' });
    const publishedXml = buildXml({ name: 'MY_FUNC', functionId: 'func-1' });
    const publishedJs = 'function MY_FUNC(inputs) { return { OUT: 42 }; }';

    const importData = await roundTrip({
      'sheet-1': {
        metadata: {
          name: 'MY_FUNC',
          description: 'A published function',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: 'func-1',
          publishedVersion: { versionId: 'v1', versionString: '1.0', publishedAt: '2025-01-01T12:00:00Z' },
          hasUnpublishedChanges: true
        },
        draftXml,
        publishedXml,
        publishedJs
      }
    });

    // All manifest fields including function-specific ones
    expect(importData.manifest.sheets['sheet-1']).toEqual({
      name: 'MY_FUNC',
      description: 'A published function',
      type: 'standard',
      folderId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      functionId: 'func-1',
      publishedVersion: { versionId: 'v1', versionString: '1.0', publishedAt: '2025-01-01T12:00:00Z' },
      hasUnpublishedChanges: true,
      hasDraft: true
    });

    // All three file types preserved
    expect(importData.sheets['sheet-1'].xml).toBe(draftXml);
    expect(importData.sheets['sheet-1'].publishedXml).toBe(publishedXml);
    expect(importData.sheets['sheet-1'].publishedJs).toBe(publishedJs);
  });

  test('transitive dependency: auto-included as published-only with correct fields', async () => {
    const mainXml = buildXml({
      name: 'Main',
      customFunctions: [{ id: 'func-dep', name: 'DEP_FUNC' }]
    });
    const depPublishedXml = buildXml({ name: 'DEP_FUNC', functionId: 'func-dep' });
    const depPublishedJs = 'function DEP_FUNC() { return { OUT: 1 }; }';

    const { storageEngine, opfsService } = createMocks({
      'sheet-1': {
        metadata: {
          name: 'Main',
          description: '',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: mainXml,
        publishedXml: null,
        publishedJs: null
      },
      'sheet-dep': {
        metadata: {
          name: 'DEP_FUNC',
          description: 'A dependency',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: 'func-dep',
          publishedVersion: { versionId: 'v1', versionString: '1.0' },
          hasUnpublishedChanges: false
        },
        draftXml: depPublishedXml,
        publishedXml: depPublishedXml,
        publishedJs: depPublishedJs
      }
    });

    // Only select sheet-1 — sheet-dep should be auto-included as dependency
    const blob = await createExportPackage({
      sheetIds: new Set(['sheet-1']),
      storageEngine,
      opfsService
    });

    const importData = await parseImportZip(blob);

    // Main sheet: full export with draft
    expect(importData.manifest.sheets['sheet-1']).toEqual({
      name: 'Main',
      description: '',
      type: 'standard',
      folderId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      functionId: null,
      publishedVersion: null,
      hasUnpublishedChanges: false,
      hasDraft: true
    });
    expect(importData.sheets['sheet-1'].xml).toBe(mainXml);

    // Dependency sheet: published-only (hasDraft: false, hasUnpublishedChanges: false)
    expect(importData.manifest.sheets['sheet-dep']).toEqual({
      name: 'DEP_FUNC',
      description: 'A dependency',
      type: 'standard',
      folderId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      functionId: 'func-dep',
      publishedVersion: { versionId: 'v1', versionString: '1.0' },
      hasUnpublishedChanges: false,
      hasDraft: false
    });
    expect(importData.sheets['sheet-dep'].xml).toBeNull();
    expect(importData.sheets['sheet-dep'].publishedXml).toBe(depPublishedXml);
    expect(importData.sheets['sheet-dep'].publishedJs).toBe(depPublishedJs);
  });

  test('folder hierarchy: chain collected and folder fields preserved', async () => {
    const xml = buildXml({ name: 'NestedSheet' });

    const folders = {
      'folder-root': { name: 'Root', parentId: null },
      'folder-child': { name: 'Child', parentId: 'folder-root' }
    };

    const importData = await roundTrip(
      {
        'sheet-1': {
          metadata: {
            name: 'NestedSheet',
            description: '',
            type: 'standard',
            folderId: 'folder-child',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            functionId: null,
            publishedVersion: null,
            hasUnpublishedChanges: false,
            dependencies: []
          },
          draftXml: xml,
          publishedXml: null,
          publishedJs: null
        }
      },
      folders
    );

    // Both folders included (child + its parent ancestor)
    expect(importData.manifest.folders['folder-root']).toEqual({ name: 'Root', parentId: null });
    expect(importData.manifest.folders['folder-child']).toEqual({ name: 'Child', parentId: 'folder-root' });

    // Sheet references the correct folder
    expect(importData.manifest.sheets['sheet-1'].folderId).toBe('folder-child');
  });

  test('entrySheetId included in manifest when provided', async () => {
    const xml = buildXml({ name: 'Entry' });

    const importData = await roundTrip({
      'sheet-1': {
        metadata: {
          name: 'Entry',
          description: '',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: xml,
        publishedXml: null,
        publishedJs: null
      }
    }, {}, { entrySheetId: 'sheet-1' });

    expect(importData.manifest.entrySheetId).toBe('sheet-1');
  });

  test('loop sheet type preserved', async () => {
    const xml = buildXml({ name: 'MyLoop', sheetType: 'loop' });

    const importData = await roundTrip({
      'sheet-1': {
        metadata: {
          name: 'MyLoop',
          description: '',
          type: 'loop',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: xml,
        publishedXml: null,
        publishedJs: null
      }
    });

    expect(importData.manifest.sheets['sheet-1'].type).toBe('loop');
  });

  test('multiple selected sheets all exported with full metadata', async () => {
    const xml1 = buildXml({ name: 'Sheet1' });
    const xml2 = buildXml({ name: 'Sheet2' });

    const importData = await roundTrip({
      'sheet-1': {
        metadata: {
          name: 'Sheet1',
          description: 'First',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: xml1,
        publishedXml: null,
        publishedJs: null
      },
      'sheet-2': {
        metadata: {
          name: 'Sheet2',
          description: 'Second',
          type: 'standard',
          folderId: null,
          createdAt: '2025-03-01T00:00:00Z',
          updatedAt: '2025-03-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: xml2,
        publishedXml: null,
        publishedJs: null
      }
    });

    // Both sheets present with correct content
    expect(importData.sheets['sheet-1'].xml).toBe(xml1);
    expect(importData.sheets['sheet-2'].xml).toBe(xml2);

    // Metadata for both preserved (spot-check distinguishing fields)
    expect(importData.manifest.sheets['sheet-1'].description).toBe('First');
    expect(importData.manifest.sheets['sheet-2'].description).toBe('Second');
    expect(importData.manifest.sheets['sheet-1'].createdAt).toBe('2025-01-01T00:00:00Z');
    expect(importData.manifest.sheets['sheet-2'].createdAt).toBe('2025-03-01T00:00:00Z');
  });

  test('import parses customFunctions from XML (not manifest)', async () => {
    const xml = buildXml({
      name: 'WithRefs',
      customFunctions: [
        { id: 'func-x', name: 'MY_FUNC' }
      ]
    });

    const importData = await roundTrip({
      'sheet-1': {
        metadata: {
          name: 'WithRefs',
          description: '',
          type: 'standard',
          folderId: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          functionId: null,
          publishedVersion: null,
          hasUnpublishedChanges: false
        },
        draftXml: xml,
        publishedXml: null,
        publishedJs: null
      }
    });

    // customFunctions is extracted from XML by importPackager, not stored in manifest
    expect(importData.sheets['sheet-1'].meta.customFunctions).toEqual([
      { id: 'func-x', name: 'MY_FUNC', versionId: 'v1', version: '1.0' }
    ]);
  });
});

// ============================================================================
// generateExportFilename
// ============================================================================

describe('generateExportFilename', () => {
  test('single sheet uses singular form', () => {
    const name = generateExportFilename(1);
    expect(name).toMatch(/^sc-sheet-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  test('multiple sheets uses plural form', () => {
    const name = generateExportFilename(3);
    expect(name).toMatch(/^sc-sheets-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});
