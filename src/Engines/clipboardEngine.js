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
  adjustTokenReferences,
  adjustRangeNotation,
} from '../utils/clipboardUtils.js';
import { tokenize, rewriteCellRefs, TokenType } from '../utils/formulaTokenizer.js';
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
  let setBatch = null;          // Set multiple values (accepts [key,value] or [key,null,tokens])
  let getActiveCell = null;     // Get the currently active cell
  let refreshFormulaBar = null; // Refresh formula bar display
  let getGridBounds = null;     // Function to get grid bounds { maxCol: 'O', maxRow: 15, minRow?: 0 }
  let onCutMarked = null;       // Callback to mark cells as "cut" visually (pass null to clear)
  let onCutStateChange = null;  // Callback to notify when cut state changes (for toolbar button)
  let getAllNamedRanges = null; // Get all named ranges with their notations
  let moveNamedRange = null;    // Move a named range to a new notation
  let deleteNamedRange = null;  // Delete a named range by name
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

  }

  /**
   * Process all cut operation side effects (named ranges, external formulas, source clears)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @param {boolean} shouldFill - Whether this is a fill mode paste
   * @returns {{updates: Array, namedRangeCount: number}} All cut-related updates and named range count
   */
  function processCutOperationSideEffects(sourceData, targetTopLeft, overwrittenCells, shouldFill, isInternalMove) {
    const updates = [];
    let namedRangeCount = 0;

    // 1. Handle named range moves (not in fill mode)
    if (!shouldFill) {
      const namedRangeResult = prepareNamedRangeMoves(sourceData, targetTopLeft);
      updates.push(...namedRangeResult.updates);
      namedRangeCount = namedRangeResult.count;
    }

    // 2. Update external formulas (not in fill mode)
    if (!shouldFill) {
      const formulaUpdates = updateExternalFormulasForCut(sourceData, targetTopLeft, overwrittenCells);
      updates.push(...formulaUpdates);
    }

    // 3. Clear source cells
    const clearUpdates = clearCutSourceCells(sourceData, overwrittenCells, isInternalMove);
    updates.push(...clearUpdates);

    return { updates, namedRangeCount };
  }

  /**
   * Update external formulas for cut operations (coordinates Part A and Part B)
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Set<string>} overwrittenCells - Cells that will be overwritten
   * @returns {Array<[string, string]>} Array of [cellKey, formula] updates
   */
  function updateExternalFormulasForCut(sourceData, targetTopLeft, overwrittenCells) {

    // Track formula updates as token arrays keyed by cellKey. Multiple passes
    // (Parts A and B) mutate the same token array rather than round-tripping
    // through string form between updates.
    /** @type {Map<string, import('../utils/formulaTokenizer.js').Token[]>} */
    const formulaUpdates = new Map();

    // PART A: Update references to moved cells
    updateReferencesToMovedCells(sourceData, targetTopLeft, overwrittenCells, formulaUpdates);

    // PART B: Convert references to overwritten cells to #REF!
    convertOverwrittenReferencesToRef(sourceData, overwrittenCells, formulaUpdates);

    // Shape for applyPasteUpdates: [key, null, tokens] → routed via setBatchClassified
    const updates = Array.from(formulaUpdates.entries(), ([key, tokens]) => [key, null, tokens]);


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
  function prepareFillModePaste(sourceData, targetTopLeft, targetBottomRight, clipRows, clipCols, clipTopLeft, selTopLeft, overwrittenCells, values) {
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
        const effectiveTargetCol = numberToColumn(targetParsed.colNum - sourceColOffset);
        const effectiveTargetRow = targetParsed.row - sourceRowOffset;
        const effectiveTargetTopLeft = `${effectiveTargetCol}${effectiveTargetRow}`;

        // Tokenize once and adjust on the token array directly — the adjusted
        // tokens flow through setBatchClassified without a re-tokenize.
        const tokens = tokenize(sourceValue);
        const ok = adjustTokenReferences(tokens, sourceData.sourceRange, effectiveTargetTopLeft, {
          isCutOperation: false,  // Fill mode is always like copy
          overwrittenCells,
          gridBounds: getGridBounds(),
        });
        if (ok) {
          updates.push([targetCellKey, null, tokens]);
          continue;
        }
        // Source/target parse failure — fall through to pushing raw sourceValue
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
  function prepareSinglePaste(sourceData, targetTopLeft, overwrittenCells, values) {
    const updates = [];

    // SINGLE PASTE MODE: Paste clipboard contents once at target location
    for (const [sourceCellKey, sourceValue] of values) {
      // Calculate target cell position
      const targetCellKey = calculateTargetCell(
        sourceCellKey,
        sourceData.sourceRange,
        targetTopLeft
      );

      // Process the value (adjust formulas if needed)
      let processedValue = sourceValue;

      if (sourceValue && typeof sourceValue === 'string' && sourceValue.startsWith('=')) {
        const tokens = tokenize(sourceValue);
        const ok = adjustTokenReferences(tokens, sourceData.sourceRange, targetTopLeft, {
          isCutOperation: sourceData.isCut,
          overwrittenCells,
          gridBounds: getGridBounds(),
        });
        if (ok) {
          updates.push([targetCellKey, null, tokens]);
          continue;
        }
      }

      updates.push([targetCellKey, processedValue]);
    }

    return updates;
  }

  /**
   * Convert references to overwritten cells to #REF! during cut (Part B)
   * @param {Set<string>} overwrittenCells
   * @param {Map<string, import('../utils/formulaTokenizer.js').Token[]>} formulaUpdates - Accumulates mutated token arrays
   */
  function convertOverwrittenReferencesToRef(sourceData, overwrittenCells, formulaUpdates) {
    for (const destCellKey of overwrittenCells) {
      // Only pure-overwrite cells (not in source range) trigger #REF! promotion
      if (isCellInRange(destCellKey, sourceData.sourceRange)) continue;

      const dependents = getDependentsOf(destCellKey);
      for (const dependentKey of dependents) {
        if (overwrittenCells.has(dependentKey)) continue;

        const tokens = loadOrGetTokens(dependentKey, formulaUpdates);
        if (!tokens) continue;

        rewriteCellRefs(tokens, (t) => t.value === destCellKey ? '#REF!' : null);
      }
    }
  }

  /**
   * Update external formula references to moved cells during cut (Part A).
   *
   * Range-aware: if a formula contains `A1:B2` and only one endpoint is inside
   * the cut source, we leave BOTH endpoints alone. Rewriting only one endpoint
   * would turn the range into a broken reference spanning pre- and post-move
   * positions. Named ranges stored as `=A1:B2` are covered by the same rule —
   * fully-contained ranges are relocated separately by prepareNamedRangeMoves,
   * and partial-overlap ranges should not be touched here.
   */
  function updateReferencesToMovedCells(sourceData, targetTopLeft, overwrittenCells, formulaUpdates) {
    const sourceCells = new Set(sourceData.values.keys());

    // Collect all dependents across all source cells so each formula is rewritten once.
    const allDependents = new Set();
    for (const sourceCellKey of sourceCells) {
      for (const dep of getDependentsOf(sourceCellKey)) allDependents.add(dep);
    }

    for (const dependentKey of allDependents) {
      if (overwrittenCells.has(dependentKey)) continue;

      const tokens = loadOrGetTokens(dependentKey, formulaUpdates);
      if (!tokens) continue;

      const skip = partialRangeEndpoints(tokens, sourceCells);

      rewriteCellRefs(tokens, (t) => {
        if (skip.has(t)) return null;
        if (!sourceCells.has(t.value)) return null;
        return calculateTargetCell(t.value, sourceData.sourceRange, targetTopLeft);
      });
    }
  }

  /**
   * Return the set of CELL_REF tokens that are endpoints of a `A1:B2` range
   * where exactly one endpoint is in `sourceCells` (a partial overlap). Both
   * endpoints of a partial range are returned so callers can skip them.
   */
  function partialRangeEndpoints(tokens, sourceCells) {
    const skip = new Set();
    for (let i = 0; i + 2 < tokens.length; i++) {
      const a = tokens[i], colon = tokens[i + 1], b = tokens[i + 2];
      if (a.type !== TokenType.CELL_REF) continue;
      if (colon.type !== TokenType.COLON) continue;
      if (b.type !== TokenType.CELL_REF) continue;
      const aIn = sourceCells.has(a.value);
      const bIn = sourceCells.has(b.value);
      if (aIn !== bIn) {
        skip.add(a);
        skip.add(b);
      }
    }
    return skip;
  }

  /**
   * Fetch tokens for a dependent formula — reuses the mutated token array from
   * formulaUpdates if already seen, otherwise tokenizes the stored canonical
   * value (and caches it in formulaUpdates for subsequent passes). Returns
   * null for non-formulas.
   */
  function loadOrGetTokens(cellKey, formulaUpdates) {
    let tokens = formulaUpdates.get(cellKey);
    if (tokens) return tokens;
    const formula = getValue(cellKey);
    if (!formula || !formula.startsWith('=')) return null;
    tokens = tokenize(formula);
    formulaUpdates.set(cellKey, tokens);
    return tokens;
  }

  /**
   * Prepare named range relocations for cut operations
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @returns {{updates: Array, count: number}} Named range updates and count
   */
  function prepareNamedRangeMoves(sourceData, targetTopLeft) {

    const updates = [];
    let count = 0;

    // Get all named ranges
    const allRanges = getAllNamedRanges();

    // Filter to only those fully contained in the cut region
    const rangesToMove = allRanges.filter(range =>
      isRangeFullyContained(range.notation, sourceData.sourceRange)
    );

    // Prepare each affected named range move and add to updates batch
    for (const range of rangesToMove) {
      const newNotation = adjustRangeNotation(
        range.notation,
        sourceData.sourceRange,
        targetTopLeft
      );

      if (newNotation) {
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
  function clearCutSourceCells(sourceData, overwrittenCells, isInternalMove) {
    const clearUpdates = [];

    // Clear source cells that aren't being pasted over themselves
    for (const sourceCellKey of sourceData.values.keys()) {
      if (!overwrittenCells.has(sourceCellKey)) {
        clearUpdates.push([sourceCellKey, '']);
      }
    }

    // Internal moves (insert/delete row/col) must not touch the user's clipboard
    // state or cut UI — those belong to the user's actual cut/paste session.
    if (isInternalMove) return clearUpdates;

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
        pasteExternalData(externalClipboardText, targetTopLeft);
        return;
      }
    }

    // Use internal clipboard
    if (!clipboardData) {
      console.warn('[ClipboardEngine] No clipboard data to paste');
      return;
    }

    _executePaste(clipboardData, targetTopLeft, {
      selectionRange: selection,
      valuesOnly,
    });
  }

  /**
   * Core paste pipeline. Operates on `sourceData` (same shape as clipboardData)
   * passed in by the caller — never reads `clipboardData` directly. Used by
   * both `paste()` (passes the user's clipboard) and `moveRange()` (passes
   * synthetic data for insert/delete row/col without disturbing the user's
   * actual clipboard or cut state).
   *
   * @param {Object} sourceData - { sourceRange, values, displayValues, isCut, formatting }
   * @param {string} targetTopLeft - Top-left cell of paste destination
   * @param {Object} [options]
   * @param {Object} [options.selectionRange] - User selection {start,end}; if omitted, treats target as 1x1 (always single paste mode)
   * @param {boolean} [options.valuesOnly] - Paste computed values, skip formatting
   * @param {boolean} [options.isInternalMove] - Suppress cut-cleanup UI/clipboard side effects (for moveRange)
   */
  function _executePaste(sourceData, targetTopLeft, { selectionRange = null, valuesOnly = false, isInternalMove = false } = {}) {
    // Choose which values to paste: display values (computed results) for
    // values-only, or the original values (which may contain formulas) for normal paste
    const pasteValues = (valuesOnly && sourceData.displayValues)
      ? sourceData.displayValues
      : sourceData.values;

    // Calculate clipboard dimensions
    const { rows: clipRows, cols: clipCols, cells: sourceCells } = expandRange(
      sourceData.sourceRange.start,
      sourceData.sourceRange.end
    );
    const clipTopLeft = parseCellKey(sourceData.sourceRange.start);

    // Determine paste mode: fill (tile) vs. single paste.
    // Without an explicit selectionRange, treat the target as 1x1 — always single mode.
    const selectionCells = selectionRange
      ? expandRange(selectionRange.start, selectionRange.end).cells
      : [targetTopLeft];
    const selTopLeft = parseCellKey(targetTopLeft);
    const shouldFill = selectionCells.length > sourceCells.length;

    // Calculate actual paste area for #REF! handling
    const targetBottomRight = shouldFill
      ? selectionCells[selectionCells.length - 1]  // Fill entire selection
      : calculateTargetCell(                        // Single paste
          sourceCells[sourceCells.length - 1],
          sourceData.sourceRange,
          targetTopLeft
        );

    // Get all cells that will be overwritten (for #REF! handling)
    const { cells: actualOverwrittenCells } = expandRange(targetTopLeft, targetBottomRight);
    const overwrittenCells = new Set(actualOverwrittenCells);

    // Prepare batch of updates
    const updates = shouldFill
      ? prepareFillModePaste(sourceData, targetTopLeft, targetBottomRight, clipRows, clipCols, clipTopLeft, selTopLeft, overwrittenCells, pasteValues)
      : prepareSinglePaste(sourceData, targetTopLeft, overwrittenCells, pasteValues);

    const isCutOperation = sourceData.isCut;

    // Prepare formatting data
    let formattingUpdates = [];
    let sourceCellsToClearFormatting = [];

    // Map source formatting to target cells (for both copy and cut) — skip for values-only paste
    if (sourceData.formatting && sourceData.formatting.size > 0 && !shouldFill && !valuesOnly) {
      for (const [sourceCellKey, formatting] of sourceData.formatting) {
        const targetCellKey = calculateTargetCell(
          sourceCellKey,
          sourceData.sourceRange,
          targetTopLeft
        );
        formattingUpdates.push([targetCellKey, formatting]);
      }
    }

    if (isCutOperation) {
      // Track source cells that need formatting cleared (cells not being overwritten)
      for (const sourceCellKey of sourceData.values.keys()) {
        if (!overwrittenCells.has(sourceCellKey)) {
          sourceCellsToClearFormatting.push(sourceCellKey);
        }
      }
    }

    // Process cut operation side effects (named ranges, formulas, source clears)
    let namedRangeMoveCount = 0;
    if (isCutOperation) {
      const cutResult = processCutOperationSideEffects(sourceData, targetTopLeft, overwrittenCells, shouldFill, isInternalMove);
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
   * Delete a rectangular range: clear its values and convert all external
   * references to those cells into #REF!. Used by the delete-row/col ops at
   * the trailing edge of the grid where there's nothing to shift up/left.
   *
   * @param {Object} range - {start, end} of the cells to delete
   */
  function deleteRange(range) {
    const { cells } = expandRange(range.start, range.end);
    const cellSet = new Set(cells);

    // Rewrite external formulas: any reference to a cell in the deleted range becomes #REF!
    const allDependents = new Set();
    for (const cellKey of cells) {
      for (const dep of getDependentsOf(cellKey)) allDependents.add(dep);
    }

    const formulaUpdates = new Map();
    for (const dependentKey of allDependents) {
      if (cellSet.has(dependentKey)) continue;  // the cell itself is being deleted
      const tokens = loadOrGetTokens(dependentKey, formulaUpdates);
      if (!tokens) continue;
      rewriteCellRefs(tokens, (t) => cellSet.has(t.value) ? '#REF!' : null);
    }

    const updates = [
      ...Array.from(formulaUpdates.entries(), ([key, tokens]) => [key, null, tokens]),
      ...cells.map(k => [k, '']),
    ];

    // Named ranges fully contained in the deleted region have nowhere to go —
    // mirror prepareNamedRangeMoves' "fully contained" filter, but delete
    // instead of relocate. Partial-overlap ranges are left alone (consistent
    // with cut/paste, which also doesn't touch them).
    const rangesToDelete = getAllNamedRanges
      ? getAllNamedRanges().filter(r => isRangeFullyContained(r.notation, range))
      : [];

    if (beginHistoryBatch) beginHistoryBatch();
    try {
      for (const r of rangesToDelete) {
        const result = deleteNamedRange(r.name);
        if (!result.success) {
          console.error(`[ClipboardEngine] Failed to delete named range "${r.name}":`, result.error);
        }
      }
      applyPasteUpdates(updates);
    } finally {
      if (endHistoryBatch) endHistoryBatch();
    }

    if (rangesToDelete.length > 0 && onRefreshNamedRangeDisplay) {
      onRefreshNamedRangeDisplay();
    }
  }

  /**
   * Move a rectangular range of cells to a new location, with the same
   * reference-shifting / named-range / #REF! semantics as cut+paste — but
   * without disturbing the user's clipboard or cut state. Used as the engine
   * primitive for insert/delete row/col.
   *
   * @param {Object} sourceRange - {start, end} of the cells to move
   * @param {string} targetTopLeft - Top-left cell of the destination
   */
  function moveRange(sourceRange, targetTopLeft) {
    const { cells } = expandRange(sourceRange.start, sourceRange.end);

    // Snapshot current values + formatting from the source region
    const values = new Map();
    for (const cellKey of cells) {
      values.set(cellKey, getValue(cellKey));
    }
    const formatting = getFormattingBatch ? getFormattingBatch(cells) : null;

    const sourceData = {
      sourceRange,
      values,
      displayValues: null,
      isCut: true,
      formatting,
    };

    // Wrap in a single history batch so insert/delete is one undo step
    if (beginHistoryBatch) beginHistoryBatch();
    try {
      _executePaste(sourceData, targetTopLeft, { isInternalMove: true });
    } finally {
      if (endHistoryBatch) endHistoryBatch();
    }
  }

  /**
   * Cancel an in-progress cut operation
   */
  function cancelCut() {

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
    // Entries are either [key, value] (non-formula or pre-stringified formula)
    // or [key, null, tokens] (formula with pre-tokenized form). setBatch
    // accepts both shapes and drains the queue in a single pass, so a paste
    // always records exactly one history checkpoint regardless of content mix.
    if (updates.length > 0) setBatch(updates);

    // Check if the active cell was updated and refresh formula bar if needed
    const activeCell = getActiveCell();
    const wasActiveCellUpdated = updates.some(([cellKey]) => cellKey === activeCell);

    if (wasActiveCellUpdated) {
      refreshFormulaBar(activeCell);
    }

  }

  /**
   * Parse and paste external clipboard data (tab-delimited text from Excel, etc.)
   * @param {string} clipboardText - Tab-delimited text from system clipboard
   * @param {string} targetTopLeft - Top-left cell to paste into
   */
  function pasteExternalData(clipboardText, targetTopLeft) {

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
        deleteNamedRange,
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
    },

    performCopyOrCut,
    paste,
    moveRange,
    deleteRange,
    cancelCut,
    hasClipboardData: () => !!clipboardData,
  };
}
