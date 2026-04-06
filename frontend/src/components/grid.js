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

import { expandRange, getAdjacentCell, normalizeRangeNotation, numberToColumn, columnToNumber, parseCellKey, getRangeBounds, rangesOverlap } from '../utils/cellUtils.js';
import { escapeCSSString } from '../utils/cssUtils.js';

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

  // Helper function to get derived values from bounds
  function getNumRows() {
    return gridBounds.maxRow;
  }

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

    // Skip cells in sticky-right columns — they're always visible
    const colName = getColumnFromCellKey(cellKey);
    if (colName && stickyRightColumns.includes(colName)) return;

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
    if (cellRect.left < safeLeft) {
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
   * Sum actual column widths for N columns to the right of cellKey.
   * Used for overflow width calculations instead of fixed 120px per column.
   */
  function getOverflowWidth(cellKey, emptyCount) {
    if (emptyCount === 0) return 0;
    const parsed = parseCellKey(cellKey);
    if (!parsed) return 0;

    let total = 0;
    for (let i = 1; i <= emptyCount; i++) {
      const col = numberToColumn(parsed.colNum + i);
      total += columnWidths[col] || COL_MIN_WIDTH;
    }
    return total;
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

        // Account for per-cell style overrides that affect text width
        const styles = display.styles;
        const hasOverride = styles && (styles.fontSize || styles.fontWeight || styles.fontStyle);
        if (hasOverride) {
          let font = cellFont;
          if (styles.fontSize) font = font.replace(/^\S+/, styles.fontSize);
          if (styles.fontWeight) font = `${styles.fontWeight} ${font}`;
          if (styles.fontStyle) font = `${styles.fontStyle} ${font}`;
          measureCanvas.font = font;
        }

        const w = measureCanvas.measureText(text).width + CELL_PADDING;
        if (w > widest) widest = w;

        if (hasOverride) {
          measureCanvas.font = cellFont;
        }
      }

      // Also measure header text
      const headerText = columnNames[col] ? `${col}: ${columnNames[col]}` : col;
      const headerWidth = measureCanvas.measureText(headerText).width + CELL_PADDING;
      if (headerWidth > widest) widest = headerWidth;

      const clamped = Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.ceil(widest)));

      if (columnWidths[col] !== clamped) {
        columnWidths[col] = clamped;
        applyColumnWidth(col, clamped);
      }
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

    // Set overflow width for clip-path (how far text can extend before hitting content)
    const emptyToRight = countEmptyCellsToRight(cellKey);
    const overflowWidth = getOverflowWidth(cellKey, emptyToRight);
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

  // Named range overlay
  let getAllNamedRanges = null;

  // ============================================================================
  // DOM STATE
  // ============================================================================

  // DOM elements
  let container = null;
  let gridContainer = null;
  let namedRangeOverlayContainer = null;
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
    const success = addColumns(count);
    if (!success) {
      alert('Cannot add more columns - maximum is ZZ');
    }
  }

  function handleAddRow(e) {
    const count = e.shiftKey ? 5 : 1;
    addRows(count);
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
    console.log('[Grid] Mounting...');

    container = elements.container;
    addColBtn = elements.addColBtn;
    addRowBtn = elements.addRowBtn;

    // Find existing table (defined in index.html)
    gridContainer = container.querySelector('.spreadsheet-grid');
    if (!gridContainer) {
      console.error('[Grid] Table .spreadsheet-grid not found in container');
      return;
    }

    // Create named range overlay container (sits before the table in the scroll flow)
    namedRangeOverlayContainer = document.createElement('div');
    namedRangeOverlayContainer.className = 'named-range-overlays';
    container.insertBefore(namedRangeOverlayContainer, gridContainer);

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

    const numCols = columnToNumber(gridBounds.maxCol);
    const numRows = getNumRows();
    console.log(`[Grid] Mounted with ${numCols}x${numRows} cells and headers`);
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

    // Remove document-level listeners
    document.removeEventListener('pointerdown', handleDocumentPointerDown);

    // Remove named range overlay container
    if (namedRangeOverlayContainer) {
      namedRangeOverlayContainer.remove();
      namedRangeOverlayContainer = null;
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

    console.log('[Grid] Unmounted');
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

  // Color palette for named range overlays (cycled when multiple ranges overlap)
  const NAMED_RANGE_COLORS = [
    '#2196F3', // blue
    '#4CAF50', // green
    '#FF9800', // orange
    '#00BCD4', // cyan
    '#9C27B0', // purple
    '#F44336', // red
  ];

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

      const color = NAMED_RANGE_COLORS[colorIndex % NAMED_RANGE_COLORS.length];
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

    // Update overflow width for clip-path (how far text can extend before hitting content)
    const emptyToRight = countEmptyCellsToRight(cellKey);
    const overflowWidth = getOverflowWidth(cellKey, emptyToRight);
    cellElement.style.setProperty('--overflow-width', `${overflowWidth}px`);
    if (overflowWidth > 0) cellElement.setAttribute('data-has-overflow', '');
    else cellElement.removeAttribute('data-has-overflow');

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

    // Add column headers (insert before separator or sticky-right columns if any)
    const headerRow = gridContainer.querySelector('thead tr');
    const separatorHeader = headerRow.querySelector('.grid-separator-col-header');
    const stickyHeader = headerRow.querySelector('.grid-sticky-right-header');
    const insertBefore = separatorHeader || stickyHeader;
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

      // Find separator or sticky cell in this row to insert before
      const separatorCell = tr.querySelector('.grid-separator-col');
      const stickyCell = tr.querySelector('.grid-sticky-right-cell');
      const insertBeforeCell = separatorCell || stickyCell;

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

    console.log(`[Grid] Added ${count} columns successfully. New bounds:`, gridBounds);
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
      console.log('[Grid] Initialized');
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
        console.log(`[Grid] Added ${rowsToAdd} rows to match new bounds`);
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
      console.log('[Grid] Grid bounds set to:', gridBounds);
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
  };
}
