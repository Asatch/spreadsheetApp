/**
 * Tests for Cell Reference Utilities
 *
 * Tests all core cellUtils functions for parsing, validating, and manipulating
 * cell references in A1 notation.
 */

import {
  columnToNumber,
  numberToColumn,
  parseCellKey,
  parseCellReference,
  formatCellReference,
  isCellInRange,
  isCellReference,
  getRangeBounds,
  normalizeRangeNotation,
  expandRange,
  getAdjacentCell,
  CELL_REF_PATTERN
} from '../../utils/cellUtils';

describe('cellUtils', () => {
  describe('columnToNumber', () => {
    it('should convert single letter columns correctly', () => {
      expect(columnToNumber('A')).toBe(1);
      expect(columnToNumber('B')).toBe(2);
      expect(columnToNumber('Z')).toBe(26);
    });

    it('should convert double letter columns correctly', () => {
      expect(columnToNumber('AA')).toBe(27);
      expect(columnToNumber('AB')).toBe(28);
      expect(columnToNumber('AZ')).toBe(52);
      expect(columnToNumber('BA')).toBe(53);
      expect(columnToNumber('ZZ')).toBe(702);
    });

    it('should work with uppercase input', () => {
      // Note: parseCellReference handles case conversion, not columnToNumber
      expect(columnToNumber('A')).toBe(1);
      expect(columnToNumber('AB')).toBe(28);
      expect(columnToNumber('ZZ')).toBe(702);
    });
  });

  describe('numberToColumn', () => {
    it('should convert single digit numbers correctly', () => {
      expect(numberToColumn(1)).toBe('A');
      expect(numberToColumn(2)).toBe('B');
      expect(numberToColumn(26)).toBe('Z');
    });

    it('should convert double letter column numbers correctly', () => {
      expect(numberToColumn(27)).toBe('AA');
      expect(numberToColumn(28)).toBe('AB');
      expect(numberToColumn(52)).toBe('AZ');
      expect(numberToColumn(53)).toBe('BA');
      expect(numberToColumn(702)).toBe('ZZ');
    });

    it('should round-trip with columnToNumber', () => {
      for (let i = 1; i <= 100; i++) {
        const col = numberToColumn(i);
        expect(columnToNumber(col)).toBe(i);
      }
    });
  });

  describe('parseCellKey', () => {
    it('should parse valid cell keys correctly', () => {
      expect(parseCellKey('A1')).toEqual({ col: 'A', row: 1, colNum: 1 });
      expect(parseCellKey('B2')).toEqual({ col: 'B', row: 2, colNum: 2 });
      expect(parseCellKey('Z99')).toEqual({ col: 'Z', row: 99, colNum: 26 });
      expect(parseCellKey('AA100')).toEqual({ col: 'AA', row: 100, colNum: 27 });
    });

    it('should be case-insensitive', () => {
      expect(parseCellKey('a1')).toEqual({ col: 'A', row: 1, colNum: 1 });
      expect(parseCellKey('Ab123')).toEqual({ col: 'AB', row: 123, colNum: 28 });
    });

    it('should return null for invalid cell keys', () => {
      expect(parseCellKey('A01')).toBeNull(); // Leading zero
      expect(parseCellKey('AAA1')).toBeNull(); // 3 letters
      expect(parseCellKey('A0')).toEqual({ col: 'A', row: 0, colNum: 1 }); // Row 0 valid for loop sheets
      expect(parseCellKey('123')).toBeNull(); // No column
      expect(parseCellKey('')).toBeNull(); // Empty
      expect(parseCellKey(null)).toBeNull(); // Null
    });

    it('should throw error if cell key contains $ markers', () => {
      expect(() => parseCellKey('$A1')).toThrow(/\$ markers/);
      expect(() => parseCellKey('A$1')).toThrow(/\$ markers/);
      expect(() => parseCellKey('$A$1')).toThrow(/\$ markers/);
    });
  });

  describe('parseCellReference', () => {
    it('should parse relative references', () => {
      const result = parseCellReference('A1');
      expect(result).toEqual({
        col: 1,
        row: 1,
        colAbs: false,
        rowAbs: false,
        originalCol: 'A'
      });
    });

    it('should parse column-absolute references', () => {
      const result = parseCellReference('$A1');
      expect(result).toEqual({
        col: 1,
        row: 1,
        colAbs: true,
        rowAbs: false,
        originalCol: 'A'
      });
    });

    it('should parse row-absolute references', () => {
      const result = parseCellReference('A$1');
      expect(result).toEqual({
        col: 1,
        row: 1,
        colAbs: false,
        rowAbs: true,
        originalCol: 'A'
      });
    });

    it('should parse fully absolute references', () => {
      const result = parseCellReference('$A$1');
      expect(result).toEqual({
        col: 1,
        row: 1,
        colAbs: true,
        rowAbs: true,
        originalCol: 'A'
      });
    });

    it('should be case-insensitive', () => {
      const result = parseCellReference('$ab$99');
      expect(result).toEqual({
        col: 28,
        row: 99,
        colAbs: true,
        rowAbs: true,
        originalCol: 'AB'
      });
    });

    it('should return null for invalid references', () => {
      expect(parseCellReference('A01')).toBeNull(); // Leading zero
      expect(parseCellReference('AAA1')).toBeNull(); // 3 letters
      expect(parseCellReference('')).toBeNull();
      expect(parseCellReference(null)).toBeNull();
    });
  });

  describe('formatCellReference', () => {
    it('should format relative references', () => {
      expect(formatCellReference(1, 1)).toBe('A1');
      expect(formatCellReference(2, 5)).toBe('B5');
      expect(formatCellReference(28, 99)).toBe('AB99');
    });

    it('should format column-absolute references', () => {
      expect(formatCellReference(1, 1, { colAbs: true })).toBe('$A1');
    });

    it('should format row-absolute references', () => {
      expect(formatCellReference(1, 1, { rowAbs: true })).toBe('A$1');
    });

    it('should format fully absolute references', () => {
      expect(formatCellReference(1, 1, { colAbs: true, rowAbs: true })).toBe('$A$1');
    });

    it('should round-trip with parseCellReference', () => {
      const tests = [
        { col: 1, row: 1, opts: {} },
        { col: 1, row: 1, opts: { colAbs: true } },
        { col: 1, row: 1, opts: { rowAbs: true } },
        { col: 1, row: 1, opts: { colAbs: true, rowAbs: true } },
        { col: 28, row: 99, opts: {} }
      ];

      tests.forEach(({ col, row, opts }) => {
        const formatted = formatCellReference(col, row, opts);
        const parsed = parseCellReference(formatted);
        expect(parsed.col).toBe(col);
        expect(parsed.row).toBe(row);
        expect(parsed.colAbs).toBe(opts.colAbs || false);
        expect(parsed.rowAbs).toBe(opts.rowAbs || false);
      });
    });
  });

  describe('isCellInRange', () => {
    it('should return true for cells inside range', () => {
      expect(isCellInRange('B2', { start: 'A1', end: 'C3' })).toBe(true);
      expect(isCellInRange('A1', { start: 'A1', end: 'C3' })).toBe(true); // Top-left corner
      expect(isCellInRange('C3', { start: 'A1', end: 'C3' })).toBe(true); // Bottom-right corner
    });

    it('should return false for cells outside range', () => {
      expect(isCellInRange('D4', { start: 'A1', end: 'C3' })).toBe(false);
      expect(isCellInRange('A4', { start: 'A1', end: 'C3' })).toBe(false);
      expect(isCellInRange('D1', { start: 'A1', end: 'C3' })).toBe(false);
    });

    it('should work with single cell ranges', () => {
      expect(isCellInRange('A1', { start: 'A1' })).toBe(true);
      expect(isCellInRange('A2', { start: 'A1' })).toBe(false);
    });

    it('should handle ranges in any direction', () => {
      // Start at bottom-right, end at top-left
      expect(isCellInRange('B2', { start: 'C3', end: 'A1' })).toBe(true);
      expect(isCellInRange('D4', { start: 'C3', end: 'A1' })).toBe(false);
    });

    it('should ignore $ markers in cell references', () => {
      expect(isCellInRange('$A$1', { start: 'A1', end: 'B2' })).toBe(true);
      expect(isCellInRange('B2', { start: '$A$1', end: '$B$2' })).toBe(true);
    });

    it('should return false for invalid inputs', () => {
      expect(isCellInRange('', { start: 'A1', end: 'B2' })).toBe(false);
      expect(isCellInRange('A1', { start: '', end: 'B2' })).toBe(false);
      expect(isCellInRange('A1', null)).toBe(false);
    });
  });

  describe('isCellReference', () => {
    it('should return true for valid cell references', () => {
      expect(isCellReference('A1')).toBe(true);
      expect(isCellReference('Z99')).toBe(true);
      expect(isCellReference('AA100')).toBe(true);
      expect(isCellReference('$A1')).toBe(true);
      expect(isCellReference('A$1')).toBe(true);
      expect(isCellReference('$A$1')).toBe(true);
    });

    it('should return false for invalid references', () => {
      expect(isCellReference('A01')).toBe(false); // Leading zero
      expect(isCellReference('AAA1')).toBe(false); // 3 letters
      expect(isCellReference('A0')).toBe(true); // Row 0 valid for loop sheets
      expect(isCellReference('123')).toBe(false); // No column
      expect(isCellReference('hello')).toBe(false);
      expect(isCellReference('')).toBe(false);
      expect(isCellReference(null)).toBe(false);
    });
  });

  describe('getRangeBounds', () => {
    it('should return normalized bounds for normal selection', () => {
      expect(getRangeBounds('A1', 'C3')).toEqual({
        minCol: 1,
        maxCol: 3,
        minRow: 1,
        maxRow: 3
      });
    });

    it('should normalize reversed selection', () => {
      expect(getRangeBounds('C3', 'A1')).toEqual({
        minCol: 1,
        maxCol: 3,
        minRow: 1,
        maxRow: 3
      });
    });

    it('should handle diagonal selections', () => {
      expect(getRangeBounds('B2', 'D1')).toEqual({
        minCol: 2,
        maxCol: 4,
        minRow: 1,
        maxRow: 2
      });
      expect(getRangeBounds('D4', 'B2')).toEqual({
        minCol: 2,
        maxCol: 4,
        minRow: 2,
        maxRow: 4
      });
    });

    it('should handle single cell (same start and end)', () => {
      expect(getRangeBounds('B2', 'B2')).toEqual({
        minCol: 2,
        maxCol: 2,
        minRow: 2,
        maxRow: 2
      });
    });

    it('should handle single cell (default end)', () => {
      expect(getRangeBounds('B2')).toEqual({
        minCol: 2,
        maxCol: 2,
        minRow: 2,
        maxRow: 2
      });
    });

    it('should return null for invalid cells', () => {
      expect(getRangeBounds('invalid', 'A1')).toBeNull();
      expect(getRangeBounds('A1', 'invalid')).toBeNull();
      expect(getRangeBounds(null)).toBeNull();
    });
  });

  describe('normalizeRangeNotation', () => {
    it('should return normalized range notation', () => {
      expect(normalizeRangeNotation('A1', 'C3')).toBe('A1:C3');
    });

    it('should normalize reversed selections', () => {
      expect(normalizeRangeNotation('C3', 'A1')).toBe('A1:C3');
    });

    it('should handle diagonal selections', () => {
      expect(normalizeRangeNotation('B2', 'D1')).toBe('B1:D2');
      expect(normalizeRangeNotation('D4', 'B2')).toBe('B2:D4');
    });

    it('should handle single cell selections', () => {
      expect(normalizeRangeNotation('B2', 'B2')).toBe('B2:B2');
    });

    it('should throw error for invalid cells', () => {
      expect(() => normalizeRangeNotation('invalid', 'A1')).toThrow(/Invalid cell references/);
      expect(() => normalizeRangeNotation('A1', 'invalid')).toThrow(/Invalid cell references/);
    });
  });

  describe('expandRange', () => {
    it('should expand a simple 2x2 range', () => {
      const result = expandRange('A1', 'B2');
      expect(result.rows).toBe(2);
      expect(result.cols).toBe(2);
      expect(result.cells).toEqual(['A1', 'B1', 'A2', 'B2']);
    });

    it('should expand a 3x3 range', () => {
      const result = expandRange('A1', 'C3');
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
      expect(result.cells).toEqual([
        'A1', 'B1', 'C1',
        'A2', 'B2', 'C2',
        'A3', 'B3', 'C3'
      ]);
    });

    it('should expand single cell range', () => {
      const result = expandRange('B2', 'B2');
      expect(result.rows).toBe(1);
      expect(result.cols).toBe(1);
      expect(result.cells).toEqual(['B2']);
    });

    it('should expand single row range', () => {
      const result = expandRange('A1', 'D1');
      expect(result.rows).toBe(1);
      expect(result.cols).toBe(4);
      expect(result.cells).toEqual(['A1', 'B1', 'C1', 'D1']);
    });

    it('should expand single column range', () => {
      const result = expandRange('A1', 'A3');
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(1);
      expect(result.cells).toEqual(['A1', 'A2', 'A3']);
    });

    it('should normalize reversed range', () => {
      const result = expandRange('C3', 'A1');
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
      expect(result.cells).toEqual([
        'A1', 'B1', 'C1',
        'A2', 'B2', 'C2',
        'A3', 'B3', 'C3'
      ]);
    });

    it('should throw error for invalid cells', () => {
      expect(() => expandRange('invalid', 'A1')).toThrow(/Invalid cell references/);
      expect(() => expandRange('A1', 'invalid')).toThrow(/Invalid cell references/);
    });
  });

  describe('getAdjacentCell', () => {
    it('should move up correctly', () => {
      expect(getAdjacentCell('B2', 'up')).toBe('B1');
      expect(getAdjacentCell('B3', 'up')).toBe('B2');
    });

    it('should move down correctly', () => {
      expect(getAdjacentCell('B2', 'down')).toBe('B3');
      expect(getAdjacentCell('B1', 'down')).toBe('B2');
    });

    it('should move left correctly', () => {
      expect(getAdjacentCell('B2', 'left')).toBe('A2');
      expect(getAdjacentCell('C2', 'left')).toBe('B2');
    });

    it('should move right correctly', () => {
      expect(getAdjacentCell('B2', 'right')).toBe('C2');
      expect(getAdjacentCell('A2', 'right')).toBe('B2');
    });

    it('should return null when moving out of bounds', () => {
      expect(getAdjacentCell('A1', 'up')).toBeNull();
      expect(getAdjacentCell('A1', 'left')).toBeNull();
    });

    it('should respect custom bounds', () => {
      expect(getAdjacentCell('O15', 'right', { maxCol: 'O', maxRow: 15 })).toBeNull();
      expect(getAdjacentCell('O15', 'down', { maxCol: 'O', maxRow: 15 })).toBeNull();
      expect(getAdjacentCell('O14', 'down', { maxCol: 'O', maxRow: 15 })).toBe('O15');
    });

    it('should return null for invalid direction', () => {
      expect(getAdjacentCell('B2', 'invalid')).toBeNull();
    });

    it('should return null for invalid cell key', () => {
      expect(getAdjacentCell('invalid', 'up')).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    describe('columnToNumber - Extended Edge Cases', () => {
      it('should handle triple-letter columns', () => {
        expect(columnToNumber('AAA')).toBe(703);
        expect(columnToNumber('AAB')).toBe(704);
        expect(columnToNumber('ZZZ')).toBe(18278);
      });
    });

    describe('numberToColumn - Extended Edge Cases', () => {
      it('should handle triple-letter column numbers', () => {
        expect(numberToColumn(703)).toBe('AAA');
        expect(numberToColumn(704)).toBe('AAB');
        expect(numberToColumn(18278)).toBe('ZZZ');
      });

      it('should round-trip with columnToNumber for large numbers', () => {
        const largeNumbers = [703, 1000, 5000, 10000, 18278];
        largeNumbers.forEach(num => {
          const col = numberToColumn(num);
          expect(columnToNumber(col)).toBe(num);
        });
      });

      it('should handle column number 1 consistently', () => {
        expect(numberToColumn(1)).toBe('A');
        expect(columnToNumber('A')).toBe(1);
      });

      it('should handle very large column numbers', () => {
        const veryLarge = 100000;
        const col = numberToColumn(veryLarge);
        expect(col).toBeDefined();
        expect(col.length).toBeGreaterThan(0);
        expect(columnToNumber(col)).toBe(veryLarge);
      });
    });

    describe('parseCellKey - Extended Edge Cases', () => {
      it('should handle maximum practical row numbers', () => {
        const result = parseCellKey('A999999');
        expect(result).toEqual({ col: 'A', row: 999999, colNum: 1 });
      });

      it('should handle very large row numbers', () => {
        const result = parseCellKey('A1000000');
        expect(result).toEqual({ col: 'A', row: 1000000, colNum: 1 });
      });

      it('should accept row number 0 for loop sheets', () => {
        expect(parseCellKey('A0')).toEqual({ col: 'A', row: 0, colNum: 1 });
      });

      it('should handle triple-letter columns', () => {
        const result = parseCellKey('AAA1');
        expect(result).toBeNull(); // Current implementation limits to 2 letters
      });

      it('should handle lowercase consistently', () => {
        expect(parseCellKey('aa1')).toEqual(parseCellKey('AA1'));
        expect(parseCellKey('zz99')).toEqual(parseCellKey('ZZ99'));
      });

      it('should reject strings with spaces', () => {
        expect(parseCellKey('A 1')).toBeNull();
        expect(parseCellKey(' A1')).toBeNull();
        expect(parseCellKey('A1 ')).toBeNull();
      });

      it('should reject cells with special characters', () => {
        expect(parseCellKey('A1!')).toBeNull();
        expect(parseCellKey('A-1')).toBeNull();
        expect(parseCellKey('A.1')).toBeNull();
      });
    });

    describe('expandRange - Extended Edge Cases', () => {
      it('should handle large ranges efficiently', () => {
        const result = expandRange('A1', 'E20');
        expect(result.rows).toBe(20);
        expect(result.cols).toBe(5);
        expect(result.cells.length).toBe(100);
      });

      it('should maintain correct order in reversed ranges', () => {
        const result = expandRange('E5', 'A1');
        // First cell should be A1
        expect(result.cells[0]).toBe('A1');
        // Last cell should be E5
        expect(result.cells[result.cells.length - 1]).toBe('E5');
      });

      it('should handle ranges with double-letter columns', () => {
        const result = expandRange('AA1', 'AB2');
        expect(result.rows).toBe(2);
        expect(result.cols).toBe(2);
        expect(result.cells).toEqual(['AA1', 'AB1', 'AA2', 'AB2']);
      });

      it('should handle very tall ranges', () => {
        const result = expandRange('A1', 'A100');
        expect(result.rows).toBe(100);
        expect(result.cols).toBe(1);
        expect(result.cells.length).toBe(100);
        expect(result.cells[0]).toBe('A1');
        expect(result.cells[99]).toBe('A100');
      });

      it('should handle very wide ranges', () => {
        const result = expandRange('A1', 'Z1');
        expect(result.rows).toBe(1);
        expect(result.cols).toBe(26);
        expect(result.cells.length).toBe(26);
        expect(result.cells[0]).toBe('A1');
        expect(result.cells[25]).toBe('Z1');
      });
    });

    describe('isCellInRange - Extended Edge Cases', () => {
      it('should handle ranges with double-letter columns', () => {
        expect(isCellInRange('AA5', { start: 'AA1', end: 'AB10' })).toBe(true);
        expect(isCellInRange('AB5', { start: 'AA1', end: 'AB10' })).toBe(true);
        expect(isCellInRange('AC5', { start: 'AA1', end: 'AB10' })).toBe(false);
      });

      it('should handle cells at exact range boundaries', () => {
        const range = { start: 'B2', end: 'D4' };
        // All corners
        expect(isCellInRange('B2', range)).toBe(true); // Top-left
        expect(isCellInRange('D2', range)).toBe(true); // Top-right
        expect(isCellInRange('B4', range)).toBe(true); // Bottom-left
        expect(isCellInRange('D4', range)).toBe(true); // Bottom-right

        // Just outside
        expect(isCellInRange('A2', range)).toBe(false); // Left of range
        expect(isCellInRange('E2', range)).toBe(false); // Right of range
        expect(isCellInRange('B1', range)).toBe(false); // Above range
        expect(isCellInRange('B5', range)).toBe(false); // Below range
      });

      it('should handle very large ranges', () => {
        expect(isCellInRange('Z99', { start: 'A1', end: 'ZZ100' })).toBe(true);
        expect(isCellInRange('AA50', { start: 'A1', end: 'ZZ100' })).toBe(true);
      });

      it('should be case-insensitive', () => {
        expect(isCellInRange('b2', { start: 'A1', end: 'C3' })).toBe(true);
        expect(isCellInRange('B2', { start: 'a1', end: 'c3' })).toBe(true);
      });
    });

    describe('normalizeRangeNotation - Extended Edge Cases', () => {
      it('should handle ranges with large row numbers', () => {
        expect(normalizeRangeNotation('A1', 'A1000')).toBe('A1:A1000');
        expect(normalizeRangeNotation('A1000', 'A1')).toBe('A1:A1000');
      });

      it('should handle ranges spanning many columns', () => {
        expect(normalizeRangeNotation('A1', 'Z1')).toBe('A1:Z1');
        expect(normalizeRangeNotation('Z1', 'A1')).toBe('A1:Z1');
      });

      it('should handle diagonal selections with double-letter columns', () => {
        expect(normalizeRangeNotation('AA1', 'AB10')).toBe('AA1:AB10');
        expect(normalizeRangeNotation('AB10', 'AA1')).toBe('AA1:AB10');
      });
    });

    describe('getAdjacentCell - Extended Edge Cases', () => {
      it('should handle movement from double-letter columns', () => {
        expect(getAdjacentCell('AA5', 'left')).toBe('Z5');
        expect(getAdjacentCell('AA5', 'right')).toBe('AB5');
        expect(getAdjacentCell('Z5', 'right')).toBe('AA5');
      });

      it('should handle movement near column boundaries', () => {
        expect(getAdjacentCell('Z1', 'right')).toBe('AA1');
        expect(getAdjacentCell('AA1', 'left')).toBe('Z1');
      });

      it('should respect maxRow bound at large numbers', () => {
        expect(getAdjacentCell('A999', 'down', { maxRow: 999 })).toBeNull();
        expect(getAdjacentCell('A998', 'down', { maxRow: 999 })).toBe('A999');
      });

      it('should respect maxCol bound with double-letter columns', () => {
        expect(getAdjacentCell('AA1', 'right', { maxCol: 'AA' })).toBeNull();
        expect(getAdjacentCell('Z1', 'right', { maxCol: 'AA' })).toBe('AA1');
      });

      it('should handle all four directions from same cell', () => {
        const cell = 'E5';
        expect(getAdjacentCell(cell, 'up')).toBe('E4');
        expect(getAdjacentCell(cell, 'down')).toBe('E6');
        expect(getAdjacentCell(cell, 'left')).toBe('D5');
        expect(getAdjacentCell(cell, 'right')).toBe('F5');
      });
    });

    describe('CELL_REF_PATTERN - Pattern Validation', () => {
      it('should match valid cell references', () => {
        expect(CELL_REF_PATTERN.test('A1')).toBe(true);
        expect(CELL_REF_PATTERN.test('Z99')).toBe(true);
        expect(CELL_REF_PATTERN.test('AA100')).toBe(true);
        expect(CELL_REF_PATTERN.test('$A$1')).toBe(true);
      });

      it('should not match invalid references', () => {
        expect(CELL_REF_PATTERN.test('A01')).toBe(false); // Leading zero
        expect(CELL_REF_PATTERN.test('AAA1')).toBe(false); // 3 letters
        expect(CELL_REF_PATTERN.test('A0')).toBe(true); // Row 0 valid for loop sheets
        expect(CELL_REF_PATTERN.test('1A')).toBe(false); // Number first
      });

      it('should not match non-cell-reference strings', () => {
        expect(CELL_REF_PATTERN.test('hello')).toBe(false);
        expect(CELL_REF_PATTERN.test('123')).toBe(false);
        expect(CELL_REF_PATTERN.test('')).toBe(false);
      });
    });

    describe('Performance and Stress Tests', () => {
      it('should handle rapid conversions between formats', () => {
        const iterations = 1000;
        for (let i = 1; i <= iterations; i++) {
          const col = numberToColumn(i);
          expect(columnToNumber(col)).toBe(i);
        }
      });

      it('should handle parsing many cell keys', () => {
        const cellKeys = [];
        for (let row = 1; row <= 100; row++) {
          for (let col = 1; col <= 26; col++) {
            cellKeys.push(`${numberToColumn(col)}${row}`);
          }
        }

        cellKeys.forEach(key => {
          const parsed = parseCellKey(key);
          expect(parsed).not.toBeNull();
        });
      });

      it('should handle large range expansions efficiently', () => {
        const start = Date.now();
        const result = expandRange('A1', 'Z100');
        const elapsed = Date.now() - start;

        expect(result.cells.length).toBe(2600);
        expect(elapsed).toBeLessThan(1000); // Should complete in less than 1 second
      });
    });
  });
});
