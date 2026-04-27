/*
 * FORMATTING ENGINE
 * =================
 *
 * Handles all presentation concerns - formatting rules, visual styles, display computation.
 *
 * SOLE MANAGER of formatting domain - owns formatRules, cellStyles, and spreadsheetDefaults storage.
 * All operations that modify these Maps must go through this engine.
 */

import { expandRange, parseCellKey, numberToColumn } from '../utils/cellUtils.js';
import { TYPE_HIERARCHY, TypeService, isArrayType, isObjectType } from '../utils/typeService.js';
import {
  formatDate,
  formatDateTime,
  formatTime,
  DATE_FORMATS,
  DATETIME_FORMATS,
  TIME_FORMATS,
  validateDateFormat,
  validateDateTimeFormat,
  getDateFormatDefaults,
  getDateTimeFormatDefaults
} from '../utils/dateFormatter.js';
import { formatNumber, validateNumberFormat, getNumberFormatDefaults } from '../utils/numberFormatter.js';

export function createFormattingEngine() {
  // Storage (injected via init)
  let formatRules = null;
  let cellStyles = null;
  let spreadsheetDefaults = null;

  // Callbacks (injected via init)
  let refreshCell = null;
  let getSelection = null;
  let getNode = null;
  let recordChanges = null;
  let onRegisterHistoryMap = null;
  let onFormattingChange = null;  // Called when formatting state changes (for persistence)
  let getInheritedFormatting = null; // Optional: returns { styles, formatRules } for cells (e.g., loop sheet row 1 → generated rows)

  // Internal derived state
  const displayCache = new Map(); // cellKey → { text, styles }
  const cellsByType = new Map(); // type → Set<cellKey> (index for efficient type-based queries)

  // Batching state — defers refreshCell calls until endBatch()
  let batchDepth = 0;
  const pendingRefreshCells = new Set();

  // Font size constants
  const DEFAULT_FONT_SIZE = 18; // Default font size in px (matches CSS [role="gridcell"])
  const FONT_SIZE_STEP = 2;     // Increment/decrement step
  const MIN_FONT_SIZE = 8;      // Minimum allowed font size

  // Highlight color names (semantic, resolved to CSS variables)
  const HIGHLIGHT_NAMES = ['yellow', 'blue', 'green', 'pink', 'orange', 'gray'];

  /**
   * Convert semantic style properties to CSS-ready properties.
   * This is the single source of truth for style → CSS mapping.
   * Grid applies these directly without needing to know the vocabulary.
   *
   * Note: Color always has a value (default #d1d5db) because the cell element
   * has `color: transparent` to hide contenteditable text, and ::before uses
   * `color: inherit` to pick up the inline color.
   *
   * @param {Object} styles - Semantic styles (e.g., { bold: true, fontSize: 18 })
   * @returns {Object} - CSS-ready styles (e.g., { fontWeight: 'bold', fontSize: '18px' })
   */
  function semanticToCSS(styles) {
    const resolvedBg = styles.highlight
      ? `var(--highlight-${styles.highlight})`
      : (styles.backgroundColor || '');
    return {
      fontWeight: styles.bold ? 'bold' : '',
      fontStyle: styles.italic ? 'italic' : '',
      fontSize: styles.fontSize ? `${styles.fontSize}px` : '',
      textAlign: styles.alignment || '',
      color: styles.color || 'var(--cell-text-default)',  // Always set - ::before inherits this
      backgroundColor: resolvedBg,
    };
  }

  /**
   * Get default text alignment based on value type
   */
  function getDefaultAlignment(node) {
    // Object-typed cells render as '{...}' — right-align like numbers
    if (isObjectType(node?.type)) {
      return 'right';
    }
    switch (node?.type) {
      case TYPE_HIERARCHY.NUMBER:
        return 'right';
      case TYPE_HIERARCHY.DATE:
      case TYPE_HIERARCHY.DATETIME:
      case TYPE_HIERARCHY.BOOLEAN:
        return 'center';
      case TYPE_HIERARCHY.TEXT:
      default:
        return 'left';
    }
  }

  /**
   * Update display cache with current styles and refresh cell
   * Merges user styles with type-based defaults
   */
  function refreshCellWithUpdatedStyles(cellKey) {
    const display = displayCache.get(cellKey);
    if (display) {
      const userStyles = cellStyles.get(cellKey) || getInheritedFormatting?.(cellKey)?.styles || {};
      const node = getNode(cellKey);

      // Any errorMeta means error state (structural or runtime)
      const isError = node?.errorMeta?.length > 0;
      const typeStyles = isError ? { color: 'var(--color-error)' } : {};

      // Merge user styles with type-based defaults
      const semanticStyles = {
        ...typeStyles,
        ...userStyles,
        // Only apply default alignment if user hasn't explicitly set one
        alignment: userStyles.alignment || getDefaultAlignment(node)
      };

      display.styles = semanticToCSS(semanticStyles);
      displayCache.set(cellKey, display);
    }

    // Refresh cell in grid (or queue if batching)
    if (batchDepth > 0) {
      pendingRefreshCells.add(cellKey);
    } else {
      refreshCell(cellKey);
    }
  }

  /**
   * Check if a value is a runtime error (NaN, Infinity, -Infinity).
   * These values indicate a calculation problem but keep their original type.
   */
  function isRuntimeError(value) {
    return typeof value === 'number' && !isFinite(value);
  }

  /**
   * Refresh cells to the left that might be affected by this cell's emptiness change.
   * When a cell becomes empty or non-empty, cells to its left need to recalculate
   * their overflow clip boundary.
   * @param {string} cellKey - The cell whose emptiness changed
   */
  function refreshLeftNeighbors(cellKey) {
    const parsed = parseCellKey(cellKey);
    if (!parsed) return;

    let colNum = parsed.colNum - 1;
    while (colNum >= 1) {
      const leftKey = numberToColumn(colNum) + parsed.row;
      const leftDisplay = displayCache.get(leftKey);
      if (leftDisplay?.text?.trim()) {
        // This cell has content - it needs to recalculate overflow
        refreshCell(leftKey);
        break;  // only the nearest non-empty cell to the left needs refresh
      }
      colNum--;
    }
  }

  /**
   * Begin a batch — defers all refreshCell calls until endBatch().
   * Nestable: only the outermost endBatch() flushes.
   */
  function beginBatch() {
    batchDepth++;
  }

  /**
   * End a batch — when depth returns to 0, flush all pending refreshCell calls.
   */
  function endBatch() {
    batchDepth--;
    if (batchDepth === 0 && pendingRefreshCells.size > 0) {
      for (const cellKey of pendingRefreshCells) {
        refreshCell(cellKey);
      }
      pendingRefreshCells.clear();
    }
  }

  /**
   * Compute display value for a cell after calculation
   * Called by CalcEngine via callback
   *
   * Display priority:
   * 1. Structural error (type === 'error') → show refValue with error styling
   * 2. Runtime error (NaN/Inf with errorMeta) → show last errorMeta entry with error styling
   * 3. Normal value → format based on type
   */
  function computeDisplayValue(node, cellKey) {
    let text = '';
    let expandedText = null;

    // Any errorMeta means error state (structural or runtime)
    const isError = node.errorMeta?.length > 0;

    // Priority 1: Structural error (type === 'error')
    if (node.type === TYPE_HIERARCHY.ERROR) {
      text = node.refValue || '#ERROR!';
    }
    // Priority 2: Runtime error (NaN/Inf/-Inf with errorMeta)
    else if (isRuntimeError(node.refValue) && isError) {
      // Show the last error in the chain (errorMeta entries are {source, error} objects)
      const lastError = node.errorMeta[node.errorMeta.length - 1];
      text = lastError.error;
    }
    // Priority 3: Normal value formatting
    else if (node.refValue !== undefined && node.refValue !== null) {
      // Multi-output functions return plain objects — catch before type switch
      if (typeof node.refValue === 'object' && !Array.isArray(node.refValue) && !(node.type === TYPE_HIERARCHY.ERROR)) {
        text = '{...}';
        expandedText = TypeService.formatCanonical(node.refValue, node.type || 'Object');
      }
      // Get cell-specific format rules (if any)
      // formatRules now stores: { NUMBER: {...}, DATE: {...}, DATETIME: {...} }
      // Extract the format for the current node type
      else {
        const cellFormats = formatRules.get(cellKey) || getInheritedFormatting?.(cellKey)?.formatRules;

        // Map node type to format type key
        const formatTypeMap = {
          [TYPE_HIERARCHY.NUMBER]: 'NUMBER',
          [TYPE_HIERARCHY.DATE]: 'DATE',
          [TYPE_HIERARCHY.DATETIME]: 'DATETIME'
        };

        const formatTypeKey = formatTypeMap[node.type];
        const cellFormat = cellFormats?.[formatTypeKey];

        // Format the value based on type
        // Merge precedence: cell format || spreadsheet defaults || factory defaults
        switch (node.type) {
          case TYPE_HIERARCHY.NUMBER: {
            const numberFormat = cellFormat || spreadsheetDefaults?.NUMBER || getNumberFormatDefaults('number');
            text = formatNumber(node.refValue, numberFormat);
            break;
          }

          case TYPE_HIERARCHY.TEXT:
            text = String(node.refValue);
            break;

          case TYPE_HIERARCHY.DATE: {
            const finalDateFormat = cellFormat || spreadsheetDefaults?.DATE || getDateFormatDefaults();
            const dateFormat = finalDateFormat.displayFormat || DATE_FORMATS.ISO;
            text = formatDate(node.refValue, dateFormat);
            break;
          }

          case TYPE_HIERARCHY.DATETIME: {
            const finalDateTimeFormat = cellFormat || spreadsheetDefaults?.DATETIME || getDateTimeFormatDefaults();
            let datetimeFormat = finalDateTimeFormat.displayFormat || DATETIME_FORMATS.ISO;
            const displayType = finalDateTimeFormat.displayType || 'datetime';

            // Check if we should display time only
            if (displayType === 'timeOnly') {
              // If the format still contains date patterns (YYYY, MM, DD), use default time format
              if (/YYYY|YY|MMMM|MM|DD/.test(datetimeFormat)) {
                datetimeFormat = TIME_FORMATS.STANDARD;  // Default to 'HH:mm:ss'
              }
              text = formatTime(node.refValue, datetimeFormat);
            } else {
              text = formatDateTime(node.refValue, datetimeFormat);
            }
            break;
          }

          case TYPE_HIERARCHY.BOOLEAN:
            text = node.refValue ? 'TRUE' : 'FALSE';
            break;

          default:
            // Handle parameterized array types like 'ARRAY[Number]'
            if (isArrayType(node.type)) {
              text = TypeService.formatCanonical(node.refValue, node.type);
            } else {
              text = String(node.refValue);
            }
        }
      }
    }

    // Get type-based default styles
    let typeStyles = {};
    if (isError) {
      typeStyles = { color: 'var(--color-error)' };
    } else if (node?.type === TYPE_HIERARCHY.BOOLEAN) {
      typeStyles = { backgroundColor: node.refValue ? 'var(--cell-bool-true-bg)' : 'var(--cell-bool-false-bg)' };
    }

    // Get user-applied styles (if any), falling back to inherited styles
    const userStyles = cellStyles.get(cellKey) || getInheritedFormatting?.(cellKey)?.styles || {};

    // Merge styles with proper precedence:
    // 1. Type-based defaults (e.g., error color)
    // 2. User overrides (user can override type defaults)
    // 3. Alignment special handling (user alignment || type default alignment)
    const semanticStyles = {
      ...typeStyles,           // Type defaults (color for errors, etc.)
      ...userStyles,           // User overrides
      // Only apply default alignment if user hasn't explicitly set one
      alignment: userStyles.alignment || getDefaultAlignment(node)
    };

    const display = {
      text,
      styles: semanticToCSS(semanticStyles),  // Convert to CSS-ready format
      ...(expandedText ? { expandedText } : {}),
    };

    // Track emptiness change for overflow recalculation
    const wasEmpty = !displayCache.get(cellKey)?.text?.trim();
    const isNowEmpty = !display.text?.trim();

    displayCache.set(cellKey, display);

    // Update type index: remove from old type sets, add to new type set
    // First, remove from any existing type sets
    for (const cellSet of cellsByType.values()) {
      cellSet.delete(cellKey);
    }
    // Add to the new type set
    if (!cellsByType.has(node.type)) {
      cellsByType.set(node.type, new Set());
    }
    cellsByType.get(node.type).add(cellKey);

    // Refresh the cell in the grid (or queue if batching)
    if (batchDepth > 0) {
      pendingRefreshCells.add(cellKey);

      // If emptiness changed, queue left neighbor instead of refreshing immediately
      if (wasEmpty !== isNowEmpty) {
        const parsed = parseCellKey(cellKey);
        if (parsed) {
          let colNum = parsed.colNum - 1;
          while (colNum >= 1) {
            const leftKey = numberToColumn(colNum) + parsed.row;
            const leftDisplay = displayCache.get(leftKey);
            if (leftDisplay?.text?.trim()) {
              pendingRefreshCells.add(leftKey);
              break;
            }
            colNum--;
          }
        }
      }
    } else {
      refreshCell(cellKey);

      // If emptiness changed, refresh cells to the left that may need to update their clip boundary
      if (wasEmpty !== isNowEmpty) {
        refreshLeftNeighbors(cellKey);
      }
    }
  }

  /**
   * Get the display data for a cell
   * Called by Grid for rendering
   */
  function getCellDisplay(cellKey) {
    if (displayCache.has(cellKey)) return displayCache.get(cellKey);

    const userStyles = cellStyles.get(cellKey) || getInheritedFormatting?.(cellKey)?.styles || {};
    const hasUserStyles = Object.keys(userStyles).length > 0;

    return {
      text: '',
      styles: hasUserStyles
        ? semanticToCSS(userStyles)
        : {
            // Explicit empty styles to clear any existing inline styles
            fontWeight: '',
            fontStyle: '',
            fontSize: '',
            textAlign: '',
            color: 'var(--cell-text-default)',
            backgroundColor: '',
          }
    };
  }

  // ============================================================================
  // Styling Operations
  // ============================================================================

  /**
   * Toggle bold style on selected cells
   * If all cells are bold, unbold all. Otherwise, bold all.
   */
  function applyBold() {

    const selection = getSelection();

    // Expand range to get all affected cells
    const { cells } = expandRange(selection.start, selection.end);

    // Record history before mutations
    if (recordChanges) {
      recordChanges('cellStyles', cells);
    }

    // Check if ALL cells are currently bold
    const allBold = cells.every(cellKey => {
      const styles = cellStyles.get(cellKey) || {};
      return styles.bold === true;
    });

    // Toggle: if all bold, unbold all; otherwise, bold all
    beginBatch();
    cells.forEach(cellKey => {
      const styles = cellStyles.get(cellKey) || {};

      if (allBold) {
        // Remove bold
        delete styles.bold;
        if (Object.keys(styles).length === 0) {
          cellStyles.delete(cellKey);
        } else {
          cellStyles.set(cellKey, styles);
        }
      } else {
        // Apply bold
        styles.bold = true;
        cellStyles.set(cellKey, styles);
      }

      // Update display cache and refresh
      refreshCellWithUpdatedStyles(cellKey);
    });
    endBatch();

    onFormattingChange?.();
  }

  /**
   * Toggle italic style on selected cells
   * If all cells are italic, unitalicize all. Otherwise, italicize all.
   */
  function applyItalic() {

    const selection = getSelection();

    // Expand range to get all affected cells
    const { cells } = expandRange(selection.start, selection.end);

    // Record history before mutations
    if (recordChanges) {
      recordChanges('cellStyles', cells);
    }

    // Check if ALL cells are currently italic
    const allItalic = cells.every(cellKey => {
      const styles = cellStyles.get(cellKey) || {};
      return styles.italic === true;
    });

    // Toggle: if all italic, unitalicize all; otherwise, italicize all
    beginBatch();
    cells.forEach(cellKey => {
      const styles = cellStyles.get(cellKey) || {};

      if (allItalic) {
        // Remove italic
        delete styles.italic;
        if (Object.keys(styles).length === 0) {
          cellStyles.delete(cellKey);
        } else {
          cellStyles.set(cellKey, styles);
        }
      } else {
        // Apply italic
        styles.italic = true;
        cellStyles.set(cellKey, styles);
      }

      // Update display cache and refresh
      refreshCellWithUpdatedStyles(cellKey);
    });
    endBatch();

    onFormattingChange?.();
  }

  /**
   * Apply or toggle a highlight color on selected cells.
   * If all cells already have this highlight, clear it; otherwise apply.
   * @param {string} highlightName - One of HIGHLIGHT_NAMES, or '' to clear
   */
  function applyHighlight(highlightName) {
    const selection = getSelection();
    const { cells } = expandRange(selection.start, selection.end);

    if (recordChanges) {
      recordChanges('cellStyles', cells);
    }

    // Determine toggle: if applying a color and all cells already have it, clear
    const shouldClear = highlightName && cells.every(cellKey => {
      const styles = cellStyles.get(cellKey) || {};
      return styles.highlight === highlightName;
    });

    beginBatch();
    cells.forEach(cellKey => {
      const styles = cellStyles.get(cellKey) || {};

      if (!highlightName || shouldClear) {
        delete styles.highlight;
        if (Object.keys(styles).length === 0) {
          cellStyles.delete(cellKey);
        } else {
          cellStyles.set(cellKey, styles);
        }
      } else {
        styles.highlight = highlightName;
        cellStyles.set(cellKey, styles);
      }

      refreshCellWithUpdatedStyles(cellKey);
    });
    endBatch();

    onFormattingChange?.();
  }

  /**
   * Get the active highlight name if all selected cells share the same one.
   * @returns {string|null} Highlight name or null
   */
  function getActiveHighlight() {
    const selection = getSelection();
    const { cells } = expandRange(selection.start, selection.end);
    if (cells.length === 0) return null;

    const first = (cellStyles.get(cells[0]) || {}).highlight || null;
    if (!first) return null;

    const allSame = cells.every(cellKey => {
      const styles = cellStyles.get(cellKey) || {};
      return styles.highlight === first;
    });

    return allSame ? first : null;
  }

  function increaseFontSize() {

    const selection = getSelection();
    const { cells } = expandRange(selection.start, selection.end);

    // Record history before mutations
    if (recordChanges) {
      recordChanges('cellStyles', cells);
    }

    beginBatch();
    cells.forEach(cellKey => {
      const styles = cellStyles.get(cellKey) || {};

      // Get current font size or use default
      const currentSize = styles.fontSize || DEFAULT_FONT_SIZE;

      // Increase by step
      styles.fontSize = currentSize + FONT_SIZE_STEP;
      cellStyles.set(cellKey, styles);

      // Update display cache and refresh
      refreshCellWithUpdatedStyles(cellKey);
    });
    endBatch();

    onFormattingChange?.();
  }

  function decreaseFontSize() {

    const selection = getSelection();
    const { cells } = expandRange(selection.start, selection.end);

    // Record history before mutations
    if (recordChanges) {
      recordChanges('cellStyles', cells);
    }

    beginBatch();
    cells.forEach(cellKey => {
      const styles = cellStyles.get(cellKey) || {};

      // Get current font size or use default
      const currentSize = styles.fontSize || DEFAULT_FONT_SIZE;

      // Decrease by step, but don't go below minimum
      const newSize = Math.max(currentSize - FONT_SIZE_STEP, MIN_FONT_SIZE);

      if (newSize === DEFAULT_FONT_SIZE) {
        // If we're back to default, remove the property
        delete styles.fontSize;
        if (Object.keys(styles).length === 0) {
          cellStyles.delete(cellKey);
        } else {
          cellStyles.set(cellKey, styles);
        }
      } else {
        styles.fontSize = newSize;
        cellStyles.set(cellKey, styles);
      }

      // Update display cache and refresh
      refreshCellWithUpdatedStyles(cellKey);
    });
    endBatch();

    onFormattingChange?.();
  }

  /**
   * Apply left alignment to selected cells
   */
  function alignLeft() {
    applyAlignment('left');
  }

  /**
   * Apply center alignment to selected cells
   */
  function alignCenter() {
    applyAlignment('center');
  }

  /**
   * Apply right alignment to selected cells
   */
  function alignRight() {
    applyAlignment('right');
  }

  /**
   * Apply alignment to all cells in selection
   * @param {string} alignment - 'left', 'center', or 'right'
   */
  function applyAlignment(alignment) {
    const selection = getSelection();

    // Expand range to get all affected cells
    const { cells } = expandRange(selection.start, selection.end);

    // Record history before mutations
    if (recordChanges) {
      recordChanges('cellStyles', cells);
    }

    // Apply alignment to all cells
    beginBatch();
    cells.forEach(cellKey => {
      const styles = cellStyles.get(cellKey) || {};

      // Set alignment
      styles.alignment = alignment;
      cellStyles.set(cellKey, styles);

      // Update display cache and refresh
      refreshCellWithUpdatedStyles(cellKey);
    });
    endBatch();

    onFormattingChange?.();
  }

  /**
   * Clear all formatting (styles and format rules) from selected cells
   * Returns cells to default formatting based on type
   */
  function clearFormatting() {

    const selection = getSelection();

    // Expand range to get all affected cells
    const { cells } = expandRange(selection.start, selection.end);

    // Record history before mutations (both formatRules and cellStyles)
    if (recordChanges) {
      recordChanges('formatRules', cells);
      recordChanges('cellStyles', cells);
    }

    beginBatch();
    cells.forEach(cellKey => {
      // Remove format rules (custom number/date/datetime formatting)
      formatRules.delete(cellKey);

      // Remove styles (bold, italic, fontSize, alignment)
      cellStyles.delete(cellKey);

      // Get node to re-trigger display computation with defaults
      const node = getNode(cellKey);
      if (node) {
        // Re-compute display with default formatting
        computeDisplayValue(node, cellKey);
      } else {
        // If no node, just clear display cache and refresh
        displayCache.delete(cellKey);
        if (batchDepth > 0) {
          pendingRefreshCells.add(cellKey);
        } else {
          refreshCell(cellKey);
        }
      }
    });
    endBatch();

    onFormattingChange?.();
  }

  // ============================================================================
  // Format Rule Operations (Public API)
  // ============================================================================

  /**
   * Apply format rule to multiple cells
   * @param {string[]} cellKeys - Array of cells to format
   * @param {object} formatSettings - Format settings with type key (e.g., { NUMBER: {...} })
   * @returns {object} { success: boolean, error?: string, failedCells?: string[] }
   */
  function applyFormatRules(cellKeys, formatSettings) {

    // Record history before mutations
    if (recordChanges) {
      recordChanges('formatRules', cellKeys);
    }

    // Extract type key and type-specific format
    const typeKey = Object.keys(formatSettings)[0];
    if (!typeKey || !['NUMBER', 'DATE', 'DATETIME'].includes(typeKey)) {
      return { success: false, error: 'Invalid format structure - must be { NUMBER: {...} }, { DATE: {...} }, or { DATETIME: {...} }' };
    }

    const typeSpecificFormat = formatSettings[typeKey];

    // Validate once for all cells
    let validation;

    switch (typeKey) {
      case 'NUMBER':
        validation = validateNumberFormat(typeSpecificFormat);
        break;
      case 'DATE':
        validation = validateDateFormat(typeSpecificFormat);
        break;
      case 'DATETIME':
        validation = validateDateTimeFormat(typeSpecificFormat);
        break;
    }

    if (!validation.valid) {
      console.error('[FormattingEngine] Invalid format settings:', validation.errors);
      return { success: false, error: validation.errors.join('; ') };
    }

    // Apply to all cells
    beginBatch();
    cellKeys.forEach(cellKey => {
      // Get existing format rules for this cell (or create empty object)
      const existingFormats = formatRules.get(cellKey) || {};

      // Merge new type-specific format into existing formats
      const updatedFormats = {
        ...existingFormats,
        [typeKey]: typeSpecificFormat
      };

      // Store merged format rules
      formatRules.set(cellKey, updatedFormats);

      // Re-compute display with new format
      const node = getNode(cellKey);
      if (node) {
        computeDisplayValue(node, cellKey);
      } else {
        if (batchDepth > 0) {
          pendingRefreshCells.add(cellKey);
        } else {
          refreshCell(cellKey);
        }
      }
    });
    endBatch();

    onFormattingChange?.();
    return { success: true };
  }

  /**
   * Update spreadsheet default format for a type
   * @param {string} formatType - Type to update ('NUMBER', 'DATE', or 'DATETIME')
   * @param {object} formatSettings - New default settings for this type
   * @returns {object} { success: boolean, error?: string }
   */
  function updateSpreadsheetDefault(formatType, formatSettings) {

    // Validate type
    const validTypes = ['NUMBER', 'DATE', 'DATETIME'];
    if (!validTypes.includes(formatType)) {
      return { success: false, error: `Invalid format type: ${formatType}` };
    }

    // Validate format settings for this type
    let validation;

    switch (formatType) {
      case 'NUMBER':
        validation = validateNumberFormat(formatSettings);
        break;
      case 'DATE':
        validation = validateDateFormat(formatSettings);
        break;
      case 'DATETIME':
        validation = validateDateTimeFormat(formatSettings);
        break;
    }

    if (!validation.valid) {
      console.error('[FormattingEngine] Invalid format settings:', validation.errors);
      return { success: false, error: validation.errors.join('; ') };
    }

    // Update spreadsheet defaults
    spreadsheetDefaults[formatType] = formatSettings;


    // Map format type to node type for efficient lookup
    const nodeTypeMap = {
      'NUMBER': TYPE_HIERARCHY.NUMBER,
      'DATE': TYPE_HIERARCHY.DATE,
      'DATETIME': TYPE_HIERARCHY.DATETIME
    };
    const targetNodeType = nodeTypeMap[formatType];

    // Efficiently refresh only cells of this type that don't have explicit format rules
    // Convert to array to avoid modifying Set while iterating (computeDisplayValue updates cellsByType)
    const cellsOfType = Array.from(cellsByType.get(targetNodeType) || []);

    beginBatch();
    for (const cellKey of cellsOfType) {
      // Skip cells with explicit format rules for this specific type (they don't use defaults)
      const cellFormats = formatRules.get(cellKey);
      if (cellFormats?.[formatType]) {
        continue; // This cell has an explicit format rule for this type
      }

      // Re-compute display value to pick up new default
      const node = getNode(cellKey);
      if (node) {
        computeDisplayValue(node, cellKey);
      }
    }
    endBatch();

    onFormattingChange?.();

    return { success: true };
  }

  /**
   * Get read-only access to spreadsheet defaults
   * @returns {object} Spreadsheet default format settings
   */
  function getSpreadsheetDefaults() {
    // Return a shallow copy to prevent external modification
    return { ...spreadsheetDefaults };
  }

  /**
   * Get styles for a specific cell
   * @param {string} cellKey - The cell key (e.g., 'A1')
   * @returns {object|null} Styles object or null if no styles exist
   */
  function getCellStyles(cellKey) {
    const styles = cellStyles.get(cellKey);
    return styles ? { ...styles } : null;
  }

  /**
   * Get format rules for a specific cell
   * @param {string} cellKey - The cell key (e.g., 'A1')
   * @returns {object|null} Format rules object or null if no rules exist
   */
  function getCellFormatRules(cellKey) {
    const rules = formatRules.get(cellKey);
    if (!rules) return null;

    // Return a deep copy to prevent external modification
    return JSON.parse(JSON.stringify(rules));
  }

  // ============================================================================
  // Batch Operations (for clipboard/multi-engine atomic changes)
  // ============================================================================

  /**
   * Get formatting (styles and format rules) for multiple cells
   * @param {string[]} cellKeys - Array of cell keys
   * @returns {Map<string, {styles: object|null, formatRules: object|null}>}
   */
  function getFormattingBatch(cellKeys) {
    const result = new Map();

    for (const cellKey of cellKeys) {
      const styles = cellStyles.get(cellKey);
      const rules = formatRules.get(cellKey);

      // Only include cells that have some formatting
      if (styles || rules) {
        result.set(cellKey, {
          styles: styles ? { ...styles } : null,
          formatRules: rules ? JSON.parse(JSON.stringify(rules)) : null
        });
      }
    }

    return result;
  }

  /**
   * Set formatting for multiple cells (used by clipboard for cut/paste)
   * Caller is responsible for history batching via historyEngine.beginBatch/endBatch
   * @param {Array<[string, {styles?: object, formatRules?: object}]>} updates - Array of [cellKey, formatting] pairs
   */
  function setFormattingBatch(updates) {
    if (!updates || updates.length === 0) return;

    // Collect all cell keys for history recording
    const cellKeys = updates.map(([cellKey]) => cellKey);

    // Record history for both maps (will be batched if beginBatch was called)
    if (recordChanges) {
      recordChanges('cellStyles', cellKeys);
      recordChanges('formatRules', cellKeys);
    }

    // Apply updates
    beginBatch();
    for (const [cellKey, formatting] of updates) {
      // Set styles
      if (formatting.styles) {
        cellStyles.set(cellKey, { ...formatting.styles });
      }

      // Set format rules
      if (formatting.formatRules) {
        formatRules.set(cellKey, JSON.parse(JSON.stringify(formatting.formatRules)));
      }

      // Refresh display
      refreshCellWithUpdatedStyles(cellKey);
    }
    endBatch();

    onFormattingChange?.();
  }

  /**
   * Clear formatting for multiple cells (used by clipboard for cut source cells)
   * Caller is responsible for history batching via historyEngine.beginBatch/endBatch
   * @param {string[]} cellKeys - Array of cell keys to clear
   */
  function clearFormattingBatch(cellKeys) {
    if (!cellKeys || cellKeys.length === 0) return;

    // Record history for both maps (will be batched if beginBatch was called)
    if (recordChanges) {
      recordChanges('cellStyles', cellKeys);
      recordChanges('formatRules', cellKeys);
    }

    // Clear formatting
    beginBatch();
    for (const cellKey of cellKeys) {
      cellStyles.delete(cellKey);
      formatRules.delete(cellKey);

      // Re-compute display with default formatting
      const node = getNode(cellKey);
      if (node) {
        computeDisplayValue(node, cellKey);
      } else {
        displayCache.delete(cellKey);
        if (batchDepth > 0) {
          pendingRefreshCells.add(cellKey);
        } else {
          refreshCell(cellKey);
        }
      }
    }
    endBatch();

    onFormattingChange?.();
  }

  return {
    /**
     * Initialize with injected storage and callbacks
     */
    init(deps) {
      ({
        formatRules,
        cellStyles,
        spreadsheetDefaults,
        refreshCell,
        getSelection,
        getNode,
        recordChanges,
        onRegisterHistoryMap,
        onFormattingChange,
      } = deps);
      getInheritedFormatting = deps.getInheritedFormatting || null;

      // Register Maps with HistoryEngine
      if (onRegisterHistoryMap) {
        // Register formatRules Map
        onRegisterHistoryMap('formatRules', formatRules, (delta) => {
          // Rebuild callback: Restore values and re-compute display
          // delta is Map<cellKey, formatRule|undefined>
          beginBatch();
          for (const [cellKey, value] of delta.entries()) {
            // Restore value to Map
            if (value === undefined) {
              formatRules.delete(cellKey);
            } else {
              formatRules.set(cellKey, value);
            }

            // Re-compute display for this cell
            const node = getNode(cellKey);
            if (node) {
              computeDisplayValue(node, cellKey);
            } else {
              displayCache.delete(cellKey);
              if (batchDepth > 0) {
                pendingRefreshCells.add(cellKey);
              } else {
                refreshCell(cellKey);
              }
            }
          }
          endBatch();
        });

        // Register cellStyles Map
        onRegisterHistoryMap('cellStyles', cellStyles, (delta) => {
          // Rebuild callback: Restore values and refresh cells
          // delta is Map<cellKey, styles|undefined>
          beginBatch();
          for (const [cellKey, value] of delta.entries()) {
            // Restore value to Map
            if (value === undefined) {
              cellStyles.delete(cellKey);
            } else {
              cellStyles.set(cellKey, value);
            }

            // Refresh the cell display
            refreshCellWithUpdatedStyles(cellKey);
          }
          endBatch();
        });
      }

    },

    // Batching
    beginBatch,
    endBatch,

    // Display computation
    computeDisplayValue,
    getCellDisplay,

    // Highlight constants
    HIGHLIGHT_NAMES,

    // Styling operations (apply to selected cells)
    applyBold,
    applyItalic,
    applyHighlight,
    getActiveHighlight,
    increaseFontSize,
    decreaseFontSize,
    alignLeft,
    alignCenter,
    alignRight,
    clearFormatting,

    // Format rule operations (public API - sole manager of formatRules)
    applyFormatRules,

    // Spreadsheet default operations (public API - sole manager of spreadsheetDefaults)
    updateSpreadsheetDefault,
    getSpreadsheetDefaults,
    getCellStyles,
    getCellFormatRules,

    // Batch operations (for clipboard/multi-engine atomic changes)
    getFormattingBatch,
    setFormattingBatch,
    clearFormattingBatch,

    /**
     * Gets a snapshot of all formatting state for persistence.
     *
     * @returns {{formatRules: Array, cellStyles: Array, spreadsheetDefaults: Object}} Serializable snapshot
     */
    getSnapshot() {
      return {
        formatRules: Array.from(formatRules.entries()),
        cellStyles: Array.from(cellStyles.entries()),
        spreadsheetDefaults: { ...spreadsheetDefaults }
      };
    },

    /**
     * Restores formatting state from a snapshot.
     *
     * @param {{formatRules: Array, cellStyles: Array, spreadsheetDefaults: Object}} data - Snapshot to restore
     */
    restoreSnapshot(data) {

      // Capture styled cells before clearing so we can refresh removed ones
      const previousStyledCells = new Set(cellStyles.keys());

      // Clear all state
      formatRules.clear();
      cellStyles.clear();
      displayCache.clear();
      cellsByType.clear();
      Object.keys(spreadsheetDefaults).forEach(k => delete spreadsheetDefaults[k]);

      // Restore formatRules
      for (const [key, value] of data.formatRules || []) {
        formatRules.set(key, value);
      }

      // Restore cellStyles
      for (const [key, value] of data.cellStyles || []) {
        cellStyles.set(key, value);
      }

      // Refresh styled cells so empty cells with backgrounds render correctly.
      // Cells with formulas will get a second refresh during calculation (harmless).
      for (const key of cellStyles.keys()) {
        refreshCell(key);
      }

      // Refresh cells that had styles before but no longer do (clears stale backgrounds)
      for (const key of previousStyledCells) {
        if (!cellStyles.has(key)) {
          refreshCell(key);
        }
      }

      // Restore spreadsheetDefaults
      if (data.spreadsheetDefaults) {
        Object.assign(spreadsheetDefaults, data.spreadsheetDefaults);
      }
    },

    /**
     * Silently delete keys from display cache and type index.
     *
     * Used by loop sheets to efficiently clear generated rows before regeneration.
     * Does not trigger grid refresh (caller handles that).
     *
     * @param {string[]} keys - Array of cell keys to delete
     */
    silentDeleteKeys(keys) {
      for (const key of keys) {
        displayCache.delete(key);
        cellStyles.delete(key);
        formatRules.delete(key);

        // Remove from type index
        for (const cellSet of cellsByType.values()) {
          cellSet.delete(key);
        }
      }
    }
  };
}
