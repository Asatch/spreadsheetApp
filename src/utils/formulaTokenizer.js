/**
 * @file Formula Tokenizer
 * @description Single-pass tokenizer for spreadsheet formulas.
 *
 * Produces a flat array of tokens with type, position, and normalized value.
 * Whitespace is emitted as WHITESPACE tokens; structural consumers (the parser)
 * skip them, while the formula-bar highlighter uses them to preserve spans.
 *
 * **Two coordinate systems:**
 * - Token indices (for the parser and structural references)
 * - Character positions via start/end (for formula bar highlighting)
 *
 * **Token value normalization:**
 * - Uppercase for all identifiers, cell refs, booleans, errors
 * - `$` and `~` stripped from cell ref values (but included in character span)
 * - Raw text recoverable via `source.slice(token.start, token.end)`
 *
 * @example
 * tokenize('=SUM(A1, $B$2+C1)')
 * // → [
 * //   { type: 'EQUALS',   start: 0,  end: 1,  value: '=' },
 * //   { type: 'IDENT',    start: 1,  end: 4,  value: 'SUM' },
 * //   { type: 'LPAREN',   start: 4,  end: 5,  value: '(' },
 * //   { type: 'CELL_REF', start: 5,  end: 7,  value: 'A1' },
 * //   { type: 'COMMA',    start: 7,  end: 8,  value: ',' },
 * //   { type: 'CELL_REF', start: 9,  end: 13, value: 'B2' },
 * //   { type: 'OP',       start: 13, end: 14, value: '+' },
 * //   { type: 'CELL_REF', start: 14, end: 16, value: 'C1' },
 * //   { type: 'RPAREN',   start: 16, end: 17, value: ')' }
 * // ]
 */

import { isCellReference } from './cellUtils.js';

/** @enum {string} */
export const TokenType = {
  EQUALS:   'EQUALS',
  CELL_REF: 'CELL_REF',
  IDENT:    'IDENT',
  NUMBER:   'NUMBER',
  STRING:   'STRING',
  BOOLEAN:  'BOOLEAN',
  ERROR:    'ERROR',
  OP:       'OP',
  COMPARE:  'COMPARE',
  COLON:    'COLON',
  LPAREN:   'LPAREN',
  RPAREN:   'RPAREN',
  COMMA:    'COMMA',
  LBRACE:   'LBRACE',
  RBRACE:   'RBRACE',
  WHITESPACE: 'WHITESPACE',
  UNKNOWN:  'UNKNOWN'
};

// Characters treated as whitespace inside formulas. Covers regular space and
// tab plus Unicode space/invisible variants that commonly sneak in via
// contentEditable browsers or pastes from external apps. Line/paragraph
// separators are intentionally excluded.
const FORMULA_WHITESPACE = /[ \t\u00A0\u200B\uFEFF\u2000-\u200A\u202F\u205F\u3000]/;

/**
 * @typedef {Object} Token
 * @property {string} type - One of TokenType values
 * @property {number} start - Character offset in source (inclusive)
 * @property {number} end - Character offset in source (exclusive)
 * @property {string} value - Normalized value (uppercase, $ stripped for cell refs)
 * @property {number} depth - Nesting depth at this token (before openers increment / closers decrement)
 * @property {boolean} [colAbs] - CELL_REF only: true if raw source had $ before the column
 * @property {boolean} [rowAbs] - CELL_REF only: true if raw source had $ before the row
 */

/**
 * Tokenize a formula string into an array of tokens.
 *
 * Single-pass, left-to-right. Every character lands in exactly one token,
 * including whitespace (emitted as WHITESPACE tokens).
 *
 * @param {string} formula - The formula string to tokenize (e.g., '=SUM(A1,B1)')
 * @returns {Token[]} Array of tokens with type, start, end, and normalized value
 */
export function tokenize(formula) {
  if (!formula) return [];

  /** @type {Token[]} */
  const tokens = [];
  const len = formula.length;
  let i = 0;
  let depth = 0;

  // Leading '=' is always EQUALS
  if (formula[0] === '=') {
    tokens.push({ type: TokenType.EQUALS, start: 0, end: 1, value: '=', depth: 0 });
    i = 1;
  }

  while (i < len) {
    const ch = formula[i];

    // Whitespace: regular space, tab, and the Unicode space variants commonly
    // introduced by contentEditable browsers or pastes from word processors, web
    // pages, and typography tools. Line separators are excluded — formulas are
    // single-line, so a stray newline should surface as an UNKNOWN token.
    if (FORMULA_WHITESPACE.test(ch)) {
      const start = i;
      while (i < len && FORMULA_WHITESPACE.test(formula[i])) i++;
      tokens.push({ type: TokenType.WHITESPACE, start, end: i, value: formula.slice(start, i), depth });
      continue;
    }

    // String literal: "..."
    if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < len && formula[i] !== '"') {
        i++;
      }
      if (i < len) i++; // skip closing quote
      // Value includes the quotes (matches how the parser handles string literals).
      // Case is preserved — text content is not normalized like identifiers/cell refs.
      tokens.push({ type: TokenType.STRING, start, end: i, value: formula.slice(start, i), depth });
      continue;
    }

    // Error literal: #...!
    if (ch === '#') {
      const start = i;
      i++; // skip #
      while (i < len && formula[i] !== '!') {
        i++;
      }
      if (i < len) i++; // skip !
      tokens.push({ type: TokenType.ERROR, start, end: i, value: formula.slice(start, i).toUpperCase(), depth });
      continue;
    }

    // Number: digits with optional decimal point
    // Note: does NOT handle leading minus — that's an OP token; the parser resolves unary minus
    if (isDigit(ch)) {
      const start = i;
      while (i < len && isDigit(formula[i])) i++;
      if (i < len && formula[i] === '.') {
        i++; // skip decimal point
        while (i < len && isDigit(formula[i])) i++;
      }
      tokens.push({ type: TokenType.NUMBER, start, end: i, value: formula.slice(start, i), depth });
      continue;
    }

    // Word: letters, digits, underscore, $, ~ (cell refs, identifiers, booleans)
    // $ and ~ are consumed as part of the span but stripped from value
    if (isWordStart(ch)) {
      const start = i;
      while (i < len && isWordChar(formula[i])) i++;
      const raw = formula.slice(start, i);
      const value = raw.replace(/[$~]/g, '').toUpperCase();

      // Classify: boolean > cell reference > identifier
      if (value === 'TRUE' || value === 'FALSE') {
        tokens.push({ type: TokenType.BOOLEAN, start, end: i, value, depth });
      } else if (isCellReference(value)) {
        tokens.push(makeCellRefToken(start, i, value, depth, raw));
      } else {
        tokens.push({ type: TokenType.IDENT, start, end: i, value, depth });
      }
      continue;
    }

    // $ or ~ at start of a word (e.g., $A$1)
    if (ch === '$' || ch === '~') {
      if (i + 1 < len && isLetter(formula[i + 1])) {
        // Start of a cell ref with leading $ or ~
        const start = i;
        while (i < len && isWordChar(formula[i])) i++;
        const raw = formula.slice(start, i);
        const value = raw.replace(/[$~]/g, '').toUpperCase();

        if (isCellReference(value)) {
          tokens.push(makeCellRefToken(start, i, value, depth, raw));
        } else {
          tokens.push({ type: TokenType.IDENT, start, end: i, value, depth });
        }
        continue;
      }
      // Standalone $ or ~ — treat as unknown
      tokens.push({ type: TokenType.UNKNOWN, start: i, end: i + 1, value: ch, depth });
      i++;
      continue;
    }

    // Multi-character comparison operators: <=, >=, <>
    if (i + 1 < len) {
      const two = formula.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ type: TokenType.COMPARE, start: i, end: i + 2, value: two, depth });
        i += 2;
        continue;
      }
    }

    // Single-character tokens
    switch (ch) {
      case '(':
        tokens.push({ type: TokenType.LPAREN, start: i, end: i + 1, value: '(', depth });
        depth++;
        i++;
        continue;
      case ')':
        depth--;
        tokens.push({ type: TokenType.RPAREN, start: i, end: i + 1, value: ')', depth });
        i++;
        continue;
      case ',':
        tokens.push({ type: TokenType.COMMA, start: i, end: i + 1, value: ',', depth });
        i++;
        continue;
      case ':':
        tokens.push({ type: TokenType.COLON, start: i, end: i + 1, value: ':', depth });
        i++;
        continue;
      case '{':
        tokens.push({ type: TokenType.LBRACE, start: i, end: i + 1, value: '{', depth });
        depth++;
        i++;
        continue;
      case '}':
        depth--;
        tokens.push({ type: TokenType.RBRACE, start: i, end: i + 1, value: '}', depth });
        i++;
        continue;
      case '+': case '-': case '*': case '/': case '^':
        tokens.push({ type: TokenType.OP, start: i, end: i + 1, value: ch, depth });
        i++;
        continue;
      case '<': case '>':
        // Single < or > (multi-char already handled above)
        tokens.push({ type: TokenType.COMPARE, start: i, end: i + 1, value: ch, depth });
        i++;
        continue;
      case '=':
        // = inside formula (not leading) is comparison
        tokens.push({ type: TokenType.COMPARE, start: i, end: i + 1, value: '=', depth });
        i++;
        continue;
      default:
        tokens.push({ type: TokenType.UNKNOWN, start: i, end: i + 1, value: ch, depth });
        i++;
        continue;
    }
  }

  // Stamp raw positions. normalizeTokens may later rewrite .start/.end to
  // canonical form (strip whitespace, insert synthetic {/}, repack); rawStart/
  // rawEnd stay fixed at the original source offsets so consumers can map
  // errors and spans back to the user's raw input.
  for (const t of tokens) {
    t.rawStart = t.start;
    t.rawEnd = t.end;
  }

  return tokens;
}

/**
 * Serialize a single token back to source form. For CELL_REF tokens, this
 * re-adds $ markers from colAbs/rowAbs flags. For all other token types,
 * returns the token's `value` directly.
 *
 * Inverse of tokenize for $ markers specifically: tokenize strips $ from
 * .value and records flags; serializeToken rebuilds the marked form.
 * `~` is not round-tripped.
 *
 * @param {Token} t
 * @returns {string}
 */
export function serializeToken(t) {
  if (t.type === TokenType.CELL_REF) {
    const m = t.value.match(/^([A-Z]+|_STOP)(\d+)$/);
    if (m) return (t.colAbs ? '$' : '') + m[1] + (t.rowAbs ? '$' : '') + m[2];
  }
  return t.value;
}

/**
 * Serialize a token array into the canonical source string.
 *
 * @param {Token[]} tokens
 * @returns {string}
 */
export function serializeTokens(tokens) {
  let s = '';
  for (const t of tokens) s += serializeToken(t);
  return s;
}

/**
 * Build a CELL_REF token, parsing $ markers out of the raw slice to populate
 * colAbs/rowAbs. Only `$` counts as an absolute marker; `~` is preserved in the
 * span but doesn't set the flags (loop-sheet relative-literal semantics).
 *
 * @returns {Token}
 */
function makeCellRefToken(start, end, value, depth, raw) {
  // Split raw at the first digit. Chars before it are the column part (possibly
  // with $/~ markers); chars immediately before the digits that are $/~ form
  // the row marker zone. Only $ sets abs flags — ~ is preserved but not flagged.
  let rowStart = 0;
  while (rowStart < raw.length && !isDigit(raw[rowStart])) rowStart++;
  // Column marker: $ anywhere in the leading non-digit span that isn't adjacent
  // to the digits. Row marker: $ in the run of $/~ immediately before the digits.
  let rowAbs = false;
  let rowMarkerEnd = rowStart;
  for (let q = rowStart - 1; q >= 0 && (raw[q] === '~' || raw[q] === '$'); q--) {
    if (raw[q] === '$') rowAbs = true;
    rowMarkerEnd = q;
  }
  const colPart = raw.slice(0, rowMarkerEnd);
  const colAbs = colPart.includes('$');
  return { type: TokenType.CELL_REF, start, end, value, depth, colAbs, rowAbs };
}

/**
 * Iterate CELL_REF tokens and apply a transform. The callback receives the
 * token and returns either:
 *   - a string: the new cell ref value (colAbs/rowAbs on the token are preserved
 *     unless the callback also sets them)
 *   - '#REF!': the token is promoted to an ERROR token
 *   - null/undefined: no change
 *
 * After any mutations, positions are repacked so `.start/.end` stay consistent
 * with the packed string.
 *
 * @param {Token[]} tokens
 * @param {function(Token): (string|null|undefined)} fn
 * @returns {Token[]} the same array, mutated
 */
export function rewriteCellRefs(tokens, fn) {
  let mutated = false;
  for (const t of tokens) {
    if (t.type !== TokenType.CELL_REF) continue;
    const out = fn(t);
    if (out == null) continue;
    if (out === '#REF!') {
      t.type = TokenType.ERROR;
      t.value = '#REF!';
      delete t.colAbs;
      delete t.rowAbs;
      mutated = true;
    } else if (out !== t.value) {
      t.value = out;
      mutated = true;
    }
  }
  if (mutated) recomputeTokenPositions(tokens);
  return tokens;
}

/**
 * Repack token character positions so they match the packed string formed by
 * concatenating `token.value` across the array. After any mutation that changes
 * token count or individual `.value` lengths (wrapping, rewriting refs, etc.),
 * call this to restore the invariant `source === tokens.map(t => t.value).join('')`
 * with `.start/.end` indexing into that source.
 *
 * Mutates tokens in place.
 *
 * @param {Token[]} tokens
 */
export function recomputeTokenPositions(tokens) {
  let pos = 0;
  for (const t of tokens) {
    const len = serializeToken(t).length;
    t.start = pos;
    t.end = pos + len;
    pos = t.end;
  }
}

// ============================================================================
// Character classification helpers
// ============================================================================

/** @param {string} ch */
function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

/** @param {string} ch */
function isLetter(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

/** @param {string} ch - Can start a word token (letter or underscore) */
function isWordStart(ch) {
  return isLetter(ch) || ch === '_';
}

/** @param {string} ch - Can continue a word token (letter, digit, underscore, $, ~) */
function isWordChar(ch) {
  return isLetter(ch) || isDigit(ch) || ch === '_' || ch === '$' || ch === '~';
}
