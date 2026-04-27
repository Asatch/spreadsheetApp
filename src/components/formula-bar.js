/*
 * FORMULA BAR
 * ===========
 *
 * Formula/value editing interface.
 * Handles text input, formula editing mode detection, and reference picking.
 *
 * Uses a contentEditable="plaintext-only" div for input, enabling the CSS
 * Custom Highlight API for syntax highlighting.
 *
 * ORGANIZATION:
 * - Dependencies (injected)
 * - Rendering State (DOM elements)
 * - ContentEditable Helpers (text/selection abstraction)
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
import { updateHighlights, updateErrorHighlights, clearErrorHighlights } from './formula-bar-highlight.js';
import { TokenType } from '../utils/formulaTokenizer.js';
import { PREVIEW_KEY } from '../Engines/canonicalValuesEngine.js';
import { createFormulaPopup, POPUP_MAX_ROWS } from './formula-popup.js';
import { getCaretClientRect, anchorRectToContainer } from '../utils/formulaBarCaret.js';

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
  let isNamedReference = null;
  let createNamedRange = null;
  let renameNamedRange = null;
  let deleteNamedRange = null;
  let commitUnhandledPointers = null;
  let onRefColorsChanged = null;
  let getErrorSpans = null;
  let previewEvaluate = null;
  let previewClear = null;
  let getNodeValue = null;
  let getNodeEntries = null;
  let getExpressionProvenance = null;

  /** Latest tokens + ref→color map produced by updateHighlights. */
  let lastTokens = null;
  let lastRefColorMap = null;

  let popup = null;

  // ============================================================================
  // RENDERING STATE (DOM elements)
  // ============================================================================

  let container = null;
  let input = null;
  let inputWrapper = null;  // Created dynamically to hold input + overlay
  let disabledOverlay = null;  // Overlay to capture clicks when input is disabled
  let previewBadge = null;  // Shows live formula result / cursor-context value
  let cellNameDisplay = null;
  let cellNameDeleteButton = null;

  // ============================================================================
  // CONTENTEDITABLE HELPERS
  // ============================================================================
  // Abstraction layer for text get/set and selection, replacing input.value
  // and input.selectionStart/End APIs.

  function getInputText() {
    return input ? (input.textContent || '') : '';
  }

  function setInputText(text) {
    if (!input) return;
    if (input.textContent === text) return;
    input.textContent = text;
    input.normalize();
    lastHighlightedText = null;
    ({ tokens: lastTokens, refColorMap: lastRefColorMap } = updateHighlights(input));
    if (onRefColorsChanged) onRefColorsChanged(lastRefColorMap);
  }

  /**
   * Get the caret/selection offsets within the input's text.
   * @returns {{start: number, end: number}}
   */
  function getCaretOffset() {
    const sel = window.getSelection();
    if (!sel || !input || sel.rangeCount === 0) return { start: 0, end: 0 };

    // Ensure the selection is within our input element
    if (!input.contains(sel.anchorNode)) return { start: 0, end: 0 };

    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(input);

    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;

    preRange.setEnd(range.endContainer, range.endOffset);
    const end = preRange.toString().length;

    return { start, end };
  }

  function setCaretOffset(start, end) {
    if (!input) return;

    const sel = window.getSelection();
    if (!sel) return;

    const textNode = input.firstChild;
    if (!textNode) return;

    const textLen = textNode.textContent.length;
    const s = Math.min(start, textLen);
    const e = Math.min(end, textLen);

    const range = document.createRange();
    range.setStart(textNode, s);
    range.setEnd(textNode, e);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function selectAll() {
    if (!input) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.selectAllChildren(input);
  }

  /**
   * Set whether the input is disabled (non-editable).
   * @param {boolean} disabled
   */
  function setInputDisabled(disabled) {
    if (!input) return;
    input.contentEditable = disabled ? 'false' : 'plaintext-only';
  }

  function isInputDisabled() {
    return input ? input.contentEditable === 'false' : false;
  }

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
   * Single point of mutation for formulaEditingMode; tears down picking/preview
   * state when leaving.
   * @private
   */
  function _setFormulaEditingMode(isEditing) {
    if (formulaEditingMode !== isEditing) {
      formulaEditingMode = isEditing;
      // Clear grid overlays, preview state, and picking state when leaving
      // formula editing mode. A picking session is always scoped within a
      // formula-editing session, so this is the single place that needs to
      // tear down referenceStart/End — otherwise a stale referenceEnd from
      // the prior session can hijack a mouse-click caret in a later cell.
      if (!isEditing) {
        if (onRefColorsChanged) onRefColorsChanged(null);
        if (previewClear) previewClear();
        if (previewBadge) previewBadge.textContent = '';
        clearErrorHighlights();
        referenceStart = null;
        referenceEnd = null;
        savedValueBeforePicking = null;
        popup.hide();
      }
    }
  }


  function isEditingFormula() {
    return formulaEditingMode;
  }

  /**
   * Assumes user is actively editing; don't call otherwise.
   */
  function updateFormulaEditingMode() {
    const newMode = input && getInputText().startsWith('=');
    _setFormulaEditingMode(newMode);
  }

  /**
   * Handle beforeinput event - commit any preview and route through handleInputFromGrid if needed
   */
  function handleBeforeInputEvent(e) {
    // Prevent newlines in contentEditable (Enter is handled in keydown)
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      return;
    }

    // Strip newlines from paste
    if (e.inputType === 'insertFromPaste' && e.data && e.data.includes('\n')) {
      e.preventDefault();
      const cleaned = e.data.replace(/[\n\r]/g, '');
      document.execCommand('insertText', false, cleaned);
      return;
    }

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
   *
   * IMPORTANT: Do not synchronously modify the DOM or selection here —
   * the browser is still settling cursor position after the input.
   * Highlighting (which needs normalize()) is deferred to the next frame.
   */
  function handleInputEvent() {
    updateFormulaEditingMode();
    scheduleHighlightUpdate();
  }

  /** @type {number|null} */
  let highlightRAF = null;

  /**
   * Format a CalcEngine node result for display in the preview badge.
   * @param {Object} node - CalcEngine node with refValue, type, errorMeta
   * @returns {{text: string, isError: boolean}}
   */
  function formatNodeForBadge(node) {
    if (!node) return { text: '', isError: false };
    if (node.errorMeta?.length) {
      const errCode = node.type === 'Error' ? node.refValue
        : typeof node.errorMeta[0] === 'string' ? node.errorMeta[0]
        : node.errorMeta[0]?.error || '#ERROR!';
      return { text: String(errCode), isError: true };
    }
    if (node.type === 'Number') return { text: String(node.refValue), isError: false };
    if (node.type === 'Boolean') return { text: node.refValue ? 'TRUE' : 'FALSE', isError: false };
    if (node.type === 'Text') return { text: `"${node.refValue}"`, isError: false };
    if (node.refValue != null) return { text: String(node.refValue), isError: false };
    return { text: '', isError: false };
  }

  /**
   * Update the preview badge with formatted result.
   * @param {string} label - Display label (e.g., "A1 = " or "= ")
   * @param {Object} node - CalcEngine node
   */
  function updatePreviewBadge(label, node) {
    if (!previewBadge) return;
    const { text, isError } = formatNodeForBadge(node);
    if (!text) {
      previewBadge.textContent = '';
      return;
    }
    previewBadge.textContent = label + text;
    previewBadge.classList.toggle('is-error', isError);
  }

  /**
   * Handle cursor position changes — update context display in the preview badge.
   * Only active when editing a formula and the formula bar is focused.
   */
  let lastContextCursorPos = -1;
  let lastContextTokens = null;
  function handleSelectionChange() {
    if (!formulaEditingMode || !input || document.activeElement !== input) return;
    if (!getNodeValue || !getExpressionProvenance) return;
    const { start } = getCaretOffset();
    const tokens = lastTokens;
    if (start === lastContextCursorPos && tokens === lastContextTokens) return;
    lastContextCursorPos = start;
    lastContextTokens = tokens;
    updateContextDisplay();
    updatePopup();
  }

  /**
   * Find what the cursor is pointing at and update the preview badge accordingly.
   * Priority: deepest sub-expression > cell reference token > overall result.
   */
  function updateContextDisplay() {
    const { start: cursorPos } = getCaretOffset();
    const tokens = lastTokens;
    if (!tokens) return;

    // cursorPos is in raw coords; provenance tokens carry rawStart/rawEnd, so
    // comparison happens in one coord system — no translation needed.

    // 1. Check sub-expressions: find deepest expression span containing cursor
    const prov = getExpressionProvenance(PREVIEW_KEY);
    if (prov) {
      const match = findDeepestSpanAtCursor(prov.expressionMap, prov.tokens, cursorPos);
      if (match) {
        const node = getNodeValue(match.key);
        if (node) {
          // Strip leading = from the expression key for display
          const label = match.key.substring(1) + ' = ';
          updatePreviewBadge(label, node);
          return;
        }
      }
    }

    // 2. Check cell reference tokens: is cursor on a CELL_REF?
    for (const token of tokens) {
      if (token.type === TokenType.CELL_REF && cursorPos >= token.start && cursorPos <= token.end) {
        const node = getNodeValue(token.value);
        if (node) {
          updatePreviewBadge(token.value + ' = ', node);
          return;
        }
      }
    }

    // 3. Fallback: overall result
    const result = getNodeValue(PREVIEW_KEY);
    updatePreviewBadge('= ', result);
  }

  /**
   * Walk the expression tree to find the deepest sub-expression span containing the cursor.
   * @param {Object} exprMap - Expression map from provenance
   * @param {Array} tokens - Token array from provenance
   * @param {number} cursorPos - Character position of cursor
   * @returns {{key: string, startChar: number, endChar: number}|null}
   */
  function findDeepestSpanAtCursor(exprMap, tokens, cursorPos) {
    let best = null;

    function walk(exprMap, tokens) {
      for (const [key, origins] of Object.entries(exprMap)) {
        if (!key.startsWith('=')) continue;

        for (const origin of origins) {
          const startChar = tokens[origin.startToken].rawStart;
          const endChar = tokens[origin.endToken - 1].rawEnd;

          if (cursorPos >= startChar && cursorPos <= endChar) {
            best = { key, startChar, endChar };

            const childProv = getExpressionProvenance(key);
            const childMap = childProv?.expressionMap;
            if (childMap && Object.keys(childMap).length > 0) {
              // Rebuild childTokens from the parent slice; indices in childMap
              // align because the child was tokenized from the same sub-sequence.
              // Synthetic EQUALS inherits the first sliced token's raw position.
              const firstSliced = tokens[origin.startToken];
              const rawFallback = firstSliced ? firstSliced.rawStart : 0;
              const childTokens = [
                { type: TokenType.EQUALS, start: 0, end: 0, value: '=', depth: 0, rawStart: rawFallback, rawEnd: rawFallback },
                ...tokens.slice(origin.startToken, origin.endToken)
              ];
              walk(childMap, childTokens);
            }
          }
        }
      }
    }

    walk(exprMap, tokens);
    return best;
  }

  /**
   * Schedule a highlight update for the next animation frame.
   * Coalesces rapid keystrokes into a single update.
   */
  let lastHighlightedText = null;
  function scheduleHighlightUpdate() {
    if (highlightRAF !== null) cancelAnimationFrame(highlightRAF);
    highlightRAF = requestAnimationFrame(() => {
      highlightRAF = null;
      if (!input) return;
      const text = getInputText();
      if (text === lastHighlightedText) return;
      lastHighlightedText = text;
      input.normalize();
      ({ tokens: lastTokens, refColorMap: lastRefColorMap } = updateHighlights(input));
      if (onRefColorsChanged) onRefColorsChanged(lastRefColorMap);

      // Preview evaluation for formulas being edited
      if (text.startsWith('=') && previewEvaluate) {
        previewEvaluate(text, lastTokens);

        // getErrorSpans returns raw-coord spans (provenance tokens carry
        // rawStart/rawEnd), so we pass them straight to updateErrorHighlights.
        const spans = getErrorSpans ? getErrorSpans(PREVIEW_KEY) : [];
        if (spans.length > 0) {
          updateErrorHighlights(input, spans);
        } else {
          clearErrorHighlights();
        }

        // Preview result badge
        const result = getNodeValue ? getNodeValue(PREVIEW_KEY) : null;
        updatePreviewBadge('= ', result);
      } else {
        clearErrorHighlights();
        if (previewBadge) previewBadge.textContent = '';
      }

      updatePopup();
    });
  }

  // ============================================================================
  // POPUP (autocomplete + function context)
  // ============================================================================

  /**
   * Find an IDENT token the cursor is editing — strictly inside, or at the end
   * (so `=SU|` triggers when caret sits right after the U). Caret right before
   * the IDENT does NOT count: nothing has been typed yet to filter against.
   */
  function identTokenAtCursor(tokens, pos) {
    if (!tokens) return null;
    for (const t of tokens) {
      if (t.type !== TokenType.IDENT) continue;
      if (t.start < pos && pos <= t.end) return t;
    }
    return null;
  }

  function findFunctionContextAtCursor(tokens, cursorPos) {
    if (!tokens) return null;
    // Stack of unclosed LPARENs preceded by an IDENT. Plain grouping parens
    // (no preceding IDENT) don't count — the cursor being inside them doesn't
    // put us in a function call.
    const stack = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.start >= cursorPos) break;
      if (t.type === TokenType.LPAREN) {
        let prev = i - 1;
        while (prev >= 0 && tokens[prev].type === TokenType.WHITESPACE) prev--;
        const funcToken = (prev >= 0 && tokens[prev].type === TokenType.IDENT) ? tokens[prev] : null;
        stack.push({ lparenIdx: i, funcToken });
      } else if (t.type === TokenType.RPAREN) {
        stack.pop();
      }
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].funcToken) {
        const { lparenIdx, funcToken } = stack[i];
        const lparen = tokens[lparenIdx];
        const argDepth = lparen.depth + 1;
        let argIndex = 0;
        for (let j = lparenIdx + 1; j < tokens.length; j++) {
          const t = tokens[j];
          if (t.start >= cursorPos) break;
          if (t.type === TokenType.COMMA && t.depth === argDepth) argIndex++;
        }
        return { funcToken, lparenIdx, argIndex };
      }
    }
    return null;
  }

  function collectCommittedArgs(tokens, lparenIdx, argDepth, cursorPos, upToArgIndex) {
    const lparen = tokens[lparenIdx];
    const slots = [];
    let currentTokens = [];
    let currentStart = lparen.end;
    for (let i = lparenIdx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.start >= cursorPos) break;
      if (t.type === TokenType.COMMA && t.depth === argDepth) {
        slots.push({ tokens: currentTokens, startChar: currentStart, endChar: t.start });
        if (slots.length >= upToArgIndex) return slots;
        currentTokens = [];
        currentStart = t.end;
        continue;
      }
      currentTokens.push(t);
    }
    return slots;
  }

  // Filtered to formula keys (those starting with `=`); returns null when
  // provenance isn't available.
  function collectProvExpressions() {
    if (!getExpressionProvenance) return null;
    const prov = getExpressionProvenance(PREVIEW_KEY);
    if (!prov || !prov.expressionMap) return null;
    const out = [];
    for (const [key, origins] of Object.entries(prov.expressionMap)) {
      if (!key.startsWith('=')) continue;
      for (const origin of origins) {
        out.push({
          key,
          startChar: prov.tokens[origin.startToken].rawStart,
          endChar: prov.tokens[origin.endToken - 1].rawEnd
        });
      }
    }
    return out;
  }

  // For multi-token args, fall back to the preview-evaluation provenance and
  // pick the largest sub-expression contained in the arg's character span.
  function resolveArgType(slot, provExprs) {
    const meaningful = slot.tokens.filter(t => t.type !== TokenType.WHITESPACE);
    if (meaningful.length === 0) return null;
    if (meaningful.length === 1) {
      const t = meaningful[0];
      if (t.type === TokenType.NUMBER) return 'Number';
      if (t.type === TokenType.STRING) return 'Text';
      if (t.type === TokenType.BOOLEAN) return 'Boolean';
      if (t.type === TokenType.CELL_REF || t.type === TokenType.IDENT) {
        const node = getNodeValue(t.value);
        return node ? node.type : null;
      }
      return null;
    }
    if (!provExprs) return null;
    let bestKey = null;
    let bestSize = -1;
    for (const expr of provExprs) {
      if (expr.startChar < slot.startChar || expr.endChar > slot.endChar) continue;
      const size = expr.endChar - expr.startChar;
      if (size > bestSize) {
        bestKey = expr.key;
        bestSize = size;
      }
    }
    if (!bestKey) return null;
    const node = getNodeValue(bestKey);
    return node ? node.type : null;
  }

  function narrowVariants(variants, argTypes) {
    return variants.filter(v => {
      for (let i = 0; i < argTypes.length; i++) {
        if (argTypes[i] == null) continue;
        if (v.argTypes[i] !== argTypes[i]) return false;
      }
      return true;
    });
  }

  // Per-variant paramNames take precedence; signature.inputs[i].name (set by
  // the function compiler for custom functions) is the fallback.
  function getParamName(funcNode, applicableVariants, argIndex) {
    for (const v of applicableVariants) {
      if (v.paramNames?.[argIndex]) return v.paramNames[argIndex];
    }
    return funcNode?.refValue?.signature?.inputs?.[argIndex]?.name || null;
  }

  function buildPopupHeader(ctx, tokens, cursorPos) {
    const node = getNodeValue(ctx.funcToken.value);
    const variants = Array.isArray(node?.refValue?.variants) ? node.refValue.variants : null;
    if (!variants || variants.length === 0) return null;

    const lparen = tokens[ctx.lparenIdx];
    const argDepth = lparen.depth + 1;
    const argSlots = collectCommittedArgs(tokens, ctx.lparenIdx, argDepth, cursorPos, ctx.argIndex);
    const provExprs = argSlots.length > 0 ? collectProvExpressions() : null;
    const argTypes = argSlots.map(slot => resolveArgType(slot, provExprs));
    const narrowed = narrowVariants(variants, argTypes);
    const candidates = narrowed.length > 0 ? narrowed : variants;

    // Variants whose arity actually covers the active arg index. If none do,
    // fall back to all candidates so the return-type line still has something.
    const applicable = candidates.filter(v => v.argTypes.length > ctx.argIndex);
    const effective = applicable.length > 0 ? applicable : candidates;

    const returnSet = new Set(effective.map(v => v.returnType));
    const returnType = Array.from(returnSet).join(' | ');

    let nextLabel = null;
    let hasMoreArgs = false;
    if (applicable.length > 0) {
      const typeSet = new Set(applicable.map(v => v.argTypes[ctx.argIndex]));
      const types = Array.from(typeSet).join(' | ');
      const paramName = getParamName(node, applicable, ctx.argIndex);
      nextLabel = paramName ? `${paramName} ${types}` : types;
      hasMoreArgs = applicable.some(v => v.argTypes.length > ctx.argIndex + 1);
    }

    const prevType = argTypes.length > 0 ? (argTypes[argTypes.length - 1] || '?') : null;
    const hasEarlierArgs = argTypes.length > 1;

    return {
      funcName: ctx.funcToken.value,
      prevType,
      hasEarlierArgs,
      nextLabel,
      hasMoreArgs,
      returnType
    };
  }

  function buildPopupCandidates(cursorPos) {
    const ident = identTokenAtCursor(lastTokens, cursorPos);
    if (!ident) return null;
    const text = getInputText();
    const prefix = text.substring(ident.start, cursorPos);
    const prefixUpper = prefix.toUpperCase();
    const matches = [];
    for (const [key, node] of getNodeEntries()) {
      if (!key.toUpperCase().startsWith(prefixUpper)) continue;
      matches.push({ name: key, node });
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => a.name.localeCompare(b.name));
    // Enrich only the rows the popup will actually render — formatNodeForBadge
    // is non-trivial and most matches past POPUP_MAX_ROWS are discarded.
    const visible = matches.slice(0, POPUP_MAX_ROWS);
    for (const m of visible) {
      if (m.node && m.node.type !== 'function') {
        const { text } = formatNodeForBadge(m.node);
        if (text) m.valuePreview = text.length > 30 ? text.slice(0, 29) + '…' : text;
      }
    }
    return { ident, matches: visible };
  }

  function updatePopup() {
    if (!popup || !input) return;
    if (!formulaEditingMode || !lastTokens || !getNodeEntries || !getNodeValue) {
      popup.hide();
      return;
    }

    // During picking, focus is on the grid and the formula-bar's logical
    // cursor is at referenceEnd (where insertions land).
    const pickingActive = referenceStart !== null && referenceEnd !== null;
    const focused = document.activeElement === input;
    const sel = pickingActive ? null : getCaretOffset();
    const cursorPos = pickingActive ? referenceEnd : sel.start;

    const funcCtx = findFunctionContextAtCursor(lastTokens, cursorPos);
    const header = funcCtx ? buildPopupHeader(funcCtx, lastTokens, cursorPos) : null;

    // Candidates only when actively typing (focused, not picking, collapsed
    // selection at a meaningful IDENT position).
    let candidatesInfo = null;
    if (focused && !pickingActive && sel.start === sel.end) {
      candidatesInfo = buildPopupCandidates(sel.start);
    }

    if (!header && !candidatesInfo) {
      popup.hide();
      return;
    }

    // Anchor at the function name when inside a call — keeps the popup fixed
    // while the user types args. Fall back to the IDENT being typed (top-level
    // autocomplete with no enclosing call), then the caret.
    const anchorOffset = funcCtx
      ? funcCtx.funcToken.start
      : candidatesInfo ? candidatesInfo.ident.start : cursorPos;
    const caretRect = getCaretClientRect(input, anchorOffset);
    if (!caretRect) {
      popup.hide();
      return;
    }
    const anchor = anchorRectToContainer(caretRect, inputWrapper.getBoundingClientRect());

    popup.show({
      header,
      candidates: candidatesInfo ? candidatesInfo.matches : null,
      anchor
    });
  }

  function acceptCandidate(pick) {
    const { start: cursorPos } = getCaretOffset();
    const ident = identTokenAtCursor(lastTokens, cursorPos);
    const replaceStart = ident.start;
    const replaceEnd = ident.end;
    const text = getInputText();

    // Auto-`(` for functions: pick `SUM` mid-formula → land at `SUM(|`, with
    // signature header kicking in immediately. Skip if next char is already `(`.
    const isFunction = pick.node && pick.node.type === 'function';
    const nextChar = text.charAt(replaceEnd);
    const insertion = isFunction && nextChar !== '(' ? `${pick.name}(` : pick.name;

    const newText = text.substring(0, replaceStart) + insertion + text.substring(replaceEnd);
    setInputText(newText);
    const newCaret = replaceStart + insertion.length;
    setCaretOffset(newCaret, newCaret);
    updatePopup();
    scheduleHighlightUpdate();
  }

  // ============================================================================
  // REFERENCE PICKING
  // ============================================================================
  // Manages the state machine for picking cell references during formula editing

  let referenceStart = null; // Start position of inserted reference
  let referenceEnd = null;   // End position of inserted reference
  let savedValueBeforePicking = null; // For revert during reference picking

  // Caret snapshot staged by handleKeyDown before it triggers blur. Programmatic
  // focus changes can move window.getSelection() off the input before blur runs,
  // so blur's tryStartPickingSession reads this instead of getCaretOffset()
  // when it's present. Mouse-click entry clears this and reads live selection.
  let pendingCaret = null;

  // Token types that, when the caret sits right after them (ignoring whitespace),
  // indicate a position where inserting a cell reference is syntactically sensible.
  const PICKING_ALLOWED_BEFORE = new Set([
    TokenType.EQUALS,
    TokenType.OP,
    TokenType.COMPARE,
    TokenType.COMMA,
    TokenType.COLON,
    TokenType.LPAREN,
    TokenType.LBRACE,
  ]);

  /**
   * Is this token one whose text the user would want picking to replace?
   */
  function isReplaceableRefToken(token) {
    if (!token) return false;
    if (token.type === TokenType.CELL_REF) return true;
    if (token.type === TokenType.IDENT && isNamedReference && isNamedReference(token.value)) return true;
    return false;
  }

  /**
   * Decide whether the current caret/selection is at a position where entering
   * reference-picking mode makes sense, and return the raw-text span to set as
   * [referenceStart, referenceEnd] on entry. Returns null if picking should
   * NOT be entered (caller should commit-and-navigate instead).
   */
  function getReferencePickingSpan(caret, tokens) {
    if (!tokens || tokens.length === 0) return null;

    // Selection present: use selection start for the allow-list check; the
    // selection bounds themselves become the replacement span. If the selection
    // starts mid-token (e.g., partway through an identifier or number), refuse
    // picking — inserting a ref there would produce garbage.
    if (caret.start !== caret.end) {
      if (tokenStrictlyContaining(tokens, caret.start)) return null;
      const prev = tokenEndingAtOrBefore(tokens, caret.start);
      if (prev && PICKING_ALLOWED_BEFORE.has(prev.type)) {
        return { start: caret.start, end: caret.end };
      }
      return null;
    }

    // Caret strictly inside a replaceable ref token → replace that token.
    const inside = tokenStrictlyContaining(tokens, caret.start);
    if (inside) {
      if (isReplaceableRefToken(inside)) {
        return { start: inside.start, end: inside.end };
      }
      return null;
    }

    // Caret at a boundary: check the non-whitespace token ending at/before caret.
    const prev = tokenEndingAtOrBefore(tokens, caret.start);
    if (prev && PICKING_ALLOWED_BEFORE.has(prev.type)) {
      return { start: caret.start, end: caret.start };
    }

    return null;
  }

  function tokenStrictlyContaining(tokens, pos) {
    for (const t of tokens) {
      if (t.type === TokenType.WHITESPACE) continue;
      if (t.start < pos && pos < t.end) return t;
    }
    return null;
  }

  function tokenEndingAtOrBefore(tokens, pos) {
    let found = null;
    for (const t of tokens) {
      if (t.type === TokenType.WHITESPACE) continue;
      if (t.end <= pos) found = t;
      else break;
    }
    return found;
  }

  /**
   * Revert to saved value during reference picking (called by grid on Delete/Backspace/Escape)
   */
  function revertReferencePicking() {
    setInputText(savedValueBeforePicking);
    // Restore cursor to where it was before picking started
    focus();
    if (referenceStart !== null) {
      setCaretOffset(referenceStart, referenceStart);
    }
  }


  /**
   * Try to start a reference-picking session at the current caret/selection.
   * Returns true if a valid picking span was found and state was initialized;
   * false if the position isn't picking-valid and the caller should commit
   * instead.
   *
   * Reads the caret from pendingCaret if handleKeyDown staged one before
   * triggering focus change; otherwise reads live selection (works for
   * mouse-click entry, where the selection is still in the input at blur).
   */
  function tryStartPickingSession() {
    const caret = pendingCaret || getCaretOffset();
    pendingCaret = null;
    const span = getReferencePickingSpan(caret, lastTokens);
    if (!span) return false;

    savedValueBeforePicking = getInputText();
    referenceStart = span.start;
    referenceEnd = span.end;
    updatePopup();
    return true;
  }

  /**
   * Save the current text selection position (for reference mode).
   *
   * Used by insertReference() as a fallback when an external caller (e.g., a
   * panel's "insert this ref" click) triggers picking without going through
   * handleBlur. Auto-expands to a containing replaceable ref token when the
   * caret is inside one. Unlike tryStartPickingSession, this ALWAYS sets a
   * span — external insert callers express explicit user intent to insert,
   * so we honor them even at positions where arrow/click entry would refuse.
   */
  function saveSelectionPosition() {
    const caret = getCaretOffset();

    if (caret.start === caret.end && lastTokens) {
      const inside = tokenStrictlyContaining(lastTokens, caret.start);
      if (isReplaceableRefToken(inside)) {
        referenceStart = inside.start;
        referenceEnd = inside.end;
        return;
      }
    }

    referenceStart = caret.start;
    referenceEnd = caret.end;
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
      savedValueBeforePicking = getInputText();
    }

    // If the notation matches a named range, use the name instead
    const resolved = (lookupRangeName && lookupRangeName(notation)) || notation;

    const currentValue = getInputText();

    const newValue =
      currentValue.substring(0, referenceStart) +
      resolved +
      currentValue.substring(referenceEnd);

    setInputText(newValue);

    referenceEnd = referenceStart + resolved.length;
    updatePopup();
  }

  // ============================================================================
  // RENDERING/MOUNTING
  // ============================================================================

  function mount(containerElement) {
    container = containerElement;

    cellNameDisplay = container.querySelector('.cell-name-display');
    cellNameDeleteButton = container.querySelector('.cell-name-delete-button');
    input = container.querySelector('.formula-input');

    // Wrap input in a container with overlay for disabled click detection
    // (contentEditable="false" elements may not fire click events reliably)
    inputWrapper = document.createElement('div');
    inputWrapper.className = 'formula-input-wrapper';
    input.parentNode.insertBefore(inputWrapper, input);
    inputWrapper.appendChild(input);

    disabledOverlay = document.createElement('div');
    disabledOverlay.className = 'formula-input-disabled-overlay';
    disabledOverlay.addEventListener('click', handleClick);
    inputWrapper.appendChild(disabledOverlay);

    previewBadge = document.createElement('span');
    previewBadge.className = 'formula-preview-badge';
    inputWrapper.appendChild(previewBadge);

    popup = createFormulaPopup({ onPick: acceptCandidate });
    popup.mount(inputWrapper);

    input.addEventListener('keydown', handleKeyDown);
    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    input.addEventListener('beforeinput', handleBeforeInputEvent);
    input.addEventListener('input', handleInputEvent);

    cellNameDisplay.addEventListener('keydown', handleCellNameKeyDown);
    cellNameDisplay.addEventListener('focus', handleCellNameFocus);
    cellNameDeleteButton.addEventListener('click', handleDeleteRangeName);
    document.addEventListener('selectionchange', handleSelectionChange);
  }

  // ============================================================================
  // CELL LOADING
  // ============================================================================

  /**
   * Load a cell for editing
   * Called by orchestrator when active cell changes
   */
  function loadCell(cellKey) {
    currentCell = cellKey;
    pendingCaret = null;
    popup.hide();

    // Load value into input and store original for Escape revert
    const value = loadValue(cellKey);
    originalValue = value || '';
    setInputText(originalValue);

    // Disable input if cell is not editable (e.g., generated rows in loop sheets)
    const editable = !isCellEditable || isCellEditable(cellKey);
    setInputDisabled(!editable);

    // Clear preview state from previous editing session
    if (previewClear) previewClear();
    if (previewBadge) previewBadge.textContent = '';

    // Apply error-source highlighting if cell has errors
    if (getErrorSpans && originalValue && originalValue.startsWith('=')) {
      const spans = getErrorSpans(cellKey);
      if (spans.length > 0) {
        updateErrorHighlights(input, spans);
      } else {
        clearErrorHighlights();
      }
    } else {
      clearErrorHighlights();
    }

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
    _setFormulaEditingMode(false);

    setInputText(originalValue);

    focusActiveCell();
  }

  /**
   * Focus the input field with optional cursor positioning
   * @param {string} cursorMode - 'select-all', 'end', 'start', or undefined (preserve current position)
   */
  function focus(cursorMode) {
    input.focus();

    if (cursorMode === 'select-all') {
      selectAll();
    } else if (cursorMode === 'start') {
      setCaretOffset(0, 0);
    } else {
      // Default to 'end' — contentEditable doesn't preserve cursor like <input> did,
      // so we explicitly place it at the end unless told otherwise.
      const len = getInputText().length;
      setCaretOffset(len, len);
    }
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
        if (cellNameDeleteButton) {
          cellNameDeleteButton.hidden = false;
        }
        return;
      }
    }

    cellNameDisplay.value = notation;
    currentRangeName = null;
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

    const result = deleteNamedRange(currentRangeName);

    if (result.success) {
      cellNameDisplay.value = currentNotation;
      currentRangeName = null;
      cellNameDeleteButton.hidden = true;
    } else {
      console.error('[FormulaBar] Failed to delete named range:', result.error);
      alert(`Cannot delete named range: ${result.error}`);
    }
  }

  function handleCellNameFocus() {
    originalNotation = cellNameDisplay.value;
    cellNameDisplay.select();
  }

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
        focus('end');
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
        updateCellNameDisplay(currentNotation);
      } else {
        console.error(`[FormulaBar] Failed to ${currentRangeName ? 'rename' : 'create'} named range:`, result.error);
        alert(`Cannot ${currentRangeName ? 'rename' : 'create'} named range: ${result.error}`);
        cellNameDisplay.value = originalNotation;
      }
    }

    cellNameDisplay.blur();
    if (inFormulaEditingMode) {
      focus('end');
    } else {
      focusActiveCell();
    }
  }

  function revertCellName() {
    const inFormulaEditingMode = isEditingFormula();
    cellNameDisplay.value = originalNotation;
    cellNameDisplay.blur();
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
      onCommit(currentCell, getInputText(), lastTokens);
    }
  }

  /**
   * Exit editing mode and move in a direction (or stay if at boundary)
   * Commit happens automatically via blur handler when focus leaves FormulaBar
   * @param {string} direction - "up", "down", "left", "right"
   */
  function exitEditingAndMove(direction) {
    _setFormulaEditingMode(false);

    // Move to next cell (blur handler commits automatically)
    const moved = moveActiveCell(direction);
    if (!moved) {
      // At boundary - still need to exit editing mode and return focus to grid
      focusActiveCell();
    }
  }

  function handleKeyDown(e) {
    // Arrow keys in formula editing mode - enter/navigate reference mode
    const arrowKeys = {
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right'
    };

    if (arrowKeys[e.key]) {
      const caret = getCaretOffset();
      const hasSelection = caret.start !== caret.end;
      const textLen = getInputText().length;
      const direction = arrowKeys[e.key];

      // Arrows only exit the formula bar at an "edge": Up/Down anywhere,
      // Right at text end, Left at text start OR when the value is just "="
      // (so Left still enters picking right after typing the leading `=`).
      // Anywhere else is regular cursor movement inside the text.
      const atEdge =
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        (e.key === 'ArrowRight' && !hasSelection && caret.start === textLen) ||
        (e.key === 'ArrowLeft' && !hasSelection && (caret.start === 0 || getInputText() === '='));

      if (!atEdge) return; // default cursor movement

      e.preventDefault();

      // Stage caret for blur's tryStartPickingSession — focusing the grid cell
      // may move window.getSelection() out of the input before blur runs.
      pendingCaret = caret;

      // focusActiveCell synchronously fires blur, which either starts a
      // picking session (keeps formulaEditingMode=true) or commits the value
      // and clears the mode. Branching on the post-blur mode unifies the
      // arrow path with the mouse-click path — both defer the "should this
      // be picking?" decision to tryStartPickingSession.
      focusActiveCell();

      if (formulaEditingMode) {
        stepSelectionAnchor(direction);
      } else {
        moveActiveCell(direction);
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift+Enter moves up, Enter moves down
      const direction = e.shiftKey ? 'up' : 'down';
      exitEditingAndMove(direction);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (popup.hasCandidates()) {
        acceptCandidate(popup.getTopCandidate());
        return;
      }
      // Shift+Tab moves left, Tab moves right
      const direction = e.shiftKey ? 'left' : 'right';
      exitEditingAndMove(direction);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (popup.hasCandidates()) {
        popup.hide();
        return;
      }
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
    if (isInputDisabled() && onDisabledClick) {
      onDisabledClick();
    }
  }

  function handleFocus() {
    // Always collapse selection to active cell when formula bar gains focus
    collapseToActiveCell();

    updateFormulaEditingMode();

    // When returning from reference picking, restore cursor to after the inserted reference
    if (formulaEditingMode && referenceEnd !== null) {
      setCaretOffset(referenceEnd, referenceEnd);
    }
  }

  /**
   * Handle blur event - commit value or save reference picking session.
   *
   * Focus moving to a grid cell while in formula editing mode *might* be the
   * start of reference picking (e.g., user clicked a cell to pick it). It's
   * only picking if the caret is at a syntactically sensible spot, same gate
   * as arrow-key entry. Otherwise we commit the current value and let the
   * grid's subsequent pointerup treat the click as a plain cell selection.
   *
   * _setFormulaEditingMode(false) fires before commit so that the pointerup
   * firing after this blur sees non-formula-mode state and takes the normal
   * selection branch instead of re-entering picking.
   */
  function handleBlur(e) {
    // Recompute popup state — body (candidates) drops because we're no longer
    // focused, but the header (function context) remains visible during a
    // picking session, since picking is a continuation of formula editing.
    updatePopup();

    const losingFocusToGridCell = e.relatedTarget?.getAttribute('role') === 'gridcell';

    if (formulaEditingMode && losingFocusToGridCell && tryStartPickingSession()) {
      return;
    }

    pendingCaret = null;
    _setFormulaEditingMode(false);
    commitCurrentCell();

    // Reload so the formula bar reflects the engine's canonical/normalized
    // form of the value we just committed. Necessary when nothing else will
    // trigger a reload — most visibly, shift+click extending the selection
    // (active cell unchanged), or a toolbar/panel click that stays put.
    if (currentCell) loadCell(currentCell);
  }

  /**
   * Handle input detected from grid (called when user types in a cell)
   */
  function handleInputFromGrid(inputText) {
    // Auto-promote any preview to active before processing input
    if (commitUnhandledPointers) {
      commitUnhandledPointers();
    }

    if (isEditingFormula()) {
      // Currently picking references - insert at saved cursor position
      const currentValue = getInputText();

      if (referenceEnd !== null) {
        // Insert at end of last reference/cursor position
        const newValue =
          currentValue.substring(0, referenceEnd) +
          inputText +
          currentValue.substring(referenceEnd);
        setInputText(newValue);

        referenceEnd = referenceEnd + inputText.length;
        referenceStart = referenceEnd;
      } else {
        // Fallback: append to end
        setInputText(currentValue + inputText);
      }

      // Update revert point to current value (so Delete/Backspace only removes the next reference)
      savedValueBeforePicking = getInputText();
      updatePopup();
    } else {
      // Normal mode - replace value with input and focus formula bar
      setInputText(inputText);
      focus('end');
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
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
        isNamedReference,
        createNamedRange,
        renameNamedRange,
        deleteNamedRange,
        commitUnhandledPointers,
        onRefColorsChanged,
        getErrorSpans,
        previewEvaluate,
        previewClear,
        getNodeValue,
        getNodeEntries,
        getExpressionProvenance
      } = deps);
    },

    mount,
    loadCell,
    focus,
    updateCellNameDisplay,
    insertReference,

    // Commit
    commitCurrentCell,

    // Formula editing mode
    isEditingFormula,

    // Reference picking
    revertReferencePicking,

    // Input handling
    handleInputFromGrid
  };
}
