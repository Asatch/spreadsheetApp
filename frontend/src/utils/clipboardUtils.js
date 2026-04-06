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
  isCellInRange,
  getRangeBounds,
  CELL_REF_GLOBAL_PATTERN
} from './cellUtils.js';

/**
 * Extract all cell references from a formula
 * @param {string} formula - The formula to parse (must start with =)
 * @returns {Array} Array of objects with cellRef and absoluteInfo properties
 */
export function extractCellReferencesFromFormula(formula) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return [];
  }

  // Use shared global pattern from cellUtils
  const references = [];
  let match;

  // Reset lastIndex to avoid stale state from previous callers
  CELL_REF_GLOBAL_PATTERN.lastIndex = 0;

  while ((match = CELL_REF_GLOBAL_PATTERN.exec(formula)) !== null) {
    const [fullMatch, colDollar, colLetters, rowDollar, rowNumber] = match;

    references.push({
      cellRef: colLetters.toUpperCase() + rowNumber, // Clean cell ref without $ markers
      fullRef: fullMatch,
      absoluteInfo: {
        colAbs: colDollar === '$',
        rowAbs: rowDollar === '$'
      },
      position: {
        start: match.index,
        end: match.index + fullMatch.length
      }
    });
  }

  return references;
}

/**
 * Converts formula references to #REF! if they point to cells that are being overwritten
 * @param {string} formula - The formula to process
 * @param {Set} overwrittenCells - Set of cell references that have been overwritten
 * @returns {string} - Formula with references to overwritten cells replaced with #REF!
 */
export function replaceOverwrittenCellsWithRef(formula, overwrittenCells) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=') || !overwrittenCells?.size) {
    return formula;
  }

  const extractedRefs = extractCellReferencesFromFormula(formula);
  let result = formula;

  // Process in reverse order to avoid messing up the match positions when replacing
  for (let i = extractedRefs.length - 1; i >= 0; i--) {
    const ref = extractedRefs[i];
    const cleanRef = ref.cellRef.toUpperCase(); // Without $ markers

    if (overwrittenCells.has(cleanRef)) {
      // Replace this reference with #REF!
      const before = result.substring(0, ref.position.start);
      const after = result.substring(ref.position.end);
      result = before + '#REF!' + after;
    }
  }

  return result;
}

/**
 * Updates all occurrences of a specific cell reference in a formula to a new location or #REF!
 * @param {string} formula - The formula to process
 * @param {string} oldCellKey - The cell reference to find and replace (e.g., "A1")
 * @param {string} newCellKeyOrRef - The new cell reference (e.g., "B10") or "#REF!"
 * @returns {string} - Formula with all references to oldCellKey updated
 */
export function updateSingleCellReference(formula, oldCellKey, newCellKeyOrRef) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }

  const extractedRefs = extractCellReferencesFromFormula(formula);
  let result = formula;

  // Process in reverse order to avoid messing up the match positions when replacing
  for (let i = extractedRefs.length - 1; i >= 0; i--) {
    const ref = extractedRefs[i];
    const cleanRef = ref.cellRef.toUpperCase(); // Without $ markers

    if (cleanRef === oldCellKey.toUpperCase()) {
      // This reference matches the cell we're updating
      let replacement;

      if (newCellKeyOrRef === '#REF!') {
        // Convert to #REF! error
        replacement = '#REF!';
      } else {
        // Update to new cell location, preserving absolute markers
        const parsed = parseCellReference(newCellKeyOrRef);
        if (parsed) {
          replacement = formatCellReference(parsed.col, parsed.row, {
            colAbs: ref.absoluteInfo.colAbs,
            rowAbs: ref.absoluteInfo.rowAbs
          });
        } else {
          // If parsing fails, just use the new ref as-is
          replacement = newCellKeyOrRef;
        }
      }

      // Replace this reference
      const before = result.substring(0, ref.position.start);
      const after = result.substring(ref.position.end);
      result = before + replacement + after;
    }
  }

  return result;
}

/**
 * Updates a cell reference based on a range movement operation (cut/copy and paste)
 * @param {string} cellRef - Original cell reference (e.g., "$A$1", "A1", "$A1", "A$1")
 * @param {Object} sourceRange - Source range (either cut or copy range)
 * @param {string} sourceRange.start - Start of source range (e.g., "A1")
 * @param {string} sourceRange.end - End of source range (e.g., "B2")
 * @param {string} targetTopLeft - Top-left cell of paste destination (e.g., "C3")
 * @param {Object} options - Configuration options
 * @param {boolean} options.preserveAbsoluteRefs - Whether to preserve $ markers (default: true for copy, false for cut)
 * @param {boolean} options.isCutOperation - Whether this is a cut operation (default: false)
 * @returns {string} - Updated cell reference
 */
export function updateCellReference(cellRef, sourceRange, targetTopLeft, options = {}) {
  // Default options
  const {
    preserveAbsoluteRefs = !options.isCutOperation, // For cut, adjust $ refs by default
    isCutOperation = false
  } = options;

  // Parse the cell reference using parseCellReference function
  const parsed = parseCellReference(cellRef);
  if (!parsed) return cellRef;

  const hasColAbs = parsed.colAbs;
  const hasRowAbs = parsed.rowAbs;

  // Parse the range references (strip $ markers since we need clean cell positions)
  const cleanStart = sourceRange.start.replace(/\$/g, '');
  const cleanEnd = (sourceRange.end || sourceRange.start).replace(/\$/g, '');
  const cleanTarget = targetTopLeft.replace(/\$/g, '');

  const start = parseCellReference(cleanStart);
  const end = parseCellReference(cleanEnd);
  const pasteCell = parseCellReference(cleanTarget);

  if (!start || !pasteCell || !end) return cellRef;

  // Calculate offset from start of source range to paste location
  const colOffset = pasteCell.col - start.col;
  const rowOffset = pasteCell.row - start.row;

  // For references within the source range during a cut operation,
  // we need to calculate the relative position in the range
  let newCol = parsed.col;
  let newRow = parsed.row;

  // For cells inside the source range, calculate their relative position
  // and adjust based on the paste target's top-left corner
  // Strip $ from cellRef for range checking
  const cleanCellRef = cellRef.replace(/\$/g, '');
  const isInSourceRange = isCellInRange(cleanCellRef, { start: cleanStart, end: cleanEnd });

  if (isInSourceRange && isCutOperation) {
    // Calculate relative position within source range
    const relativeCol = parsed.col - start.col;
    const relativeRow = parsed.row - start.row;

    // Apply relative position to target
    newCol = pasteCell.col + relativeCol;
    newRow = pasteCell.row + relativeRow;
  } else {
    // For cells outside the range or copy operations
    // Update column if it's not absolute or if we're handling cut operation
    if (!hasColAbs || !preserveAbsoluteRefs) {
      newCol += colOffset;
    }

    // Update row if it's not absolute or if we're handling cut operation
    if (!hasRowAbs || !preserveAbsoluteRefs) {
      newRow += rowOffset;
    }
  }

  // Format with original $ markers
  return formatCellReference(newCol, newRow, {
    colAbs: hasColAbs,
    rowAbs: hasRowAbs
  });
}

/**
 * Pattern for matching relative literals (~N) in formulas.
 * Relative literals adjust during row generation in loop sheets.
 * @constant {RegExp}
 */
const RELATIVE_LITERAL_PATTERN = /~(\d+)/g;

/**
 * Adjusts all cell references and relative literals in a formula by a fixed row and column offset.
 * Respects absolute ($) markers - absolute references are not adjusted.
 *
 * This is a simpler utility than adjustFormulaReferences, used for:
 * - Loop sheet iteration (adjusting Row 1 formulas for generated rows)
 * - Fill operations (future)
 *
 * @param {string} formula - The formula to adjust (must start with =)
 * @param {number} rowOffset - Number of rows to shift (positive = down)
 * @param {number} colOffset - Number of columns to shift (positive = right), defaults to 0
 * @returns {string} - The adjusted formula
 *
 * @example
 * adjustFormulaByOffset("=A0+B0", 1, 0)  // Returns "=A1+B1"
 * adjustFormulaByOffset("=A$0+B1", 2, 0) // Returns "=A$0+B3" ($0 stays fixed)
 * adjustFormulaByOffset("=$A1+B1", 0, 1) // Returns "=$A1+C1" ($A stays fixed)
 * adjustFormulaByOffset("=~1+A1", 1, 0)  // Returns "=~2+A2" (~N adjusts by rowOffset)
 */
export function adjustFormulaByOffset(formula, rowOffset, colOffset = 0) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }

  // If no offset, return as-is
  if (rowOffset === 0 && colOffset === 0) {
    return formula;
  }

  // First, adjust cell references
  let result = formula.replace(CELL_REF_GLOBAL_PATTERN, (match, colDollar, col, rowDollar, row) => {
    const hasColAbs = colDollar === '$';
    const hasRowAbs = rowDollar === '$';

    // Parse the cell reference
    const parsed = parseCellReference(`${col}${row}`);
    if (!parsed) return match;

    // Apply offsets, respecting absolute markers
    let newCol = parsed.col;
    let newRow = parsed.row;

    if (!hasColAbs) {
      newCol += colOffset;
    }
    if (!hasRowAbs) {
      newRow += rowOffset;
    }

    // Check for invalid references (negative row/col for normal columns)
    // Reserved columns (like _STOP) have negative col numbers and that's OK
    if (newCol < 1 && newCol > -100) {
      return '#REF!';
    }
    if (newRow < 0) {
      return '#REF!';
    }

    return formatCellReference(newCol, newRow, {
      colAbs: hasColAbs,
      rowAbs: hasRowAbs
    });
  });

  // Then, adjust relative literals (~N) by rowOffset only
  result = result.replace(RELATIVE_LITERAL_PATTERN, (match, num) => {
    const newNum = parseInt(num, 10) + rowOffset;
    if (newNum < 0) {
      return '#REF!';
    }
    return `~${newNum}`;
  });

  return result;
}

/**
 * Collapses all cell references in a formula to row 1.
 * References already at row 0 or 1 are left unchanged.
 * Used for loop sheets where row 1 is the template row.
 *
 * @example
 * collapseFormulaToRow1("=A3+B5")       // "=A1+B1"
 * collapseFormulaToRow1("=$A$3+B1")     // "=$A$1+B1"
 * collapseFormulaToRow1("=A0+B2")       // "=A0+B1"
 * collapseFormulaToRow1("=SUM(A3:C5)")  // "=SUM(A1:C1)"
 *
 * @param {string} formula - The formula to transform (must start with =)
 * @returns {string} The formula with all row references > 1 collapsed to 1
 */
export function collapseFormulaToRow1(formula) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }

  return formula.replace(CELL_REF_GLOBAL_PATTERN, (match, colDollar, col, rowDollar, row) => {
    const rowNum = parseInt(row, 10);
    if (rowNum > 1) {
      return `${colDollar}${col}${rowDollar}1`;
    }
    return match;
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
 * Adjusts a formula's cell references based on a range movement operation
 * @param {string} formula - The formula to adjust
 * @param {Object} sourceRange - Source range (either cut or copy range)
 * @param {string} sourceRange.start - Start of source range
 * @param {string} sourceRange.end - End of source range
 * @param {string} targetTopLeft - Top-left cell of paste destination
 * @param {Object} options - Configuration options
 * @param {boolean} options.isCutOperation - Whether this is a cut operation (affects how references are adjusted)
 * @param {Set} options.overwrittenCells - Set of cell IDs that were overwritten by the paste
 * @param {Object} options.gridBounds - Grid bounds { maxCol: 'O', maxRow: 15 } for bounds checking
 * @returns {string} - The adjusted formula
 */
export function adjustFormulaReferences(formula, sourceRange, targetTopLeft, options = {}) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }

  const { isCutOperation = false, overwrittenCells = new Set(), gridBounds = null } = options;

  // Parse source range
  const start = parseCellReference(sourceRange.start);
  const end = parseCellReference(sourceRange.end || sourceRange.start);
  const target = parseCellReference(targetTopLeft);

  if (!start || !end || !target) return formula;

  // First check if any references point to overwritten cells
  // This takes precedence over moving references
  if (overwrittenCells.size > 0) {
    formula = replaceOverwrittenCellsWithRef(formula, overwrittenCells);
  }

  // Continue to adjust remaining valid cell references even if formula contains #REF!
  // Process each cell reference in the formula using shared global pattern
  return formula.replace(CELL_REF_GLOBAL_PATTERN, (match, colDollar, col, rowDollar, row) => {
    // Clean cell reference (without $ markers)
    const cellRef = `${col}${row}`;
    const hasColAbs = colDollar === '$';
    const hasRowAbs = rowDollar === '$';

    // Check if reference is within source range
    const isInSourceRange = isCellInRange(cellRef, sourceRange);

    // For references within the cut/copy range, adjust them based on the new position
    if (isInSourceRange) {
      const newRef = updateCellReference(match, sourceRange, targetTopLeft, {
        preserveAbsoluteRefs: true,  // Always preserve $ markers
        isCutOperation
      });

      // Check if adjusted reference is within bounds
      const adjustedCell = parseCellReference(newRef);
      if (adjustedCell && !isWithinBounds(adjustedCell.col, adjustedCell.row, gridBounds)) {
        return '#REF!';
      }

      return newRef;
    }
    // For cut operations, we also need to adjust references to cells in the cut range
    // from outside formulas to point to their new locations
    else if (isCutOperation) {
      const refCell = parseCellReference(cellRef);
      if (!refCell) return match;

      // Check if this is referencing a cell in the source range
      if (refCell.col >= Math.min(start.col, end.col) &&
          refCell.col <= Math.max(start.col, end.col) &&
          refCell.row >= Math.min(start.row, end.row) &&
          refCell.row <= Math.max(start.row, end.row)) {

        // Calculate relative position within source range
        const relCol = refCell.col - Math.min(start.col, end.col);
        const relRow = refCell.row - Math.min(start.row, end.row);

        // Apply offset to get new position
        const newCol = target.col + relCol;
        const newRow = target.row + relRow;

        // Check if adjusted reference is within bounds
        if (!isWithinBounds(newCol, newRow, gridBounds)) {
          return '#REF!';
        }

        // Format with original absolute markers
        return formatCellReference(newCol, newRow, {
          colAbs: hasColAbs,
          rowAbs: hasRowAbs
        });
      }
    }
    // For copy operations, also adjust external references by the same offset
    else if (!isCutOperation) {
      // Only adjust if the reference is not absolute
      const refCell = parseCellReference(cellRef);
      if (!refCell) return match;

      // Calculate offset from source top-left to target top-left
      const colOffset = target.col - start.col;
      const rowOffset = target.row - start.row;

      // For copy operations, we shift external references by the same offset
      // but respect absolute markers
      let newCol = refCell.col;
      let newRow = refCell.row;

      // Only adjust the column if it's not absolute
      if (!hasColAbs) {
        newCol += colOffset;
      }

      // Only adjust the row if it's not absolute
      if (!hasRowAbs) {
        newRow += rowOffset;
      }

      // Check if adjusted reference is within bounds
      if (!isWithinBounds(newCol, newRow, gridBounds)) {
        return '#REF!';
      }

      // Format with original absolute markers
      return formatCellReference(newCol, newRow, {
        colAbs: hasColAbs,
        rowAbs: hasRowAbs
      });
    }

    // For references not in the source range and not a copy operation, leave unchanged
    return match;
  });
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
