/**
 * Tests for fetchAndImportFromUrl in orchestrator-shared.js
 * Covers the URL import flow: fetch, parse, dedup, import, publish, metadata.
 */

import { vi } from 'vitest';
import { fetchAndImportFromUrl } from '../../orchestrators/shared/orchestrator-shared.js';

// Mock the importPackager module
vi.mock('../../utils/importPackager.js', () => ({
  parseImportZip: vi.fn(),
  detectConflicts: vi.fn(),
  checkMissingDependencies: vi.fn(),
  executeImport: vi.fn(),
  generateImportFolderName: vi.fn(),
  publishImportedSheets: vi.fn(),
  findTopLevelSheet: vi.fn(),
}));

// Import the mocked functions so we can configure them per test
import {
  parseImportZip,
  executeImport,
  generateImportFolderName,
  publishImportedSheets,
  findTopLevelSheet,
} from '../../utils/importPackager.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockStorageEngine(overrides = {}) {
  return {
    ensureDownloadsFolder: vi.fn().mockResolvedValue('downloads-folder-id'),
    findFolderByPackageId: vi.fn().mockResolvedValue(null),
    updateFolderMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDeps(storageOverrides = {}) {
  return {
    storageEngine: createMockStorageEngine(storageOverrides),
    opfsService: {},
    functionCompiler: {},
  };
}

const MINIMAL_IMPORT_DATA = {
  manifest: { packageId: 'pkg-123' },
  sheets: {
    'sheet-1': {
      xml: '<CodeCalculation name="Dashboard"/>',
      meta: { name: 'Dashboard', functionId: null, type: 'standard' },
    },
  },
};

const MINIMAL_IMPORT_RESULT = {
  imported: 1,
  skipped: 0,
  warnings: [],
  sheetIdMap: new Map([['sheet-1', 'local-new-id']]),
  folderIdMap: new Map(),
  functionIdMap: new Map(),
  importFolderId: 'import-folder-id',
};

function setupHappyPath() {
  mockFetch.mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['fake-zip'])),
  });
  parseImportZip.mockResolvedValue(MINIMAL_IMPORT_DATA);
  generateImportFolderName.mockReturnValue('retirement');
  executeImport.mockResolvedValue(MINIMAL_IMPORT_RESULT);
  publishImportedSheets.mockResolvedValue({ published: 1, failed: 0 });
  findTopLevelSheet.mockReturnValue({ id: 'local-new-id', type: 'standard', name: 'Dashboard' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchAndImportFromUrl', () => {
  it('fetches, imports, and returns entry sheet info', async () => {
    setupHappyPath();
    const deps = createMockDeps();

    const result = await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(result).toEqual({
      entrySheetId: 'local-new-id',
      entrySheetType: 'standard',
      importFolderId: 'import-folder-id',
      alreadyDownloaded: false,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(parseImportZip).toHaveBeenCalledTimes(1);
    expect(executeImport).toHaveBeenCalledTimes(1);
    expect(publishImportedSheets).toHaveBeenCalledTimes(1);
  });

  it('returns existing folder when packageId already downloaded', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-zip'])),
    });
    parseImportZip.mockResolvedValue(MINIMAL_IMPORT_DATA);

    const deps = createMockDeps({
      findFolderByPackageId: vi.fn().mockResolvedValue({
        folderId: 'existing-folder',
        folder: { entrySheetId: 'existing-sheet', entrySheetType: 'loop' },
      }),
    });

    const result = await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(result).toEqual({
      entrySheetId: 'existing-sheet',
      entrySheetType: 'loop',
      importFolderId: 'existing-folder',
      alreadyDownloaded: true,
    });
    // Should NOT have called executeImport or publishImportedSheets
    expect(executeImport).not.toHaveBeenCalled();
    expect(publishImportedSheets).not.toHaveBeenCalled();
  });

  it('stores entrySheetId in folder metadata after import', async () => {
    setupHappyPath();
    const deps = createMockDeps();

    await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(deps.storageEngine.updateFolderMetadata).toHaveBeenCalledWith(
      'import-folder-id',
      { entrySheetId: 'local-new-id', entrySheetType: 'standard' }
    );
  });

  it('uses manifest entrySheetId when present', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-zip'])),
    });
    parseImportZip.mockResolvedValue({
      manifest: { packageId: 'pkg-123', entrySheetId: 'sheet-1' },
      sheets: MINIMAL_IMPORT_DATA.sheets,
    });
    generateImportFolderName.mockReturnValue('retirement');
    executeImport.mockResolvedValue(MINIMAL_IMPORT_RESULT);
    publishImportedSheets.mockResolvedValue({ published: 1, failed: 0 });
    const deps = createMockDeps();

    const result = await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(result.entrySheetId).toBe('local-new-id');
    expect(result.entrySheetType).toBe('standard');
    // Should NOT have called findTopLevelSheet since manifest had entrySheetId
    expect(findTopLevelSheet).not.toHaveBeenCalled();
  });

  it('falls back to heuristic when manifest entrySheetId not in sheetIdMap', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-zip'])),
    });
    parseImportZip.mockResolvedValue({
      manifest: { packageId: 'pkg-123', entrySheetId: 'nonexistent-sheet' },
      sheets: MINIMAL_IMPORT_DATA.sheets,
    });
    generateImportFolderName.mockReturnValue('retirement');
    executeImport.mockResolvedValue(MINIMAL_IMPORT_RESULT);
    publishImportedSheets.mockResolvedValue({ published: 1, failed: 0 });
    findTopLevelSheet.mockReturnValue({ id: 'local-new-id', type: 'standard', name: 'Dashboard' });
    const deps = createMockDeps();

    const result = await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(result.entrySheetId).toBe('local-new-id');
    expect(findTopLevelSheet).toHaveBeenCalled();
  });

  it('passes packageId and parentFolderId to executeImport', async () => {
    setupHappyPath();
    const deps = createMockDeps();

    await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(executeImport).toHaveBeenCalledWith(
      expect.objectContaining({
        parentFolderId: 'downloads-folder-id',
        packageId: 'pkg-123',
      })
    );
  });

  it('sets all resolutions to fork', async () => {
    setupHappyPath();
    const deps = createMockDeps();

    await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    const callArgs = executeImport.mock.calls[0][0];
    expect(callArgs.resolutions.get('sheet-1')).toBe('fork');
  });

  it('throws on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    const deps = createMockDeps();

    await expect(
      fetchAndImportFromUrl('https://example.com/missing.zip', deps)
    ).rejects.toThrow('Download failed: 404 Not Found');
  });

  it('throws on invalid zip content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['not-a-zip'])),
    });
    parseImportZip.mockRejectedValue(new Error('Invalid zip'));
    const deps = createMockDeps();

    await expect(
      fetchAndImportFromUrl('https://example.com/bad.zip', deps)
    ).rejects.toThrow('The URL did not return a valid zip file.');
  });

  it('rejects non-http protocols', async () => {
    const deps = createMockDeps();

    await expect(
      fetchAndImportFromUrl('ftp://example.com/file.zip', deps)
    ).rejects.toThrow('Unsupported protocol');
  });

  it('returns null entrySheetId when no entry sheet found', async () => {
    setupHappyPath();
    findTopLevelSheet.mockReturnValue(null);
    const deps = createMockDeps();

    const result = await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(result.entrySheetId).toBeNull();
    expect(result.entrySheetType).toBe('standard');
  });

  it('skips metadata update when no entry sheet found', async () => {
    setupHappyPath();
    findTopLevelSheet.mockReturnValue(null);
    const deps = createMockDeps();

    await fetchAndImportFromUrl('https://example.com/retirement.zip', deps);

    expect(deps.storageEngine.updateFolderMetadata).not.toHaveBeenCalled();
  });

  it('skips dedup check when manifest has no packageId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-zip'])),
    });
    parseImportZip.mockResolvedValue({
      manifest: {},
      sheets: MINIMAL_IMPORT_DATA.sheets,
    });
    generateImportFolderName.mockReturnValue('import');
    executeImport.mockResolvedValue(MINIMAL_IMPORT_RESULT);
    publishImportedSheets.mockResolvedValue({ published: 1, failed: 0 });
    findTopLevelSheet.mockReturnValue({ id: 'local-new-id', type: 'standard', name: 'Dashboard' });
    const deps = createMockDeps();

    await fetchAndImportFromUrl('https://example.com/file.zip', deps);

    expect(deps.storageEngine.findFolderByPackageId).not.toHaveBeenCalled();
  });

  it('extracts filename from URL path, ignoring query string', async () => {
    setupHappyPath();
    const deps = createMockDeps();

    await fetchAndImportFromUrl('https://example.com/path/my-file.zip?token=abc', deps);

    expect(generateImportFolderName).toHaveBeenCalledWith('my-file.zip');
  });
});
