/*
 * FORMULA BAR
 * ===========
 *
 * Formula/value editing interface.
 * Handles text input, formula editing mode detection, and reference picking.
 *
 * ORGANIZATION:
 * - Dependencies (injected)
 * - Rendering State (DOM elements)
 * - Cell State (current cell, values)
 * - Formula Editing Mode
 * - Reference Picking
 * - Rendering/Mounting
 * - Cell Loading
 * - Keyboard Handling
 * - Input Handling
 * - Public API
 */

import { isCellReference } from '../utils/cellUtils.js';

export function createFormulaBar() {
  // ============================================================================
  // DEPENDENCIES (injected via init)
  // ============================================================================

  let loadValue = null;
  let isCellEditable = null;  // Optional - if not provided, all cells are editable
  let onDisabledClick = null;  // Optional - called when user clicks on disabled input
  let onCommit = null;
  let focusActiveCell = null;
  let collapseToActiveCell = null;
  let stepSelectionAnchor = null;
  let moveActiveCell = null;
  let lookupRangeName = null;
  let createNamedRange = null;
  let renameNamedRange = null;
  let deleteNamedRange = null;
  let commitUnhandledPointers = null;

  // ============================================================================
  // RENDERING STATE (DOM elements)
  // ============================================================================

  let container = null;
  let input = null;
  let inputWrapper = null;  // Created dynamically to hold input + overlay
  let disabledOverlay = null;  // Overlay to capture clicks when input is disabled
  let cellNameDisplay = null;
  let cellNameDeleteButton = null;

  // ============================================================================
  // CELL STATE (current cell being edited)
  // ============================================================================

  let currentCell = null;
  let originalValue = null; // Stored when cell loads, for Escape revert
  let currentNotation = null; // Current selection notation (for naming ranges)
  let originalNotation = null; // Original notation before editing cell name
  let currentRangeName = null; // The named range currently displayed (null if showing notation)

  // ============================================================================
  // FORMULA EDITING MODE
  // ============================================================================
  // Tracks whether user is editing a formula (value starts with '=')

  let formulaEditingMode = false;

  /**
   * Internal helper: Set formula editing mode with logging
   * Single point of mutation for consistency
   * @private
   */
  function _setFormulaEditingMode(isEditing) {
    if (formulaEditingMode !== isEditing) {
      formulaEditingMode = isEditing;
      console.log('[FormulaBar] Formula editing mode:', formulaEditingMode);
    }
  }


  function isEditingFormula() {
    return formulaEditingMode;
  }

  /**
   * Update formula editing mode based on input value--This assumes the user is editing--this should not be called if they are not
   */
  function updateFormulaEditingMode() {
    const newMode = input && input.value.startsWith('=');
    _setFormulaEditingMode(newMode);
  }

  /**
   * Handle beforeinput event - commit any preview and route through handleInputFromGrid if needed
   */
  function handleBeforeInputEvent(e) {
    // Auto-promote any preview to active before processing input
    const didCommit = commitUnhandledPointers ? commitUnhandledPointers() : false;

    if (didCommit && e.data) {
      // We committed a preview - route through handleInputFromGrid for correct replacement behavior
      e.preventDefault();
      handleInputFromGrid(e.data);
    }
    // If no preview committed, let normal typing happen and browser will add the character
  }

  /**
   * Handle input event - update formula editing mode after normal typing
   */
  function handleInputEvent() {
    updateFormulaEditingMode();
  }

  // ============================================================================
  // REFERENCE PICKING
  // ============================================================================
  // Manages the state machine for picking cell references during formula editing

  let referenceStart = null; // Start position of inserted reference
  let referenceEnd = null;   // End position of inserted reference
  let savedValueBeforePicking = null; // For revert during reference picking

  /**
   * Revert to saved value during reference picking (called by grid on Delete/Backspace/Escape)
   */
  function revertReferencePicking() {
    console.log('[FormulaBar] Reverting to:', savedValueBeforePicking);

    input.value = savedValueBeforePicking;
    focus(); 
  }


  /**
   * Save the current text selection position (for reference mode)
   */
  function saveSelectionPosition() {
    referenceStart = input.selectionStart;
    referenceEnd = input.selectionEnd;
    console.log('[FormulaBar] Saved selection position:', referenceStart, '-', referenceEnd);
  }

  /**
   * Insert reference notation at the saved position
   * @param {string} notation - Reference notation like "A1" or "A1:C3"
   */
  function insertReference(notation) {
    // If selection position hasn't been saved yet (e.g. clicking panel input
    // while formula bar still has focus), save it now from the live cursor.
    if (referenceStart === null || referenceEnd === null) {
      if (!input) return;
      saveSelectionPosition();
      savedValueBeforePicking = input.value;
    }

    // If the notation matches a named range, use the name instead
    const resolved = (lookupRangeName && lookupRangeName(notation)) || notation;

    const currentValue = input.value;

    // Replace text at the saved position with the reference
    const newValue =
      currentValue.substring(0, referenceStart) +
      resolved +
      currentValue.substring(referenceEnd);

    input.value = newValue;

    // Update saved position to reflect new reference length
    referenceEnd = referenceStart + resolved.length;

    console.log('[FormulaBar] Inserted reference:', resolved, 'at', referenceStart, '-', referenceEnd);
  }

  // ============================================================================
  // RENDERING/MOUNTING
  // ============================================================================

  /**
   * Mount the formula bar to provided element
   */
  function mount(containerElement) {
    console.log('[FormulaBar] Mounting...');

    container = containerElement;

    // Find child elements
    cellNameDisplay = container.querySelector('.cell-name-display');
    cellNameDeleteButton = container.querySelector('.cell-name-delete-button');
    input = container.querySelector('.formula-input');

    // Wrap input in a container with overlay for disabled click detection
    // (Disabled inputs don't receive click events in most browsers)
    inputWrapper = document.createElement('div');
    inputWrapper.className = 'formula-input-wrapper';
    input.parentNode.insertBefore(inputWrapper, input);
    inputWrapper.appendChild(input);

    disabledOverlay = document.createElement('div');
    disabledOverlay.className = 'formula-input-disabled-overlay';
    disabledOverlay.addEventListener('click', handleClick);
    inputWrapper.appendChild(disabledOverlay);

    // Event listeners
    input.addEventListener('keydown', handleKeyDown);
    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    input.addEventListener('beforeinput', handleBeforeInputEvent);
    input.addEventListener('input', handleInputEvent);

    cellNameDisplay.addEventListener('keydown', handleCellNameKeyDown);
    cellNameDisplay.addEventListener('focus', handleCellNameFocus);
    cellNameDeleteButton.addEventListener('click', handleDeleteRangeName);

    console.log('[FormulaBar] Mounted');
  }

  /**
   * Unmount the formula bar (remove event listeners, clear references)
   */
  function unmount() {
    if (input) {
      input.removeEventListener('keydown', handleKeyDown);
      input.removeEventListener('focus', handleFocus);
      input.removeEventListener('blur', handleBlur);
      input.removeEventListener('beforeinput', handleBeforeInputEvent);
      input.removeEventListener('input', handleInputEvent);
    }
    if (disabledOverlay) {
      disabledOverlay.removeEventListener('click', handleClick);
    }
    if (cellNameDisplay) {
      cellNameDisplay.removeEventListener('keydown', handleCellNameKeyDown);
      cellNameDisplay.removeEventListener('focus', handleCellNameFocus);
    }
    if (cellNameDeleteButton) {
      cellNameDeleteButton.removeEventListener('click', handleDeleteRangeName);
    }

    // Unwrap input (restore original DOM structure)
    if (inputWrapper && input) {
      inputWrapper.parentNode.insertBefore(input, inputWrapper);
      inputWrapper.remove();
    }

    // Clear references
    container = null;
    input = null;
    inputWrapper = null;
    disabledOverlay = null;
    cellNameDisplay = null;
    cellNameDeleteButton = null;

    console.log('[FormulaBar] Unmounted');
  }

  // ============================================================================
  // CELL LOADING
  // ============================================================================

  /**
   * Load a cell for editing
   * Called by orchestrator when active cell changes
   */
  function loadCell(cellKey) {
    console.log(`[FormulaBar] Loading cell: ${cellKey}`);

    currentCell = cellKey;

    // Load value into input and store original for Escape revert
    const value = loadValue(cellKey);
    originalValue = value || '';
    input.value = originalValue;

    // Disable input if cell is not editable (e.g., generated rows in loop sheets)
    const editable = !isCellEditable || isCellEditable(cellKey);
    input.disabled = !editable;

    // If formula bar is currently focused, update formula editing mode
    // This handles external changes (like paste) that modify the current cell while editing
    if (input === document.activeElement) {
      updateFormulaEditingMode();
    }

    // Don't focus - let cell keep focus for input detection
    // Note: Formula editing mode will be updated when/if formula bar gains focus
    // Note: Cell name display is updated by Grid's selection state logic
  }

  /**
   * Revert to original value (called on Escape)
   */
  function revertValue() {
    console.log(`[FormulaBar] Reverting to original value: "${originalValue}"`);

    // Exit formula editing mode
    _setFormulaEditingMode(false);

    input.value = originalValue;

    // Return focus to grid cell
    focusActiveCell();
  }

  /**
   * Get current input value
   */
  function getValue() {
    return input.value;
  }

  /**
   * Get current cell being edited
   */
  function getCurrentCell() {
    return currentCell;
  }

  /**
   * Focus the input field with optional cursor positioning
   * @param {string} cursorMode - 'select-all', 'end', 'start', or undefined (preserve current position)
   */
  function focus(cursorMode) {
    input.focus();

    if (cursorMode === 'select-all') {
      input.select();
    } else if (cursorMode === 'end') {
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (cursorMode === 'start') {
      input.setSelectionRange(0, 0);
    }
    // undefined/other values = preserve current cursor position (default behavior)
  }

  /**
   * Set the input value (pure setter)
   */
  function setValue(value) {
    input.value = value;
  }

  /**
   * Update the cell name display (e.g., "A1" or "A1:C3")
   * @param {string} notation - Cell or range notation
   */
  function updateCellNameDisplay(notation) {
    // Store current notation (needed for creating named ranges)
    currentNotation = notation;

    // Check if this notation matches a named range (works for both single cells and ranges)
    if (lookupRangeName) {
      const rangeName = lookupRangeName(notation);
      if (rangeName) {
        cellNameDisplay.value = rangeName;
        currentRangeName = rangeName;
        // Show delete button
        if (cellNameDeleteButton) {
          cellNameDeleteButton.hidden = false;
        }
        return;
      }
    }

    // Otherwise show the notation as-is
    cellNameDisplay.value = notation;
    currentRangeName = null;
    // Hide delete button
    if (cellNameDeleteButton) {
      cellNameDeleteButton.hidden = true;
    }
  }

  // ============================================================================
  // CELL NAME EDITING
  // ============================================================================

  /**
   * Handle delete button click - delete the named range
   */
  function handleDeleteRangeName(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!currentRangeName || !deleteNamedRange) {
      return;
    }

    console.log('[FormulaBar] Deleting named range:', currentRangeName);

    const result = deleteNamedRange(currentRangeName);

    if (result.success) {
      // Successfully deleted - update display to show notation
      cellNameDisplay.value = currentNotation;
      currentRangeName = null;
      cellNameDeleteButton.hidden = true;
      console.log('[FormulaBar] Named range deleted, reverted to:', currentNotation);
    } else {
      console.error('[FormulaBar] Failed to delete named range:', result.error);
      alert(`Cannot delete named range: ${result.error}`);
    }
  }

  /**
   * Handle focus on cell name display - save original value
   */
  function handleCellNameFocus() {
    originalNotation = cellNameDisplay.value;
    cellNameDisplay.select(); // Select all for easy editing
    console.log('[FormulaBar] Cell name focused, original:', originalNotation);
  }

  /**
   * Handle keyboard events on cell name display
   */
  function handleCellNameKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCellName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revertCellName();
    }
  }

  /**
   * Check if a string is a valid range notation (e.g., "A1:B2")
   * @param {string} str - String to check
   * @returns {boolean} True if valid range notation
   */
  function isValidRangeNotation(str) {
    if (!str || typeof str !== 'string') return false;

    const parts = str.split(':');
    if (parts.length !== 2) return false;

    // Both parts must be valid cell references
    return isCellReference(parts[0]) && isCellReference(parts[1]);
  }

  /**
   * Commit the cell name (create named range or navigate)
   */
  function commitCellName() {
    const newValue = cellNameDisplay.value.trim();
    const inFormulaEditingMode = isEditingFormula();

    // If unchanged, just blur and return focus
    if (newValue === originalNotation) {
      cellNameDisplay.blur();
      // If in formula editing mode, return to formula bar; otherwise focus grid
      if (inFormulaEditingMode) {
        focus('end'); // Focus formula bar input with cursor at end
      } else {
        focusActiveCell();
      }
      return;
    }

    // Check if it looks like a cell reference or range notation using proper validation
    // This prevents false positives like "ARRAY1" being treated as a cell reference
    const isCell = isCellReference(newValue);
    const isRange = isValidRangeNotation(newValue);

    if (isCell || isRange) {
      cellNameDisplay.blur();
      // If in formula editing mode, return to formula bar; otherwise focus grid
      if (inFormulaEditingMode) {
        focus('end');
      } else {
        focusActiveCell();
      }
      return;
    }

    // Otherwise treat as naming the current selection
    if (currentNotation) {
      // If this selection already has a named range, rename it; otherwise create a new one
      const result = currentRangeName && renameNamedRange
        ? renameNamedRange(currentRangeName, newValue)
        : createNamedRange(newValue, currentNotation);

      if (result.success) {
        console.log(`[FormulaBar] ${currentRangeName ? 'Renamed' : 'Created'} named range:`, result.name);
        // Update display (this will show the name and the delete button)
        updateCellNameDisplay(currentNotation);
      } else {
        console.error(`[FormulaBar] Failed to ${currentRangeName ? 'rename' : 'create'} named range:`, result.error);
        alert(`Cannot ${currentRangeName ? 'rename' : 'create'} named range: ${result.error}`);
        cellNameDisplay.value = originalNotation;
      }
    }

    cellNameDisplay.blur();
    // If in formula editing mode, return to formula bar; otherwise focus grid
    if (inFormulaEditingMode) {
      focus('end'); // Return to formula input to continue editing
    } else {
      focusActiveCell();
    }
  }

  /**
   * Revert cell name to original value
   */
  function revertCellName() {
    const inFormulaEditingMode = isEditingFormula();
    console.log('[FormulaBar] Reverting cell name to:', originalNotation);
    cellNameDisplay.value = originalNotation;
    cellNameDisplay.blur();
    // If in formula editing mode, return to formula bar; otherwise focus grid
    if (inFormulaEditingMode) {
      focus('end');
    } else {
      focusActiveCell();
    }
  }

  // ============================================================================
  // KEYBOARD HANDLING
  // ============================================================================

  /**
   * Commit the current cell's value (if any)
   * Called by Grid before switching cells, or internally before navigation
   */
  function commitCurrentCell() {
    if (currentCell) {
      onCommit(currentCell, input.value);
    }
  }

  /**
   * Exit editing mode and move in a direction (or stay if at boundary)
   * Commit happens automatically via blur handler when focus leaves FormulaBar
   * @param {string} direction - "up", "down", "left", "right"
   */
  function exitEditingAndMove(direction) {
    // Exit formula editing mode
    _setFormulaEditingMode(false);

    // Move to next cell (blur handler commits automatically)
    const moved = moveActiveCell(direction);
    if (!moved) {
      // At boundary - still need to exit editing mode and return focus to grid
      focusActiveCell();
    }
  }

  /**
   * Handle keyboard events
   */
  function handleKeyDown(e) {
    console.log('[FormulaBar] handleKeyDown triggered, key:', e.key, 'target:', e.target);

    // Arrow keys in formula editing mode - enter/navigate reference mode
    const arrowKeys = {
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right'
    };

    if (arrowKeys[e.key]) {
      // Check if there's an active selection (user has highlighted text)
      const hasSelection = input.selectionStart !== input.selectionEnd;

      // Formula editing mode - arrows at edges navigate selection in grid for reference picking
      if (formulaEditingMode && (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        (e.key === 'ArrowRight' && !hasSelection && input.selectionStart === input.value.length) ||
        (e.key === 'ArrowLeft' && !hasSelection && input.value === '=')
      )) {
        e.preventDefault();
        const direction = arrowKeys[e.key];

        console.log('[FormulaBar] Formula editing mode - navigating grid selection:', direction);

        // Exit to grid and start moving the selection
        focusActiveCell();
        stepSelectionAnchor(direction);
        return;
      }

      // Normal mode - navigate cells when: Up/Down always, or Left/Right at edges
      const direction = arrowKeys[e.key];

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
          (e.key === 'ArrowRight' && !hasSelection && input.selectionStart === input.value.length) ||
          (e.key === 'ArrowLeft' && !hasSelection && input.selectionStart === 0)) {
        e.preventDefault();
        exitEditingAndMove(direction);
        return;
      }

      // Left/Right when not at edge or has selection - let default behavior happen (cursor movement in text)
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift+Enter moves up, Enter moves down
      const direction = e.shiftKey ? 'up' : 'down';
      exitEditingAndMove(direction);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Shift+Tab moves left, Tab moves right
      const direction = e.shiftKey ? 'left' : 'right';
      exitEditingAndMove(direction);
    } else if (e.key === 'Escape') {
      e.preventDefault();
        revertValue();
      
    }
  }

  // ============================================================================
  // INPUT HANDLING
  // ============================================================================

  /**
   * Handle click event - if disabled, notify orchestrator to redirect
   */
  function handleClick() {
    if (input.disabled && onDisabledClick) {
      onDisabledClick();
    }
  }

  function handleFocus() {
    console.log('[FormulaBar] Focused');

    // Always collapse selection to active cell when formula bar gains focus
    collapseToActiveCell();

    // Update formula editing mode based on current value
    updateFormulaEditingMode();
  }

  /**
   * Handle blur event - commit value or save reference picking session
   */
  function handleBlur(e) {
    const losingFocusToGridCell = e.relatedTarget?.getAttribute('role') === 'gridcell';

    if (formulaEditingMode && losingFocusToGridCell) {
      // Entering reference picking mode - save session state, don't commit
      console.log('[FormulaBar] Blur to Grid during formula editing - saving picking session');
      savedValueBeforePicking = input.value;
      saveSelectionPosition();
    } else {
      // Done editing - commit the value
      console.log('[FormulaBar] Blur - committing value');
      commitCurrentCell();
    }
  }

  /**
   * Handle input detected from grid (called when user types in a cell)
   */
  function handleInputFromGrid(inputText) {
    console.log(`[FormulaBar] Input from grid: "${inputText}"`);

    // Auto-promote any preview to active before processing input
    if (commitUnhandledPointers) {
      commitUnhandledPointers();
    }

    if (isEditingFormula()) {
      // Currently picking references - insert at saved cursor position
      const currentValue = input.value;

      if (referenceEnd !== null) {
        // Insert at end of last reference/cursor position
        input.value =
          currentValue.substring(0, referenceEnd) +
          inputText +
          currentValue.substring(referenceEnd);

        // Update position to after the inserted text
        referenceEnd = referenceEnd + inputText.length;
        referenceStart = referenceEnd;
      } else {
        // Fallback: append to end
        input.value = currentValue + inputText;
      }

      // Update revert point to current value (so Delete/Backspace only removes the next reference)
      savedValueBeforePicking = input.value;
    } else {
      // Normal mode - replace value with input and focus formula bar
      input.value = inputText;
      focus();
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
        loadValue,
        isCellEditable,
        onDisabledClick,
        onCommit,
        focusActiveCell,
        collapseToActiveCell,
        stepSelectionAnchor,
        moveActiveCell,
        lookupRangeName,
        createNamedRange,
        renameNamedRange,
        deleteNamedRange,
        commitUnhandledPointers
      } = deps);
      console.log('[FormulaBar] Initialized');
    },

    mount,
    unmount,
    loadCell,
    getValue,
    getCurrentCell,
    focus,
    setValue,
    updateCellNameDisplay,
    insertReference,

    // Commit
    commitCurrentCell,

    // Formula editing mode
    isEditingFormula,

    // Reference picking
    revertReferencePicking,

    // Input handling
    handleInputFromGrid,
  };
}
