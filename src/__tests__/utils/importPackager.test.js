/**
 * Tests for importPackager.js
 * Covers findTopLevelSheet dependency analysis and top-level sheet selection,
 * plus scenario-import behavior (manifest v2.1).
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import {
  findTopLevelSheet,
  executeImport,
  parseImportZip,
  checkMissingScenarioFunctions,
} from '../../utils/importPackager.js';

/**
 * Build a minimal XML string for testing. Optionally includes CustomFunctions references.
 * @param {Object} opts
 * @param {string} opts.name
 * @param {string} [opts.functionId]
 * @param {string} [opts.sheetType]
 * @param {Array<{id: string, name: string}>} [opts.customFunctions]
 */
function buildXml({ name, functionId, sheetType, customFunctions = [] }) {
  const attrs = [`name="${name}"`];
  if (functionId) attrs.push(`functionId="${functionId}"`);
  if (sheetType) attrs.push(`sheetType="${sheetType}"`);

  const cfBlock = customFunctions.length > 0
    ? `<CustomFunctions>${customFunctions.map(f =>
        `<Function id="${f.id}" name="${f.name}" versionId="v1" version="1.0"/>`
      ).join('')}</CustomFunctions>`
    : '';

  return `<CodeCalculation ${attrs.join(' ')}>${cfBlock}</CodeCalculation>`;
}

function makeSheetEntry(name, { functionId, sheetType, customFunctions } = {}) {
  return {
    xml: buildXml({ name, functionId, sheetType, customFunctions }),
    meta: { name, functionId: functionId || null, type: sheetType || 'standard' },
  };
}

describe('findTopLevelSheet', () => {
  it('returns the only sheet when there is one', () => {
    const importData = {
      sheets: {
        'sheet-1': makeSheetEntry('Dashboard'),
      },
    };
    const importResult = { sheetIdMap: new Map() };

    const result = findTopLevelSheet(importData, importResult);
    expect(result).toEqual({ id: 'sheet-1', type: 'standard', name: 'Dashboard' });
  });

  it('returns null for empty import', () => {
    const result = findTopLevelSheet({ sheets: {} }, { sheetIdMap: new Map() });
    expect(result).toBeNull();
  });

  it('prefers display-only sheet over callable function', () => {
    const importData = {
      sheets: {
        'sheet-1': makeSheetEntry('CALC', { functionId: 'func-1' }),
        'sheet-2': makeSheetEntry('Dashboard'),
      },
    };
    const importResult = { sheetIdMap: new Map() };

    const result = findTopLevelSheet(importData, importResult);
    expect(result.id).toBe('sheet-2');
    expect(result.name).toBe('Dashboard');
    expect(result).not.toHaveProperty('hasFunctionId');
  });

  it('excludes sheets referenced by other sheets', () => {
    // Dashboard calls CALC via CustomFunctions
    const importData = {
      sheets: {
        'sheet-1': makeSheetEntry('CALC', { functionId: 'func-calc' }),
        'sheet-2': makeSheetEntry('Dashboard', {
          customFunctions: [{ id: 'func-calc', name: 'CALC' }],
        }),
      },
    };
    const importResult = { sheetIdMap: new Map() };

    const result = findTopLevelSheet(importData, importResult);
    expect(result.id).toBe('sheet-2');
    expect(result.name).toBe('Dashboard');
  });

  it('uses remapped IDs from sheetIdMap', () => {
    const importData = {
      sheets: {
        'old-id': makeSheetEntry('Dashboard'),
      },
    };
    const importResult = { sheetIdMap: new Map([['old-id', 'new-id']]) };

    const result = findTopLevelSheet(importData, importResult);
    expect(result.id).toBe('new-id');
  });

  it('handles multi-level dependency chains', () => {
    // A calls B, B calls C → A is top-level
    const importData = {
      sheets: {
        'a': makeSheetEntry('A', {
          customFunctions: [{ id: 'func-b', name: 'B' }],
        }),
        'b': makeSheetEntry('B', {
          functionId: 'func-b',
          customFunctions: [{ id: 'func-c', name: 'C' }],
        }),
        'c': makeSheetEntry('C', { functionId: 'func-c' }),
      },
    };
    const importResult = { sheetIdMap: new Map() };

    const result = findTopLevelSheet(importData, importResult);
    expect(result.id).toBe('a');
    expect(result.name).toBe('A');
  });

  it('sorts alphabetically among equal candidates', () => {
    const importData = {
      sheets: {
        's1': makeSheetEntry('Zebra'),
        's2': makeSheetEntry('Alpha'),
      },
    };
    const importResult = { sheetIdMap: new Map() };

    const result = findTopLevelSheet(importData, importResult);
    expect(result.name).toBe('Alpha');
  });

  it('preserves sheet type from metadata', () => {
    const importData = {
      sheets: {
        's1': makeSheetEntry('LoopSheet', { sheetType: 'loop' }),
      },
    };
    const importResult = { sheetIdMap: new Map() };

    const result = findTopLevelSheet(importData, importResult);
    expect(result.type).toBe('loop');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Scenario import (manifest v2.1)
// ────────────────────────────────────────────────────────────────────────

function makeScenarioEntry({ name, functionId, functionName, inputs, results, folderId }) {
  return {
    meta: {
      name,
      functionId: functionId || null,
      functionName: functionName || 'TARGET',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      folderId: folderId === undefined ? null : folderId,
    },
    data: {
      inputs: inputs || {},
      results: results === undefined ? null : results,
    },
  };
}

function makeMockEngines({ localFunctionIds = new Set() } = {}) {
  const scenarioEntries = new Map();
  const scenarioFiles = new Map();

  const storageEngine = {
    createFolder: vi.fn(async () => 'folder-' + crypto.randomUUID()),
    createSpreadsheetBatch: vi.fn(async () => {}),
    createScenarioEntry: vi.fn(async (id, entry) => {
      scenarioEntries.set(id, entry);
    }),
    findSheetByFunctionId: vi.fn(async (fid) =>
      localFunctionIds.has(fid) ? { id: 'local-' + fid } : null
    ),
  };

  const opfsService = {
    saveSheet: vi.fn(async () => {}),
    savePublishedVersion: vi.fn(async () => {}),
    saveScenario: vi.fn(async (id, data) => {
      scenarioFiles.set(id, data);
    }),
  };

  return { storageEngine, opfsService, scenarioEntries, scenarioFiles };
}

describe('executeImport — scenarios', () => {
  it('creates scenario manifest entry and data file', async () => {
    // Function exists locally (e.g. previously installed) — no warning expected
    const { storageEngine, opfsService, scenarioEntries, scenarioFiles } = makeMockEngines({
      localFunctionIds: new Set(['func-target']),
    });

    const importData = {
      manifest: { version: '2.1', folders: {}, sheets: {}, scenarios: {} },
      sheets: {},
      scenarios: {
        'scenario-old-1': makeScenarioEntry({
          name: 'Sweep A',
          functionId: 'func-target',
          functionName: 'TARGET',
          inputs: {
            X: { category: 'decision', values: [1, 2, 3] },
            Y: { category: 'fixed', values: [42] },
          },
        }),
      },
    };

    const result = await executeImport({
      importData,
      resolutions: new Map(),
      folderName: 'pkg',
      storageEngine,
      opfsService,
    });

    expect(result.scenariosImported).toBe(1);
    expect(result.scenarioIdMap.size).toBe(1);

    // ID was reassigned (no collisions on re-import)
    const newId = result.scenarioIdMap.get('scenario-old-1');
    expect(newId).toMatch(/^scenario-[0-9a-f-]+$/);
    expect(newId).not.toBe('scenario-old-1');

    // Manifest entry is correct
    expect(scenarioEntries.get(newId)).toEqual({
      name: 'Sweep A',
      functionId: 'func-target',
      functionName: 'TARGET',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      folderId: null,
    });

    // Data file is correct
    expect(scenarioFiles.get(newId)).toEqual({
      inputs: {
        X: { category: 'decision', values: [1, 2, 3] },
        Y: { category: 'fixed', values: [42] },
      },
      results: null,
    });
  });

  it('remaps functionId when host function was forked', async () => {
    const { storageEngine, opfsService, scenarioEntries } = makeMockEngines();

    const importData = {
      manifest: { version: '2.1', folders: {}, sheets: {} },
      // One sheet that will be forked, plus one scenario pointing at it
      sheets: {
        'local-sheet-1': {
          meta: {
            name: 'TARGET',
            type: 'standard',
            functionId: 'func-original',
            customFunctions: [],
          },
          xml: '<CodeCalculation name="TARGET" functionId="func-original"/>',
          publishedXml: null,
          publishedJs: null,
        },
      },
      scenarios: {
        'scenario-old-1': makeScenarioEntry({
          name: 'Uses TARGET',
          functionId: 'func-original',
          functionName: 'TARGET',
          inputs: {},
        }),
      },
    };

    const result = await executeImport({
      importData,
      resolutions: new Map([['local-sheet-1', 'fork']]),
      folderName: 'pkg',
      storageEngine,
      opfsService,
    });

    // The host function got remapped during fork; the scenario should follow
    const newFunctionId = result.functionIdMap.get('func-original');
    expect(newFunctionId).toBeDefined();
    expect(newFunctionId).not.toBe('func-original');

    const newScenarioId = result.scenarioIdMap.get('scenario-old-1');
    expect(scenarioEntries.get(newScenarioId).functionId).toBe(newFunctionId);
  });

  it('parseImportZip flags scenarios whose data file is missing from the zip', async () => {
    const sheetXml = '<CodeCalculation name="TARGET" functionId="func-target"></CodeCalculation>';
    const manifest = {
      version: '2.1',
      exportedAt: '2026-04-26T00:00:00.000Z',
      packageId: 'workfolder:test',
      folders: {},
      sheets: {
        'local-sheet-1': {
          name: 'TARGET', type: 'standard', folderId: null,
          functionId: 'func-target', publishedVersion: null,
          hasUnpublishedChanges: false, hasDraft: true,
        },
      },
      scenarios: {
        'scenario-good': {
          name: 'OK', functionId: 'func-target', functionName: 'TARGET',
          createdAt: 'x', updatedAt: 'x', folderId: null,
        },
        'scenario-missing-file': {
          name: 'Lost data', functionId: 'func-target', functionName: 'TARGET',
          createdAt: 'x', updatedAt: 'x', folderId: null,
        },
        'scenario-corrupt-json': {
          name: 'Bad JSON', functionId: 'func-target', functionName: 'TARGET',
          createdAt: 'x', updatedAt: 'x', folderId: null,
        },
      },
    };

    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('sheets/local-sheet-1.xml', sheetXml);
    zip.file('scenarios/scenario-good.json', JSON.stringify({ inputs: {}, results: null }));
    // scenario-missing-file: intentionally not added
    zip.file('scenarios/scenario-corrupt-json.json', '{not valid json');

    const blob = await zip.generateAsync({ type: 'blob' });
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const importData = await parseImportZip(blob);
    consoleSpy.mockRestore();

    // Only the good scenario survives parsing
    expect(Object.keys(importData.scenarios)).toEqual(['scenario-good']);

    // Both bad scenarios surface as corrupt entries with the right reason
    expect(importData.corruptScenarios).toEqual([
      { scenarioId: 'scenario-missing-file', scenarioName: 'Lost data', reason: 'missing-file' },
      { scenarioId: 'scenario-corrupt-json', scenarioName: 'Bad JSON', reason: 'parse-error' },
    ]);
  });

  it('parseImportZip extracts manifest.scenarios + data files (v2.1)', async () => {
    const sheetXml = '<CodeCalculation name="TARGET" functionId="func-target"></CodeCalculation>';
    const manifest = {
      version: '2.1',
      exportedAt: '2026-04-26T00:00:00.000Z',
      packageId: 'workfolder:test',
      folders: {},
      sheets: {
        'local-sheet-1': {
          name: 'TARGET',
          type: 'standard',
          folderId: null,
          functionId: 'func-target',
          publishedVersion: null,
          hasUnpublishedChanges: false,
          hasDraft: true,
        },
      },
      scenarios: {
        'scenario-zip-1': {
          name: 'My sweep',
          functionId: 'func-target',
          functionName: 'TARGET',
          createdAt: '2026-04-26T01:00:00.000Z',
          updatedAt: '2026-04-26T02:00:00.000Z',
          folderId: null,
        },
      },
    };

    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('sheets/local-sheet-1.xml', sheetXml);
    zip.file('scenarios/scenario-zip-1.json', JSON.stringify({
      inputs: {
        AGE: { category: 'decision', values: [62, 67] },
      },
      results: null,
    }));

    const blob = await zip.generateAsync({ type: 'blob' });
    const importData = await parseImportZip(blob);

    expect(importData.manifest.version).toBe('2.1');
    expect(Object.keys(importData.scenarios)).toEqual(['scenario-zip-1']);
    expect(importData.scenarios['scenario-zip-1'].meta.name).toBe('My sweep');
    expect(importData.scenarios['scenario-zip-1'].data.inputs.AGE.values).toEqual([62, 67]);
  });

  it('warns when scenario references a function not in import or local storage', async () => {
    const { storageEngine, opfsService } = makeMockEngines();  // no local funcs

    const importData = {
      manifest: { version: '2.1', folders: {}, sheets: {} },
      sheets: {},  // empty import — scenario's host function not provided here
      scenarios: {
        'scenario-1': makeScenarioEntry({
          name: 'Orphaned',
          functionId: 'func-missing',
          functionName: 'GHOST',
          inputs: {},
        }),
      },
    };

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await executeImport({
      importData,
      resolutions: new Map(),
      folderName: 'pkg',
      storageEngine,
      opfsService,
    });
    consoleSpy.mockRestore();

    expect(result.warnings).toEqual([{
      type: 'scenario-missing-function',
      scenarioName: 'Orphaned',
      functionName: 'GHOST',
      functionId: 'func-missing',
    }]);
    // Still imported (broken-but-recoverable: user could install the function later)
    expect(result.scenariosImported).toBe(1);
  });

  it('is a no-op when manifest has no scenarios section', async () => {
    const { storageEngine, opfsService } = makeMockEngines();

    const result = await executeImport({
      importData: {
        manifest: { version: '2.0', folders: {}, sheets: {} },
        sheets: {},
        // no scenarios key — older v2.0 importData
      },
      resolutions: new Map(),
      folderName: 'pkg',
      storageEngine,
      opfsService,
    });

    expect(result.scenariosImported).toBe(0);
    expect(result.scenarioIdMap.size).toBe(0);
    expect(storageEngine.createScenarioEntry).not.toHaveBeenCalled();
    expect(opfsService.saveScenario).not.toHaveBeenCalled();
  });
});

describe('checkMissingScenarioFunctions', () => {
  function makeStorage(localPublishedFunctionIds = []) {
    return {
      listSheets: vi.fn(async () => localPublishedFunctionIds.map(fid => ({ functionId: fid }))),
    };
  }

  it('returns empty array when there are no scenarios', async () => {
    const result = await checkMissingScenarioFunctions(
      { sheets: {}, scenarios: {} },
      makeStorage()
    );
    expect(result).toEqual([]);
  });

  it('returns empty array when functionId is satisfied by the import', async () => {
    const importData = {
      sheets: {
        'sheet-1': { meta: { name: 'TARGET', functionId: 'func-target' } },
      },
      scenarios: {
        'scenario-1': makeScenarioEntry({
          name: 'OK',
          functionId: 'func-target',
          functionName: 'TARGET',
        }),
      },
    };
    const result = await checkMissingScenarioFunctions(importData, makeStorage());
    expect(result).toEqual([]);
  });

  it('returns empty array when functionId is satisfied by local storage', async () => {
    const importData = {
      sheets: {},
      scenarios: {
        'scenario-1': makeScenarioEntry({
          name: 'OK locally',
          functionId: 'func-installed',
          functionName: 'INSTALLED',
        }),
      },
    };
    const result = await checkMissingScenarioFunctions(
      importData,
      makeStorage(['func-installed'])
    );
    expect(result).toEqual([]);
  });

  it('flags scenarios whose functionId is in neither import nor local', async () => {
    const importData = {
      sheets: {},
      scenarios: {
        'scenario-1': makeScenarioEntry({
          name: 'Orphan',
          functionId: 'func-missing',
          functionName: 'GHOST',
        }),
      },
    };
    const result = await checkMissingScenarioFunctions(importData, makeStorage());
    expect(result).toEqual([
      { scenarioName: 'Orphan', functionName: 'GHOST', functionId: 'func-missing' },
    ]);
  });
});
