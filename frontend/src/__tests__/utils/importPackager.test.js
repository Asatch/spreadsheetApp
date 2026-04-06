/**
 * Tests for importPackager.js
 * Covers findTopLevelSheet dependency analysis and top-level sheet selection.
 */

import { findTopLevelSheet } from '../../utils/importPackager.js';

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
