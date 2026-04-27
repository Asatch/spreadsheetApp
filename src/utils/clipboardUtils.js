/**
 * CLIPBOARD UTILITIES
 * ===================
 *
 * Advanced utilities for clipboard operations including:
 * - Formula reference parsing with absolute ($) markers
 * - Formula reference adjustment for copy/cut/paste
 * - Clipboard data formatting
 * - #REF! error handling
 */

import {
  columnToNumber,
  numberToColumn,
  parseCellReference,
  formatCellReference,
  getRangeBounds
} from './cellUtils.js';
import { rewriteCellRefs } from './formulaTokenizer.js';

/**
 * Promotes CELL_REF tokens in `overwrittenCells` to ERROR tokens with value '#REF!'.
 * Mutates the token array and repacks positions.
 *
 * @param {Token[]} tokens
 * @param {Set<string>} overwrittenCells - Set of canonical cell keys ("A1", "B2")
 * @returns {Token[]} the same array, mutated
 */
export function replaceOverwrittenCellRefsInTokens(tokens, overwrittenCells) {
  if (!overwrittenCells?.size) return tokens;
  return rewriteCellRefs(tokens, (t) => {
    if (overwrittenCells.has(t.value)) return '#REF!';
    return null;
  });
}

/**
 * Shifts every CELL_REF token's row/column by the given offsets. Honors
 * colAbs/rowAbs flags (absolute refs don't shift). Out-of-bounds results
 * become '#REF!'. Mutates in place.
 *
 * @param {Token[]} tokens
 * @param {number} rowOffset
 * @param {number} colOffset
 * @returns {Token[]} the same array, mutated
 */
export function adjustTokensByOffset(tokens, rowOffset, colOffset = 0) {
  if (rowOffset === 0 && colOffset === 0) return tokens;
  return rewriteCellRefs(tokens, (t) => {
    const parsed = parseCellReference(t.value);
    if (!parsed) return null;
    const newCol = t.colAbs ? parsed.col : parsed.col + colOffset;
    const newRow = t.rowAbs ? parsed.row : parsed.row + rowOffset;
    // Reserved columns (_STOP) have negative col numbers — leave those alone.
    if (newCol < 1 && newCol > -100) return '#REF!';
    if (newRow < 0) return '#REF!';
    return numberToColumn(newCol) + newRow;
  });
}

/**
 * Rewrites every CELL_REF token whose row > 1 to the same column at row 1.
 * Used for loop sheets where row 1 is the template row. Mutates in place;
 * colAbs/rowAbs flags are preserved.
 *
 * @param {Token[]} tokens
 * @returns {Token[]} the same array, mutated
 */
export function collapseTokensToRow1(tokens) {
  return rewriteCellRefs(tokens, (t) => {
    // value is already $-stripped and uppercased: "A3", "AZ15", "_STOP0".
    const m = t.value.match(/^([A-Z]+|_STOP)(\d+)$/);
    if (!m) return null;
    const rowNum = parseInt(m[2], 10);
    if (rowNum <= 1) return null;
    return m[1] + '1';
  });
}

/**
 * Check if a cell reference is within grid bounds
 * @param {number} colNum - Column number (1-based)
 * @param {number} rowNum - Row number (0-based or 1-based depending on minRow)
 * @param {Object} gridBounds - Grid bounds { maxCol: 'O', maxRow: 15, minRow?: 0|1 }
 * @returns {boolean} - True if within bounds
 */
function isWithinBounds(colNum, rowNum, gridBounds) {
  if (!gridBounds) return true; // No bounds checking if not provided

  const maxColNum = columnToNumber(gridBounds.maxCol);
  const minRow = gridBounds.minRow ?? 1; // Default to 1 for normal sheets, 0 for loop sheets
  return colNum >= 1 && colNum <= maxColNum && rowNum >= minRow && rowNum <= gridBounds.maxRow;
}

/**
 * Token-native cell-ref adjustment for range movement (cut/copy/paste). Mutates the token array in place:
 * CELL_REF tokens inside the source range are relocated to the target; external
 * refs are shifted (copy) or retargeted (cut) as appropriate. Out-of-bounds
 * references are promoted to ERROR tokens with value '#REF!'. Absolute markers
 * (colAbs/rowAbs) are honored for the shift logic and preserved on output.
 *
 * Returns true on success, false if sourceRange/targetTopLeft couldn't be parsed
 * (caller may then fall back to the original tokens unchanged).
 *
 * @param {Token[]} tokens
 * @param {{start: string, end?: string}} sourceRange
 * @param {string} targetTopLeft
 * @param {{isCutOperation?: boolean, overwrittenCells?: Set<string>, gridBounds?: Object|null}} [options]
 * @returns {boolean}
 */
export function adjustTokenReferences(tokens, sourceRange, targetTopLeft, options = {}) {
  const { isCutOperation = false, overwrittenCells = new Set(), gridBounds = null } = options;

  const start = parseCellReference(sourceRange.start);
  const end = parseCellReference(sourceRange.end || sourceRange.start);
  const target = parseCellReference(targetTopLeft);
  if (!start || !end || !target) return false;

  const srcMinCol = Math.min(start.col, end.col);
  const srcMaxCol = Math.max(start.col, end.col);
  const srcMinRow = Math.min(start.row, end.row);
  const srcMaxRow = Math.max(start.row, end.row);
  const colOffset = target.col - start.col;
  const rowOffset = target.row - start.row;

  // Overwritten-cells replacement applies only to cells that are pure paste
  // destinations. Cells in source ∩ destination are being repositioned by the
  // move (the relocation pass below shifts them), so promoting their refs to
  // #REF! here would clobber formulas whose target rides along with the block.
  if (overwrittenCells.size > 0) {
    const externalOverwrites = new Set();
    for (const key of overwrittenCells) {
      const cell = parseCellReference(key);
      if (!cell) continue;
      const inSource =
        cell.col >= srcMinCol && cell.col <= srcMaxCol &&
        cell.row >= srcMinRow && cell.row <= srcMaxRow;
      if (!inSource) externalOverwrites.add(key);
    }
    if (externalOverwrites.size > 0) {
      replaceOverwrittenCellRefsInTokens(tokens, externalOverwrites);
    }
  }

  rewriteCellRefs(tokens, (t) => {
    const refCell = parseCellReference(t.value);
    if (!refCell) return null;

    const inSource =
      refCell.col >= srcMinCol && refCell.col <= srcMaxCol &&
      refCell.row >= srcMinRow && refCell.row <= srcMaxRow;

    // Inside source range: relocate. Cut moves the ref with its target;
    // copy honors absolute markers (absolute refs don't shift).
    if (inSource) {
      let newCol, newRow;
      if (isCutOperation) {
        newCol = target.col + (refCell.col - start.col);
        newRow = target.row + (refCell.row - start.row);
      } else {
        newCol = t.colAbs ? refCell.col : refCell.col + colOffset;
        newRow = t.rowAbs ? refCell.row : refCell.row + rowOffset;
      }
      if (!isWithinBounds(newCol, newRow, gridBounds)) return '#REF!';
      return numberToColumn(newCol) + newRow;
    }

    // External ref, cut operation: no shift (refs outside the cut range stay
    // pointing at their original cells).
    if (isCutOperation) return null;

    // External ref, copy operation: shift by (target - source), honoring $.
    const newCol = t.colAbs ? refCell.col : refCell.col + colOffset;
    const newRow = t.rowAbs ? refCell.row : refCell.row + rowOffset;
    if (!isWithinBounds(newCol, newRow, gridBounds)) return '#REF!';
    return numberToColumn(newCol) + newRow;
  });

  return true;
}

/**
 * Adjusts a named range notation based on a range movement operation (cut and paste).
 * Uses the same offset logic as formula reference adjustment.
 *
 * @param {string} notation - The range notation to adjust (e.g., "A1:B2" or "A1")
 * @param {Object} sourceRange - Source range (cut range)
 * @param {string} sourceRange.start - Start of source range
 * @param {string} sourceRange.end - End of source range
 * @param {string} targetTopLeft - Top-left cell of paste destination
 * @returns {string|null} - The adjusted notation, or null if adjustment fails
 */
export function adjustRangeNotation(notation, sourceRange, targetTopLeft) {
  if (!notation || typeof notation !== 'string') {
    return null;
  }

  // Parse source range
  const start = parseCellReference(sourceRange.start);
  const end = parseCellReference(sourceRange.end || sourceRange.start);
  const target = parseCellReference(targetTopLeft);

  if (!start || !end || !target) {
    return null;
  }

  // Calculate offset from source top-left to target top-left
  const minSourceCol = Math.min(start.col, end.col);
  const minSourceRow = Math.min(start.row, end.row);
  const colOffset = target.col - minSourceCol;
  const rowOffset = target.row - minSourceRow;

  // Check if notation is a range (contains :) or single cell
  const isRange = notation.includes(':');

  if (isRange) {
    // Parse the range (e.g., "A1:B2")
    const [startNotation, endNotation] = notation.split(':');
    const rangeStart = parseCellReference(startNotation);
    const rangeEnd = parseCellReference(endNotation);

    if (!rangeStart || !rangeEnd) {
      return null;
    }

    // Apply offset to both start and end
    const newStartCol = rangeStart.col + colOffset;
    const newStartRow = rangeStart.row + rowOffset;
    const newEndCol = rangeEnd.col + colOffset;
    const newEndRow = rangeEnd.row + rowOffset;

    // Format the new range
    const newStart = formatCellReference(newStartCol, newStartRow);
    const newEnd = formatCellReference(newEndCol, newEndRow);

    return `${newStart}:${newEnd}`;
  } else {
    // Single cell notation (e.g., "A1")
    const cell = parseCellReference(notation);

    if (!cell) {
      return null;
    }

    // Apply offset
    const newCol = cell.col + colOffset;
    const newRow = cell.row + rowOffset;

    return formatCellReference(newCol, newRow);
  }
}

/**
 * Format selected cells data for the system clipboard
 * @param {Function} getValue - Function to get canonical value for a cell key
 * @param {Array<string>} cellKeys - Array of cell keys (e.g., ["A1", "B1", "A2", "B2"])
 * @param {Object} selectionRange - Range object with start and end
 * @returns {string} Tab-delimited text formatted for clipboard
 */
export function formatCellsForClipboard(getValue, cellKeys, selectionRange) {
  if (!cellKeys || !cellKeys.length || !getValue) {
    return '';
  }

  const bounds = getRangeBounds(selectionRange.start, selectionRange.end);

  if (!bounds) {
    return '';
  }

  // Create a 2D grid of the selected region
  const gridData = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    const rowData = [];
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const cellKey = `${numberToColumn(col)}${row}`;
      const value = getValue(cellKey);

      // Include formulas and values as-is
      rowData.push(value || '');
    }
    gridData.push(rowData);
  }

  // Convert to tab-delimited format
  return gridData.map(row => row.join('\t')).join('\n');
}

/**
 * Generate a simple hash from a string (for clipboard identity)
 * @param {string} str - The string to hash
 * @returns {string} - A hash string
 */
export function generateClipboardHash(str) {
  if (!str) return '';

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16); // Convert to hex string
}

/**
 * Updates all occurrences of an input reference name in a formula.
 * Handles word boundaries to avoid partial matches (e.g., "tax" vs "taxRate").
 *
 * @param {string} formula - The formula to update (must start with =)
 * @param {string} oldInputName - The old input name to find
 * @param {string} newInputName - The new input name to replace with
 * @returns {string} - The updated formula
 *
 * @example
 * updateInputReference("=tax+1", "tax", "taxRate")  // Returns "=taxRate+1"
 * updateInputReference("=SUM(tax,foo)", "tax", "bar")  // Returns "=SUM(bar,foo)"
 * updateInputReference("=taxRate+tax", "tax", "bar")  // Returns "=taxRate+bar" (only exact match)
 */
export function updateInputReference(formula, oldInputName, newInputName) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }

  // Characters that can appear before or after an input name (word boundaries)
  const validBoundary = /^$|[(,+\-*/^=<>)&\s:]/;
  let result = '=';
  let i = 1;

  while (i < formula.length) {
    // Check if the substring at position i matches oldInputName (case-insensitive)
    if (formula.slice(i, i + oldInputName.length).toUpperCase() === oldInputName.toUpperCase()) {
      const charBefore = i === 1 ? '' : formula[i - 1];
      const charAfter = formula[i + oldInputName.length] || '';

      // Only replace if surrounded by valid boundary characters
      if (validBoundary.test(charBefore) && validBoundary.test(charAfter)) {
        result += newInputName;
        i += oldInputName.length;
        continue;
      }
    }
    result += formula[i];
    i++;
  }

  return result;
}
