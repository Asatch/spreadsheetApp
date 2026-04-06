/**
 * @file Cell Reference Utilities
 * @description Core utilities for cell reference parsing, validation, and manipulation in the spreadsheet application.
 *
 * **Key Features:**
 * - Cell reference parsing and validation (A1 notation)
 * - Column letter ↔ number conversion (A=1, Z=26, AA=27, etc.)
 * - Absolute reference support ($A$1, $A1, A$1)
 * - Range operations (expansion, normalization, containment checks)
 * - Cell navigation (adjacent cells, bounds checking)
 *
 * **Cell Reference Formats:**
 * - Simple: "A1", "Z99", "AA100"
 * - Absolute column: "$A1", "$Z99"
 * - Absolute row: "A$1", "Z$99"
 * - Fully absolute: "$A$1", "$Z$99"
 *
 * **Constraints:**
 * - Row numbers: 1-based, no leading zeros (e.g., "A01" is invalid)
 * - Column letters: 1-2 letters max (A-ZZ, supports up to 702 columns)
 * - Internal cell keys: Must NOT contain $ markers (use parseCellKey)
 * - Formula references: May contain $ markers (use parseCellReference)
 */

/**
 * @typedef {Object} ParsedCellKey
 * @property {string} col - Column letters (e.g., "A", "AB")
 * @property {number} row - Row number (1-based)
 * @property {number} colNum - Column number (1-based: A=1, B=2, etc.)
 */

/**
 * @typedef {Object} ParsedCellReference
 * @property {number} col - Column number (1-based: A=1, B=2, etc.)
 * @property {number} row - Row number (1-based)
 * @property {boolean} colAbs - Whether column has $ marker (absolute reference)
 * @property {boolean} rowAbs - Whether row has $ marker (absolute reference)
 * @property {string} originalCol - Original column letters in uppercase (e.g., "A", "AB")
 */

/**
 * @typedef {Object} RangeExpansion
 * @property {number} rows - Number of rows in the range
 * @property {number} cols - Number of columns in the range
 * @property {string[]} cells - Array of all cell keys in the range (top-left to bottom-right order)
 */

/**
 * Regular expression for matching a single cell reference.
 *
 * **Pattern breakdown:**
 * - Group 1: Optional $ before column (absolute column marker)
 * - Group 2: Column name - either 1-2 letters (A-ZZ) or reserved name (_STOP)
 * - Group 3: Optional $ before row (absolute row marker)
 * - Group 4: Row number starting with 0-9 (0 allowed for loop sheets, no leading zeros except bare 0)
 *
 * **Valid examples:** "A1", "Z99", "AA100", "$A1", "A$1", "$A$1", "_STOP0", "_STOP1"
 * **Invalid examples:** "A01" (leading zero), "AAA1" (3 letters), "A00" (leading zero)
 *
 * **Reserved column names:**
 * - `_STOP`: Stop condition column for loop sheets
 *
 * @constant {RegExp}
 */
export const CELL_REF_PATTERN = /^(\$?)([A-Z]{1,2}|_STOP)(\$?)(0|[1-9][0-9]*)$/i;

/**
 * Regular expression for globally matching all cell references in a formula string.
 *
 * Same pattern as CELL_REF_PATTERN but with global flag for finding all matches.
 * Used to extract all cell references from formula strings for dependency tracking.
 *
 * **Example usage:**
 * ```js
 * const formula = "=A1+B2*$C$3";
 * const matches = formula.matchAll(CELL_REF_GLOBAL_PATTERN);
 * // Finds: ["A1", "B2", "$C$3"]
 * ```
 *
 * @constant {RegExp}
 */
export const CELL_REF_GLOBAL_PATTERN = /(\$?)([A-Z]{1,2}|_STOP)(\$?)(0|[1-9][0-9]*)/gi;

/**
 * Reserved column names and their assigned column numbers.
 * Uses negative numbers to avoid conflicts with normal columns (which are 1+).
 *
 * @constant {Object<string, number>}
 */
const RESERVED_COLUMNS = {
  '_STOP': -1  // Stop condition column for loop sheets
};

/**
 * Convert column letters to number (A=1, B=2, ..., Z=26, AA=27, etc.).
 *
 * Uses base-26 positional notation where A=1, B=2, ..., Z=26, then
 * AA=27, AB=28, ..., AZ=52, BA=53, ..., ZZ=702.
 *
 * Reserved column names (like `_STOP`) map to negative numbers.
 *
 * @param {string} col - Column letters (e.g., "A", "AB", "ZZ") or reserved name ("_STOP"), case-insensitive
 * @returns {number} Column number (1-based for normal columns, negative for reserved)
 *
 * @example
 * columnToNumber("A")      // 1
 * columnToNumber("Z")      // 26
 * columnToNumber("AA")     // 27
 * columnToNumber("_STOP")  // -1
 */
export function columnToNumber(col) {
  const upperCol = col.toUpperCase();
  if (RESERVED_COLUMNS[upperCol] !== undefined) {
    return RESERVED_COLUMNS[upperCol];
  }

  /** @type {number} */
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (upperCol.charCodeAt(i) - 64);
  }
  return num;
}

/**
 * Reverse lookup for reserved column numbers to names.
 * @constant {Object<number, string>}
 */
const RESERVED_COLUMN_NUMBERS = {
  [-1]: '_STOP'
};

/**
 * Convert column number to letters (1=A, 2=B, ..., 26=Z, 27=AA, etc.).
 *
 * Inverse of columnToNumber. Converts 1-based column numbers back to letter notation
 * using modified base-26 system (A-Z then AA-ZZ).
 *
 * Negative numbers map to reserved column names.
 *
 * @param {number} num - Column number (1-based for normal, negative for reserved)
 * @returns {string} Column letters in uppercase (e.g., "A", "AB", "ZZ", "_STOP")
 *
 * @example
 * numberToColumn(1)    // "A"
 * numberToColumn(26)   // "Z"
 * numberToColumn(27)   // "AA"
 * numberToColumn(-1)   // "_STOP"
 */
export function numberToColumn(num) {
  // Check for reserved column numbers
  if (RESERVED_COLUMN_NUMBERS[num] !== undefined) {
    return RESERVED_COLUMN_NUMBERS[num];
  }

  /** @type {string} */
  let col = '';
  while (num > 0) {
    /** @type {number} */
    const remainder = (num - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
}

/**
 * Parse a cell key into its components (simple version without $ markers).
 *
 * **Important:** Cell keys are used internally as identifiers (Map keys, DOM attributes,
 * selection state) and should NEVER contain $ markers. This function validates that
 * constraint and throws an error if $ markers are found.
 *
 * **Use cases:**
 * - Parsing user-provided cell keys for navigation
 * - Validating internal cell identifiers
 * - Converting cell keys to components for range calculations
 *
 * **When to use vs parseCellReference:**
 * - Use parseCellKey: For internal cell identifiers (no $ markers)
 * - Use parseCellReference: For formula parsing (may have $ markers)
 *
 * @param {string} cellKey - Cell key (e.g., "A1", "AB123") - must NOT contain $ markers
 * @returns {ParsedCellKey|null} Parsed components, or null if invalid format
 * @throws {Error} If the cell key contains $ markers (indicates caller bug)
 *
 * @example
 * parseCellKey("A1")    // { col: "A", row: 1, colNum: 1 }
 * parseCellKey("AB99")  // { col: "AB", row: 99, colNum: 28 }
 * parseCellKey("$A1")   // throws Error ($ markers not allowed)
 * parseCellKey("A01")   // null (leading zero not allowed)
 */
export function parseCellKey(cellKey) {
  // Delegate to parseCellReference for consistency
  /** @type {ParsedCellReference|null} */
  const parsed = parseCellReference(cellKey);
  if (!parsed) {
    return null;
  }

  // Ensure no $ markers are present - this would indicate a bug in the calling code
  if (parsed.colAbs || parsed.rowAbs) {
    throw new Error(
      `parseCellKey received a cell reference with $ markers: "${cellKey}". ` +
      `Cell keys should not contain absolute reference markers. ` +
      `This indicates a bug in the calling code - use parseCellReference() for formula references.`
    );
  }

  // Simpler return shape: col as string (e.g., "A"), colNum as number (e.g., 1)
  return {
    col: parsed.originalCol,
    row: parsed.row,
    colNum: parsed.col
  };
}

/**
 * Parse a cell reference into column and row components with absolute reference markers.
 *
 * More advanced than parseCellKey - handles $ markers for absolute references.
 * Used primarily for formula parsing where absolute references ($A$1) are needed.
 *
 * **Absolute Reference Types:**
 * - Relative: "A1" - both column and row adjust when copied
 * - Absolute column: "$A1" - column fixed, row adjusts
 * - Absolute row: "A$1" - row fixed, column adjusts
 * - Fully absolute: "$A$1" - neither adjusts when copied
 *
 * @param {string} cellRef - Cell reference (e.g., "A1", "$A1", "A$1", "$A$1"), case-insensitive
 * @returns {ParsedCellReference|null} Parsed components with absolute markers, or null if invalid
 *
 * @example
 * parseCellReference("A1")
 * // { col: 1, row: 1, colAbs: false, rowAbs: false, originalCol: "A" }
 *
 * parseCellReference("$A$1")
 * // { col: 1, row: 1, colAbs: true, rowAbs: true, originalCol: "A" }
 *
 * parseCellReference("$A1")
 * // { col: 1, row: 1, colAbs: true, rowAbs: false, originalCol: "A" }
 *
 * parseCellReference("invalid")  // null
 */
export function parseCellReference(cellRef) {
  if (!cellRef || typeof cellRef !== 'string') {
    return null;
  }

  // Match the cell reference with optional $ markers (disallow leading zeros)
  /** @type {RegExpMatchArray|null} */
  const match = cellRef.match(CELL_REF_PATTERN);
  if (!match) return null;

  // Destructure match groups: [fullMatch, colDollar, colStr, rowDollar, rowStr]
  const [, colDollar, colStr, rowDollar, rowStr] = match;
  /** @type {boolean} */
  const colAbs = colDollar === '$';
  /** @type {boolean} */
  const rowAbs = rowDollar === '$';
  /** @type {number} */
  const rowNum = parseInt(rowStr, 10);
  /** @type {number} */
  const colNum = columnToNumber(colStr.toUpperCase());

  return {
    col: colNum,
    row: rowNum,
    colAbs,
    rowAbs,
    originalCol: colStr.toUpperCase(),
  };
}

/**
 * Format a cell reference from column and row numbers.
 *
 * Inverse of parseCellReference. Constructs an A1-notation cell reference string
 * from numeric components with optional absolute reference markers.
 *
 * @param {number} colNum - Column number (1-based: A=1, B=2, etc.)
 * @param {number} rowNum - Row number (1-based)
 * @param {Object} [options={}] - Optional formatting options
 * @param {boolean} [options.colAbs=false] - Whether column should have $ marker (absolute reference)
 * @param {boolean} [options.rowAbs=false] - Whether row should have $ marker (absolute reference)
 * @returns {string} Cell reference in A1 format
 *
 * @example
 * formatCellReference(1, 1)                           // "A1"
 * formatCellReference(1, 1, { colAbs: true })        // "$A1"
 * formatCellReference(1, 1, { rowAbs: true })        // "A$1"
 * formatCellReference(1, 1, { colAbs: true, rowAbs: true })  // "$A$1"
 * formatCellReference(28, 99)                         // "AB99"
 */
export function formatCellReference(colNum, rowNum, options = {}) {
  const { colAbs = false, rowAbs = false } = options;
  /** @type {string} */
  const colLetter = numberToColumn(colNum);

  return `${colAbs ? '$' : ''}${colLetter}${rowAbs ? '$' : ''}${rowNum}`;
}

/**
 * Check if a cell is within a range.
 *
 * Supports ranges in any direction (start/end can be any two corners).
 * Automatically normalizes the range to find min/max bounds.
 *
 * @param {string} cellRef - Cell reference to check (e.g., "A1", "$A$1"), $ markers stripped automatically
 * @param {Object} range - Range object with start and end cell references
 * @param {string} range.start - Start cell reference (e.g., "A1")
 * @param {string} [range.end] - End cell reference (e.g., "B5"), defaults to start if omitted (single cell range)
 * @returns {boolean} True if the cell is within the range bounds, false otherwise
 *
 * @example
 * isCellInRange("B2", { start: "A1", end: "C3" })   // true
 * isCellInRange("D4", { start: "A1", end: "C3" })   // false
 * isCellInRange("$A$1", { start: "A1", end: "B2" }) // true ($ markers ignored)
 * isCellInRange("A1", { start: "A1" })              // true (single cell range)
 */
export function isCellInRange(cellRef, range) {
  if (!cellRef || !range || !range.start) {
    return false;
  }

  // Clean up the cell reference to remove $ markers
  /** @type {string} */
  const cleanCellRef = typeof cellRef === 'string' ? cellRef.replace(/\$/g, '') : cellRef;

  /** @type {ParsedCellReference|null} */
  const cell = parseCellReference(cleanCellRef);
  if (!cell) {
    return false;
  }

  const bounds = getRangeBounds(range.start, range.end);
  if (!bounds) {
    return false;
  }

  return (
    cell.col >= bounds.minCol &&
    cell.col <= bounds.maxCol &&
    cell.row >= bounds.minRow &&
    cell.row <= bounds.maxRow
  );
}

/**
 * Check if a string matches cell reference pattern.
 *
 * Validates that a string conforms to valid cell reference format (A1 notation).
 * Strips $ markers before testing for flexibility.
 *
 * @param {string} str - String to test (e.g., "A1", "B23", "AA100", "$A$1")
 * @returns {boolean} True if it matches a valid cell reference pattern, false otherwise
 *
 * @example
 * isCellReference("A1")     // true
 * isCellReference("$A$1")   // true ($ markers stripped)
 * isCellReference("AA100")  // true
 * isCellReference("A01")    // false (leading zero)
 * isCellReference("AAA1")   // false (3 letters)
 * isCellReference("123")    // false (no column)
 */
export function isCellReference(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }
  // Strip $ markers before testing (for flexibility)
  /** @type {string} */
  const cleaned = str.replace(/\$/g, '');
  return CELL_REF_PATTERN.test(cleaned);
}

/**
 * Calculate normalized bounds for a range (min/max for rows and columns).
 * Handles ranges in any direction (start/end can be any two corners).
 *
 * @param {string} startCell - Start cell reference (e.g., "A1", "$A$1")
 * @param {string} [endCell] - End cell reference (defaults to startCell for single-cell range)
 * @returns {Object|null} Normalized bounds { minCol, maxCol, minRow, maxRow }, or null if invalid
 *
 * @example
 * getRangeBounds("A1", "C3")   // { minCol: 1, maxCol: 3, minRow: 1, maxRow: 3 }
 * getRangeBounds("C3", "A1")   // { minCol: 1, maxCol: 3, minRow: 1, maxRow: 3 } (same)
 * getRangeBounds("A1")         // { minCol: 1, maxCol: 1, minRow: 1, maxRow: 1 } (single cell)
 */
export function getRangeBounds(startCell, endCell) {
  /** @type {ParsedCellReference|null} */
  const start = parseCellReference(startCell);
  /** @type {ParsedCellReference|null} */
  const end = parseCellReference(endCell || startCell); // Default to startCell if not provided

  if (!start || !end) {
    return null;
  }

  return {
    minCol: Math.min(start.col, end.col),
    maxCol: Math.max(start.col, end.col),
    minRow: Math.min(start.row, end.row),
    maxRow: Math.max(start.row, end.row),
  };
}

/**
 * Check if two rectangular ranges overlap.
 *
 * @param {string} range1Start - Start cell of first range
 * @param {string} range1End - End cell of first range
 * @param {string} range2Start - Start cell of second range
 * @param {string} range2End - End cell of second range
 * @returns {boolean} True if the ranges overlap
 */
export function rangesOverlap(range1Start, range1End, range2Start, range2End) {
  const b1 = getRangeBounds(range1Start, range1End);
  const b2 = getRangeBounds(range2Start, range2End);
  if (!b1 || !b2) return false;
  return b1.minCol <= b2.maxCol && b1.maxCol >= b2.minCol &&
         b1.minRow <= b2.maxRow && b1.maxRow >= b2.minRow;
}

/**
 * Normalize range notation to canonical form (top-left:bottom-right).
 *
 * Converts any two corner cells to standard range notation with top-left first,
 * then bottom-right. Useful for displaying ranges consistently regardless of
 * how they were selected.
 *
 * @param {string} startCell - Start cell key (e.g., "A1", "C3")
 * @param {string} endCell - End cell key (e.g., "C3", "A1")
 * @returns {string} Normalized range notation (e.g., "A1:C3")
 * @throws {Error} If either cell reference is invalid
 *
 * @example
 * normalizeRangeNotation("A1", "C3")  // "A1:C3"
 * normalizeRangeNotation("C3", "A1")  // "A1:C3" (same result)
 * normalizeRangeNotation("B2", "D1")  // "B1:D2"
 */
export function normalizeRangeNotation(startCell, endCell) {
  const bounds = getRangeBounds(startCell, endCell);

  if (!bounds) {
    throw new Error(`Invalid cell references: ${startCell}, ${endCell}`);
  }

  /** @type {string} */
  const topLeft = `${numberToColumn(bounds.minCol)}${bounds.minRow}`;
  /** @type {string} */
  const bottomRight = `${numberToColumn(bounds.maxCol)}${bounds.maxRow}`;

  return `${topLeft}:${bottomRight}`;
}

/**
 * Expand a range into all individual cell keys.
 *
 * Generates all cell keys within a rectangular range, returned in row-major order
 * (left-to-right, top-to-bottom). Useful for iterating over all cells in a selection
 * or for dependency tracking in formulas.
 *
 * @param {string} startCell - Start cell key (e.g., "A1")
 * @param {string} endCell - End cell key (e.g., "C3")
 * @returns {RangeExpansion} Object containing range dimensions and array of all cell keys
 * @throws {Error} If either cell reference is invalid
 *
 * @example
 * expandRange("A1", "B2")
 * // { rows: 2, cols: 2, cells: ["A1", "B1", "A2", "B2"] }
 *
 * expandRange("A1", "A1")
 * // { rows: 1, cols: 1, cells: ["A1"] }
 *
 * expandRange("B2", "D3")
 * // { rows: 2, cols: 3, cells: ["B2", "C2", "D2", "B3", "C3", "D3"] }
 */
export function expandRange(startCell, endCell) {
  const bounds = getRangeBounds(startCell, endCell);

  if (!bounds) {
    throw new Error(`Invalid cell references: ${startCell}, ${endCell}`);
  }

  /** @type {number} */
  const rows = bounds.maxRow - bounds.minRow + 1;
  /** @type {number} */
  const cols = bounds.maxCol - bounds.minCol + 1;
  /** @type {string[]} */
  const cells = [];

  // Generate all cells in range (top-left to bottom-right, row-major order)
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      cells.push(`${numberToColumn(col)}${row}`);
    }
  }

  return { rows, cols, cells };
}

/**
 * Get the adjacent cell in a given direction.
 *
 * Returns the cell reference one step away in the specified direction,
 * or null if the move would go out of bounds.
 *
 * @param {string} cellKey - Current cell key (e.g., "A1")
 * @param {string} direction - Direction to move: "up", "down", "left", "right"
 * @param {Object} [options={}] - Optional bounds configuration
 * @param {string} [options.maxCol='ZZ'] - Maximum column (e.g., "O" for 15 columns, "ZZ" for 702)
 * @param {number} [options.maxRow=9999] - Maximum row number
 * @returns {string|null} Adjacent cell key, or null if out of bounds or invalid
 *
 * @example
 * getAdjacentCell("B2", "up")      // "B1"
 * getAdjacentCell("B2", "down")    // "B3"
 * getAdjacentCell("B2", "left")    // "A2"
 * getAdjacentCell("B2", "right")   // "C2"
 * getAdjacentCell("A1", "up")      // null (out of bounds)
 * getAdjacentCell("A1", "left")    // null (out of bounds)
 *
 * @example
 * // With custom bounds (e.g., 15x15 grid)
 * getAdjacentCell("O15", "right", { maxCol: "O", maxRow: 15 })  // null (at right edge)
 * getAdjacentCell("O14", "down", { maxCol: "O", maxRow: 15 })   // "O15"
 */
export function getAdjacentCell(cellKey, direction, options = {}) {
  // Default bounds (can be overridden for larger grids)
  /** @type {string} */
  const maxCol = options.maxCol || 'ZZ'; // Effectively unlimited
  /** @type {number} */
  const maxRow = options.maxRow || 9999; // Effectively unlimited
  /** @type {number} */
  const minRow = options.minRow ?? 1; // 0 for loop sheets, 1 for normal sheets

  // DEBUG: Check what bounds are being used
  if (direction === 'up' && cellKey.endsWith('1')) {
    console.log('[getAdjacentCell] Trying to go up from row 1:', { cellKey, minRow, options });
  }
  /** @type {string|undefined} */
  const virtualRightColumn = options.virtualRightColumn; // e.g., '_STOP' for loop sheets

  // Parse cell key
  /** @type {ParsedCellKey|null} */
  const parsed = parseCellKey(cellKey);
  if (!parsed) {
    return null; // Invalid cell key
  }

  const maxColNum = columnToNumber(maxCol);
  const isInVirtualColumn = virtualRightColumn && parsed.col.toUpperCase() === virtualRightColumn.toUpperCase();

  // Handle navigation from virtual right column
  if (isInVirtualColumn) {
    switch (direction) {
      case 'up':
        if (parsed.row - 1 < minRow) return null;
        return `${virtualRightColumn}${parsed.row - 1}`;
      case 'down':
        if (parsed.row + 1 > maxRow) return null;
        return `${virtualRightColumn}${parsed.row + 1}`;
      case 'left':
        // Go to maxCol on same row
        return `${numberToColumn(maxColNum)}${parsed.row}`;
      case 'right':
        return null; // Already at right edge
      default:
        return null;
    }
  }

  // Apply direction
  /** @type {number} */
  let newColNum = parsed.colNum;
  /** @type {number} */
  let newRowNum = parsed.row;

  switch (direction) {
    case 'up':
      newRowNum--;
      break;
    case 'down':
      newRowNum++;
      break;
    case 'left':
      newColNum--;
      break;
    case 'right':
      newColNum++;
      break;
    default:
      return null; // Invalid direction
  }

  // Check bounds
  if (newRowNum < minRow || newRowNum > maxRow) {
    return null; // Out of bounds vertically
  }

  if (newColNum < 1) {
    return null; // Out of bounds horizontally (left edge)
  }

  // Handle right edge - jump to virtual column if configured
  if (newColNum > maxColNum) {
    if (virtualRightColumn) {
      return `${virtualRightColumn}${newRowNum}`;
    }
    return null; // Out of bounds horizontally (right edge)
  }

  // Build new cell key
  return `${numberToColumn(newColNum)}${newRowNum}`;
}
