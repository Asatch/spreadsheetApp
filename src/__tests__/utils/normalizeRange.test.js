/**
 * Tests for normalizeRange utility function
 * Migrated from manual test: ~/dev/sc/sc-spreadsheet/test/manual/normalizeRangeTest.js
 */

// Define the normalizeRange function here for isolated testing
const normalizeRange = (startCol, startRow, endCol, endRow) => {
  // Convert columns to their index values for comparison
  const startColIndex = startCol.charCodeAt(0);
  const endColIndex = endCol.charCodeAt(0);
  
  // Compare column and row indices to determine the actual top-left and bottom-right
  // For a range like A1:B2, we want A (smaller column) and 1 (smaller row) as the start point
  // and B (larger column) and 2 (larger row) as the end point
  const topLeftCol = startColIndex <= endColIndex ? startCol : endCol;
  const topLeftRow = Math.min(startRow, endRow);
  const bottomRightCol = startColIndex <= endColIndex ? endCol : startCol;
  const bottomRightRow = Math.max(startRow, endRow);
  
  return {
    startCol: topLeftCol,
    startRow: topLeftRow,
    endCol: bottomRightCol,
    endRow: bottomRightRow
  };
};

describe('normalizeRange', () => {
  test('Normal order (A1:B2)', () => {
    const result = normalizeRange('A', 1, 'B', 2);
    expect(result).toEqual({
      startCol: 'A',
      startRow: 1,
      endCol: 'B',
      endRow: 2
    });
  });

  test('Reversed columns (B1:A2)', () => {
    const result = normalizeRange('B', 1, 'A', 2);
    expect(result).toEqual({
      startCol: 'A',
      startRow: 1,
      endCol: 'B',
      endRow: 2
    });
  });

  test('Reversed rows (A2:B1)', () => {
    const result = normalizeRange('A', 2, 'B', 1);
    expect(result).toEqual({
      startCol: 'A',
      startRow: 1,
      endCol: 'B',
      endRow: 2
    });
  });

  test('Completely reversed (B2:A1)', () => {
    const result = normalizeRange('B', 2, 'A', 1);
    expect(result).toEqual({
      startCol: 'A',
      startRow: 1,
      endCol: 'B',
      endRow: 2
    });
  });
});
