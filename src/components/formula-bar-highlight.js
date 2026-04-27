/**
 * @file Formula Bar Syntax Highlighting
 * @description Wires the formula tokenizer to the CSS Custom Highlight API
 * for syntax highlighting in the formula bar's contentEditable element.
 *
 * Cell references, range references, and named references each get a distinct
 * color from a cycling palette. The ref→color mapping is exposed for the grid
 * to render matching overlays.
 *
 * Call `updateHighlights(element)` after any content change to refresh colors.
 */

import { tokenize, TokenType } from '../utils/formulaTokenizer.js';

/** Number of colors in the reference palette; --ref-color-0..N-1 must be defined in index.css. */
export const REF_COLOR_COUNT = 6;

/**
 * Map token types to CSS highlight names (matching ::highlight() rules in index.css).
 * Token types not listed here get per-reference coloring or are unhighlighted.
 */
const TOKEN_HIGHLIGHT_MAP = {
  [TokenType.NUMBER]:   'formula-literal',
  [TokenType.STRING]:   'formula-literal',
  [TokenType.OP]:       'formula-operator',
  [TokenType.COMPARE]:  'formula-operator',
  [TokenType.ERROR]:    'formula-error',
  [TokenType.BOOLEAN]:  'formula-literal'
};

const ERROR_HIGHLIGHT_NAME = 'formula-error-source';

/** All highlight names we manage (for cleanup) */
const ALL_HIGHLIGHT_NAMES = [
  ...new Set(Object.values(TOKEN_HIGHLIGHT_MAP)),
  'formula-function',
  ...Array.from({ length: REF_COLOR_COUNT }, (_, i) => `formula-ref-${i}`),
  ERROR_HIGHLIGHT_NAME
];

/**
 * Update syntax highlights on a contentEditable element.
 *
 * @param {HTMLElement} element - The contentEditable formula bar element
 * @returns {{tokens: import('../utils/formulaTokenizer.js').Token[]|null, refColorMap: Map<string, number>|null}}
 */
export function updateHighlights(element) {
  const empty = { tokens: null, refColorMap: null };
  if (!CSS.highlights) return empty;

  // Clear all managed highlights
  for (const name of ALL_HIGHLIGHT_NAMES) {
    CSS.highlights.delete(name);
  }

  if (!element) return empty;

  const text = element.textContent || '';
  if (!text || !text.startsWith('=')) return empty;

  const textNode = element.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return empty;

  const tokens = tokenize(text);

  // --- Assign colors to references ---
  // Each unique reference (cell, range, named) gets a color index from the palette.
  // Ranges (CELL_REF COLON CELL_REF) are treated as a single reference unit.

  /** @type {Map<string, number>} refKey → colorIndex */
  const refColorMap = new Map();
  let nextColor = 0;

  /**
   * Get or assign a color index for a reference key.
   * @param {string} key
   * @returns {number}
   */
  function getColor(key) {
    if (refColorMap.has(key)) return refColorMap.get(key);
    const idx = nextColor % REF_COLOR_COUNT;
    nextColor++;
    refColorMap.set(key, idx);
    return idx;
  }

  // --- Build highlight ranges ---
  /** @type {Map<string, StaticRange[]>} highlightName → ranges */
  const rangesByHighlight = new Map();

  function addRange(highlightName, start, end) {
    const range = new StaticRange({
      startContainer: textNode,
      startOffset: start,
      endContainer: textNode,
      endOffset: end
    });
    let arr = rangesByHighlight.get(highlightName);
    if (!arr) {
      arr = [];
      rangesByHighlight.set(highlightName, arr);
    }
    arr.push(range);
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti];

    // --- Reference tokens: per-color highlighting ---

    // Range pattern: CELL_REF COLON CELL_REF → single reference unit
    if (token.type === TokenType.CELL_REF &&
        tokens[ti + 1]?.type === TokenType.COLON &&
        tokens[ti + 2]?.type === TokenType.CELL_REF) {
      const rangeKey = token.value + ':' + tokens[ti + 2].value;
      const colorIdx = getColor(rangeKey);
      addRange(`formula-ref-${colorIdx}`, token.start, tokens[ti + 2].end);
      ti += 2; // skip COLON and second CELL_REF
      continue;
    }

    // Single cell reference
    if (token.type === TokenType.CELL_REF) {
      const colorIdx = getColor(token.value);
      addRange(`formula-ref-${colorIdx}`, token.start, token.end);
      continue;
    }

    // Named reference (IDENT not followed by LPAREN)
    if (token.type === TokenType.IDENT) {
      const next = tokens[ti + 1];
      if (next && next.type === TokenType.LPAREN) {
        addRange('formula-function', token.start, token.end);
      } else {
        const colorIdx = getColor(token.value);
        addRange(`formula-ref-${colorIdx}`, token.start, token.end);
      }
      continue;
    }

    // --- Standard token highlighting ---
    const highlightName = TOKEN_HIGHLIGHT_MAP[token.type];
    if (highlightName) {
      addRange(highlightName, token.start, token.end);
    }
  }

  // Register highlights
  for (const [name, ranges] of rangesByHighlight) {
    CSS.highlights.set(name, new Highlight(...ranges));
  }

  return { tokens, refColorMap };
}

/**
 * Clear all formula bar highlights.
 */
export function clearHighlights() {
  if (!CSS.highlights) return;
  for (const name of ALL_HIGHLIGHT_NAMES) {
    CSS.highlights.delete(name);
  }
}

/**
 * Apply error-source underline highlights on a contentEditable element.
 *
 * @param {HTMLElement} element - The contentEditable formula bar element
 * @param {Array<{startChar: number, endChar: number}>} spans - Character spans to underline
 */
export function updateErrorHighlights(element, spans) {
  if (!CSS.highlights || !element || !spans.length) return;

  const textNode = element.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

  const ranges = spans.map(span => new StaticRange({
    startContainer: textNode,
    startOffset: span.startChar,
    endContainer: textNode,
    endOffset: span.endChar
  }));

  if (ranges.length > 0) {
    CSS.highlights.set(ERROR_HIGHLIGHT_NAME, new Highlight(...ranges));
  }
}

/**
 * Clear error-source underline highlights.
 */
export function clearErrorHighlights() {
  if (!CSS.highlights) return;
  CSS.highlights.delete(ERROR_HIGHLIGHT_NAME);
}
