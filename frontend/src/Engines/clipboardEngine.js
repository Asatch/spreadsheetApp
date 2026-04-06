/*
 * CLIPBOARD ENGINE
 * ================
 *
 * Handles clipboard operations - copy, cut, paste.
 * Manages clipboard state and coordinates with selection.
 *
 * Features:
 * - Copy/cut/paste cells with values and formulas
 * - Formula reference adjustment (absolute/relative)
 * - System clipboard integration
 * - Cut state visualization
 * - #REF! error handling for overwritten cells
 */

import { expandRange, getRangeBounds, parseCellKey, numberToColumn, isCellInRange} from '../utils/cellUtils.js';
import {
  formatCellsForClipboard,
  generateClipboardHash,
  adjustFormulaReferences,
  adjustRangeNotation,
  updateSingleCellReference,
} from '../utils/clipboardUtils.js';
import { TypeService } from '../utils/typeService.js';

export function createClipboardEngine() {
  // ============================================================================
  // STATE
  // ============================================================================

  // Clipboard state
  let clipboardData = null;  // { sourceRange: {start, end}, values: Map<cellKey, value>, isCut: boolean, contentHash: string }

  // ============================================================================
  // DEPENDENCIES (injected via init)
  // ============================================================================

  let getSelection = null;      // Get current selection range
  let getValue = null;          // Get canonical value for a cell
  let setBatch = null;          // Set multiple values efficiently
  let getActiveCell = null;     // Get the currently active cell
  let refreshFormulaBar = null; // Refresh formula bar display
  let getGridBounds = null;     // Function to get grid bounds { maxCol: 'O', maxRow: 15, minRow?: 0 }
  let onCutMarked = null;       // Callback to mark cells as "cut" visually (pass null to clear)
  let onCutStateChange = null;  // Callback to notify when cut state changes (for toolbar button)
  let getAllNamedRanges = null; // Get all named ranges with their notations
  let moveNamedRange = null;    // Move a named range to a new notation
  let onRefreshNamedRangeDisplay = null; // Callback to refresh UI after named range moves
  let getDependentsOf = null;   // Get cells that depend on a given cell (from calculation engine)

  // Formatting dependencies (for cut/paste formatting transfer)
  let getFormattingBatch = null;   // Get formatting for multiple cells
  let setFormattingBatch = null;   // Set formatting for multiple cells
  let clearFormattingBatch = null; // Clear formatting for multiple cells
  let beginHistoryBatch = null;    // Begin atomic history operation
  let endHistoryBatch = null;      // End atomic history operation
  let getCalcNode = null;          // Get calculation node for a cell (raw computed value)

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Check if a named range is fully contained within a region
   * @param {string} rangeNotation - The range notation to check (e.g., "A1:B2" or "A1")
   * @param {Object} region - The region to check against
   * @param {string} region.start - Start cell of region
   * @param {string} region.end - End cell of region
   * @returns {boolean} - True if range is fully contained
   */
  function isRangeFullyContained(rangeNotation, region) {
    // Parse the notation (may be "A1:B2" or just "A1")
    const isRange = rangeNotation.includes(':');
    let rangeStart, rangeEnd;

    if (isRange) {
      [rangeStart, rangeEnd] = rangeNotation.split(':');
    } else {
      // Single cell - treat as 1x1 range
      rangeStart = rangeEnd = rangeNotation;
    }

    // Get normalized bounds for both the range and the region
    const rangeBounds = getRangeBounds(rangeStart, rangeEnd);
    const regionBounds = getRangeBounds(region.start, region.end);

    if (!rangeBounds || !regionBounds) {
      return false;
    }

    // Check if range is fully contained within region
    return rangeBounds.minCol >= regionBounds.minCol &&
           rangeBounds.maxCol <= regionBounds.maxCol &&
           rangeBounds.minRow >= regionBounds.minRow &&
           rangeBounds.maxRow <= regionBounds.maxRow;
  }

  // ============================================================================
  // OPERATIONS
  // ============================================================================

  /**
   * Perform copy or cut operation
   * @param {boolean} isCut - Whether this is a cut (true) or copy (false) operation
   */
  function performCopyOrCut(isCut) {
    console.log(`[ClipboardEngine] ${isCut ? 'Cut' : 'Copy'}`);

    const selection = getSelection();
    const { cells } = expandRange(selection.start, selection.end);

    // expandRange already normalizes, so cells[0] is top-left and cells[last] is bottom-right
    const sourceTopLeft = cells[0];
    const sourceBottomRight = cells[cells.length - 1];

    // Collect values from all selected cells
    const values = new Map();
    cells.forEach(cellKey => {
      const value = getValue(cellKey);
      values.set(cellKey, value);
    });

    // Format for system clipboard
    const formattedText = formatCellsForClipboard(getValue, cells, selection);
    const contentHash = generateClipboardHash(formattedText);

    // Capture raw computed values for paste-special (values only)
    // Uses calculation node's refValue (unformatted) so numbers stay as numbers,
    // not formatted strings like "$1,234.56"
    // Values are serialized via serializeForInput so arrays, booleans, dates, etc.
    // round-trip correctly through detectType when pasted.
    let displayValues = null;
    if (getCalcNode) {
      displayValues = new Map();
      cells.forEach(cellKey => {
        const rawValue = values.get(cellKey);
        // Only need to resolve formula cells — plain values are already literal
        if (rawValue && typeof rawValue === 'string' && rawValue.startsWith('=')) {
          const node = getCalcNode(cellKey);
          if (node?.refValue != null) {
            displayValues.set(cellKey, TypeService.serializeForInput(node.refValue, node.type));
          } else {
            displayValues.set(cellKey, '');
          }
        } else {
          displayValues.set(cellKey, rawValue ?? '');
        }
      });
    }

    // Capture formatting for clipboard (copy applies to destination, cut also clears source)
    let formatting = null;
    if (getFormattingBatch) {
      formatting = getFormattingBatch(cells);
      console.log(`[ClipboardEngine] Captured formatting for ${formatting.size} cells`);
    }

    // Store in internal clipboard with normalized range
    clipboardData = {
      sourceRange: { start: sourceTopLeft, end: sourceBottomRight },
      values,
      displayValues,  // Map<cellKey, displayText> for paste-values
      isCut,
      contentHash,
      formatting,  // Map<cellKey, {styles, formatRules}> or null
    };

    // Write to system clipboard
    writeToSystemClipboard(formattedText);

    // Update visual state based on operation type
    onCutStateChange(isCut);
    onCutMarked(isCut ? selection : null);

    console.log(`[ClipboardEngine] ${isCut ? 'Cut' : 'Copied'} ${cells.length} cells`);
  }

  /**
   * Process all cut operation side effects (named ranges, external formulas, source clears)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @param {boolean} shouldFill - Whether this is a fill mode paste
   * @returns {{updates: Array, namedRangeCount: number}} All cut-related updates and named range count
   */
  function processCutOperationSideEffects(targetTopLeft, overwrittenCells, shouldFill) {
    const updates = [];
    let namedRangeCount = 0;

    // 1. Handle named range moves (not in fill mode)
    if (!shouldFill) {
      const namedRangeResult = prepareNamedRangeMoves(targetTopLeft);
      updates.push(...namedRangeResult.updates);
      namedRangeCount = namedRangeResult.count;
    }

    // 2. Update external formulas (not in fill mode)
    if (!shouldFill) {
      const formulaUpdates = updateExternalFormulasForCut(targetTopLeft, overwrittenCells);
      updates.push(...formulaUpdates);
    }

    // 3. Clear source cells
    const clearUpdates = clearCutSourceCells(overwrittenCells);
    updates.push(...clearUpdates);

    return { updates, namedRangeCount };
  }

  /**
   * Update external formulas for cut operations (coordinates Part A and Part B)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @returns {Array<[string, string]>} Array of [cellKey, formula] updates
   */
  function updateExternalFormulasForCut(targetTopLeft, overwrittenCells) {
    console.log('[ClipboardEngine] Updating external formula references for cut operation');

    // Track all formula updates (Map: cellKey -> updated formula)
    const formulaUpdates = new Map();

    // PART A: Update references to moved cells
    updateReferencesToMovedCells(targetTopLeft, overwrittenCells, formulaUpdates);

    // PART B: Convert references to overwritten cells to #REF!
    convertOverwrittenReferencesToRef(overwrittenCells, formulaUpdates);

    // Convert Map to updates array
    const updates = Array.from(formulaUpdates.entries());

    console.log(`[ClipboardEngine] Updated ${formulaUpdates.size} external formulas`);

    return updates;
  }

  /**
   * Prepare paste updates for fill mode (2D tiling across selection)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {string} targetBottomRight - Bottom-right cell of paste destination
   * @param {number} clipRows - Number of rows in clipboard data
   * @param {number} clipCols - Number of columns in clipboard data
   * @param {Object} clipTopLeft - Parsed clipboard top-left cell {row, colNum, col}
   * @param {Object} selTopLeft - Parsed selection top-left cell {row, colNum, col}
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @returns {Array<[string, any]>} Array of [cellKey, value] updates
   */
  function prepareFillModePaste(targetTopLeft, targetBottomRight, clipRows, clipCols, clipTopLeft, selTopLeft, overwrittenCells, values) {
    const updates = [];

    // FILL MODE: Tile clipboard contents across the entire selection
    const { cells: targetCells } = expandRange(targetTopLeft, targetBottomRight);

    for (const targetCellKey of targetCells) {
      const targetParsed = parseCellKey(targetCellKey);

      // Calculate which clipboard cell to use (2D tiling with modulo)
      const offsetRow = targetParsed.row - selTopLeft.row;
      const offsetCol = targetParsed.colNum - selTopLeft.colNum;

      // Use modulo to tile the clipboard pattern
      const sourceRowOffset = offsetRow % clipRows;
      const sourceColOffset = offsetCol % clipCols;

      // Calculate source cell key
      const sourceRow = clipTopLeft.row + sourceRowOffset;
      const sourceCol = numberToColumn(clipTopLeft.colNum + sourceColOffset);
      const sourceCellKey = `${sourceCol}${sourceRow}`;
      const sourceValue = values.get(sourceCellKey);

      // Process the value (adjust formulas if needed)
      let processedValue = sourceValue;

      if (sourceValue && typeof sourceValue === 'string' && sourceValue.startsWith('=')) {
        // For fill mode, calculate the offset from clipboard top-left to this tile's top-left
        // Offset from clipboard top-left to current source cell
        const relativeRowInClip = sourceRowOffset;
        const relativeColInClip = sourceColOffset;

        // Calculate effective target top-left for this tile
        const effectiveTargetCol = numberToColumn(targetParsed.colNum - relativeColInClip);
        const effectiveTargetRow = targetParsed.row - relativeRowInClip;
        const effectiveTargetTopLeft = `${effectiveTargetCol}${effectiveTargetRow}`;

        // Adjust formula references
        processedValue = adjustFormulaReferences(
          sourceValue,
          clipboardData.sourceRange,
          effectiveTargetTopLeft,
          {
            isCutOperation: false,  // Fill mode is always like copy
            overwrittenCells,
            gridBounds: getGridBounds(),
          }
        );
      }

      updates.push([targetCellKey, processedValue]);
    }

    return updates;
  }

  /**
   * Prepare paste updates for single paste mode (one-to-one paste)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @returns {Array<[string, any]>} Array of [cellKey, value] updates
   */
  function prepareSinglePaste(targetTopLeft, overwrittenCells, values) {
    const updates = [];

    // SINGLE PASTE MODE: Paste clipboard contents once at target location
    for (const [sourceCellKey, sourceValue] of values) {
      // Calculate target cell position
      const targetCellKey = calculateTargetCell(
        sourceCellKey,
        clipboardData.sourceRange,
        targetTopLeft
      );

      // Process the value (adjust formulas if needed)
      let processedValue = sourceValue;

      if (sourceValue && typeof sourceValue === 'string' && sourceValue.startsWith('=')) {
        // Adjust formula references
        processedValue = adjustFormulaReferences(
          sourceValue,
          clipboardData.sourceRange,
          targetTopLeft,
          {
            isCutOperation: clipboardData.isCut,
            overwrittenCells,
            gridBounds: getGridBounds(),
          }
        );
      }

      updates.push([targetCellKey, processedValue]);
    }

    return updates;
  }

  /**
   * Convert references to overwritten cells to #REF! during cut (Part B)
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @param {Map<string, string>} formulaUpdates - Map to accumulate formula updates
   */
  function convertOverwrittenReferencesToRef(overwrittenCells, formulaUpdates) {
    // PART B: Convert references to overwritten cells to #REF!
    // Loop through each cell in destination range
    for (const destCellKey of overwrittenCells) {
      // Check if this cell is NOT in source range (pure overwrite, not a move)
      const isInSource = isCellInRange(destCellKey, clipboardData.sourceRange);
      if (!isInSource) {
        // Get all cells that depend on this overwritten cell
        const dependents = getDependentsOf(destCellKey);

        // Update each dependent formula that's NOT in the destination range
        for (const dependentKey of dependents) {
          if (!overwrittenCells.has(dependentKey)) {
            // Get current formula (or use already updated version)
            let currentFormula = formulaUpdates.get(dependentKey);
            if (!currentFormula) {
              currentFormula = getValue(dependentKey);
              // Only process if it's actually a formula
              if (!currentFormula || !currentFormula.startsWith('=')) {
                continue;
              }
            }

            // Convert references to this overwritten cell to #REF!
            const updatedFormula = updateSingleCellReference(
              currentFormula,
              destCellKey,
              '#REF!'
            );

            formulaUpdates.set(dependentKey, updatedFormula);
          }
        }
      }
    }
  }

  /**
   * Update external formula references to moved cells during cut (Part A)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @param {Map<string, string>} formulaUpdates - Map to accumulate formula updates
   */
  function updateReferencesToMovedCells(targetTopLeft, overwrittenCells, formulaUpdates) {
    // PART A: Update references to moved cells (SC-CB-049, SC-CB-050, SC-CB-051)
    // Loop through each cell in source range
    for (const sourceCellKey of clipboardData.values.keys()) {
      // Calculate corresponding target cell
      const targetCellKey = calculateTargetCell(
        sourceCellKey,
        clipboardData.sourceRange,
        targetTopLeft
      );

      // Get all cells that depend on this source cell
      const dependents = getDependentsOf(sourceCellKey);

      // Update each dependent formula that's NOT in the destination range
      for (const dependentKey of dependents) {
        if (!overwrittenCells.has(dependentKey)) {
          // Get current formula (or use already updated version if we've seen this cell)
          let currentFormula = formulaUpdates.get(dependentKey);
          if (!currentFormula) {
            currentFormula = getValue(dependentKey);
            // Only process if it's actually a formula
            if (!currentFormula || !currentFormula.startsWith('=')) {
              continue;
            }
          }

          // Update references from sourceCellKey to targetCellKey
          const updatedFormula = updateSingleCellReference(
            currentFormula,
            sourceCellKey,
            targetCellKey
          );

          formulaUpdates.set(dependentKey, updatedFormula);
        }
      }
    }
  }

  /**
   * Prepare named range relocations for cut operations
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @returns {{updates: Array, count: number}} Named range updates and count
   */
  function prepareNamedRangeMoves(targetTopLeft) {
    console.log('[ClipboardEngine] Checking for named ranges to move during cut/paste');

    const updates = [];
    let count = 0;

    // Get all named ranges
    const allRanges = getAllNamedRanges();

    // Filter to only those fully contained in the cut region
    const rangesToMove = allRanges.filter(range =>
      isRangeFullyContained(range.notation, clipboardData.sourceRange)
    );

    // Prepare each affected named range move and add to updates batch
    for (const range of rangesToMove) {
      const newNotation = adjustRangeNotation(
        range.notation,
        clipboardData.sourceRange,
        targetTopLeft
      );

      if (newNotation) {
        console.log(`[ClipboardEngine] Moving named range "${range.name}" from ${range.notation} to ${newNotation}`);
        const result = moveNamedRange(range.name, newNotation);

        if (result.success && result.entry) {
          // Add the named range update to the batch
          updates.push(result.entry);
          count++;
        } else {
          console.error(`[ClipboardEngine] Failed to move named range "${range.name}":`, result.error);
        }
      } else {
        console.error(`[ClipboardEngine] Failed to calculate new notation for named range "${range.name}"`);
      }
    }

    return { updates, count };
  }

  /**
   * Clear source cells for cut operation and update UI state
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten by paste
   * @returns {Array<[string, string]>} Array of [cellKey, ''] clear updates
   */
  function clearCutSourceCells(overwrittenCells) {
    const clearUpdates = [];

    // Clear source cells that aren't being pasted over themselves
    for (const sourceCellKey of clipboardData.values.keys()) {
      if (!overwrittenCells.has(sourceCellKey)) {
        clearUpdates.push([sourceCellKey, '']);
      }
    }

    // Clear cut state and visual marks
    onCutStateChange(false);
    onCutMarked(null);

    // Clear internal clipboard after cut+paste
    clipboardData = null;

    // Clear system clipboard after cut+paste
    writeToSystemClipboard('');

    return clearUpdates;
  }

  /**
   * Paste clipboard data at current selection
   * @param {string} [externalClipboardText] - Optional text from system clipboard
   * @param {Object} [options] - Paste options
   * @param {boolean} [options.valuesOnly] - If true, paste computed values instead of formulas, skip formatting
   */
  async function paste(externalClipboardText, { valuesOnly = false } = {}) {
    console.log('[ClipboardEngine] Paste');

    const selection = getSelection();
    // Get the actual top-left corner of the selection (handles any selection direction)
    const selectionBounds = getRangeBounds(selection.start, selection.end);
    if (!selectionBounds) {
      console.error('[ClipboardEngine] Invalid selection range');
      return;
    }
    const targetTopLeft = `${numberToColumn(selectionBounds.minCol)}${selectionBounds.minRow}`;

    // Determine whether to use internal or external clipboard
    if (externalClipboardText) {
      // We have external clipboard data - check if it matches our internal clipboard
      // Normalize line endings for cross-platform compatibility (Windows uses \r\n, we use \n)
      const normalizedText = externalClipboardText.replace(/\r\n/g, '\n');
      const externalHash = generateClipboardHash(normalizedText);

      if (!clipboardData || !clipboardData.contentHash || clipboardData.contentHash !== externalHash) {
        // External data doesn't match our internal clipboard - parse external data
        console.log('[ClipboardEngine] Using external clipboard data');
        pasteExternalData(externalClipboardText, targetTopLeft);
        return;
      } else {
        console.log('[ClipboardEngine] External clipboard matches internal - using internal');
      }
    }

    // Use internal clipboard
    if (!clipboardData) {
      console.warn('[ClipboardEngine] No clipboard data to paste');
      return;
    }

    // Choose which values to paste: display values (computed results) for
    // values-only, or the original values (which may contain formulas) for normal paste
    const pasteValues = (valuesOnly && clipboardData.displayValues)
      ? clipboardData.displayValues
      : clipboardData.values;
    if (valuesOnly) {
      console.log('[ClipboardEngine] Paste values only (stripping formulas and formatting)');
    }

    // Calculate clipboard dimensions
    const { rows: clipRows, cols: clipCols, cells: sourceCells } = expandRange(
      clipboardData.sourceRange.start,
      clipboardData.sourceRange.end
    );
    const clipTopLeft = parseCellKey(clipboardData.sourceRange.start);

    // Calculate selection dimensions
    const { cells: selectionCells } = expandRange(
      selection.start,
      selection.end
    );
    const selTopLeft = parseCellKey(targetTopLeft);

    // Determine paste mode: fill (tile) vs. single paste
    const shouldFill = selectionCells.length > sourceCells.length;

    // Calculate actual paste area for #REF! handling
    const targetBottomRight = shouldFill
      ? selectionCells[selectionCells.length - 1]  // Fill entire selection
      : calculateTargetCell(                        // Single paste
          sourceCells[sourceCells.length - 1],
          clipboardData.sourceRange,
          targetTopLeft
        );

    // Get all cells that will be overwritten (for #REF! handling)
    const { cells: actualOverwrittenCells } = expandRange(targetTopLeft, targetBottomRight);
    const overwrittenCells = new Set(actualOverwrittenCells);

    // Prepare batch of updates
    const updates = shouldFill
      ? prepareFillModePaste(targetTopLeft, targetBottomRight, clipRows, clipCols, clipTopLeft, selTopLeft, overwrittenCells, pasteValues)
      : prepareSinglePaste(targetTopLeft, overwrittenCells, pasteValues);

    // Save cut-related data BEFORE processCutOperationSideEffects (which nulls clipboardData)
    const isCutOperation = clipboardData.isCut;
    const savedFormatting = clipboardData.formatting;
    const savedSourceRange = clipboardData.sourceRange;
    const savedValues = clipboardData.values;

    // Prepare formatting data before clipboardData gets nulled (cut nulls it)
    let formattingUpdates = [];
    let sourceCellsToClearFormatting = [];

    // Map source formatting to target cells (for both copy and cut) — skip for values-only paste
    if (savedFormatting && savedFormatting.size > 0 && !shouldFill && !valuesOnly) {
      for (const [sourceCellKey, formatting] of savedFormatting) {
        const targetCellKey = calculateTargetCell(
          sourceCellKey,
          savedSourceRange,
          targetTopLeft
        );
        formattingUpdates.push([targetCellKey, formatting]);
      }
      console.log(`[ClipboardEngine] Prepared ${formattingUpdates.length} formatting updates`);
    }

    if (isCutOperation) {
      // Track source cells that need formatting cleared (cells not being overwritten)
      for (const sourceCellKey of savedValues.keys()) {
        if (!overwrittenCells.has(sourceCellKey)) {
          sourceCellsToClearFormatting.push(sourceCellKey);
        }
      }
    }

    // Process cut operation side effects (named ranges, formulas, source clears)
    // NOTE: This nulls clipboardData, so we saved what we needed above
    let namedRangeMoveCount = 0;
    if (isCutOperation) {
      const cutResult = processCutOperationSideEffects(targetTopLeft, overwrittenCells, shouldFill);
      updates.push(...cutResult.updates);
      namedRangeMoveCount = cutResult.namedRangeCount;
    }

    // Begin atomic history batch (values + formatting = one undo step)
    const hasFormattingWork = formattingUpdates.length > 0 || sourceCellsToClearFormatting.length > 0;
    if (beginHistoryBatch && hasFormattingWork) {
      beginHistoryBatch();
    }

    // Apply formatting BEFORE values so computeDisplayValue sees correct styles
    if (formattingUpdates.length > 0 && setFormattingBatch) {
      setFormattingBatch(formattingUpdates);
    }

    // Clear formatting from source cells (cut only)
    if (isCutOperation && sourceCellsToClearFormatting.length > 0 && clearFormattingBatch) {
      clearFormattingBatch(sourceCellsToClearFormatting);
    }

    // Apply value updates (this triggers recalculation which calls computeDisplayValue)
    applyPasteUpdates(updates);

    // End atomic history batch
    if (endHistoryBatch && hasFormattingWork) {
      endHistoryBatch();
    }

    // Refresh UI to show updated named range display (after batch is applied)
    if (namedRangeMoveCount > 0) {
      onRefreshNamedRangeDisplay();
    }
  }

  /**
   * Cancel an in-progress cut operation
   */
  function cancelCut() {
    console.log('[ClipboardEngine] Cancel cut');

    if (clipboardData && clipboardData.isCut) {
      // Clear the clipboard
      clipboardData = null;

      // Clear cut state and visual marks
      onCutStateChange(false);
      onCutMarked(null);
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Apply paste updates and refresh UI
   * Shared logic for both internal and external paste
   * @param {Array} updates - Array of [cellKey, value] pairs
   */
  function applyPasteUpdates(updates) {
    // Apply all updates in one batch (creates single history checkpoint)
    setBatch(updates);

    // Check if the active cell was updated and refresh formula bar if needed
    const activeCell = getActiveCell();
    const wasActiveCellUpdated = updates.some(([cellKey]) => cellKey === activeCell);

    if (wasActiveCellUpdated) {
      console.log(`[ClipboardEngine] Active cell ${activeCell} was updated, refreshing formula bar`);
      refreshFormulaBar(activeCell);
    }

    console.log(`[ClipboardEngine] Pasted ${updates.length} cells`);
  }

  /**
   * Parse and paste external clipboard data (tab-delimited text from Excel, etc.)
   * @param {string} clipboardText - Tab-delimited text from system clipboard
   * @param {string} targetTopLeft - Top-left cell to paste into
   */
  function pasteExternalData(clipboardText, targetTopLeft) {
    console.log('[ClipboardEngine] Parsing external clipboard data');

    // Parse tab-delimited text into 2D array
    // Normalize \r\n to \n for cross-platform compatibility, then preserve all rows
    // (including empty ones) so empty cells properly clear target cells on paste.
    const rows = clipboardText.replace(/\r\n/g, '\n').split('\n');
    const grid = rows.map(row => row.split('\t'));

    // Parse target top-left cell using proper utility
    const targetParsed = parseCellKey(targetTopLeft);
    if (!targetParsed) {
      console.error('[ClipboardEngine] Invalid target cell:', targetTopLeft);
      return;
    }

    // Build updates array
    const updates = [];

    grid.forEach((rowData, rowIndex) => {
      rowData.forEach((cellValue, colIndex) => {
        // Calculate target cell position
        const newCol = numberToColumn(targetParsed.colNum + colIndex);
        const newRow = targetParsed.row + rowIndex;
        const cellKey = `${newCol}${newRow}`;

        // Trim the value and use it directly
        const trimmedValue = cellValue.trim();
        updates.push([cellKey, trimmedValue]);
      });
    });

    console.log(`[ClipboardEngine] Parsed ${updates.length} cells from external clipboard`);

    // Apply updates using shared helper
    applyPasteUpdates(updates);
  }

  /**
   * Calculate target cell position based on source position and paste target
   */
  function calculateTargetCell(sourceCellKey, sourceRange, targetTopLeft) {
    const sourceStart = sourceRange.start;

    // Parse cell keys using proper utility
    const sourceParsed = parseCellKey(sourceCellKey);
    const sourceStartParsed = parseCellKey(sourceStart);
    const targetParsed = parseCellKey(targetTopLeft);

    if (!sourceParsed || !sourceStartParsed || !targetParsed) {
      return sourceCellKey; // Fallback
    }

    // Calculate offset from source start to this cell
    const colOffset = sourceParsed.colNum - sourceStartParsed.colNum;
    const rowOffset = sourceParsed.row - sourceStartParsed.row;

    // Apply offset to target position
    const newCol = numberToColumn(targetParsed.colNum + colOffset);
    const newRow = targetParsed.row + rowOffset;

    return `${newCol}${newRow}`;
  }

  /**
   * Write text to system clipboard
   */
  function writeToSystemClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => {
            console.log('[ClipboardEngine] Wrote to system clipboard');
          })
          .catch(err => {
            console.error('[ClipboardEngine] Failed to write to system clipboard:', err);
          });
      } else {
        console.warn('[ClipboardEngine] Clipboard API not available');
      }
    } catch (error) {
      console.error('[ClipboardEngine] Error accessing clipboard API:', error);
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    init(deps) {
      ({
        getSelection,
        getValue,
        setBatch,
        getActiveCell,
        refreshFormulaBar,
        getGridBounds,
        onCutMarked,
        onCutStateChange,
        getAllNamedRanges,
        moveNamedRange,
        onRefreshNamedRangeDisplay,
        getDependentsOf,
        // Formatting dependencies
        getFormattingBatch,
        setFormattingBatch,
        clearFormattingBatch,
        beginHistoryBatch,
        endHistoryBatch,
        getCalcNode,
      } = deps);
      console.log('[ClipboardEngine] Initialized');
    },

    performCopyOrCut,
    paste,
    cancelCut,
    hasClipboardData: () => !!clipboardData,
  };
}
