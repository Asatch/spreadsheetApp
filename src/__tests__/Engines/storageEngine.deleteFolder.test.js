/**
 * Tests for storageEngine.deleteFolder cascade behavior.
 * Specifically: when a folder is deleted, scenarios pointing at functions
 * in the deleted sheets should be removed too (otherwise they'd dangle as
 * broken references — a real bug surfaced by the package re-import flow,
 * which deletes folders to replace packages in place).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStorageEngine } from '../../Engines/storageEngine.js';

function makeOpfsMock(initialManifest) {
  let manifest = JSON.parse(JSON.stringify(initialManifest));
  return {
    readSheetManifest: vi.fn(async () => manifest),
    writeSheetManifest: vi.fn(async (m) => { manifest = m; }),
    deleteSheet: vi.fn(async () => {}),
    deleteScenarioFile: vi.fn(async () => {}),
    deletePublishedFiles: vi.fn(async () => {}),
    getManifest: () => manifest,
  };
}

async function makeEngine(initialManifest) {
  const opfs = makeOpfsMock(initialManifest);
  const engine = createStorageEngine();
  engine.setOpfsService(opfs);
  await engine.init({
    getCanonicalSnapshot: () => ({}),
    getFormattingSnapshot: () => ({}),
    getGridBounds: () => ({}),
    getOutputCells: () => [],
    getOutputModes: () => [],
    getCalcSnapshot: () => ({}),
    getCustomFunctions: () => [],
    getSpreadsheetName: () => '',
    getTestCases: () => [],
    getInputNames: () => [],
    getColumnNames: () => [],
    getMaxIterations: () => 0,
    onDirtyChange: () => {},
    onUnpublishedChange: () => {},
  });
  return { engine, opfs };
}

describe('storageEngine.deleteFolder — scenario cascade', () => {
  let opfs, engine;

  beforeEach(async () => {
    const initialManifest = {
      version: '3.0',
      folders: {
        'folder-pkg': { name: 'My Package', parentId: null },
        'folder-other': { name: 'Other', parentId: null },
      },
      sheets: {
        'sheet-target': {
          name: 'TARGET', folderId: 'folder-pkg', functionId: 'func-target',
          publishedVersion: { versionId: 'v1', versionString: '1.0', publishedAt: 'x' },
          type: 'standard',
        },
        'sheet-helper': {
          name: 'HELPER', folderId: 'folder-pkg', functionId: 'func-helper',
          publishedVersion: { versionId: 'v1', versionString: '1.0', publishedAt: 'x' },
          type: 'standard',
        },
        'sheet-elsewhere': {
          name: 'OTHER', folderId: 'folder-other', functionId: 'func-elsewhere',
          publishedVersion: { versionId: 'v1', versionString: '1.0', publishedAt: 'x' },
          type: 'standard',
        },
      },
      scenarioAnalyses: {
        'scenario-on-target': {
          name: 'Sweep', functionId: 'func-target', functionName: 'TARGET',
          createdAt: 'x', updatedAt: 'x', folderId: null,
        },
        'scenario-on-helper': {
          name: 'Helper sweep', functionId: 'func-helper', functionName: 'HELPER',
          createdAt: 'x', updatedAt: 'x', folderId: null,
        },
        'scenario-elsewhere': {
          name: 'Unrelated', functionId: 'func-elsewhere', functionName: 'OTHER',
          createdAt: 'x', updatedAt: 'x', folderId: null,
        },
      },
    };
    ({ engine, opfs } = await makeEngine(initialManifest));
  });

  it('deletes scenarios pointing at functions in the deleted folder', async () => {
    await engine.deleteFolder('folder-pkg');

    const m = opfs.getManifest();
    expect(Object.keys(m.scenarioAnalyses)).toEqual(['scenario-elsewhere']);

    // Both scenario data files should have been deleted from OPFS
    const deletedScenarioIds = opfs.deleteScenarioFile.mock.calls.map(c => c[0]).sort();
    expect(deletedScenarioIds).toEqual(['scenario-on-helper', 'scenario-on-target']);
  });

  it('leaves unrelated scenarios alone', async () => {
    await engine.deleteFolder('folder-pkg');

    const m = opfs.getManifest();
    expect(m.scenarioAnalyses['scenario-elsewhere']).toBeDefined();
    expect(m.scenarioAnalyses['scenario-elsewhere'].functionId).toBe('func-elsewhere');
  });

  it('still deletes sheets and folders as before', async () => {
    await engine.deleteFolder('folder-pkg');

    const m = opfs.getManifest();
    expect(m.sheets['sheet-target']).toBeUndefined();
    expect(m.sheets['sheet-helper']).toBeUndefined();
    expect(m.sheets['sheet-elsewhere']).toBeDefined();
    expect(m.folders['folder-pkg']).toBeUndefined();
    expect(m.folders['folder-other']).toBeDefined();
  });

  it('is a no-op for scenarios when no scenarioAnalyses section exists', async () => {
    const initialManifest = {
      version: '3.0',
      folders: { 'f1': { name: 'X', parentId: null } },
      sheets: {
        's1': { name: 'A', folderId: 'f1', functionId: 'func-a', type: 'standard' },
      },
      // no scenarioAnalyses key
    };
    const { engine: e2, opfs: o2 } = await makeEngine(initialManifest);

    await expect(e2.deleteFolder('f1')).resolves.not.toThrow();
    expect(o2.deleteScenarioFile).not.toHaveBeenCalled();
  });
});
