# Grid & Formula Bar: Architecture and Interaction Reference

This document comprehensively describes the Grid and Formula Bar components, their internal states, event handlers, and how they coordinate to provide cell editing, navigation, and formula reference picking.

**Source files:**
- `src/components/grid.js` - Grid component (1,680 lines)
- `src/components/formula-bar.js` - Formula Bar component (737 lines)
- `src/orchestrators/shared/orchestrator-shared.js` - Wiring via `createBaseGridConfig()` and `createBaseFormulaBarConfig()`

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Grid: Internal State](#2-grid-internal-state)
3. [Formula Bar: Internal State](#3-formula-bar-internal-state)
4. [System States (Combined)](#4-system-states-combined)
5. [Grid Event Handlers](#5-grid-event-handlers)
6. [Formula Bar Event Handlers](#6-formula-bar-event-handlers)
7. [Dependency Injection Wiring](#7-dependency-injection-wiring)
8. [State Transitions](#8-state-transitions)
9. [Key Interaction Flows](#9-key-interaction-flows)

---

## 1. Architectural Overview

The Grid and Formula Bar are **separate factory-pattern components** that communicate exclusively through **injected callback dependencies**. Neither imports nor directly references the other. The orchestrator wires them together at initialization time.

```
                    Orchestrator (wiring)
                   /                     \
            Grid                    Formula Bar
         (cell grid,              (text input,
          selection,               value editing,
          input detection)         reference picking)
              |                         |
              +---- injected deps ------+
              |    (callbacks only)     |
              v                         v
       CanonicalValuesEngine     CalculationEngine
       (source of truth)         (computed values)
              |
              v
       FormattingEngine
       (display values)
```

**Key design principles:**
- Grid owns **selection state** (activeCell, selectionRange, selectionAnchor)
- Formula Bar owns **editing state** (currentCell, formulaEditingMode, reference picking state)
- Neither component directly mutates the other's state -- all cross-component effects go through callbacks
- Grid cells are `contenteditable` but are kept empty; all actual editing happens in the Formula Bar's `<input>` element
- The Grid intercepts typed characters and routes them to the Formula Bar

### Focus as implicit state

The system uses **browser focus** as the primary mechanism for managing interaction complexity. Most event handlers don't need to check what "mode" the system is in, because they only receive events when their element has focus:

- Grid keydown handlers only fire when a grid cell is focused (grid navigation or reference picking)
- Formula bar keydown handlers only fire when the formula bar input is focused (text editing)
- Blur/focus handlers on the formula bar naturally detect transitions between editing and picking

This means the system avoids maintaining an explicit mode flag for "which component is active" -- focus position *is* that state. The one exception is `formulaEditingMode`, which persists across focus changes (it stays `true` when focus moves from formula bar to grid during reference picking). This is necessary because both components need to know whether the user is editing a formula, regardless of which one currently has focus.

Where this gets interesting is `_updateSelectionState` (see [Section 2.1](#21-selection-state)) -- it's called from both focus contexts and needs a runtime `document.activeElement` check to determine whether selection changes should insert references. Every other handler can rely on the fact that it only runs in the right focus context.

---

## 2. Grid: Internal State

### 2.1 Selection State

```
activeCell: string          // Currently focused cell key (e.g., "A1")
selectionRange: {           // Currently selected range
  start: string,            //   Top-left cell
  end: string               //   Bottom-right cell
}
selectionAnchor: string     // Anchor for shift-extending selections
currentlyHighlightedElements: Element[]  // Cached DOM elements for efficient clearing
```

All selection mutations go through `_updateSelectionState(newRange, newAnchor)`, which:
1. Updates `selectionRange` and `selectionAnchor`
2. Calls `highlightSelection()` to apply CSS classes
3. Checks if in reference-picking mode (formula editing + focus on gridcell):
   - **Yes:** calls `insertReference(notation)` and `updateCellNameDisplay(activeCell)`
   - **No:** calls `updateCellNameDisplay(selectionNotation)`

**Why the reference-picking side effect lives here:** The alternative is pulling it out and making every caller (`setSelection`, `extendSelection`, `stepSelectionAnchor`, `collapseToActiveCell`, etc.) responsible for calling `insertReference` when appropriate. Centralizing it in `_updateSelectionState` means no selection-mutation path can forget to update the formula during reference picking -- at the cost of needing a `document.activeElement` check to determine context, since this function is called from both grid-focused and formula-bar-focused code paths. The check works because focus events settle synchronously before selection updates run in all current code paths.

### 2.2 Pointer/Interaction State

```
isDragging: boolean                     // Currently in drag-selection mode
dragStartCell: string | null            // Cell where drag started
activePointers: Map<pointerId, {       // Multi-pointer tracking
  startX, startY,                       //   Initial position (threshold check)
  lastX, lastY,                         //   Current position (scroll deltas)
  cellKey: string,                      //   Cell under pointer at start
  shiftKey: boolean                     //   Shift held at start
}>
handledPointers: Set<pointerId>         // Pointers that committed via drag/scroll
previewedCells: Set<string>             // Cells with preview highlighting
scrollCentroidContent: {x, y} | null    // Content point pinned to centroid during two-finger scroll
```

### 2.3 Double-Click Detection

```
lastClickTime: number       // Timestamp of last pointerdown
lastClickCell: string       // Cell key of last pointerdown
DOUBLE_CLICK_THRESHOLD: 300 // ms window for double-click detection
```

### 2.4 Grid Bounds

```
gridBounds: {
  maxCol: string,    // Rightmost column letter (default: 'O')
  maxRow: number     // Bottom row number (default: 30)
}
```

### 2.5 Visual CSS Classes

| Class | Applied By | Meaning |
|-------|-----------|---------|
| `.active-cell` | `highlightActiveCell()` | The single focused cell |
| `.selected-cell` | `highlightSelection()` | All cells in the selection range |
| `.preview-cell` | `addPreviewHighlight()` | Uncommitted pointer preview |
| `.cell-marked-for-cut` | `markCellsAsCut()` | Cells in the cut clipboard |

---

## 3. Formula Bar: Internal State

### 3.1 Cell State

```
currentCell: string | null       // Cell key currently loaded for editing
originalValue: string | null     // Value snapshot when cell loaded (for Escape revert)
currentNotation: string | null   // Current selection notation (for naming ranges)
originalNotation: string | null  // Notation saved when cell name input is focused
currentRangeName: string | null  // Named range displayed (null if showing notation)
```

### 3.2 Formula Editing Mode

```
formulaEditingMode: boolean      // true when input.value starts with '='
```

Updated by `updateFormulaEditingMode()`, which is called:
- On `handleFocus()` -- when formula bar gains focus
- On `handleInputEvent()` -- after each normal input event
- On `loadCell()` -- if formula bar is already focused

### 3.3 Reference Picking State

```
referenceStart: number | null           // Cursor position where reference insertion begins
referenceEnd: number | null             // Current end of the inserted reference text
savedValueBeforePicking: string | null  // Complete formula value saved when entering picking mode
```

---

## 4. System States (Combined)

The Grid and Formula Bar together form a system with these composite states:

### State 1: Grid Navigation (idle)

```
Focus:              Grid cell
formulaEditingMode: false
Pointer state:      No active pointers
```

The user can click cells, use arrow keys, and type. Arrow keys navigate cells. Typing routes to Formula Bar.

### State 2: Formula Bar Editing (non-formula)

```
Focus:              Formula Bar input
formulaEditingMode: false
```

The user is editing a plain value. Arrow keys at text edges exit editing and navigate. Enter/Tab commit and move.

### State 3: Formula Bar Editing (formula)

```
Focus:              Formula Bar input
formulaEditingMode: true
```

The user is editing a formula (value starts with `=`). Up/Down arrows and Left/Right at edges **exit to reference picking** instead of navigating cells.

### State 4: Reference Picking

```
Focus:              Grid cell
formulaEditingMode: true
savedValueBeforePicking: <saved formula text>
referenceStart/End: <saved cursor positions>
```

The user is selecting cells to insert as references into the formula. Arrow keys/clicks update the selection and insert references into the formula bar. Typing inserts characters at the reference position. Escape reverts to saved value.

Entry is gated: both arrow-key presses and mouse clicks on grid cells only transition into this state if the formula-bar caret is at a syntactically valid insertion point (see §6.2). Otherwise the attempted entry falls through to commit-and-navigate instead.

### State 5: Pointer Preview (transient)

```
Focus:              Grid cell (or previous focus)
activePointers:     Has entries
handledPointers:    Does NOT have those entries
previewedCells:     Non-empty
```

A pointerdown has occurred but hasn't committed (no movement past threshold, no pointerup yet). The cell has a preview highlight but is not selected.

**Why preview before commit:** If pointerdown immediately selected the cell, then starting a two-finger scroll would always select whichever cell the first finger touched. The delayed commit lets the system wait for more information (movement, second pointer, or pointerup) before deciding what the user intended.

This state resolves to:
- **Simple tap** (pointerup without movement) -- commits as cell selection
- **Drag selection** (movement past 5px threshold, 1 pointer) -- enters drag mode
- **Two-finger scroll** (movement past 5px threshold, 2+ pointers) -- enters scroll mode
- **Auto-promote** (user types before pointerup) -- `commitUnhandledPointers()` promotes preview to selection so input goes to the right cell

### State 6: Drag Selection

```
Focus:              Grid cell
isDragging:         true
dragStartCell:      <cell key>
```

The user is dragging to select a range. pointermove extends the selection. Behavior depends on `formulaEditingMode`:
- Normal mode: sets active cell and extends selection
- Formula mode: picks references

### State 7: Two-Finger Scroll

```
activePointers:     2+ entries
scrollCentroidContent: {x, y}
```

The user is scrolling the grid with two fingers. The content point under the centroid is pinned as fingers move.

### State 8: Column Name Editing

```
Focus:              Inline <input> inside a column header <th>
```

The user double-clicked a column header and is editing its name. Grid keydown handler returns early when `e.target.classList.contains('column-name-input')`.

### State 9: Cell Name Editing

```
Focus:              Cell name display input (top-left of formula bar)
originalNotation:   <saved>
```

The user clicked the cell name display and is typing a named range or cell reference. Enter commits, Escape reverts.

### State 10: Disabled Input (loop sheets only)

```
input.disabled:     true
disabledOverlay:    visible
```

The cell is in a non-editable row (loop sheet generated rows). Clicking the overlay triggers `onDisabledClick` which redirects to the editable equivalent row.

---

## 5. Grid Event Handlers

All handlers are attached to `gridContainer` (the `<table>` element) via event delegation.

### 5.1 Pointer Events

| Event | Handler | Trigger Condition | Behavior |
|-------|---------|------------------|----------|
| `pointerdown` | `handlePointerDown` | Primary button on a gridcell | Tracks pointer, checks for double-click, adds preview highlight |
| `pointermove` | `handlePointerMove` | Tracked pointer moves | Checks movement threshold; commits to drag or scroll mode |
| `pointerup` | `handlePointerUp` | Tracked pointer released | If unhandled: commits as simple tap. Cleanup. |
| `pointercancel` | `handlePointerCancel` | Pointer interrupted | Cleanup without commit |
| `pointerenter` | `handlePointerEnter` | Pointer enters grid | If dragging but no buttons pressed, ends drag (mouse released outside window) |

**Double-click handling** (inside `handlePointerDown`):
- Detected when same cell clicked within 300ms
- If in formula editing mode: reverts reference picking and commits
- Sets active cell, focuses formula bar
- Marks pointer as handled (skips pointerup)

**Movement threshold** (inside `handlePointerMove`):
- 5px from initial position before committing
- 1 pointer: enters drag selection mode
- 2+ pointers: enters two-finger scroll mode

### 5.2 Keyboard Events

`handleKeyDown` on `gridContainer`:

|           Key         |  Modifier   | In Formula Editing? | Action |
|-----------------------|-------------|-------------------  |--------|
| `Ctrl+B`              | Ctrl        | any                 | Apply bold |
| `Ctrl+I`              | Ctrl        | any                 | Apply italic |
| `Ctrl+L`              | Ctrl        | any                 | Align left |
| `Ctrl+E`              | Ctrl        | any                 | Align center |
| `Ctrl+R`              | Ctrl        | any                 | Align right |
| `Ctrl+Z`              | Ctrl        | any                 | Undo |
| `Ctrl+Shift+Z`        | Ctrl+Shift  | any                 | Redo |
| `Ctrl+Y`              | Ctrl        | any                 | Redo |
| `Ctrl+D`              | Ctrl        | any                 | Drilldown into custom function |
| `Delete`/ `Backspace` | --          | **yes**             | Revert reference picking |
| `Delete`/ `Backspace` | --          | **no**              | Clear selected cells |
| `Escape`              | --          | **yes**             | Clear pointer state, revert reference picking |
| `Escape`              | --          | **no**              | Clear pointer state, cancel cut |
| `Enter`               | --          | **yes**             | Focus formula bar (cursor preserved) |
| `Enter`               | --          | **no**              | Focus formula bar (select-all mode) |
| `F2`                  | --          | any                 | Focus formula bar (cursor at end) |
| `Home`                | --          | any                 | Go to column A of current row |
| `Ctrl+Home`           | Ctrl        | any                 | Go to A1 |
| `Shift+Home`          | Shift       | any                 | Extend selection to column A |
| `Tab`                 | --          | **yes**             | `stepSelectionAnchor('right')` |
| `Tab`                 | --          | **no**              | `moveActiveCell('right')` |
| `Shift+Tab`           | Shift       | **yes**             | `stepSelectionAnchor('left')` |
| `Shift+Tab`           | Shift       | **no**              | `moveActiveCell('left')` |
| Arrow keys            | --          | **yes**             | `stepSelectionAnchor(direction)` |
| Arrow keys            | --          | **no**              | `moveActiveCell(direction)` |
| Arrow keys            | Shift       | any                 | `extendSelectionInDirection(direction)` |

**Note:** The handler returns early if `e.target` has class `column-name-input` (inline column name editing).

### 5.3 Input Routing (Three-Layer Detection)

Grid cells are `contenteditable="plaintext-only"` so they can receive focus and keyboard input, but they are never the actual editor -- all editing happens in the Formula Bar's `<input>`. Characters are intercepted and routed via three layers, each catching cases the previous one can't:

| Layer | Event | Priority | When It Fires | Action |
|-------|-------|----------|--------------|--------|
| Layer | Event | When It Fires | Action |
|-------|-------|--------------|--------|
| 1 | `beforeinput` | Cancelable input (most typing) | `preventDefault()` stops character from appearing in cell, routes `e.data` to `onInputDetected()` |
| 2 | `input` | Non-cancelable input (fallback for inputs layer 1 couldn't prevent) | Reads `cellElement.textContent`, routes it, clears cell. Skips `isComposing` events (those are partial IME -- layer 3 handles the final result). |
| 3 | `compositionend` | IME composition finalized | Reads composed text from cell, routes it, clears cell |

All three ultimately call `onInputDetected(text)` which maps to `formulaBar.handleInputFromGrid(text)`. Layer 1 handles the common case cleanly (character never appears in cell). Layer 2 catches edge cases where `beforeinput` isn't cancelable. Layer 3 handles IME input where partial compositions must be ignored until the user confirms.

### 5.4 Clipboard Events

| Event | Handler | Action |
|-------|---------|--------|
| `copy` | `handleCopy` | `preventDefault()`, calls `onCopyOrCut(false)` |
| `cut` | `handleCut` | `preventDefault()`, calls `onCopyOrCut(true)` |
| `paste` | `handlePaste` | `preventDefault()`, calls `onPaste(clipboardText)` |

### 5.5 Column Header Events

| Event | Handler | Action |
|-------|---------|--------|
| `dblclick` | `handleColumnHeaderDblClick` | Opens inline editor if target is `.grid-column-header` (not `_`-prefixed) |

### 5.6 Other

| Event | Handler | Action |
|-------|---------|--------|
| `selectstart` | `handleSelectStart` | `preventDefault()` if dragging (prevents text selection during drag) |
| `click` on add-col button | `handleAddColumn` | Adds 1 column (or 5 with Shift) |
| `click` on add-row button | `handleAddRow` | Adds 1 row (or 5 with Shift) |

---

## 6. Formula Bar Event Handlers

All handlers are attached directly to formula bar DOM elements during `mount()`.

### 6.1 Input Field Events

| Event | Handler | Trigger Condition | Action |
|-------|---------|------------------|--------|
| `beforeinput` | `handleBeforeInputEvent` | User about to type | Commits unhandled pointers; if a preview was committed, `preventDefault()` and routes through `handleInputFromGrid()` |
| `input` | `handleInputEvent` | Character inserted normally | Calls `updateFormulaEditingMode()` to check if value now starts with `=` |
| `keydown` | `handleKeyDown` | Key pressed while input focused | Arrow navigation, Enter, Tab, Escape handling (see table below) |
| `focus` | `handleFocus` | Input gains focus | Collapses grid selection to active cell; updates formula editing mode |
| `blur` | `handleBlur` | Input loses focus | **If formula mode + losing to gridcell + caret is at a picking-valid position:** saves picking session (no commit). **Otherwise:** clears formula editing mode and commits value. See §8.3. |

### 6.2 Formula Bar `handleKeyDown` Detail

Arrow keys only exit the formula bar at an **edge**; everywhere else they're regular cursor movement.

**Edge definition** (same check for both picking and commit-and-navigate):

| Key | Edge condition |
|-----|---------------|
| `ArrowUp` / `ArrowDown` | any position |
| `ArrowRight` | at text end, no selection |
| `ArrowLeft` | at text start OR value is exactly `=`, no selection |

ArrowLeft's `value === '='` clause preserves "just typed `=`, press Left to start picking a cell to the left" — without it, Left would be useless for picking.

**At an edge**, in formula mode, picking is attempted first via `getReferencePickingSpan(caret, tokens)`:

1. **Selection present** — selection's start sits at a token boundary (not strictly inside any token) AND the non-whitespace token ending at/before that position is one of: `EQUALS`, `OP`, `COMPARE`, `COMMA`, `COLON`, `LPAREN`, `LBRACE`. Bounds = selection; first pick replaces the selected text.
2. **Caret strictly inside a replaceable ref token** (CELL_REF, or IDENT that resolves to a named range / named input) — bounds expand to the whole token; first pick replaces the existing reference.
3. **Caret at a boundary** — the non-whitespace token ending at/before the caret is in the allow-list above. Bounds = `{caret, caret}` (insert).

**Arrow-key flow unifies with mouse-click flow through blur**: `handleKeyDown` stages the caret in `pendingCaret`, calls `focusActiveCell()` (which synchronously fires blur → `tryStartPickingSession`), then branches on `formulaEditingMode` — if blur started a picking session (mode still `true`), calls `stepSelectionAnchor(direction)`; if blur committed and cleared the mode, calls `moveActiveCell(direction)`. The "should this be picking?" decision lives in one place (`tryStartPickingSession`), shared with mouse-click entry. The caret is staged because programmatic `.focus()` can move `window.getSelection()` off the input before blur runs, making live caret reads unreliable there.

So in `=A1+B2`, pressing Up with the caret right after `B2` commits and navigates up. To pick a replacement for `A1` / `B2`, put the caret *inside* the token — bounds auto-expand to the whole token.

**Mouse-click entry into picking** (user clicks a grid cell while the formula bar has focus) goes through the same `saveSelectionPosition` helper, which also auto-expands to the containing ref token if the caret sits inside one. So clicking away while mid-token replaces that token.
| `Enter` | any | `exitEditingAndMove('down')` (or `'up'` with Shift) |
| `Tab` | any | `exitEditingAndMove('right')` (or `'left'` with Shift) |
| `Escape` | any | `revertValue()` -- restores `originalValue`, exits formula mode, returns focus to grid |

**`exitEditingAndMove(direction)`** does:
1. `_setFormulaEditingMode(false)`
2. `moveActiveCell(direction)` -- which shifts focus to the new grid cell, triggering formula bar blur, which triggers commit
3. If at boundary (can't move), calls `focusActiveCell()` instead

Commit is intentionally implicit here -- the formula bar's `handleBlur` is the single commit path for normal editing. This means no exit path can forget to commit, because any focus change away from the formula bar triggers it. The one exception is double-click during reference picking, which calls `commitFormulaBarCell()` explicitly because the timing of blur relative to the revert/setActiveCell sequence isn't guaranteed.

### 6.3 Cell Name Display Events

| Event | Handler | Action |
|-------|---------|--------|
| `focus` on cell name | `handleCellNameFocus` | Saves `originalNotation`, selects all text |
| `keydown` on cell name | `handleCellNameKeyDown` | Enter: `commitCellName()`. Escape: `revertCellName()` |
| `click` on delete button | `handleDeleteRangeName` | Calls `deleteNamedRange()`, updates display |

### 6.4 Disabled Overlay Event

| Event | Handler | Action |
|-------|---------|--------|
| `click` on overlay | `handleClick` | If input disabled and `onDisabledClick` set, calls it (loop sheet redirect) |

---

## 7. Dependency Injection Wiring

### 7.1 Grid receives (from orchestrator via `createBaseGridConfig`):

| Dependency | Source | Purpose |
|-----------|--------|---------|
| `getCellDisplay(cellKey)` | formattingEngine | Get display text + styles for rendering |
| `onClearCells()` | centralFunctions | Clear selected cells on Delete/Backspace |
| `onInputDetected(text)` | adapter → `formulaBar.handleInputFromGrid` | Route typed characters to formula bar |
| `isFormulaEditingMode()` | `formulaBar.isEditingFormula()` | Check if arrow keys should pick references |
| `revertReferencePicking()` | `formulaBar.revertReferencePicking()` | Cancel reference picking on Delete/Escape |
| `insertReference(notation)` | `formulaBar.insertReference()` | Insert cell reference into formula |
| `focusFormulaBar(cursorMode)` | adapter | Focus formula bar input |
| `loadCellInFormulaBar(cellKey)` | `formulaBar.loadCell()` | Load cell value when active cell changes |
| `updateCellNameDisplay(notation)` | `formulaBar.updateCellNameDisplay()` | Update cell name label |
| `commitFormulaBarCell()` | `formulaBar.commitCurrentCell()` | Force-commit pending edits |
| `applyBold/Italic/alignLeft/Center/Right()` | formattingEngine | Formatting shortcuts |
| `onCopyOrCut(isCut)` | clipboardEngine | Clipboard operations |
| `onPaste(text)` | clipboardEngine | Paste operation |
| `cancelCut()` | clipboardEngine | Cancel cut state on Escape |
| `onUndo()` / `onRedo()` | centralFunctions | History operations |
| `onDrilldown(cellKey)` | orchestrator | Open custom function in new tab |

### 7.2 Formula Bar receives (from orchestrator via `createBaseFormulaBarConfig`):

| Dependency | Source | Purpose |
|-----------|--------|---------|
| `loadValue(cellKey)` | `canonicalValuesEngine.getValue()` | Get raw canonical value for editing |
| `isCellEditable(cellKey)` | optional (loop sheets) | Check if cell can be edited |
| `onDisabledClick()` | optional (loop sheets) | Handle click on disabled input |
| `onCommit(cellKey, rawValue)` | adapter → `canonicalValuesEngine.setValue()` | Save edited value |
| `focusActiveCell()` | `grid.focusActiveCell()` | Return focus to grid |
| `collapseToActiveCell()` | `grid.collapseToActiveCell()` | Collapse selection to single cell |
| `stepSelectionAnchor(direction)` | `grid.stepSelectionAnchor()` | Move reference picking selection |
| `moveActiveCell(direction)` | `grid.moveActiveCell()` | Navigate to adjacent cell |
| `lookupRangeName(notation)` | `canonicalValuesEngine.lookupRangeName()` | Check if notation is a named range |
| `isNamedReference(name)` | `canonicalValuesEngine.resolveNamedRange()` + `getAllNamedInputs()` | Check if an IDENT token is a named range or named input (determines whether cursor-inside-IDENT replaces the token) |
| `createNamedRange(name, notation)` | `canonicalValuesEngine.createNamedRange()` | Create named range from cell name input |
| `deleteNamedRange(name)` | `canonicalValuesEngine.deleteNamedRange()` | Delete named range |
| `commitUnhandledPointers()` | `grid.commitUnhandledPointers()` | Auto-promote pointer preview before processing input |

---

## 8. State Transitions

### 8.1 Navigation ↔ Editing

```
┌─────────────────────┐
│  Grid Navigation     │ ◄─── Escape (revertValue)
│  (focus: grid cell)  │ ◄─── Arrow/Enter/Tab at boundary (exitEditingAndMove)
│  formulaEditingMode: │ ◄─── Arrow/Enter/Tab (exitEditingAndMove + blur commits)
│  false               │
└──────────┬───────────┘
           │
           │ Enter ──────────────────────► focusFormulaBar('select-all')
           │ F2 ─────────────────────────► focusFormulaBar()
           │ Double-click ───────────────► setActiveCell + focusFormulaBar()
           │ Type character ─────────────► onInputDetected → handleInputFromGrid
           │                                (sets input.value, calls focus())
           │
           ▼
┌─────────────────────┐
│  Formula Bar Editing │
│  (focus: input)      │
│  formulaEditingMode: │──── if value starts with '=' ───► true
│  false or true       │──── otherwise ─────────────────► false
└──────────┬───────────┘
           │
           │ (Only when formulaEditingMode = true)
           │ ArrowUp/Down ──────────────► focusActiveCell + stepSelectionAnchor
           │ ArrowRight at end ─────────► focusActiveCell + stepSelectionAnchor
           │ ArrowLeft when value="=" ──► focusActiveCell + stepSelectionAnchor
           │
           ▼
┌─────────────────────┐
│  Reference Picking   │ ◄─── Click on grid cell during formula editing
│  (focus: grid cell)  │      (handleBlur saves picking session)
│  formulaEditingMode: │
│  true                │
│  savedValueBefore-   │
│  Picking: <saved>    │
└──────────┬───────────┘
           │
           │ Arrow keys ────────────────► stepSelectionAnchor → _updateSelectionState
           │                               → insertReference (updates formula)
           │ Shift+Arrow ───────────────► extendSelectionInDirection
           │                               → insertReference (range notation)
           │ Click cell ────────────────► setSelection → insertReference
           │ Type character ────────────► onInputDetected → handleInputFromGrid
           │                               (inserts at referenceEnd position)
           │
           │ Delete/Backspace/Escape ──► revertReferencePicking
           │                              (restores savedValueBeforePicking, focuses input)
           │
           │ Enter ────────────────────► focusFormulaBar → handleFocus
           │                              → back to "Formula Bar Editing"
           │ Double-click ─────────────► revertReferencePicking + commitFormulaBarCell
           │                              → setActiveCell + focusFormulaBar
           └───────────────────────────────────────────────────────────────────────
```

### 8.2 Pointer State Machine

```
[No Active Pointers]
     │
     │ pointerdown (primary button on gridcell)
     │
     ▼
[Preview] ──── double-click detected? ──── YES ──► [Handled]
     │                                              (setActiveCell + focusFormulaBar)
     │ NO
     │
     ├─── pointermove (>5px, 1 pointer) ──────────► [Drag Selection]
     │                                               isDragging = true
     │                                               pointermove: extendSelection()
     │
     ├─── pointermove (>5px, 2+ pointers) ────────► [Two-Finger Scroll]
     │                                               scrollCentroidContent set
     │                                               pointermove: scroll container
     │
     ├─── pointerup (no movement) ────────────────► [Simple Tap]
     │                                               Normal: setActiveCell()
     │                                               Formula: setSelection()
     │
     ├─── beforeinput (user types) ───────────────► commitUnhandledPointers()
     │                                               auto-promotes preview
     │
     └─── pointercancel ──────────────────────────► cleanup, no commit
```

### 8.3 Blur Decision Tree (Formula Bar)

When the formula bar loses focus, it must decide: is this blur part of the editing flow (reference picking), or is the user leaving?

The only case where blur is part of editing is: `formulaEditingMode` is true AND focus is moving to a grid cell (the user is clicking/arrowing to pick a reference). Every other blur means the user has moved on -- clicked a panel, the toolbar, or somewhere else entirely. In that case the system **commits whatever is in the input**, even if the formula might be incomplete. This is the right default because:
- The user chose to leave the editing context
- Reverting would silently destroy their work, which is worse than saving a partial formula
- The formula might actually be finished -- there's no way to know
- The user can undo if the commit was unwanted

The `relatedTarget` check (`e.relatedTarget?.getAttribute('role') === 'gridcell'`) detects the one case where blur should be treated as "still editing." If `relatedTarget` is null (focus went somewhere unknown), the system falls through to commit, which is the safe default.

```
handleBlur fires
     │
     ├─── formulaEditingMode == true
     │    AND relatedTarget.role == 'gridcell'?
     │         │
     │         YES ──► tryStartPickingSession()
     │         │        │ (reads caret from pendingCaret if staged by handleKeyDown,
     │         │        │  else from window.getSelection())
     │         │        │
     │         │        ├── getReferencePickingSpan returns a span?
     │         │        │    YES ──► SAVE picking session (don't commit)
     │         │        │             savedValueBeforePicking = input.value
     │         │        │             referenceStart/End = span
     │         │        │             return
     │         │        │
     │         │        └── NO ──► fall through to commit below
     │         │
     │         NO ───► fall through to commit below
     │
     └─── COMMIT
            _setFormulaEditingMode(false)
            commitCurrentCell() → onCommit(currentCell, input.value)
            loadCell(currentCell)  // re-render normalized value
```

**Why the reload at the end:** `onCommit` normalizes the value in the engine (casing, whitespace, etc.), but the formula bar still shows whatever the user typed. Re-calling `loadCell` pulls the canonical form back into the display. This matters most for commits that don't navigate away — shift+click extending a selection, toolbar/panel actions — where nothing else would otherwise trigger a reload.

**Why the picking-validity gate runs at blur:** the same rule that governs arrow-key entry (section 6.2) also governs mouse-click entry. If the caret is at a spot where inserting a reference would garble the formula (e.g., caret right after `B2` in `=A1+B2`, or mid-number), we commit instead. Grid's subsequent `pointerup` then sees `formulaEditingMode === false` and takes the normal-selection branch, setting the clicked cell as active — clean navigation rather than silent garbling.

**Why `_setFormulaEditingMode(false)` runs before commit:** blur and grid pointerup fire in quick succession on the same click. Clearing the mode synchronously ensures pointerup doesn't re-enter picking after we've decided to commit.

---

## 9. Key Interaction Flows

### 9.1 Click a Cell

```
1. pointerdown on cell B2
   → Track pointer, add preview highlight

2. pointerup (no movement)
   → Clear preview
   → focusCell(B2)
   → setActiveCell(B2):
     → activeCell = B2
     → _updateSelectionState({start: B2, end: B2}, B2)
       → highlightSelection()
       → updateCellNameDisplay("B2")
     → highlightActiveCell(B2)
     → focusCell(B2)
     → loadCellInFormulaBar(B2)
       → FormulaBar.loadCell("B2"):
         → currentCell = "B2"
         → originalValue = loadValue("B2")
         → input.value = originalValue
```

### 9.2 Type in a Cell

```
1. Grid cell has focus, user types "5"

2. beforeinput fires (cancelable)
   → preventDefault()
   → onInputDetected("5")
     → FormulaBar.handleInputFromGrid("5"):
       → commitUnhandledPointers()
       → isEditingFormula() == false
       → input.value = "5"
       → focus()  // focuses formula bar

3. FormulaBar.handleFocus() fires:
   → collapseToActiveCell()
   → updateFormulaEditingMode()  // "5" doesn't start with "=", mode stays false
```

### 9.3 Edit a Formula with Reference Picking

```
1. User presses Enter on cell A1 (which contains "=SUM(")
   → Grid calls focusFormulaBar('select-all')
   → Formula bar shows "=SUM(" with all text selected
   → handleFocus: formulaEditingMode = true

2. User presses End to deselect, cursor at end of "=SUM("
   User presses ArrowDown:
   → FormulaBar.handleKeyDown(ArrowDown)
   → formulaEditingMode=true, getReferencePickingSpan sees LPAREN ends at the
     caret (allow-listed) → returns {5, 5} → picking entered
   → focusActiveCell()  // focus returns to grid cell
   → stepSelectionAnchor('down')  // selection moves to A2

3. FormulaBar.handleBlur fires:
   → relatedTarget is gridcell, formulaEditingMode=true
   → savedValueBeforePicking = "=SUM("
   → saveSelectionPosition()  // referenceStart=5, referenceEnd=5

4. Grid._updateSelectionState fires (from stepSelectionAnchor):
   → isFormulaEditingMode()=true, activeElement is gridcell
   → focusCell(A2)
   → insertReference("A2")
     → input.value = "=SUM(" + "A2" + "" = "=SUM(A2"
     → referenceEnd = 7

5. User presses Shift+Down to extend to A2:A4:
   → Grid.handleKeyDown(ArrowDown+Shift)
   → extendSelectionInDirection('down')
   → _updateSelectionState → insertReference("A2:A4")
     → input.value = "=SUM(A2:A4"

6. User types ")":
   → Grid.handleBeforeInput(")")
   → onInputDetected(")")
   → FormulaBar.handleInputFromGrid(")"):
     → isEditingFormula()=true
     → insert at referenceEnd: input.value = "=SUM(A2:A4)"
     → savedValueBeforePicking = "=SUM(A2:A4)"  // update revert point

7. User presses Enter:
   → Grid.handleKeyDown(Enter)
   → inFormulaEditingMode=true
   → focusFormulaBar()  // focus returns to formula bar

8. FormulaBar.handleFocus:
   → collapseToActiveCell()
   → updateFormulaEditingMode()  // still true

9. FormulaBar receives Enter from the grid's focusFormulaBar call,
   but user's next Enter keydown goes to formula bar:
   → handleKeyDown(Enter)
   → exitEditingAndMove('down')
     → _setFormulaEditingMode(false)
     → moveActiveCell('down')  // moves to A2, triggers blur

10. FormulaBar.handleBlur:
    → formulaEditingMode=false (was just set to false)
    → commitCurrentCell()
    → onCommit("A1", "=SUM(A2:A4)")
```

### 9.4 Escape During Reference Picking

```
1. User is in reference picking mode (formula bar blurred, grid focused)
   → input.value = "=SUM(A2:A4"
   → savedValueBeforePicking = "=SUM("

2. User presses Escape in grid:
   → Grid.handleKeyDown(Escape)
   → clearAllPointerState()
   → isFormulaEditingMode()=true
   → revertReferencePicking()
     → FormulaBar.revertReferencePicking():
       → input.value = "=SUM("  // restored from savedValueBeforePicking
       → focus()  // returns focus to formula bar
```

### 9.5 Double-Click During Reference Picking

```
1. User is in reference picking mode

2. User double-clicks cell C1:
   → pointerdown detects double-click (same cell within 300ms)
   → isFormulaEditingMode()=true
   → revertReferencePicking()  // restores saved formula
   → commitFormulaBarCell()    // commits the restored formula
   → setActiveCell(C1)         // switch to new cell
   → focusFormulaBar()         // open C1 for editing
```

### 9.6 Commit via Blur (Non-Grid Target)

```
1. User is editing in formula bar
2. User clicks the panels area (or any non-gridcell element)

3. FormulaBar.handleBlur:
   → relatedTarget.role != 'gridcell' (or relatedTarget is null)
   → commitCurrentCell()
   → onCommit(currentCell, input.value)
   → canonicalValuesEngine.setValue(cellKey, value)
```

### 9.7 Auto-Promote Preview (Type Before Pointerup)

```
1. User touches cell B3 (pointerdown)
   → Preview highlight on B3

2. User types "hello" before lifting finger (beforeinput fires before pointerup)
   → Grid.handleBeforeInput("h")
   → onInputDetected("h")
   → FormulaBar.handleInputFromGrid("h"):
     → commitUnhandledPointers()
       → Finds unhandled pointer for B3
       → Clears preview, calls setActiveCell(B3)
     → input.value = "h"
     → focus()

3. pointerup fires later
   → Pointer already in handledPointers, just cleanup
```
