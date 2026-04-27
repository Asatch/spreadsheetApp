import { vi } from 'vitest';
import { createScenarioEngine } from '../../Engines/scenarioEngine.js';

vi.mock('../../utils/xmlSerializer.js', () => ({
  extractSignatureFromXml: vi.fn().mockReturnValue({
    inputs: [{ name: 'x', type: 'Number' }],
    outputs: [{ name: 'result', type: 'Number' }],
  }),
}));

import { extractSignatureFromXml } from '../../utils/xmlSerializer.js';

function createMockStorageEngine(overrides = {}) {
  return {
    createScenarioEntry: vi.fn(),
    getScenarioEntry: vi.fn().mockResolvedValue(null),
    updateScenarioEntry: vi.fn(),
    deleteScenarioEntry: vi.fn(),
    listScenarioEntries: vi.fn().mockResolvedValue({}),
    findSheetByFunctionId: vi.fn().mockResolvedValue(null),
    listSheets: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMockOpfsService(overrides = {}) {
  return {
    saveScenario: vi.fn(),
    loadScenario: vi.fn(),
    deleteScenarioFile: vi.fn(),
    loadPublishedCode: vi.fn(),
    loadPublishedXml: vi.fn().mockResolvedValue('<xml/>'),
    ...overrides,
  };
}

let engine;
let mockStorage;
let mockOpfs;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage = createMockStorageEngine();
  mockOpfs = createMockOpfsService();
  engine = createScenarioEngine();
  engine.setDependencies({ storageEngine: mockStorage, opfsService: mockOpfs });
});

// ============================================================================
// CRUD
// ============================================================================

describe('createScenario', () => {
  test('creates manifest entry and initial data file', async () => {
    const id = await engine.createScenario('My Analysis', 'func-1', 'MY_FUNC', { folderId: 'folder-1' });

    expect(id).toMatch(/^scenario-/);
    expect(mockStorage.createScenarioEntry).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        name: 'My Analysis',
        functionId: 'func-1',
        functionName: 'MY_FUNC',
        folderId: 'folder-1',
      }),
    );
    expect(mockOpfs.saveScenario).toHaveBeenCalledWith(id, { inputs: {}, results: null });
  });

  test('defaults folderId to null', async () => {
    await engine.createScenario('Test', 'func-1', 'FUNC');

    expect(mockStorage.createScenarioEntry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ folderId: null }),
    );
  });
});

describe('listScenarios', () => {
  test('returns entries as array with id', async () => {
    mockStorage.listScenarioEntries.mockResolvedValue({
      'scenario-1': { name: 'A', functionName: 'F1' },
      'scenario-2': { name: 'B', functionName: 'F2' },
    });

    const result = await engine.listScenarios();
    expect(result).toEqual([
      { id: 'scenario-1', name: 'A', functionName: 'F1' },
      { id: 'scenario-2', name: 'B', functionName: 'F2' },
    ]);
  });

  test('returns empty array when no scenarios exist', async () => {
    const result = await engine.listScenarios();
    expect(result).toEqual([]);
  });
});

describe('getScenarioMetadata', () => {
  test('delegates to storageEngine', async () => {
    const entry = { name: 'Test', functionId: 'f1' };
    mockStorage.getScenarioEntry.mockResolvedValue(entry);

    const result = await engine.getScenarioMetadata('scenario-1');
    expect(result).toBe(entry);
    expect(mockStorage.getScenarioEntry).toHaveBeenCalledWith('scenario-1');
  });
});

describe('loadScenarioData / saveScenarioData', () => {
  test('loadScenarioData delegates to opfsService', async () => {
    const data = { inputs: { X: { category: 'fixed', values: [1] } }, results: null };
    mockOpfs.loadScenario.mockResolvedValue(data);

    const result = await engine.loadScenarioData('scenario-1');
    expect(result).toBe(data);
    expect(mockOpfs.loadScenario).toHaveBeenCalledWith('scenario-1');
  });

  test('saveScenarioData writes data and updates manifest timestamp', async () => {
    mockStorage.getScenarioEntry.mockResolvedValue({ name: 'Test' });
    const data = { inputs: {}, results: null };

    await engine.saveScenarioData('scenario-1', data);

    expect(mockOpfs.saveScenario).toHaveBeenCalledWith('scenario-1', data);
    expect(mockStorage.updateScenarioEntry).toHaveBeenCalledWith(
      'scenario-1',
      expect.objectContaining({ updatedAt: expect.any(String) }),
    );
  });

  test('saveScenarioData skips manifest update if entry not found', async () => {
    mockStorage.getScenarioEntry.mockResolvedValue(null);

    await engine.saveScenarioData('scenario-missing', { inputs: {}, results: null });

    expect(mockOpfs.saveScenario).toHaveBeenCalled();
    expect(mockStorage.updateScenarioEntry).not.toHaveBeenCalled();
  });
});

describe('renameScenario', () => {
  test('updates manifest entry with new name', async () => {
    await engine.renameScenario('scenario-1', 'New Name');

    expect(mockStorage.updateScenarioEntry).toHaveBeenCalledWith(
      'scenario-1',
      expect.objectContaining({ name: 'New Name', updatedAt: expect.any(String) }),
    );
  });
});

describe('deleteScenario', () => {
  test('deletes both OPFS file and manifest entry', async () => {
    await engine.deleteScenario('scenario-1');

    expect(mockOpfs.deleteScenarioFile).toHaveBeenCalledWith('scenario-1');
    expect(mockStorage.deleteScenarioEntry).toHaveBeenCalledWith('scenario-1');
  });
});

// ============================================================================
// FOLDER INTEGRATION
// ============================================================================

describe('listScenariosInFolder', () => {
  test('filters scenarios by folderId', async () => {
    mockStorage.listScenarioEntries.mockResolvedValue({
      's1': { name: 'A', folderId: 'folder-1' },
      's2': { name: 'B', folderId: 'folder-2' },
      's3': { name: 'C', folderId: 'folder-1' },
    });

    const result = await engine.listScenariosInFolder('folder-1');
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['s1', 's3']);
  });

  test('returns root-level scenarios when folderId is null', async () => {
    mockStorage.listScenarioEntries.mockResolvedValue({
      's1': { name: 'A', folderId: null },
      's2': { name: 'B', folderId: 'folder-1' },
      's3': { name: 'C' }, // no folderId property — treated as root
    });

    const result = await engine.listScenariosInFolder(null);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['s1', 's3']);
  });
});

describe('moveScenarioToFolder', () => {
  test('updates folderId in manifest', async () => {
    await engine.moveScenarioToFolder('scenario-1', 'folder-2');

    expect(mockStorage.updateScenarioEntry).toHaveBeenCalledWith(
      'scenario-1',
      expect.objectContaining({ folderId: 'folder-2', updatedAt: expect.any(String) }),
    );
  });
});

// ============================================================================
// FUNCTION LOADING
// ============================================================================

describe('loadPublishedFunction', () => {
  test('loads and compiles published JS into a callable', async () => {
    mockStorage.findSheetByFunctionId.mockResolvedValue({
      id: 'sheet-1',
      name: 'add',
      publishedVersion: {
        publishedName: 'ADD',
        signature: { inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'result' }] },
      },
    });
    mockOpfs.loadPublishedCode.mockResolvedValue('function ADD(a, b) { return { result: a + b }; }');

    const result = await engine.loadPublishedFunction('func-1');

    expect(result.name).toBe('ADD');
    expect(result.signature.inputs).toHaveLength(2);
    expect(result.callable(3, 4)).toEqual({ result: 7 });
  });

  test('throws when function not found', async () => {
    mockStorage.findSheetByFunctionId.mockResolvedValue(null);

    await expect(engine.loadPublishedFunction('missing')).rejects.toThrow('Function not found: missing');
  });

  test('falls back to sheet name when publishedName is missing', async () => {
    mockStorage.findSheetByFunctionId.mockResolvedValue({
      id: 'sheet-1',
      name: 'double',
      publishedVersion: {
        signature: { inputs: [{ name: 'x' }], outputs: [{ name: 'result' }] },
      },
    });
    mockOpfs.loadPublishedCode.mockResolvedValue('function DOUBLE(x) { return x * 2; }');

    const result = await engine.loadPublishedFunction('func-1');
    expect(result.name).toBe('DOUBLE');
    expect(result.callable(5)).toBe(10);
  });

  test('extracts signature from published XML when manifest lacks it', async () => {
    mockStorage.findSheetByFunctionId.mockResolvedValue({
      id: 'sheet-1',
      name: 'old_func',
      publishedVersion: { publishedName: 'OLD_FUNC' },  // no signature
    });
    mockOpfs.loadPublishedCode.mockResolvedValue('function OLD_FUNC(x) { return x; }');
    mockOpfs.loadPublishedXml.mockResolvedValue('<some-xml/>');
    extractSignatureFromXml.mockReturnValue({
      inputs: [{ name: 'x', type: 'Number' }],
      outputs: [{ name: 'result', type: 'Number' }],
    });

    const result = await engine.loadPublishedFunction('func-1');

    expect(mockOpfs.loadPublishedXml).toHaveBeenCalledWith('sheet-1');
    expect(extractSignatureFromXml).toHaveBeenCalledWith('<some-xml/>');
    expect(result.signature.inputs).toEqual([{ name: 'x', type: 'Number' }]);
  });

  test('returns null signature when XML extraction also fails', async () => {
    mockStorage.findSheetByFunctionId.mockResolvedValue({
      id: 'sheet-1',
      name: 'broken',
      publishedVersion: { publishedName: 'BROKEN' },  // no signature
    });
    mockOpfs.loadPublishedCode.mockResolvedValue('function BROKEN() { return 1; }');
    mockOpfs.loadPublishedXml.mockRejectedValue(new Error('Not found'));

    const result = await engine.loadPublishedFunction('func-1');

    expect(result.signature).toBeNull();
  });

  test('enriches existing signature with format info from XML when outputs lack it', async () => {
    mockStorage.findSheetByFunctionId.mockResolvedValue({
      id: 'sheet-1',
      name: 'calc',
      publishedVersion: {
        publishedName: 'CALC',
        signature: { inputs: [{ name: 'x' }], outputs: [{ name: 'BALANCE', type: 'Number' }] },
      },
    });
    mockOpfs.loadPublishedCode.mockResolvedValue('function CALC(x) { return { BALANCE: x }; }');
    const fmt = { subCategory: 'currency', symbol: '$', decimalPlaces: 2 };
    extractSignatureFromXml.mockReturnValue({
      inputs: [{ name: 'x', type: 'Number' }],
      outputs: [{ name: 'BALANCE', type: 'Number', format: fmt }],
    });

    const result = await engine.loadPublishedFunction('func-1');

    expect(mockOpfs.loadPublishedXml).toHaveBeenCalledWith('sheet-1');
    expect(result.signature.outputs[0].format).toEqual(fmt);
  });

  test('skips format enrichment when outputs already have format', async () => {
    const existingFmt = { subCategory: 'number', decimalPlaces: 2 };
    mockStorage.findSheetByFunctionId.mockResolvedValue({
      id: 'sheet-1',
      name: 'calc',
      publishedVersion: {
        publishedName: 'CALC',
        signature: { inputs: [{ name: 'x', canonical: '1' }], outputs: [{ name: 'RESULT', type: 'Number', format: existingFmt }] },
      },
    });
    mockOpfs.loadPublishedCode.mockResolvedValue('function CALC(x) { return { RESULT: x }; }');

    const result = await engine.loadPublishedFunction('func-1');

    expect(mockOpfs.loadPublishedXml).not.toHaveBeenCalled();
    expect(result.signature.outputs[0].format).toEqual(existingFmt);
  });
});

describe('listPublishedFunctions', () => {
  test('returns formatted list of published sheets', async () => {
    mockStorage.listSheets.mockResolvedValue([
      {
        id: 'sheet-1',
        functionId: 'func-1',
        name: 'add',
        type: 'standard',
        publishedVersion: {
          publishedName: 'ADD',
          versionString: '2.0',
          signature: { inputs: [{ name: 'a' }] },
        },
      },
    ]);

    const result = await engine.listPublishedFunctions();

    expect(result).toEqual([{
      sheetId: 'sheet-1',
      functionId: 'func-1',
      name: 'ADD',
      version: '2.0',
      signature: { inputs: [{ name: 'a' }] },
      type: 'standard',
    }]);
    expect(mockStorage.listSheets).toHaveBeenCalledWith({ publishedOnly: true });
  });

  test('falls back to defaults when publishedVersion fields are missing', async () => {
    mockStorage.listSheets.mockResolvedValue([
      { id: 'sheet-1', functionId: 'func-1', name: 'calc', type: 'standard' },
    ]);

    const result = await engine.listPublishedFunctions();

    expect(result[0].name).toBe('calc');
    expect(result[0].version).toBe('1.0');
    expect(result[0].signature).toBeNull();
  });
});
