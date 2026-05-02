/*
 * SPREADSHEET GRID
 * ================
 *
 * Renders cell grid with column/row headers and detects user interactions.
 * Manages selection state, mouse/keyboard input, and visual updates.
 *
 * ORGANIZATION:
 * - Configuration/Constants
 * - Dependencies (injected)
 * - State
 * - Interaction State (drag, double-click, event handlers)
 * - Rendering/Mounting
 * - Mouse Interaction
 * - Keyboard Handling
 * - Visual Updates
 * - Input Routing (three-layer detection)
 * - Public API
 */

import { expandRange, getAdjacentCell, normalizeRangeNotation, numberToColumn, columnToNumber, parseCellKey, getRangeBounds, rangesOverlap, isCellReference } from '../utils/cellUtils.js';
import { escapeCSSString } from '../utils/cssUtils.js';
import { REF_COLOR_COUNT } from './formula-bar-highlight.js';
import { isIndicatorEnabled as showIndicator } from './indicator-keys.js';

export function createGrid(initialBounds = { maxCol: 'O', maxRow: 30 }) {
  // ============================================================================
  // CONFIGURATION/CONSTANTS
  // ============================================================================

  // Grid bounds (mutable - can grow via addRows/addColumns)
  // Initialized to match the HTML grid; serves as the minimum floor.
  let gridBounds = { ...initialBounds };
  const minGridBounds = { maxCol: initialBounds.maxCol, maxRow: initialBounds.maxRow };
  const DOUBLE_CLICK_THRESHOLD = 300; // ms
  const COL_MIN_WIDTH = 120;
  const COL_MAX_WIDTH = 350;
  const COL_FIT_DEBOUNCE_MS = 150;

  // Returns bounds constrained for formula editing (e.g., loop sheets restrict to row 1)
  function getEffectiveBounds() {
    if (isFormulaEditingMode && isFormulaEditingMode() && gridBounds.formulaEditingMaxRow !== undefined) {
      return { ...gridBounds, maxRow: gridBounds.formulaEditingMaxRow };
    }
    return gridBounds;
  }

  // Check if a cell is within effective bounds (used to reject out-of-bounds reference picks)
  function isCellWithinEffectiveBounds(cellKey) {
    const bounds = getEffectiveBounds();
    if (bounds === gridBounds) return true; // No restriction active
    const parsed = parseCellKey(cellKey);
    if (!parsed) return true; // Named entity, allow
    return parsed.row <= bounds.maxRow;
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  // Cached CSS inset values (cleared on unmount so re-mount recomputes)
  let cachedInsets = null;

  /**
   * Compute the pixel insets that sticky elements occupy within the scroll container.
   * Cached per mount cycle since these CSS custom properties don't change at runtime.
   */
  function getInsets() {
    if (cachedInsets) return cachedInsets;
    if (!container) return null;

    const styles = getComputedStyle(container);
    const headerHeight = parseFloat(styles.getPropertyValue('--header-height')) || 48;
    const rowHeight = parseFloat(styles.getPropertyValue('--row-height')) || 54;
    const rowHeaderWidth = parseFloat(styles.getPropertyValue('--row-header-width')) || 32;
    const stopColumnWidth = parseFloat(styles.getPropertyValue('--stop-column-width')) || 120;

    // Top inset: header + sticky rows + separator (1px) if sticky rows exist
    const stickyRowCount = stickyTopRows.length;
    const topInset = headerHeight + (stickyRowCount * rowHeight) + (stickyRowCount > 0 ? 1 : 0);

    // Left inset: row header column
    const leftInset = rowHeaderWidth;

    // Right inset: stop column + separator (2px) if sticky right columns exist
    const hasStickyCols = stickyRightColumns.length > 0;
    const rightInset = hasStickyCols ? stopColumnWidth + 2 : 0;

    cachedInsets = { top: topInset, left: leftInset, right: rightInset, bottom: 0 };
    return cachedInsets;
  }

  /**
   * Scroll the container so that cellElement is fully visible within the safe area
   * (i.e., not hidden behind sticky headers, row headers, or sticky columns).
   */
  function scrollCellIntoView(cellElement) {
    if (!container) return;

    const insets = getInsets();
    if (!insets) return;

    const cellKey = cellElement.id;
    const colName = getColumnFromCellKey(cellKey);
    const isInStickyRightCol = colName && stickyRightColumns.includes(colName);

    const containerRect = container.getBoundingClientRect();
    const cellRect = cellElement.getBoundingClientRect();

    // Use clientWidth/clientHeight to exclude scrollbar space — sticky elements
    // position relative to the content box, not the scrollbar gutter.
    const visibleRight = containerRect.left + container.clientWidth;
    const visibleBottom = containerRect.top + container.clientHeight;

    // Define the safe visible area within the container
    const safeTop = containerRect.top + insets.top;
    const safeLeft = containerRect.left + insets.left;
    const safeRight = visibleRight - insets.right;
    const safeBottom = visibleBottom - insets.bottom;

    // Check if cell is in a sticky row — skip vertical scroll if so
    const parsed = parseCellKey(cellKey);
    const isInStickyRow = parsed && stickyTopRows.includes(parsed.row);

    // Horizontal scroll adjustments
    if (isInStickyRightCol) {
      // Sticky-right columns (e.g. _STOP) are always horizontally visible, so
      // the cell-rect check below would spuriously scroll by one column width
      // on every focus. Instead, when navigating into such a column (typically
      // via right-arrow from the last data column), scroll the underlying
      // content to its end so any trailing columns — the add-col pseudo-column
      // and any newly-added data columns just before it — come into view.
      const maxScrollLeft = container.scrollWidth - container.clientWidth;
      if (container.scrollLeft < maxScrollLeft) {
        container.scrollLeft = maxScrollLeft;
      }
    } else if (cellRect.left < safeLeft) {
      container.scrollLeft += cellRect.left - safeLeft;
    } else if (cellRect.right > safeRight) {
      container.scrollLeft += cellRect.right - safeRight;
    }

    // Vertical scroll adjustments (skip for sticky rows)
    if (!isInStickyRow) {
      if (cellRect.top < safeTop) {
        container.scrollTop += cellRect.top - safeTop;
      } else if (cellRect.bottom > safeBottom) {
        container.scrollTop += cellRect.bottom - safeBottom;
      }
    }
  }

  function focusCell(cellKey) {
    const cellElement = document.getElementById(cellKey);
    if (cellElement) {
      cellElement.focus();
      scrollCellIntoView(cellElement);
    }
  }

  // Tracks the cell currently marked as a find match so we can remove the
  // class without scanning the DOM. Distinct from active-cell selection so
  // the find bar can preview results without stealing focus.
  let lastFindMatchKey = null;

  function clearFindMatch() {
    if (!lastFindMatchKey) return;
    const el = document.getElementById(lastFindMatchKey);
    if (el) el.classList.remove('find-match');
    lastFindMatchKey = null;
  }

  function revealCell(cellKey) {
    clearFindMatch();
    const cellElement = document.getElementById(cellKey);
    if (!cellElement) return;
    cellElement.classList.add('find-match');
    lastFindMatchKey = cellKey;
    scrollCellIntoView(cellElement);
  }


  /**
   * Extract column name from cell key (e.g., "A1" -> "A", "_STOP5" -> "_STOP")
   * @param {string} cellKey - Cell identifier
   * @returns {string|null} - Column name or null if invalid
   */
  function getColumnFromCellKey(cellKey) {
    const match = cellKey.match(/^([A-Z]+|_[A-Z]+)/i);
    return match ? match[1].toUpperCase() : null;
  }

  /**
   * Count empty cells to the right of a given cell.
   * Used to calculate how far text can overflow before hitting content.
   * @param {string} cellKey - Cell identifier
   * @returns {number} - Number of consecutive empty cells to the right
   */
  function countEmptyCellsToRight(cellKey) {
    const parsed = parseCellKey(cellKey);
    if (!parsed) return 0;

    // Skip sticky columns - they don't participate in overflow
    const colName = getColumnFromCellKey(cellKey);
    if (colName && stickyRightColumns.includes(colName)) return 0;

    let count = 0;
    let colNum = parsed.colNum + 1;
    const maxColNum = columnToNumber(gridBounds.maxCol);

    while (colNum <= maxColNum) {
      const neighborKey = numberToColumn(colNum) + parsed.row;
      const neighborDisplay = getCellDisplay(neighborKey);
      if (neighborDisplay?.text?.trim()) break;  // has content, stop
      count++;
      colNum++;
    }
    return count;
  }

  /**
   * Measure rendered text width on the shared canvas, applying per-cell
   * font overrides (size/weight/style) the same way fitColumnWidths does.
   */
  function measureCellTextWidth(text, styles) {
    if (!measureCanvas || !text) return 0;
    const hasOverride = styles && (styles.fontSize || styles.fontWeight || styles.fontStyle);
    if (!hasOverride) return measureCanvas.measureText(text).width;

    let font = cellFont;
    if (styles.fontSize) font = font.replace(/^\S+/, styles.fontSize);
    if (styles.fontWeight) font = `${styles.fontWeight} ${font}`;
    if (styles.fontStyle) font = `${styles.fontStyle} ${font}`;
    measureCanvas.font = font;
    const w = measureCanvas.measureText(text).width;
    measureCanvas.font = cellFont;
    return w;
  }

  /**
   * Compute how far the cell's background should extend past its own right
   * edge so it lands on a column boundary (rather than ending mid-cell where
   * the glyphs stop). Walks neighbors, accumulating column widths until the
   * cumulative width covers the text overflow; that cumulative is the snapped
   * extension.
   *
   * stopAtContent=true: overflow case — stop at the first non-empty neighbor.
   * stopAtContent=false: active-cell case — extend over neighbors with content too.
   *
   * Returns 0 if the text fits in the cell's own width, or if the cell is in a
   * sticky-right column (sticky columns don't participate in overflow).
   */
  function getSnappedExtensionWidth(cellKey, text, styles, stopAtContent) {
    if (!text) return 0;
    const parsed = parseCellKey(cellKey);
    if (!parsed) return 0;

    const colName = getColumnFromCellKey(cellKey);
    if (colName && stickyRightColumns.includes(colName)) return 0;

    // Text glyphs start at cell.left + 6 (left padding) and run for T px, so
    // they extend past cell.right when T + 6 > N. Don't count the right
    // padding here — text living inside that padding still fits in the cell
    // box and shouldn't trigger an extension.
    const LEFT_PADDING = 6;
    const ownWidth = columnWidths[colName] || COL_MIN_WIDTH;
    const overflow = measureCellTextWidth(text, styles) + LEFT_PADDING - ownWidth;
    if (overflow <= 0) return 0;

    let cumulative = 0;
    let colNum = parsed.colNum + 1;
    const maxColNum = columnToNumber(gridBounds.maxCol);
    while (colNum <= maxColNum) {
      if (stopAtContent) {
        const neighborKey = numberToColumn(colNum) + parsed.row;
        const neighborDisplay = getCellDisplay(neighborKey);
        if (neighborDisplay?.text?.trim()) break;
      }
      cumulative += columnWidths[numberToColumn(colNum)] || COL_MIN_WIDTH;
      if (cumulative >= overflow) return cumulative;
      colNum++;
    }
    return cumulative;
  }

  /**
   * Recompute and apply overflow snap variables on a cell. Used to refresh
   * the snap when something it depends on changes after the cell was last
   * touched — column widths (post fitColumnWidths) or a neighbor's emptiness.
   */
  function updateCellOverflowSnap(cellKey) {
    const cellElement = document.getElementById(cellKey);
    if (!cellElement) return;
    const display = getCellDisplay(cellKey);
    const text = display?.text || '';

    const overflowWidth = getSnappedExtensionWidth(cellKey, text, display?.styles, true);
    cellElement.style.setProperty('--overflow-width', `${overflowWidth}px`);
    if (overflowWidth > 0) cellElement.setAttribute('data-has-overflow', '');
    else cellElement.removeAttribute('data-has-overflow');

    if (cellElement.classList.contains('active-cell')) {
      const activeText = display?.expandedText || text;
      const activeWidth = getSnappedExtensionWidth(cellKey, activeText, display?.styles, false);
      cellElement.style.setProperty('--active-overflow-width', `${activeWidth}px`);
    }
  }

  /**
   * Find the nearest cell with content to the left of cellKey in the same row.
   * That's the only leftward cell whose overflow could have extended through
   * cellKey (cells further left would have stopped at this one).
   */
  function findOverflowSourceLeftOf(cellKey) {
    const parsed = parseCellKey(cellKey);
    if (!parsed) return null;
    for (let c = parsed.colNum - 1; c >= 1; c--) {
      const leftKey = numberToColumn(c) + parsed.row;
      const display = getCellDisplay(leftKey);
      if (display?.text?.trim()) return leftKey;
    }
    return null;
  }

  /**
   * Measure all columns and update widths to fit content.
   * Clamps each column between COL_MIN_WIDTH and COL_MAX_WIDTH.
   */
  function fitColumnWidths() {
    if (!measureCanvas || !gridContainer) return;

    const maxColNum = columnToNumber(gridBounds.maxCol);
    const maxRow = gridBounds.maxRow;
    const CELL_PADDING = 12; // 6px each side
    let widthsChanged = false;

    for (let c = 1; c <= maxColNum; c++) {
      const col = numberToColumn(c);
      let widest = 0;

      for (let r = (gridBounds.minRow ?? 1); r <= maxRow; r++) {
        const cellKey = `${col}${r}`;
        const display = getCellDisplay(cellKey);
        const text = display?.text || '';
        if (!text) continue;

        // If this cell overflows into empty neighbors, it doesn't need
        // the column itself to be wider — skip it for width measurement.
        const emptyToRight = countEmptyCellsToRight(cellKey);
        if (emptyToRight > 0) continue;

        const w = measureCellTextWidth(text, display.styles) + CELL_PADDING;
        if (w > widest) widest = w;
      }

      // Also measure header text
      const headerText = columnNames[col] ? `${col}: ${columnNames[col]}` : col;
      const headerWidth = measureCanvas.measureText(headerText).width + CELL_PADDING;
      if (headerWidth > widest) widest = headerWidth;

      const clamped = Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.ceil(widest)));

      if (columnWidths[col] !== clamped) {
        columnWidths[col] = clamped;
        applyColumnWidth(col, clamped);
        widthsChanged = true;
      }
    }

    // Column widths feed into the snap calculation. If any width changed,
    // re-snap every content cell so hover/active highlights match the new
    // layout (avoids stale --overflow-width).
    if (widthsChanged) {
      const cells = gridContainer.querySelectorAll('td[data-has-content]');
      cells.forEach((cell) => updateCellOverflowSnap(cell.id));
    }
  }

  /**
   * Apply a specific width to a column header and all its cells.
   */
  function applyColumnWidth(col, width) {
    if (!gridContainer) return;
    const px = `${width}px`;

    // Update column header
    const th = gridContainer.querySelector(`thead th[data-col="${col}"]`);
    if (th) {
      th.style.minWidth = px;
      th.style.maxWidth = px;
    }

    // Update all cells in this column
    const maxRow = gridBounds.maxRow;
    const minRow = gridBounds.minRow ?? 1;
    for (let r = minRow; r <= maxRow; r++) {
      const cell = document.getElementById(`${col}${r}`);
      if (cell) {
        cell.style.minWidth = px;
        cell.style.maxWidth = px;
      }
    }
  }

  /**
   * Debounced wrapper for fitColumnWidths.
   */
  function scheduleFitColumnWidths() {
    if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
    fitDebounceTimer = setTimeout(fitColumnWidths, COL_FIT_DEBOUNCE_MS);
  }

  /**
   * Create a cell element with proper configuration
   * @param {string} cellKey - Cell identifier (e.g., "A1", "P16")
   * @returns {HTMLElement} - The created cell element
   */
  function createCellElement(cellKey) {
    const displayData = getCellDisplay(cellKey);
    const cellElement = document.createElement('td');
    cellElement.setAttribute('role', 'gridcell');
    cellElement.setAttribute('contenteditable', 'plaintext-only');
    cellElement.id = cellKey;

    const escapedText = escapeCSSString(displayData.text || '');
    cellElement.style.setProperty('--cell-value', `"${escapedText}"`);
    Object.assign(cellElement.style, displayData.styles);

    // Apply sticky-right class if this column is sticky
    const colName = getColumnFromCellKey(cellKey);
    if (colName && stickyRightColumns.includes(colName)) {
      cellElement.classList.add('grid-sticky-right-cell');
    }

    // Mark if cell has content (for z-index layering - allows overflow from left to be covered)
    if (displayData.text?.trim()) {
      cellElement.setAttribute('data-has-content', '');
    }

    // Set overflow width: snaps the background extension to the next column
    // boundary instead of ending mid-cell where the glyphs stop.
    const overflowWidth = getSnappedExtensionWidth(cellKey, displayData.text || '', displayData.styles, true);
    cellElement.style.setProperty('--overflow-width', `${overflowWidth}px`);
    if (overflowWidth > 0) cellElement.setAttribute('data-has-overflow', '');

    return cellElement;
  }

  // ============================================================================
  // DEPENDENCIES (injected via init)
  // ============================================================================
 
 
  let onClearCells = null;

  //Formula bar coordination
  let getCellDisplay = null;
  let onInputDetected = null;
  let isFormulaEditingMode = null;
  let revertReferencePicking = null;
  let insertReference = null; 
  let focusFormulaBar = null;
  let loadCellInFormulaBar = null;
  let getDependentsOf = null;
  let updateCellNameDisplay = null;
  let commitFormulaBarCell = null;
  let onSelectionChange = null;

  // Formatting callbacks
  let applyBold = null;
  let applyItalic = null;
  let alignLeft = null;
  let alignCenter = null;
  let alignRight = null;

  // Clipboard callbacks
  let onCopyOrCut = null;
  let onPaste = null;
  let onPasteValues = null;
  let hasInternalClipboard = null;
  let cancelCut = null;

  // History callbacks
  let onUndo = null;
  let onRedo = null;

  // Drill-down callback (for custom function inspection)
  let onDrilldown = null;
  let canDrilldown = null;

  // Row/column structure ops (each may be null if the orchestrator doesn't expose it —
  // e.g. loop sheets don't wire row ops since rows are bound to loop iterations)
  let onInsertRow = null;
  let onInsertCol = null;
  let onDeleteRow = null;
  let onDeleteCol = null;

  // Named range overlay
  let getAllNamedRanges = null;

  // ============================================================================
  // DOM STATE
  // ============================================================================

  // DOM elements
  let container = null;
  let gridContainer = null;
  let namedRangeOverlayContainer = null;
  let formulaRefOverlayContainer = null;
  let lastRefColorMap = null;
  let lastResolveNamedRange = null;
  let lastRefOverlaySignature = null;
  let formulaDependentOverlayContainer = null;
  let lastDependentSet = null;
  let lastDependentSignature = null;
  let offscreenIndicatorContainer = null;
  let floatingToolbar = null;

  // ============================================================================
  // COLUMN WIDTH STATE
  // ============================================================================

  let columnWidths = {};       // col letter → current width in px
  let measureCanvas = null;    // canvas 2D context for measureText()
  let fitDebounceTimer = null; // debounce timer ID
  let cellFont = '';           // font string read from computed styles on mount

  // ============================================================================
  // COLUMN NAMES STATE
  // ============================================================================

  // Column letter → display name (e.g., { A: "Counter", B: "Sum" })
  let columnNames = {};

  // Callback when a column name changes (injected via init)
  let onColumnNameChange = null;

  // ============================================================================
  // STICKY COLUMN STATE
  // ============================================================================

  // Columns that should stick to the right edge (e.g., ['_STOP'])
  let stickyRightColumns = [];

  // Rows that should stick to the top (e.g., [0, 1] for loop sheets)
  let stickyTopRows = [];

  // ============================================================================
  // SELECTION STATE & functions for interaction
  // ============================================================================
  let activeCell = 'A1';  // Current focused cell
  let selectionRange = { start: 'A1', end: 'A1' };  // Selected range
  let selectionAnchor = 'A1';  // For shift-extending
  let currentlyHighlightedElements = [];  // Track highlighted cell elements for efficient clearing
  let pendingHighlightFrame = null;  // rAF ID for batching selection highlights



  function getActiveCell() {
    return activeCell;
  }

  function getSelection() {
    return selectionRange;
  }

  /**
   * Internal helper: Update selection state and trigger all related side effects
   * Single point of truth for selection mutations - ensures consistency
   */
  function _updateSelectionState(newRange, newAnchor) {
    selectionRange = newRange;
    selectionAnchor = newAnchor;

    // Batch highlight updates to once per animation frame to avoid
    // excessive reflows during drag selection (especially on Firefox
    // where sticky-positioned elements make reflows expensive).
    if (pendingHighlightFrame) cancelAnimationFrame(pendingHighlightFrame);
    pendingHighlightFrame = requestAnimationFrame(() => {
      pendingHighlightFrame = null;
      highlightSelection(selectionRange);
      updateNamedRangeOverlays();
    });

    /**
    * The following check verifies we are currently picking references--
    * the event handlers mostly don't bother with the focus check because they only run while having the correct focus
    * (except click handlers which do the same thing in one case)
    */

    if (isFormulaEditingMode() && document.activeElement?.getAttribute('role') === 'gridcell') {
      focusCell(newRange.end);
      const notation = getSelectionNotation();
      insertReference(notation);
      // Shows the active cell--to correctly label the formula bar
      updateCellNameDisplay(activeCell);
    } else {
      // Show the current selection--which will include the active cell if not reference picking
      updateCellNameDisplay(getSelectionNotation());
    }

    onSelectionChange?.();
  }

  function setActiveCell(cellKey) {
    activeCell = cellKey;

    _updateSelectionState(
      { start: cellKey, end: cellKey },
      cellKey
    );

    highlightActiveCell(cellKey);
    focusCell(cellKey);
    loadCellInFormulaBar(cellKey);

    if (getDependentsOf) {
      updateDependentOverlays(getDependentsOf(cellKey));
    }
    updateOffscreenIndicators();
  }

  /**
   * Move the active cell in a direction
   * Note: Commit happens automatically via FormulaBar's blur handler when focus changes
   * @param {string} direction - "up", "down", "left", "right"
   * @returns {boolean} - True if moved successfully, false if hit boundary
   */
  function moveActiveCell(direction) {
    const current = getActiveCell();
    const adjacent = getAdjacentCell(current, direction, gridBounds);

    if (adjacent) {
      setActiveCell(adjacent);
      return true;
    }

    // Hit boundary - no movement
    return false;
  }

  /**
   * Set selection range
   */
  function setSelection(start, end) {
    // Prevent mixed selections between virtual columns (e.g., _STOP) and regular columns
    const startCol = getColumnFromCellKey(start);
    const endCol = getColumnFromCellKey(end);
    const startIsVirtual = startCol && startCol.startsWith('_');
    const endIsVirtual = endCol && endCol.startsWith('_');

    if (startIsVirtual !== endIsVirtual) {
      // One is virtual, one is regular - reject
      return;
    }

    // Use helper to update selection state
    _updateSelectionState(
      { start, end },
      start  // Update anchor to the start of the new selection
    );
  }

  /**
   * Extend selection from anchor to cell (for shift-select, shift arrow, and drag clicks)
   */
  function extendSelection(cellKey) {
    setSelection(selectionAnchor, cellKey);
  }
  /**
   * Collapse selection to the active cell-Used when transitioning focus state to Formula Bar
   */
  function collapseToActiveCell() {
    setSelection(activeCell, activeCell);
  }

  /**
   * Step the selection anchor in a direction (for reference picking navigation)
   * Moves the anchor and selection to an adjacent cell
   * @param {string} direction - "up", "down", "left", "right"
   * @returns {boolean} - True if moved successfully, false if hit boundary
   */
  function stepSelectionAnchor(direction) {
    const current = selectionAnchor;
    const adjacent = getAdjacentCell(current, direction, getEffectiveBounds());

    if (adjacent) {
      setSelection( adjacent, adjacent);
      return true;
    }

    return false;
  }

  /**
   * Extend selection in a direction (for shift+arrow)
   * Extends from anchor to an adjacent cell in the given direction
   * @param {string} direction - "up", "down", "left", "right"
   * @returns {boolean} - True if extended successfully, false if hit boundary
   */
  function extendSelectionInDirection(direction) {
    const current = selectionRange.end;
    const adjacent = getAdjacentCell(current, direction, getEffectiveBounds());

    if (adjacent) {
      extendSelection(adjacent);
      return true;
    }

    return false;
  }

  /**
   * Get selection as notation string (e.g., "A1:C3")
   * Always returns normalized form (top-left:bottom-right)
   */
  function getSelectionNotation() {
    if (selectionRange.start === selectionRange.end) {
      return selectionRange.start;
    }
    return normalizeRangeNotation(selectionRange.start, selectionRange.end);
  }



  // ============================================================================
  // INTERACTION STATE (drag detection, double-click, event handlers)
  // ============================================================================

  // Drag selection state
  let isDragging = false;
  let dragStartCell = null;
  let isSelectionDrag = false; // Touch: second tap on active cell + drag = extend selection

  // Pointer tracking for tap/drag detection
  let activePointers = new Map(); // pointerId -> {startX, startY, lastX, lastY, cellKey, shiftKey}

  // Double-click detection
  let lastClickTime = 0;
  let lastClickCell = null;

  // Movement threshold and preview state
  const MOVEMENT_THRESHOLD = 5; // pixels
  let previewedCells = new Set(); // Cells with preview highlighting
  let handledPointers = new Set(); // Pointers that committed via drag/scroll

  // ============================================================================
  // RENDERING/MOUNTING
  // ============================================================================

  // References for expansion buttons
  let addColBtn = null;
  let addRowBtn = null;

  // Event handlers stored for removal on unmount
  function handleAddColumn(e) {
    const count = e.shiftKey ? 5 : 1;
    // Capture the scroll-content width so we can shift scrollLeft by the same
    // amount the table grew, keeping the add-columns button under the user's
    // finger across repeated clicks.
    const oldScrollWidth = container?.scrollWidth ?? 0;
    const success = addColumns(count);
    if (!success) {
      alert('Cannot add more columns - maximum is ZZ');
      return;
    }
    if (container) {
      container.scrollLeft += container.scrollWidth - oldScrollWidth;
      updateFloatingExpansionButtons();
    }
  }

  function handleAddRow(e) {
    const count = e.shiftKey ? 5 : 1;
    // Same idea as handleAddColumn but on the vertical axis: shift scrollTop
    // by the new content height so the add-rows button stays put.
    const oldScrollHeight = container?.scrollHeight ?? 0;
    addRows(count);
    if (container) {
      container.scrollTop += container.scrollHeight - oldScrollHeight;
      updateFloatingExpansionButtons();
    }
  }

  function handleSelectStart(e) {
    if (isDragging) {
      e.preventDefault();
    }
  }

  /**
   * Mount the grid with provided elements
   * @param {Object} elements - { container, addColBtn, addRowBtn }
   */
  function mount(elements) {
    container = elements.container;
    addColBtn = elements.addColBtn;
    addRowBtn = elements.addRowBtn;

    // Find existing table (defined in index.html)
    gridContainer = container.querySelector('.spreadsheet-grid');
    if (!gridContainer) {
      console.error('[Grid] Table .spreadsheet-grid not found in container');
      return;
    }

    // Create named range overlay container (sits before the table in the scroll flow).
    // Insert into the table's parent so positioning stays relative to the table even
    // when the table is wrapped (e.g. inside .grid-main alongside the add-columns button).
    const gridParent = gridContainer.parentNode;
    namedRangeOverlayContainer = document.createElement('div');
    namedRangeOverlayContainer.className = 'named-range-overlays';
    gridParent.insertBefore(namedRangeOverlayContainer, gridContainer);

    // Create formula reference overlay container (same pattern, lower z-index)
    formulaRefOverlayContainer = document.createElement('div');
    formulaRefOverlayContainer.className = 'formula-ref-overlays';
    gridParent.insertBefore(formulaRefOverlayContainer, gridContainer);

    // Create dependent (reverse-reference) overlay container
    formulaDependentOverlayContainer = document.createElement('div');
    formulaDependentOverlayContainer.className = 'formula-dependent-overlays';
    gridParent.insertBefore(formulaDependentOverlayContainer, gridContainer);

    // Off-screen indicator container — fixed to viewport, doesn't scroll with grid.
    // Body-attached so it stays anchored to the visible grid rect on scroll.
    offscreenIndicatorContainer = document.createElement('div');
    offscreenIndicatorContainer.className = 'offscreen-indicators';
    document.body.appendChild(offscreenIndicatorContainer);

    // Event delegation: drag selection handlers (using pointer events for mouse/touch/pen)
    gridContainer.addEventListener('pointerdown', handlePointerDown);
    gridContainer.addEventListener('pointermove', handlePointerMove);
    gridContainer.addEventListener('pointerup', handlePointerUp);
    gridContainer.addEventListener('pointercancel', handlePointerCancel);
    gridContainer.addEventListener('pointerenter', handlePointerEnter); // Check if drag is still valid on re-entry

    // Touch: prevent browser scroll/pan when touching the active cell,
    // so our pointer events can handle selection drag without being cancelled.
    // preventDefault on pointerdown alone isn't enough — browsers use touchstart
    // to decide whether to initiate scrolling, and will fire pointercancel if
    // touch-action allows panning.
    gridContainer.addEventListener('touchstart', handleTouchStart, { passive: false });

    // Re-render overlays on resize/zoom (pixel positions go stale)
    window.addEventListener('resize', handleOverlayResize);

    // Suppress native context menu (long-press on touch) — we have our own floating toolbar
    gridContainer.addEventListener('contextmenu', handleContextMenu);

    // Prevent text selection during drag
    gridContainer.addEventListener('selectstart', handleSelectStart);

    // Input detection: three-layer approach for all input types
    gridContainer.addEventListener('beforeinput', handleBeforeInput, true);
    gridContainer.addEventListener('input', handleInput, true);
    gridContainer.addEventListener('compositionend', handleCompositionEnd, true);

    // Arrow key navigation
    gridContainer.addEventListener('keydown', handleKeyDown);

    // Clipboard event handlers (handles both keyboard shortcuts and context menu)
    gridContainer.addEventListener('copy', handleCopy);
    gridContainer.addEventListener('cut', handleCut);
    gridContainer.addEventListener('paste', handlePaste);

    // Column header double-click for renaming
    gridContainer.addEventListener('dblclick', handleColumnHeaderDblClick);

    // Attach expansion button event listeners
    addColBtn?.addEventListener('click', handleAddColumn);
    addRowBtn?.addEventListener('click', handleAddRow);

    // Keep the expansion buttons floating to the viewport center on their
    // perpendicular axis. The add-rows button sits below the table in normal
    // flow (so it scrolls out of view when not near the bottom); we translate
    // it horizontally so it's always at the horizontal center of the visible
    // viewport. The add-columns button is vice versa.
    container.addEventListener('scroll', updateFloatingExpansionButtons);
    // Capture-phase window scroll catches any scroll on the page, including
    // the grid container — covers cases where the indicators need to update.
    window.addEventListener('scroll', handleScrollForIndicators, true);
    window.addEventListener('resize', updateFloatingExpansionButtons);
    // On Android the soft keyboard shrinks/grows the visual viewport without
    // firing window.resize; listen on visualViewport too so the buttons
    // re-center when the keyboard opens or closes.
    window.visualViewport?.addEventListener('resize', updateFloatingExpansionButtons);

    // Dismiss floating toolbar when tapping outside it
    document.addEventListener('pointerdown', handleDocumentPointerDown);

    // Initialize with A1 as active cell (this triggers all cross-component coordination)
    setActiveCell('A1');

    // Apply sticky column styles if any were set before mount
    applyStickyRightColumnStyles();

    // Set up canvas for text measurement (auto-fit column widths)
    const sampleCell = gridContainer.querySelector('[role="gridcell"]');
    if (sampleCell) {
      const computed = getComputedStyle(sampleCell);
      const canvas = document.createElement('canvas');
      measureCanvas = canvas.getContext('2d');
      cellFont = `${computed.fontSize} ${computed.fontFamily}`;
      measureCanvas.font = cellFont;
    }

    // Initial column width fit
    fitColumnWidths();

    // Position the floating expansion buttons for the initial scroll/viewport state.
    updateFloatingExpansionButtons();
  }

  function updateFloatingExpansionButtons() {
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const viewportCenterX = containerRect.left + container.clientWidth / 2;
    const viewportCenterY = containerRect.top + container.clientHeight / 2;

    // For each button, measure its current on-screen center (which already
    // includes the last translate we applied, stored in data-translate-delta),
    // back out that prior delta to recover the natural center, then compute a
    // fresh delta that puts the button on the requested viewport axis. Works
    // whether the button is a flex sibling of the table (regular sheets) or
    // inside a rowspan'd <td> before _STOP (loop sheets), and avoids the forced
    // reflow you'd get from resetting transform before each measurement.
    const reposition = (btn, axis, viewportCenter) => {
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const currentCenter = axis === 'x'
        ? rect.left + rect.width / 2
        : rect.top + rect.height / 2;
      const prevDelta = parseFloat(btn.dataset.translateDelta) || 0;
      const naturalCenter = currentCenter - prevDelta;
      const delta = viewportCenter - naturalCenter;
      btn.style.transform = axis === 'x' ? `translateX(${delta}px)` : `translateY(${delta}px)`;
      btn.dataset.translateDelta = delta;
    };

    reposition(addRowBtn, 'x', viewportCenterX);
    reposition(addColBtn, 'y', viewportCenterY);
  }

  /**
   * Unmount the grid (remove event listeners, clear references)
   */
  function unmount() {
    if (gridContainer) {
      // Remove all event listeners from grid
      gridContainer.removeEventListener('pointerdown', handlePointerDown);
      gridContainer.removeEventListener('pointermove', handlePointerMove);
      gridContainer.removeEventListener('pointerup', handlePointerUp);
      gridContainer.removeEventListener('pointercancel', handlePointerCancel);
      gridContainer.removeEventListener('pointerenter', handlePointerEnter);
      gridContainer.removeEventListener('touchstart', handleTouchStart);
      gridContainer.removeEventListener('contextmenu', handleContextMenu);
      gridContainer.removeEventListener('selectstart', handleSelectStart);
      gridContainer.removeEventListener('beforeinput', handleBeforeInput, true);
      gridContainer.removeEventListener('input', handleInput, true);
      gridContainer.removeEventListener('compositionend', handleCompositionEnd, true);
      gridContainer.removeEventListener('keydown', handleKeyDown);
      gridContainer.removeEventListener('copy', handleCopy);
      gridContainer.removeEventListener('cut', handleCut);
      gridContainer.removeEventListener('paste', handlePaste);
      gridContainer.removeEventListener('dblclick', handleColumnHeaderDblClick);
      // Table stays in DOM (defined in index.html)
    }

    // Remove expansion button listeners
    addColBtn?.removeEventListener('click', handleAddColumn);
    addRowBtn?.removeEventListener('click', handleAddRow);

    // Remove floating button position updates
    if (container) {
      container.removeEventListener('scroll', updateFloatingExpansionButtons);
    }
    window.removeEventListener('scroll', handleScrollForIndicators, true);
    window.removeEventListener('resize', updateFloatingExpansionButtons);
    window.visualViewport?.removeEventListener('resize', updateFloatingExpansionButtons);

    // Remove document-level listeners
    document.removeEventListener('pointerdown', handleDocumentPointerDown);

    // Remove resize listener
    window.removeEventListener('resize', handleOverlayResize);

    // Remove overlay containers
    if (namedRangeOverlayContainer) {
      namedRangeOverlayContainer.remove();
      namedRangeOverlayContainer = null;
    }
    if (formulaRefOverlayContainer) {
      formulaRefOverlayContainer.remove();
      formulaRefOverlayContainer = null;
    }
    if (formulaDependentOverlayContainer) {
      formulaDependentOverlayContainer.remove();
      formulaDependentOverlayContainer = null;
    }
    if (offscreenIndicatorContainer) {
      offscreenIndicatorContainer.remove();
      offscreenIndicatorContainer = null;
    }

    // Remove floating toolbar
    if (floatingToolbar) {
      floatingToolbar.remove();
      floatingToolbar = null;
    }

    // Clear references (container remains in index.html)
    container = null;
    gridContainer = null;
    addColBtn = null;
    addRowBtn = null;
    cachedInsets = null;
    columnWidths = {};
    measureCanvas = null;
    if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
    fitDebounceTimer = null;
    cellFont = '';
  }

  // ============================================================================
  // CLIPBOARD INTERACTION
  // ============================================================================


  function handleCopy(e) {
    e.preventDefault();
    onCopyOrCut(false);
  }


  function handleCut(e) {
    e.preventDefault();
    onCopyOrCut(true);
  }


  function handlePaste(e) {
    e.preventDefault();
    onPaste(e.clipboardData?.getData('text/plain'))
  }

  // ============================================================================
  // POINTER INTERACTION (mouse/touch/pen)
  // ============================================================================

  /**
   * Handle touchstart — prevents browser scroll/pan when we need to handle
   * the touch ourselves (active cell selection drag, or formula reference picking).
   * For all other cases, we don't preventDefault, so native scrolling works.
   */
  function handleTouchStart(e) {
    const touch = e.touches[0];
    if (!touch) return;
    const cellElement = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[role="gridcell"]');
    if (!cellElement) return;

    // In formula editing mode, any cell touch should pick references, not scroll
    if (isFormulaEditingMode()) {
      e.preventDefault();
      return;
    }

    // Normal mode: only prevent scroll on the active cell (for selection drag)
    if (cellElement.id === activeCell) {
      e.preventDefault();
    }
  }

  function handleContextMenu(e) {
    e.preventDefault();
    if (isFormulaEditingMode()) return;

    const cellElement = e.target.closest('[role="gridcell"]');
    if (!cellElement || !cellElement.id) return;

    const cellKey = cellElement.id;
    if (cellKey !== activeCell) {
      setActiveCell(cellKey);
    }
    showFloatingToolbar();
  }

  /**
   * Handle pointer down on a cell (mouse/touch/pen)
   * New behavior: Preview on down, commit on up (except double-click)
   */
  function handlePointerDown(e) {
    const cellElement = e.target.closest('[role="gridcell"]');
    if (!cellElement || !cellElement.id) return;

    // Only handle primary button (left mouse button / primary touch)
    if (e.button !== 0) return;

    const cellKey = cellElement.id;

    // preventDefault to block text selection and allow our drag handling.
    // For touch on a non-active cell in normal mode, let the browser scroll natively.
    // In formula editing mode, always preventDefault so touch dragging picks references.
    const tappingActiveCell = cellKey === activeCell;
    if (e.pointerType !== 'touch' || tappingActiveCell || isFormulaEditingMode()) {
      e.preventDefault();
    }

    isSelectionDrag = (e.pointerType === 'touch' && tappingActiveCell);

    // Track this pointer with position info for threshold detection and scrolling
    activePointers.set(e.pointerId, {
      startX: e.clientX,      // Initial position (for threshold check)
      startY: e.clientY,      // Initial position (for threshold check)
      lastX: e.clientX,       // Current position (for scroll deltas if needed)
      lastY: e.clientY,       // Current position (for scroll deltas if needed)
      cellKey: cellKey,
      shiftKey: e.shiftKey,   // Preserve user intent
      pointerType: e.pointerType
    });

    // Check for double-click (only exception that commits immediately)
    const currentTime = Date.now();
    const isDoubleClick =
      lastClickCell === cellKey &&
      (currentTime - lastClickTime) < DOUBLE_CLICK_THRESHOLD;

    lastClickTime = currentTime;
    lastClickCell = cellKey;

    if (isDoubleClick) {
      // Reset detection so subsequent rapid clicks aren't also treated as double-clicks
      lastClickTime = 0;
      lastClickCell = null;

      // Double-click: Commit immediately to formula bar
      // Revert fixes what the first click did, commit is needed because it was skipped
      if (isFormulaEditingMode()) {
        revertReferencePicking();
        commitFormulaBarCell();
      }

      clearPreviewHighlights();
      setActiveCell(cellKey);
      focusFormulaBar();

      // Mark as handled so pointerup doesn't commit again
      handledPointers.add(e.pointerId);
      return;
    }

    // For all other cases (single tap, drag, scroll): just add preview
    addPreviewHighlight(cellKey);

    // Store the drag start cell for later use
    dragStartCell = cellKey;
  }


  function handlePointerMove(e) {
    // Only process if we're tracking this pointer
    if (!activePointers.has(e.pointerId)) return;

    const pointer = activePointers.get(e.pointerId);

    // Update current position
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;

    // Calculate distance from initial position
    const distanceMoved = Math.sqrt(
      Math.pow(e.clientX - pointer.startX, 2) +
      Math.pow(e.clientY - pointer.startY, 2)
    );

    // Check if we've crossed the movement threshold and haven't committed yet
    if (distanceMoved > MOVEMENT_THRESHOLD && !handledPointers.has(e.pointerId)) {

      // Movement detected - start drag selection
      const inFormulaEditingMode = isFormulaEditingMode();

      // Touch on non-active cell: let the browser handle scroll natively,
      // UNLESS we're in formula editing mode (where dragging picks references).
      if (pointer.pointerType === 'touch' && !isSelectionDrag && !inFormulaEditingMode) {
        handledPointers.add(e.pointerId);
        clearPreviewHighlights();
        return;
      }

      // Clear previews before committing
      clearPreviewHighlights();

      if (isSelectionDrag && !inFormulaEditingMode) {
        // Touch selection drag: extend selection from the active cell
        // Active cell stays as the anchor — don't change it
        isDragging = true;
        handledPointers.add(e.pointerId);
        return;
      } else if (inFormulaEditingMode) {
        // Reject drags starting outside effective bounds
        if (!isCellWithinEffectiveBounds(dragStartCell)) return;
        // Formula editing mode - pick references
        // Always focus the cell so keyboard navigation works
        focusCell(dragStartCell);
        setSelection(dragStartCell, dragStartCell);
      } else {
        // Normal mode - set active cell
        setActiveCell(dragStartCell);
      }

      // Enable drag and mark as handled
      isDragging = true;
      handledPointers.add(e.pointerId);

      return;
    }

    // If we're in drag selection mode (already committed)
    if (isDragging) {
      // For touch, e.target stays as the original element — use elementFromPoint
      // to find the cell under the finger. For mouse, e.target updates normally.
      const targetElement = pointer.pointerType === 'touch'
        ? document.elementFromPoint(e.clientX, e.clientY)
        : e.target;
      const cellKey = targetElement?.closest('[role="gridcell"]')?.id;
      if (!cellKey || !isCellWithinEffectiveBounds(cellKey)) return;

      if (isSelectionDrag) {
        // Touch selection drag: extend from the active cell (anchor stays fixed)
        extendSelection(cellKey);
      } else if (cellKey !== dragStartCell) {
        extendSelection(cellKey);
      }
    }
  }

  function handlePointerUp(e) {
    // Get pointer data before deleting
    const pointer = activePointers.get(e.pointerId);

    // Check if this pointer was already handled by drag/scroll
    if (handledPointers.has(e.pointerId)) {
      // Show toolbar after touch selection drag completes
      const wasSelectionDrag = isSelectionDrag;

      // Already committed - just cleanup
      activePointers.delete(e.pointerId);
      handledPointers.delete(e.pointerId);

      // Clear drag state if no pointers remain
      if (activePointers.size === 0) {
        isDragging = false;
        isSelectionDrag = false;
        dragStartCell = null;
      }

      // Show toolbar after drag-select completes (if multi-cell and not in formula mode)
      if (!isFormulaEditingMode()) {
        const sel = getSelection();
        if (wasSelectionDrag || sel.start !== sel.end) {
          showFloatingToolbar();
        }
      }

      return;
    }

    // Not handled - this was a simple tap, commit now
    if (pointer) {
      const cellKey = pointer.cellKey;
      const shiftKey = pointer.shiftKey;
      const tappedActiveCell = cellKey === activeCell;
      const inFormulaEditingMode = isFormulaEditingMode(); // Check fresh

      // Clear previews before committing
      clearPreviewHighlights();

      // Always ensure focus returns to grid when clicking a cell
      focusCell(cellKey);

      if (inFormulaEditingMode) {
        // Reject clicks outside effective bounds (e.g., below row 1 in loop sheets)
        if (!isCellWithinEffectiveBounds(cellKey)) return;
        // Formula editing mode - pick references
        if (shiftKey) {
          extendSelection(cellKey);
        } else {
          setSelection(cellKey, cellKey);
        }
      } else {
        // Normal mode
        if (shiftKey) {
          extendSelection(cellKey);
        } else {
          // Second click/tap on active cell shows toolbar
          if (tappedActiveCell) {
            showFloatingToolbar();
          } else {
            hideFloatingToolbar();
            setActiveCell(cellKey);  // Also focuses, but that's fine
          }
        }
      }
    }

    // Cleanup
    activePointers.delete(e.pointerId);
    handledPointers.delete(e.pointerId);

    // Clear drag state if no pointers remain
    if (activePointers.size === 0) {
      isDragging = false;
      isSelectionDrag = false;
      dragStartCell = null;
    }
  }

  /**
   * Handle pointer cancel - cleanup for interrupted pointers
   */
  function handlePointerCancel(e) {
    // Treat as handled - cleanup only, no commits
    activePointers.delete(e.pointerId);
    handledPointers.delete(e.pointerId);

    // If no pointers remain, clear all state
    if (activePointers.size === 0) {
      clearAllPointerState();
    }
  }

  /**
   * Handle pointer entering the grid - check if drag should still be active
   */
  function handlePointerEnter(e) {
    // If we think we're dragging but no buttons are pressed, end the drag
    // This handles the case where user released the button while outside the window
    if (isDragging && e.buttons === 0) {
      clearAllPointerState();
    }
  }

  // ============================================================================
  // FLOATING TOOLBAR (action bar for cell interactions)
  // ============================================================================

  function createFloatingToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'floating-toolbar';

    toolbar.addEventListener('pointerdown', (e) => {
      // Prevent this tap from propagating to the grid and dismissing the toolbar
      e.stopPropagation();
    });

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.floating-toolbar-btn');
      if (!btn || btn.disabled) return;

      e.stopPropagation();
      const action = btn.dataset.action;

      switch (action) {
        case 'drilldown':
          if (onDrilldown) onDrilldown(activeCell);
          break;
        case 'copy':
          onCopyOrCut(false);
          break;
        case 'cut':
          onCopyOrCut(true);
          break;
        case 'paste':
          // Read system clipboard and paste
          navigator.clipboard.readText()
            .then(text => onPaste(text))
            .catch((err) => {
              console.error('Clipboard read denied — falling back to internal clipboard:', err.message);
              onPaste(undefined);
            });
          break;
        case 'paste-values':
          onPasteValues();
          break;
        case 'clear':
          onClearCells();
          break;
        case 'insert-row':
          onInsertRow();
          break;
        case 'insert-col':
          onInsertCol();
          break;
        case 'delete-row':
          onDeleteRow();
          break;
        case 'delete-col':
          onDeleteCol();
          break;
      }

      hideFloatingToolbar();
    });

    return toolbar;
  }

  function populateToolbarButtons() {
    floatingToolbar.replaceChildren();

    const sel = getSelection();
    const isSingleCell = sel.start === sel.end;

    // Show drill-down first if available for this single cell
    if (isSingleCell && canDrilldown && canDrilldown(activeCell)) {
      addToolbarButton('Drill down', 'drilldown');
    }

    addToolbarButton('Cut', 'cut');
    addToolbarButton('Copy', 'copy');
    addToolbarButton('Paste', 'paste');

    const hasClipboard = hasInternalClipboard && hasInternalClipboard();
    addToolbarButton('Paste values', 'paste-values', !hasClipboard);

    addToolbarButton('Clear', 'clear');

    if (onInsertRow) addToolbarButton('Insert row', 'insert-row');
    if (onInsertCol) addToolbarButton('Insert col', 'insert-col');
    if (onDeleteRow) addToolbarButton('Delete row', 'delete-row');
    if (onDeleteCol) addToolbarButton('Delete col', 'delete-col');
  }

  function addToolbarButton(label, action, disabled = false) {
    const btn = document.createElement('button');
    btn.className = 'floating-toolbar-btn';
    btn.textContent = label;
    btn.dataset.action = action;
    if (disabled) btn.disabled = true;
    floatingToolbar.appendChild(btn);
  }

  function showFloatingToolbar() {
    if (!container) return;

    if (!floatingToolbar) {
      floatingToolbar = createFloatingToolbar();
      container.appendChild(floatingToolbar);
    }

    populateToolbarButtons();

    // Position at the top-left corner of the selection rectangle
    const sel = getSelection();
    const bounds = getRangeBounds(sel.start, sel.end);
    const topLeftKey = bounds ? `${numberToColumn(bounds.minCol)}${bounds.minRow}` : activeCell;
    const anchorEl = document.getElementById(topLeftKey) || gridContainer.querySelector('.active-cell');
    if (!anchorEl) {
      hideFloatingToolbar();
      return;
    }

    floatingToolbar.style.display = 'flex';

    const containerRect = container.getBoundingClientRect();
    const cellRect = anchorEl.getBoundingClientRect();

    // Position above the top-left cell by default
    const toolbarHeight = floatingToolbar.offsetHeight;
    const gap = 8;
    let top = cellRect.top - containerRect.top - toolbarHeight - gap;

    // If not enough room above, position below the cell
    if (top < 0) {
      top = cellRect.bottom - containerRect.top + gap;
    }

    // Align left edge with the cell, clamped to container bounds
    const toolbarWidth = floatingToolbar.offsetWidth;
    let left = cellRect.left - containerRect.left;
    left = Math.max(4, Math.min(left, containerRect.width - toolbarWidth - 4));

    floatingToolbar.style.top = `${top}px`;
    floatingToolbar.style.left = `${left}px`;
  }

  function hideFloatingToolbar() {
    if (floatingToolbar) {
      floatingToolbar.style.display = 'none';
    }
  }

  function handleDocumentPointerDown(e) {
    // Dismiss toolbar when tapping outside it
    if (floatingToolbar && floatingToolbar.style.display !== 'none' && !floatingToolbar.contains(e.target)) {
      hideFloatingToolbar();
    }
  }

  // ============================================================================

  /**
   * Commit any unhandled pointers (auto-promote preview to active)
   * Called when user types before pointerup - ensures input goes to the right cell
   * @returns {boolean} - True if any pointers were committed, false otherwise
   */
  function commitUnhandledPointers() {
    let didCommit = false;

    // Find any pointer that hasn't been handled yet (has preview but not committed)
    for (const [pointerId, pointer] of activePointers.entries()) {
      if (!handledPointers.has(pointerId)) {
        const cellKey = pointer.cellKey;
        const shiftKey = pointer.shiftKey;
        const inFormulaEditingMode = isFormulaEditingMode();

        // Clear previews before committing
        clearPreviewHighlights();

        if (inFormulaEditingMode) {
          // Reject clicks outside effective bounds (e.g., below row 1 in loop sheets)
          if (!isCellWithinEffectiveBounds(cellKey)) {
            handledPointers.add(pointerId);
            continue;
          }
          // Formula editing mode - pick references
          if (document.activeElement?.classList.contains('formula-input')) {
            focusCell(cellKey);
          }
          if (shiftKey) {
            extendSelection(cellKey);
          } else {
            setSelection(cellKey, cellKey);
          }
        } else {
          // Normal mode
          if (shiftKey) {
            extendSelection(cellKey);
          } else {
            setActiveCell(cellKey);
          }
        }

        // Mark as handled
        handledPointers.add(pointerId);
        didCommit = true;
      }
    }

    return didCommit;
  }


  // ============================================================================
  // KEYBOARD HANDLING
  // ============================================================================


  function handleKeyDown(e) {
    // Don't intercept keys when editing a column name
    if (e.target.classList.contains('column-name-input')) return;

    // Any keyboard interaction dismisses the floating toolbar
    hideFloatingToolbar();

    const inFormulaEditingMode = isFormulaEditingMode();

    // Handle formatting shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        applyBold();
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        applyItalic();
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        alignLeft();
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        alignCenter();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        alignRight();
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (onRedo) onRedo();
        } else {
          if (onUndo) onUndo();
        }
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        if (onRedo) onRedo();
        return;
      }
      // Ctrl+Shift+V: Paste values only (uses internal clipboard directly)
      if ((e.key === 'v' || e.key === 'V') && e.shiftKey) {
        e.preventDefault();
        if (onPasteValues) onPasteValues();
        return;
      }
      // Ctrl+D: Drill-down into custom function (Ctrl+Shift+D handled by breadcrumb nav)
      if ((e.key === 'd' || e.key === 'D') && !e.shiftKey) {
        e.preventDefault();
        if (onDrilldown) onDrilldown(activeCell);
        return;
      }
    }

    // Handle Delete/Backspace/Escape - revert reference picking, clear cells, or cancel cut
    if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Escape') {
      e.preventDefault();

      // Escape key: cancel all unhandled pointers (like pointercancel, but for all)
      if (e.key === 'Escape') {
        clearAllPointerState();
      }

      if (inFormulaEditingMode) {
        revertReferencePicking();
      } else if (e.key === 'Escape') {
        if (cancelCut) cancelCut();
      } else {
        onClearCells();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (inFormulaEditingMode) {
        focusFormulaBar();
      } else {
        // Normal mode - focus formula bar and select all text for easy replacement
        focusFormulaBar('select-all');
      }
      return;
    }

    // F2: Edit cell (focus formula bar, position cursor at end)
    if (e.key === 'F2') {
      e.preventDefault();
      focusFormulaBar();
      return;
    }

    // Home: Go to column A of current row (plain) or A1 (with Ctrl)
    // With Shift: extend selection instead of moving
    if (e.key === 'Home') {
      e.preventDefault();
      const currentRow = activeCell.match(/\d+$/)[0];
      const targetCell = (e.ctrlKey || e.metaKey) ? 'A1' : `A${currentRow}`;
      if (e.shiftKey) {
        extendSelection(targetCell);
      } else {
        setActiveCell(targetCell);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const direction = e.shiftKey ? 'left' : 'right';

      if (inFormulaEditingMode) {
        stepSelectionAnchor(direction);
      } else {
        moveActiveCell(direction);
      }
      return;
    }

    const arrowKeys = {
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right'
    };

    if (arrowKeys[e.key]) {
      e.preventDefault();
      const direction = arrowKeys[e.key];

      if (e.shiftKey) {
        extendSelectionInDirection(direction);
      } else if (inFormulaEditingMode) {
        stepSelectionAnchor(direction);
      } else {
        moveActiveCell(direction);
      }
    }
  }

  // ============================================================================
  // VISUAL UPDATES
  // ============================================================================

  
  //Change which cell is highlighted as the active cell
   
  function highlightActiveCell(cellKey) {
    const prevActive = gridContainer.querySelector('.active-cell');
    if (prevActive) {
      // Revert expanded multi-output display to short form
      const prevDisplay = getCellDisplay(prevActive.id);
      if (prevDisplay.expandedText) {
        prevActive.style.setProperty('--cell-value', `"${escapeCSSString(prevDisplay.text || '')}"`);
      }
      prevActive.classList.remove('active-cell');
    }

    const cellElement = document.getElementById(cellKey);
    if (cellElement) {
      cellElement.classList.add('active-cell');
      // Expand multi-output display to show full keys+values
      const display = getCellDisplay(cellKey);
      if (display.expandedText) {
        cellElement.style.setProperty('--cell-value', `"${escapeCSSString(display.expandedText)}"`);
      }
      // Snap active-cell extension to the next column boundary. Active cell
      // can extend over neighbors with content, so don't stop at content.
      const activeText = display.expandedText || display.text || '';
      const activeWidth = getSnappedExtensionWidth(cellKey, activeText, display.styles, false);
      cellElement.style.setProperty('--active-overflow-width', `${activeWidth}px`);
    }
  }

  /**
   * Change which cells are highlighted as the selection
   * @param {Object} range - { start: 'A1', end: 'C3' }
   */
  function highlightSelection(range) {
    currentlyHighlightedElements.forEach(element => {
      element.classList.remove('selected-cell');
    });

    if (!range || !range.start || !range.end) {
      currentlyHighlightedElements = [];
      return;
    }

    try {
      const { cells } = expandRange(range.start, range.end);

      if (cells.length > 0) {
        const selector = cells.map(key => `#${key}`).join(',');
        const elements = gridContainer.querySelectorAll(selector);
        elements.forEach(element => {
          element.classList.add('selected-cell');
        });
        currentlyHighlightedElements = Array.from(elements);
      } else {
        currentlyHighlightedElements = [];
      }
    } catch (error) {
      console.warn('[Grid] Invalid range for highlighting:', range, error);
      currentlyHighlightedElements = [];
    }
  }

  // Color palette for named range / formula ref overlays.
  // Read from CSS custom properties (--ref-color-N) so they stay in sync with
  // ::highlight(formula-ref-N) rules in index.css.
  let refColorsCache = null;
  function getRefColors() {
    if (refColorsCache) return refColorsCache;
    const style = getComputedStyle(document.documentElement);
    refColorsCache = Array.from({ length: REF_COLOR_COUNT }, (_, i) =>
      style.getPropertyValue(`--ref-color-${i}`).trim() || '#888'
    );
    return refColorsCache;
  }

  /**
   * Update named range overlay borders for ranges that overlap the current selection.
   * Called on selection change and after named range mutations.
   */
  function updateNamedRangeOverlays() {
    if (!namedRangeOverlayContainer || !getAllNamedRanges) return;

    // Clear existing overlays
    namedRangeOverlayContainer.innerHTML = '';

    const namedRanges = getAllNamedRanges();
    if (namedRanges.length === 0) return;

    // Get current selection bounds
    const selStart = selectionRange.start;
    const selEnd = selectionRange.end;

    let colorIndex = 0;

    for (const { name, notation } of namedRanges) {
      // Parse named range notation (could be "A1:C3" or just "A1")
      const parts = notation.split(':');
      const rangeStart = parts[0];
      const rangeEnd = parts[1] || parts[0];

      if (!rangesOverlap(selStart, selEnd, rangeStart, rangeEnd)) continue;

      // Get corner cell elements
      const bounds = getRangeBounds(rangeStart, rangeEnd);
      if (!bounds) continue;

      const topLeftKey = `${numberToColumn(bounds.minCol)}${bounds.minRow}`;
      const bottomRightKey = `${numberToColumn(bounds.maxCol)}${bounds.maxRow}`;
      const topLeftEl = document.getElementById(topLeftKey);
      const bottomRightEl = document.getElementById(bottomRightKey);
      if (!topLeftEl || !bottomRightEl) continue;

      // Calculate position relative to overlay container
      const containerRect = namedRangeOverlayContainer.getBoundingClientRect();
      const tlRect = topLeftEl.getBoundingClientRect();
      const brRect = bottomRightEl.getBoundingClientRect();

      const color = getRefColors()[colorIndex % getRefColors().length];
      colorIndex++;

      // Create overlay div
      const overlay = document.createElement('div');
      overlay.className = 'named-range-overlay';
      overlay.style.setProperty('--named-range-color', color);
      overlay.style.top = `${tlRect.top - containerRect.top}px`;
      overlay.style.left = `${tlRect.left - containerRect.left}px`;
      overlay.style.width = `${brRect.right - tlRect.left}px`;
      overlay.style.height = `${brRect.bottom - tlRect.top}px`;

      namedRangeOverlayContainer.appendChild(overlay);

      // Create name tag (appended to container, not overlay, so it renders above sibling borders)
      const tag = document.createElement('span');
      tag.className = 'named-range-tag';
      tag.textContent = name;
      tag.style.setProperty('--named-range-color', color);
      tag.style.top = `${brRect.bottom - containerRect.top}px`;
      tag.style.left = `${brRect.right - containerRect.left}px`;
      namedRangeOverlayContainer.appendChild(tag);
    }
  }

  /**
   * Update formula reference overlays on the grid.
   * Each entry in the map gets a colored border overlay matching its formula bar color.
   * @param {Map<string, number>|null} refColorMap - ref → colorIndex, or null to clear
   * @param {function} [resolveNamedRange] - optional resolver for named range → notation
   */
  function updateFormulaRefOverlays(refColorMap, resolveNamedRange) {
    lastRefColorMap = refColorMap;
    lastResolveNamedRange = resolveNamedRange || null;

    if (!formulaRefOverlayContainer) return;

    const signature = refColorMap
      ? Array.from(refColorMap).map(([r, c]) => `${r}:${c}`).sort().join('|')
      : '';
    if (signature === lastRefOverlaySignature) return;
    lastRefOverlaySignature = signature;

    formulaRefOverlayContainer.innerHTML = '';

    if (!refColorMap || refColorMap.size === 0) return;
    if (!showIndicator('precedent-boxes')) return;

    // Collect all geometry reads first, then build DOM in one batch
    // to avoid interleaving reads (getBoundingClientRect) with writes (appendChild).
    const containerRect = formulaRefOverlayContainer.getBoundingClientRect();
    const overlayData = [];

    for (const [ref, colorIndex] of refColorMap) {
      let rangeStart, rangeEnd;

      if (ref.includes(':')) {
        const parts = ref.split(':');
        rangeStart = parts[0];
        rangeEnd = parts[1];
      } else if (isCellReference(ref)) {
        rangeStart = ref;
        rangeEnd = ref;
      } else if (resolveNamedRange) {
        const notation = resolveNamedRange(ref);
        if (!notation) continue;
        const parts = notation.split(':');
        rangeStart = parts[0];
        rangeEnd = parts[1] || parts[0];
      } else {
        continue;
      }

      const bounds = getRangeBounds(rangeStart, rangeEnd);
      if (!bounds) continue;

      const topLeftKey = `${numberToColumn(bounds.minCol)}${bounds.minRow}`;
      const bottomRightKey = `${numberToColumn(bounds.maxCol)}${bounds.maxRow}`;
      const topLeftEl = document.getElementById(topLeftKey);
      const bottomRightEl = document.getElementById(bottomRightKey);
      if (!topLeftEl || !bottomRightEl) continue;

      const tlRect = topLeftEl.getBoundingClientRect();
      const brRect = bottomRightEl.getBoundingClientRect();
      overlayData.push({ tlRect, brRect, colorIndex });
    }

    // Single DOM write pass
    const fragment = document.createDocumentFragment();
    for (const { tlRect, brRect, colorIndex } of overlayData) {
      const color = getRefColors()[colorIndex % getRefColors().length];
      const overlay = document.createElement('div');
      overlay.className = 'formula-ref-overlay';
      overlay.style.setProperty('--formula-ref-color', color);
      overlay.style.top = `${tlRect.top - containerRect.top}px`;
      overlay.style.left = `${tlRect.left - containerRect.left}px`;
      overlay.style.width = `${brRect.right - tlRect.left}px`;
      overlay.style.height = `${brRect.bottom - tlRect.top}px`;
      fragment.appendChild(overlay);
    }
    formulaRefOverlayContainer.appendChild(fragment);
    updateOffscreenIndicators();
  }

  let overlayResizeRAF = null;
  function handleOverlayResize() {
    if (overlayResizeRAF !== null) return;
    overlayResizeRAF = requestAnimationFrame(() => {
      overlayResizeRAF = null;
      updateNamedRangeOverlays();
      if (lastRefColorMap) {
        lastRefOverlaySignature = null;
        updateFormulaRefOverlays(lastRefColorMap, lastResolveNamedRange);
      }
      if (lastDependentSet) {
        lastDependentSignature = null;
        updateDependentOverlays(lastDependentSet);
      }
      updateOffscreenIndicators();
    });
  }

  let offscreenScrollRAF = null;
  function handleScrollForIndicators() {
    if (offscreenScrollRAF !== null) return;
    offscreenScrollRAF = requestAnimationFrame(() => {
      offscreenScrollRAF = null;
      updateOffscreenIndicators();
    });
  }

  /**
   * Force a re-render of all reference indicators (boxes + arrows) using the
   * cached refColorMap and dependent set. Called when the visibility prefs
   * change in the Settings dialog so toggles take effect immediately.
   */
  function refreshOverlays() {
    // Invalidate signature caches so the early-return short-circuit in
    // updateFormulaRefOverlays / updateDependentOverlays doesn't skip work.
    lastRefOverlaySignature = null;
    lastDependentSignature = null;
    updateFormulaRefOverlays(lastRefColorMap, lastResolveNamedRange);
    updateDependentOverlays(lastDependentSet);
    updateOffscreenIndicators();
  }

  function clearFormulaRefOverlays() {
    lastRefColorMap = null;
    lastResolveNamedRange = null;
    lastRefOverlaySignature = null;
    if (formulaRefOverlayContainer) {
      formulaRefOverlayContainer.innerHTML = '';
    }
  }

  /**
   * Update dependent-cell overlays on the grid.
   * Renders a uniform dashed border around each cell that has a formula
   * referencing the active cell (reverse of formula-ref overlays).
   * @param {Set<string>|null} dependentSet - cellKeys depending on active cell, or null to clear
   */
  function updateDependentOverlays(dependentSet) {
    lastDependentSet = dependentSet;

    if (!formulaDependentOverlayContainer) return;

    const signature = dependentSet
      ? Array.from(dependentSet).sort().join('|')
      : '';
    if (signature === lastDependentSignature) return;
    lastDependentSignature = signature;

    formulaDependentOverlayContainer.innerHTML = '';

    if (!dependentSet || dependentSet.size === 0) return;
    if (!showIndicator('dependent-boxes')) return;

    const containerRect = formulaDependentOverlayContainer.getBoundingClientRect();
    const overlayData = [];

    for (const cellKey of dependentSet) {
      if (!isCellReference(cellKey)) continue;
      const cellEl = document.getElementById(cellKey);
      if (!cellEl) continue;
      const rect = cellEl.getBoundingClientRect();
      overlayData.push(rect);
    }

    const fragment = document.createDocumentFragment();
    for (const rect of overlayData) {
      const overlay = document.createElement('div');
      overlay.className = 'formula-dependent-overlay';
      overlay.style.top = `${rect.top - containerRect.top}px`;
      overlay.style.left = `${rect.left - containerRect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      fragment.appendChild(overlay);
    }
    formulaDependentOverlayContainer.appendChild(fragment);
    updateOffscreenIndicators();
  }

  /**
   * Resolve a ref string (cell key, range, or named range) to a viewport rect
   * spanning all of its cells. Returns null if it can't be resolved.
   */
  function resolveRefToRect(ref, resolveNamedRange) {
    let rangeStart, rangeEnd;
    if (ref.includes(':')) {
      const parts = ref.split(':');
      rangeStart = parts[0];
      rangeEnd = parts[1];
    } else if (isCellReference(ref)) {
      rangeStart = ref;
      rangeEnd = ref;
    } else if (resolveNamedRange) {
      const notation = resolveNamedRange(ref);
      if (!notation) return null;
      const parts = notation.split(':');
      rangeStart = parts[0];
      rangeEnd = parts[1] || parts[0];
    } else {
      return null;
    }
    const bounds = getRangeBounds(rangeStart, rangeEnd);
    if (!bounds) return null;
    const tl = document.getElementById(`${numberToColumn(bounds.minCol)}${bounds.minRow}`);
    const br = document.getElementById(`${numberToColumn(bounds.maxCol)}${bounds.maxRow}`);
    if (!tl || !br) return null;
    const tlRect = tl.getBoundingClientRect();
    const brRect = br.getBoundingClientRect();
    return {
      left: tlRect.left,
      top: tlRect.top,
      right: brRect.right,
      bottom: brRect.bottom,
    };
  }

  /**
   * Closest pair of points between segment P (p0→p1) and segment Q (q0→q1).
   * Returns the point on Q closest to P along with the squared distance.
   * Standard parametric form with end-clamping; continuous in all inputs.
   */
  function closestPointOnSegmentToSegment(p0x, p0y, p1x, p1y, q0x, q0y, q1x, q1y) {
    const dpx = p1x - p0x, dpy = p1y - p0y;
    const dqx = q1x - q0x, dqy = q1y - q0y;
    const rx = p0x - q0x, ry = p0y - q0y;
    const a = dpx * dpx + dpy * dpy;   // |P|²
    const e = dqx * dqx + dqy * dqy;   // |Q|²
    const f = dqx * rx + dqy * ry;
    const EPS = 1e-12;

    let s, t;
    if (a <= EPS && e <= EPS) {
      s = 0; t = 0;
    } else if (a <= EPS) {
      s = 0;
      t = clamp01(f / e);
    } else {
      const c = dpx * rx + dpy * ry;
      if (e <= EPS) {
        t = 0;
        s = clamp01(-c / a);
      } else {
        const b = dpx * dqx + dpy * dqy;
        const denom = a * e - b * b;
        s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = clamp01((b - c) / a);
        }
      }
    }

    const px = p0x + s * dpx, py = p0y + s * dpy;
    const qx = q0x + t * dqx, qy = q0y + t * dqy;
    const ddx = px - qx, ddy = py - qy;
    return { qx, qy, distSq: ddx * ddx + ddy * ddy };
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /**
   * Decide where to place an off-screen indicator triangle and what direction
   * to rotate it to.
   *
   * Two cases, picked so the result is continuous in A and R:
   *  1. The segment A→R crosses the viewport perimeter. We pick the crossing
   *     with the largest segment parameter s — i.e., the exit on the side
   *     toward R, not the entry near A. Linear in A/R, so smooth.
   *  2. The segment misses the perimeter. We use the closest point on the
   *     perimeter to the segment, which varies continuously with A and R.
   *
   * At the transition (segment tangent to a corner), both cases land on the
   * same corner, so there's no jump at the boundary either.
   */
  function placeIndicator(vp, ax, ay, tx, ty) {
    const dx = tx - ax;
    const dy = ty - ay;

    // Case 1: explicit segment/perimeter intersections, pick max s (exit).
    let px = vp.left, py = vp.top;
    let bestS = -Infinity;
    const consider = (s, x, y) => {
      if (s >= 0 && s <= 1 && s > bestS) { bestS = s; px = x; py = y; }
    };
    if (dy !== 0) {
      const sTop = (vp.top - ay) / dy;
      const xTop = ax + sTop * dx;
      if (xTop >= vp.left && xTop <= vp.right) consider(sTop, xTop, vp.top);
      const sBot = (vp.bottom - ay) / dy;
      const xBot = ax + sBot * dx;
      if (xBot >= vp.left && xBot <= vp.right) consider(sBot, xBot, vp.bottom);
    }
    if (dx !== 0) {
      const sLeft = (vp.left - ax) / dx;
      const yLeft = ay + sLeft * dy;
      if (yLeft >= vp.top && yLeft <= vp.bottom) consider(sLeft, vp.left, yLeft);
      const sRight = (vp.right - ax) / dx;
      const yRight = ay + sRight * dy;
      if (yRight >= vp.top && yRight <= vp.bottom) consider(sRight, vp.right, yRight);
    }

    // Case 2: no crossing. Closest point on perimeter to segment A→R.
    if (bestS === -Infinity) {
      const edges = [
        [vp.left,  vp.top,    vp.right, vp.top   ],
        [vp.right, vp.top,    vp.right, vp.bottom],
        [vp.right, vp.bottom, vp.left,  vp.bottom],
        [vp.left,  vp.bottom, vp.left,  vp.top   ],
      ];
      let bestDistSq = Infinity;
      for (const [ex0, ey0, ex1, ey1] of edges) {
        const { qx, qy, distSq } = closestPointOnSegmentToSegment(
          ax, ay, tx, ty, ex0, ey0, ex1, ey1
        );
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          px = qx; py = qy;
        }
      }
    }

    // Rotation: point from chosen perimeter position toward the ref. If the
    // chosen point coincides with the ref (e.g., ref on perimeter), fall back
    // to the active-cell direction so the triangle still has a sensible angle.
    let rdx = tx - px, rdy = ty - py;
    if (rdx === 0 && rdy === 0) { rdx = tx - ax; rdy = ty - ay; }
    return {
      x: px,
      y: py,
      rotation: Math.atan2(rdy, rdx) * 180 / Math.PI + 90,
    };
  }

  /**
   * Render edge-of-viewport triangles for any precedent or dependent that's
   * fully outside the visible grid. Each triangle sits on the edge that the
   * line from the active cell center to the off-screen ref center crosses,
   * and points outward toward the ref.
   */
  function updateOffscreenIndicators() {
    if (!offscreenIndicatorContainer || !container) return;

    const containerRect = container.getBoundingClientRect();
    const insets = getInsets() || { top: 0, left: 0, right: 0, bottom: 0 };

    // Restrict the indicator surface to the data area — exclude column header,
    // row-header column, sticky rows/cols, and scrollbar gutter — so triangles
    // never sit under headers where they'd be invisible.
    const vp = {
      left: containerRect.left + insets.left,
      top: containerRect.top + insets.top,
      right: containerRect.left + container.clientWidth - insets.right,
      bottom: containerRect.top + container.clientHeight - insets.bottom,
    };
    vp.width = vp.right - vp.left;
    vp.height = vp.bottom - vp.top;

    offscreenIndicatorContainer.style.top = `${vp.top}px`;
    offscreenIndicatorContainer.style.left = `${vp.left}px`;
    offscreenIndicatorContainer.style.width = `${vp.width}px`;
    offscreenIndicatorContainer.style.height = `${vp.height}px`;

    offscreenIndicatorContainer.innerHTML = '';

    const showPrecArrows = showIndicator('precedent-arrows');
    const showDepArrows = showIndicator('dependent-arrows');
    const hasPrecedents = showPrecArrows && lastRefColorMap && lastRefColorMap.size > 0;
    const hasDependents = showDepArrows && lastDependentSet && lastDependentSet.size > 0;
    if (!hasPrecedents && !hasDependents) return;

    // Active cell center is always the conceptual anchor — placeIndicator
    // handles the on-screen, between, and other-side cases internally.
    let ax = (vp.left + vp.right) / 2;
    let ay = (vp.top + vp.bottom) / 2;
    const activeEl = activeCell ? document.getElementById(activeCell) : null;
    if (activeEl) {
      const r = activeEl.getBoundingClientRect();
      ax = (r.left + r.right) / 2;
      ay = (r.top + r.bottom) / 2;
    }

    const items = [];
    if (hasPrecedents) {
      for (const [ref, colorIndex] of lastRefColorMap) {
        const rect = resolveRefToRect(ref, lastResolveNamedRange);
        if (!rect) continue;
        items.push({ rect, kind: 'precedent', colorIndex });
      }
    }
    if (hasDependents) {
      for (const cellKey of lastDependentSet) {
        if (!isCellReference(cellKey)) continue;
        const el = document.getElementById(cellKey);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        items.push({
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          kind: 'dependent',
        });
      }
    }

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      // Skip if any part of the ref is visible — overlay already shows it.
      const visible = item.rect.right > vp.left && item.rect.left < vp.right
                   && item.rect.bottom > vp.top && item.rect.top < vp.bottom;
      if (visible) continue;

      const tx = (item.rect.left + item.rect.right) / 2;
      const ty = (item.rect.top + item.rect.bottom) / 2;
      const hit = placeIndicator(vp, ax, ay, tx, ty);
      if (!hit) continue;

      const tri = document.createElement('div');
      tri.className = `offscreen-indicator offscreen-indicator-${item.kind}`;
      const color = item.kind === 'precedent'
        ? getRefColors()[item.colorIndex % getRefColors().length]
        : '#ea580c';
      tri.style.setProperty('--indicator-color', color);

      // SVG triangle. Precedent = filled (10×16); dependent = hollow stroked
      // (14×22) so it reads as distinct from precedents, mirroring the
      // dashed-vs-solid distinction used by the on-grid overlays.
      tri.innerHTML = item.kind === 'precedent'
        ? '<svg viewBox="0 0 10 16" width="10" height="16"><polygon points="5,0 10,16 0,16"/></svg>'
        : '<svg viewBox="0 0 14 22" width="14" height="22" overflow="visible"><polygon points="7,0 14,22 0,22"/></svg>';

      // Position relative to indicator container's top-left corner.
      const localX = hit.x - vp.left;
      const localY = hit.y - vp.top;
      // Clamp so the tip stays inside the container away from the corners.
      const margin = 14;
      const clampedX = Math.max(margin, Math.min(vp.width - margin, localX));
      const clampedY = Math.max(margin, Math.min(vp.height - margin, localY));

      // Position so the triangle's apex (top-center of element) lands on the
      // placement point. CSS uses translate(-50%,0) + transform-origin top-center.
      tri.style.left = `${clampedX}px`;
      tri.style.top = `${clampedY}px`;
      tri.style.transform = `translate(-50%, 0) rotate(${hit.rotation}deg)`;

      fragment.appendChild(tri);
    }
    offscreenIndicatorContainer.appendChild(fragment);
  }

  function refreshCell(cellKey) {
    const cellElement = document.getElementById(cellKey);
    if (!cellElement) {
      console.warn(`[Grid] Cell ${cellKey} not found for refresh`);
      return;
    }

    const displayData = getCellDisplay(cellKey);

    // Use expanded text if this is the active cell with a multi-output result
    const isActive = cellElement.classList.contains('active-cell');
    const displayText = (isActive && displayData.expandedText) ? displayData.expandedText : (displayData.text || '');
    const escapedText = escapeCSSString(displayText);
    cellElement.style.setProperty('--cell-value', `"${escapedText}"`);
    Object.assign(cellElement.style, displayData.styles);

    // Update data-has-content attribute (for z-index layering - covers overflow from left)
    if (displayData.text?.trim()) {
      cellElement.setAttribute('data-has-content', '');
    } else {
      cellElement.removeAttribute('data-has-content');
    }

    // Update overflow snap (snaps background extension to next column boundary).
    updateCellOverflowSnap(cellKey);

    // This cell becoming empty or non-empty can shift the snap boundary of the
    // nearest leftward cell with content (its overflow may have extended into
    // or stopped at this one). Re-snap that cell so its hover area stays accurate.
    const leftSource = findOverflowSourceLeftOf(cellKey);
    if (leftSource) updateCellOverflowSnap(leftSource);

    scheduleFitColumnWidths();
  }


  /**
   * Change which cells are visually marked as cut
   * @param {Object|null} range - Range object { start, end }, or null to just clear marks
   */
  function markCellsAsCut(range) {
    clearCutMarks();

    // If no range provided, just clear and return
    if (!range) {
      return;
    }

    const { cells } = expandRange(range.start, range.end);

    if (cells.length > 0) {
      const selector = cells.map(key => `#${key}`).join(',');
      const elements = gridContainer.querySelectorAll(selector);
      elements.forEach(element => {
        element.classList.add('cell-marked-for-cut');
      });
    }

  }
  function clearCutMarks() {
    const cutCells = gridContainer.querySelectorAll('.cell-marked-for-cut');
    cutCells.forEach(cell => cell.classList.remove('cell-marked-for-cut'));
  }

  /**
   * Add preview highlight to a cell (lighter styling than committed selection)
   */
  function addPreviewHighlight(cellKey) {
    const cellElement = document.getElementById(cellKey);
    if (cellElement) {
      cellElement.classList.add('preview-cell');
      previewedCells.add(cellKey);
    }
  }

  /**
   * Clear all preview highlights
   */
  function clearPreviewHighlights() {
    previewedCells.forEach(cellKey => {
      const cellElement = document.getElementById(cellKey);
      if (cellElement) {
        cellElement.classList.remove('preview-cell');
      }
    });
    previewedCells.clear();
  }

  /**
   * Clear all pointer tracking state (previews, drag, scroll, etc.)
   * Use this when canceling or resetting all pointer interactions
   */
  function clearAllPointerState() {
    clearPreviewHighlights();
    activePointers.clear();
    handledPointers.clear();
    isDragging = false;
    isSelectionDrag = false;
    dragStartCell = null;
  }

  // ============================================================================
  // INPUT ROUTING (three-layer detection)
  // ============================================================================


  function handleBeforeInput(e) {
    const cellElement = e.target.closest('[role="gridcell"]');
    if (!cellElement) return;

    if (e.cancelable) {
      e.preventDefault();
      const inputText = e.data || '';
      onInputDetected(inputText); // Route to formula bar (formula bar commits preview and processes input)
    }
    // Non-cancelable inputs will be handled by handleInput
  }

  /**
   * Layer 2: Handle input events (non-cancelable inputs)
   */
  function handleInput(e) {
    const cellElement = e.target.closest('[role="gridcell"]');
    if (!cellElement) return;

    // Skip composition events - handled in compositionend
    if (e.isComposing) return;

    // Cell should started empty, so textContent equals the new input
    const inputText = cellElement.textContent;
    if (inputText) {
      onInputDetected(inputText); // Route to formula bar (formula bar commits preview and processes input)
      // Clear cell immediately after routing to keep it empty
      cellElement.textContent = '';
    }
  }

  /**
   * Layer 3: Handle compositionend events (IME input)
   */
  function handleCompositionEnd(e) {
    const cellElement = e.target.closest('[role="gridcell"]');
    if (!cellElement) return;

    // Get the final composed text
    const composedText = cellElement.textContent;
    if (composedText) {
      onInputDetected(composedText); // Route to formula bar (formula bar commits preview and processes input)
      // Clear cell immediately after routing to keep it empty
      cellElement.textContent = '';
    }
  }

  // ============================================================================
  // GRID EXPANSION
  // ============================================================================

  /**
   * Add rows to the bottom of the grid
   * @param {number} count - Number of rows to add
   * @param {Object} [options] - Optional settings
   * @param {string} [options.rowClass] - CSS class to add to each new row
   * @returns {boolean} - True if successful
   */
  function addRows(count, options = {}) {
    if (!gridContainer) {
      console.warn('[Grid] Cannot add rows - not mounted');
      return false;
    }

    const tbody = gridContainer.querySelector('tbody');
    const numCols = columnToNumber(gridBounds.maxCol);
    const startRow = gridBounds.maxRow + 1;
    const { rowClass } = options;


    // Use DocumentFragment for batch DOM operations (single reflow)
    const fragment = document.createDocumentFragment();

    // Create new rows
    for (let i = 0; i < count; i++) {
      const row = startRow + i;
      const tr = document.createElement('tr');
      if (rowClass) {
        tr.className = rowClass;
      }

      // Row header
      const rowHeader = document.createElement('th');
      rowHeader.className = 'grid-row-header';
      rowHeader.setAttribute('scope', 'row');
      rowHeader.textContent = row;
      tr.appendChild(rowHeader);

      // Cells
      for (let col = 0; col < numCols; col++) {
        const colLetter = numberToColumn(col + 1);
        const cellKey = `${colLetter}${row}`;
        tr.appendChild(createCellElement(cellKey));
      }

      // Add sticky right column cells (e.g., _STOP)
      for (const stickyCol of stickyRightColumns) {
        const cellKey = `${stickyCol}${row}`;
        tr.appendChild(createCellElement(cellKey));
      }

      fragment.appendChild(tr);
    }

    // Append all rows at once
    tbody.appendChild(fragment);

    // Update bounds after DOM is created
    gridBounds.maxRow += count;

    // Redundant in practice: handleAddRow repositions via its scrollTop adjust,
    // and the orchestrator's loop-sheet path doesn't need it (add-columns button
    // sits in <thead>, unaffected by tbody growth). Left in as a defensive hook
    // for any future external caller; can be removed in a later cleanup.
    updateFloatingExpansionButtons();

    return true;
  }

  /**
   * Remove all generated rows (rows with .generated-row class)
   * Used by loop sheets to efficiently clear generated content
   * @param {Object} [options] - Options
   * @param {number} [options.minRows=0] - Minimum total rows to maintain (adds empty placeholder rows)
   * @returns {number} - Number of rows removed
   */
  function removeGeneratedRows(options = {}) {
    const { minRows = 0 } = options;

    if (!gridContainer) {
      console.warn('[Grid] Cannot remove rows - not mounted');
      return 0;
    }

    const tbody = gridContainer.querySelector('tbody');
    const generatedRows = tbody.querySelectorAll('.generated-row');
    const count = generatedRows.length;

    // Remove all generated rows from DOM
    for (const row of generatedRows) {
      row.remove();
    }

    // Update bounds (generated rows start at row 2, so reset to row 1)
    if (count > 0) {
      gridBounds.maxRow = 1;
    }

    // Add placeholder rows if needed to maintain minimum
    if (minRows > gridBounds.maxRow + 1) {
      const placeholderCount = minRows - gridBounds.maxRow - 1;
      addRows(placeholderCount, { rowClass: 'generated-row' });
    }

    return count;
  }

  /**
   * Add columns to the right of the grid
   * @param {number} count - Number of columns to add
   * @returns {boolean} - True if successful, false if would exceed limit
   */
  function addColumns(count) {
    if (!gridContainer) {
      console.warn('[Grid] Cannot add columns - not mounted');
      return false;
    }

    const currentColNum = columnToNumber(gridBounds.maxCol);
    const newColNum = currentColNum + count;

    // Check limit (ZZ = 702 columns)
    const MAX_COL_NUM = 26 * 26 + 26; // ZZ
    if (newColNum > MAX_COL_NUM) {
      console.warn(`[Grid] Cannot add ${count} columns - would exceed ZZ limit`);
      return false;
    }

    const newMaxCol = numberToColumn(newColNum);

    // Add column headers (insert before add-col pseudo-column, separator, or
    // sticky-right columns if any — in that priority order, since on loop sheets
    // the add-col header sits to the left of the separator and _STOP).
    const headerRow = gridContainer.querySelector('thead tr');
    const addColHeader = headerRow.querySelector('.grid-add-col-header');
    const separatorHeader = headerRow.querySelector('.grid-separator-col-header');
    const stickyHeader = headerRow.querySelector('.grid-sticky-right-header');
    const insertBefore = addColHeader || separatorHeader || stickyHeader;
    for (let i = 0; i < count; i++) {
      const colLetter = numberToColumn(currentColNum + i + 1);
      const th = document.createElement('th');
      th.className = 'grid-column-header';
      th.setAttribute('scope', 'col');
      th.setAttribute('data-col', colLetter);
      updateHeaderDisplay(th, colLetter);
      if (insertBefore) {
        headerRow.insertBefore(th, insertBefore);
      } else {
        headerRow.appendChild(th);
      }
    }

    // Add cells to each existing row (insert before sticky-right cells if any)
    const rows = gridContainer.querySelectorAll('tbody tr');
    rows.forEach((tr, idx) => {
      // Skip separator row (uses large colspan that doesn't need updating)
      if (tr.classList.contains('grid-separator-row')) {
        return;
      }

      // Get row number from the row header (handles both 0-indexed and 1-indexed grids)
      const rowHeader = tr.querySelector('.grid-row-header');
      const rowNum = rowHeader ? parseInt(rowHeader.textContent, 10) : idx + 1;

      // Find the leftmost trailing pseudo-column cell in this row to insert before.
      // Only the first row of a loop sheet has the rowspan'd add-col and separator
      // cells; other rows skip to the sticky _STOP cell directly.
      const addColCell = tr.querySelector('.grid-add-col-cell');
      const separatorCell = tr.querySelector('.grid-separator-col');
      const stickyCell = tr.querySelector('.grid-sticky-right-cell');
      const insertBeforeCell = addColCell || separatorCell || stickyCell;

      for (let i = 0; i < count; i++) {
        const colLetter = numberToColumn(currentColNum + i + 1);
        const cellKey = `${colLetter}${rowNum}`;
        const cellElement = createCellElement(cellKey);
        if (insertBeforeCell) {
          tr.insertBefore(cellElement, insertBeforeCell);
        } else {
          tr.appendChild(cellElement);
        }
      }
    });

    // Update bounds after DOM is created
    gridBounds.maxCol = newMaxCol;
    return true;
  }

  // ============================================================================
  // STICKY COLUMN FUNCTIONS
  // ============================================================================

  /**
   * Set which columns should stick to the right edge of the grid
   * @param {string[]} columns - Array of column names (e.g., ['_STOP'])
   */
  function setStickyRightColumns(columns) {
    stickyRightColumns = columns;
    cachedInsets = null;
    if (gridContainer) {
      applyStickyRightColumnStyles();
    }
  }

  /**
   * Apply sticky-right CSS classes to headers and cells in sticky columns.
   * Called after mount (for pre-existing HTML cells) or when sticky columns change.
   * New cells created via createCellElement get the class at creation time.
   */
  function applyStickyRightColumnStyles() {
    if (!gridContainer || stickyRightColumns.length === 0) return;

    // Apply to column headers (only add, don't remove - HTML may have classes pre-set)
    const headers = gridContainer.querySelectorAll('thead th[data-col]');
    headers.forEach(th => {
      const colName = th.getAttribute('data-col');
      if (colName && stickyRightColumns.includes(colName)) {
        th.classList.add('grid-sticky-right-header');
      }
    });

    // Apply to all existing cells in sticky columns (only add, don't remove)
    const cells = gridContainer.querySelectorAll('tbody td[role="gridcell"]');
    cells.forEach(cell => {
      const colName = getColumnFromCellKey(cell.id);
      if (colName && stickyRightColumns.includes(colName)) {
        cell.classList.add('grid-sticky-right-cell');
      }
    });
  }

  // ============================================================================
  // STICKY ROW FUNCTIONS
  // ============================================================================

  /**
   * Set which rows should stick to the top of the grid (below header)
   * @param {number[]} rows - Array of row numbers (e.g., [0, 1])
   */
  function setStickyTopRows(rows) {
    stickyTopRows = rows;
    cachedInsets = null;
    if (gridContainer) {
      applyStickyTopRowStyles();
    }
  }

  /**
   * Apply sticky positioning to rows using data attributes.
   * CSS handles the actual positioning based on data-sticky-row value.
   */
  function applyStickyTopRowStyles() {
    if (!gridContainer || stickyTopRows.length === 0) return;

    const rows = gridContainer.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      const rowHeader = tr.querySelector('.grid-row-header');
      if (!rowHeader) return;

      const rowNum = parseInt(rowHeader.textContent, 10);
      if (stickyTopRows.includes(rowNum)) {
        tr.dataset.stickyRow = rowNum;
      }
    });
  }

  // ============================================================================
  // COLUMN NAME FUNCTIONS
  // ============================================================================

  /**
   * Update a column header's display text based on its name.
   * Shows "Name:COL" if named, or just "COL" if unnamed.
   * @param {HTMLElement} th - The <th> element
   * @param {string} colLetter - Column letter (e.g., "A", "_STOP")
   */
  function updateHeaderDisplay(th, colLetter) {
    const name = columnNames[colLetter];
    th.textContent = name ? `${colLetter}: ${name}` : colLetter;
  }

  /**
   * Bulk set column names (from loaded data).
   * @param {Object} namesObj - Map of column letter → name string
   */
  function setColumnNames(namesObj) {
    columnNames = { ...namesObj };
    if (!gridContainer) return;

    const headers = gridContainer.querySelectorAll('thead th[data-col]');
    for (const th of headers) {
      const col = th.getAttribute('data-col');
      if (col) {
        updateHeaderDisplay(th, col);
      }
    }
  }

  /**
   * Set a single column name and update its header.
   * @param {string} col - Column letter
   * @param {string} name - Display name (empty string to clear)
   */
  function setColumnName(col, name) {
    if (name) {
      columnNames[col] = name;
    } else {
      delete columnNames[col];
    }

    if (!gridContainer) return;
    const th = gridContainer.querySelector(`thead th[data-col="${col}"]`);
    if (th) {
      updateHeaderDisplay(th, col);
    }
  }

  /**
   * Get current column names object.
   * @returns {Object} Map of column letter → name string
   */
  function getColumnNames() {
    return { ...columnNames };
  }

  /**
   * Open inline edit on a column header.
   * Replaces header text with an input field.
   * @param {HTMLElement} th - The <th> element to edit
   */
  function openColumnNameEditor(th) {
    const col = th.getAttribute('data-col');
    if (!col) return;

    // Don't allow editing sticky/virtual columns like _STOP
    if (col.startsWith('_')) return;

    // Only allow editing if the sheet type supports column names (e.g., loop sheets)
    if (!onColumnNameChange) return;

    const currentName = columnNames[col] || '';

    // Lock the th width so the input doesn't resize it
    const currentWidth = th.offsetWidth;
    th.style.width = currentWidth + 'px';
    th.style.minWidth = currentWidth + 'px';
    th.style.maxWidth = currentWidth + 'px';

    // Create input
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'column-name-input';

    // Replace header content
    th.textContent = '';
    th.appendChild(input);
    input.focus();
    input.select();

    let cancelled = false;

    function unlockWidth() {
      th.style.width = '';
      th.style.minWidth = '';
      th.style.maxWidth = '';
    }

    function handleBlur() {
      if (cancelled) return;
      const newName = input.value.trim();
      setColumnName(col, newName);
      unlockWidth();
      if (onColumnNameChange) {
        onColumnNameChange(col, newName);
      }
    }

    input.addEventListener('blur', handleBlur);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur(); // triggers commit via blur handler
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        updateHeaderDisplay(th, col);
        unlockWidth();
      }
    });
  }

  // Column header double-click handler (stored for removal on unmount)
  function handleColumnHeaderDblClick(e) {
    const th = e.target.closest('.grid-column-header');
    if (th) {
      e.preventDefault();
      openColumnNameEditor(th);
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    /**
     * Initialize with injected dependencies
     */
    init(deps) {
      ({
        getCellDisplay,
        onInputDetected,
        onClearCells,
        isFormulaEditingMode,
        revertReferencePicking,
        insertReference,
        focusFormulaBar,
        loadCellInFormulaBar,
        getDependentsOf,
        updateCellNameDisplay,
        commitFormulaBarCell,
        applyBold,
        applyItalic,
        alignLeft,
        alignCenter,
        alignRight,
        onCopyOrCut,
        onPaste,
        onPasteValues,
        hasInternalClipboard,
        cancelCut,
        onUndo,
        onRedo,
        onDrilldown,
        canDrilldown,
      } = deps);
      // Optional row/col structure ops
      if (deps.onInsertRow) onInsertRow = deps.onInsertRow;
      if (deps.onInsertCol) onInsertCol = deps.onInsertCol;
      if (deps.onDeleteRow) onDeleteRow = deps.onDeleteRow;
      if (deps.onDeleteCol) onDeleteCol = deps.onDeleteCol;
      // Optional dependencies
      if (deps.onColumnNameChange) {
        onColumnNameChange = deps.onColumnNameChange;
      }
      if (deps.onSelectionChange) {
        onSelectionChange = deps.onSelectionChange;
      }
      if (deps.getAllNamedRanges) {
        getAllNamedRanges = deps.getAllNamedRanges;
      }
    },

    mount,
    unmount,
    refreshCell,
    getGridBounds: () => gridBounds,
    setGridBounds: (bounds) => {
      // Clamp to at least the initial HTML grid size
      const clampedMaxRow = Math.max(bounds.maxRow, minGridBounds.maxRow);
      const clampedMaxCol = columnToNumber(bounds.maxCol) >= columnToNumber(minGridBounds.maxCol)
        ? bounds.maxCol : minGridBounds.maxCol;

      const oldMaxRow = gridBounds.maxRow;
      const oldMaxColNum = columnToNumber(gridBounds.maxCol);
      const newMaxColNum = columnToNumber(clampedMaxCol);

      // Ensure enough columns exist to match the new bounds
      // Must add columns BEFORE updating gridBounds (addColumns uses gridBounds.maxCol for start)
      if (newMaxColNum > oldMaxColNum) {
        addColumns(newMaxColNum - oldMaxColNum);
      }

      // Ensure enough rows exist to match the new bounds
      // Must add rows BEFORE updating gridBounds (addRows uses gridBounds.maxRow for start)
      if (clampedMaxRow > oldMaxRow) {
        const rowsToAdd = clampedMaxRow - oldMaxRow;
        // In loop sheets (formulaEditingMaxRow is set), rows beyond the editable
        // range are generated content and need the generated-row class for proper
        // cleanup by removeGeneratedRows.
        const options = {};
        if (gridBounds.formulaEditingMaxRow !== undefined &&
            oldMaxRow >= gridBounds.formulaEditingMaxRow) {
          options.rowClass = 'generated-row';
        }
        addRows(rowsToAdd, options);
      }

      // Update all gridBounds properties
      gridBounds.maxCol = clampedMaxCol;
      gridBounds.maxRow = clampedMaxRow;
      if (bounds.minRow !== undefined) {
        gridBounds.minRow = bounds.minRow;
      }
      if (bounds.virtualRightColumn !== undefined) {
        gridBounds.virtualRightColumn = bounds.virtualRightColumn;
      }
      if (bounds.formulaEditingMaxRow !== undefined) {
        gridBounds.formulaEditingMaxRow = bounds.formulaEditingMaxRow;
      }
    },

    // Selection queries (for orchestrator to read state)
    getActiveCell,
    getSelection,
    getSelectionNotation,

    // Selection mutations (for FormulaBar to call when it has focus)
    setActiveCell,
    moveActiveCell,
    stepSelectionAnchor,
    collapseToActiveCell,
    focusActiveCell: () => focusCell(activeCell),

    // Preview commit (for FormulaBar to call before processing input)
    commitUnhandledPointers,

    // Cut cell visualization
    markCellsAsCut,

    // Grid Expansion
    addRows,
    addColumns,
    removeGeneratedRows,

    // Sticky columns (for loop sheets - _STOP column)
    setStickyRightColumns,

    // Sticky rows (for loop sheets - rows 0 and 1)
    setStickyTopRows,

    // Column names (for loop sheets - human-readable column headers)
    setColumnNames,
    getColumnNames,

    // Named range overlays
    refreshNamedRangeOverlays: updateNamedRangeOverlays,

    // Formula reference overlays
    updateFormulaRefOverlays,
    clearFormulaRefOverlays,
    refreshOverlays,

    // Find-bar preview: highlight + scroll without taking focus or
    // mutating selection state.
    revealCell,
    clearFindMatch,
  };
}
