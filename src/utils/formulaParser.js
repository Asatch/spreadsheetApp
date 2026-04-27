/**
 * @file Formula Parser
 * @description Parses normalized formula strings into precedent structures using tokenization.
 *
 * **Key Features:**
 * - Tokenizes formulas then recursively splits on operators
 * - Handles operator precedence and parentheses
 * - Extracts anonymous sub-expressions for recursive evaluation
 * - Supports unary minus (NEGATE) operator
 *
 * **Input:** Normalized formula (uppercase, no spaces), starting with `=`
 * **Output:** `{ precedents: Array, anonymousExpressions: Array }`
 * **Error Handling:** Returns `['PROCEED', '#SYNTAX!']` on parse error
 */

import { expandRange, isCellReference } from './cellUtils.js';
import { TokenType } from './formulaTokenizer.js';

/**
 * @typedef {Object} ExpressionOrigin
 * @property {number} startToken - Start token index in parent's token array (inclusive)
 * @property {number} endToken - End token index in parent's token array (exclusive)
 */

/**
 * @typedef {Object} ParseResult
 * @property {Array<string>} precedents - Array of precedents, first element is operation name
 * @property {Array<string>} anonymousExpressions - Array of extracted sub-expressions to be parsed recursively
 * @property {Object<string, ExpressionOrigin>} expressionMap - Map from anonymous expression key to its origin span in the parent formula
 * @property {import('./formulaTokenizer.js').Token[]} tokens - The token array for the parsed formula
 */

// ============================================================================
// Operator precedence table
// ============================================================================

/** @type {Object<string, {precedence: number, name: string}>} */
const OPERATORS = {
  '=':  { precedence: 1, name: 'EQUAL' },
  '<>': { precedence: 1, name: 'NOTEQUAL' },
  '<=': { precedence: 1, name: 'LESSEQUAL' },
  '>=': { precedence: 1, name: 'GREATEREQUAL' },
  '<':  { precedence: 1, name: 'LESS' },
  '>':  { precedence: 1, name: 'GREATER' },
  '+':  { precedence: 2, name: 'ADD' },
  '-':  { precedence: 2, name: 'SUBTRACT' },
  '*':  { precedence: 3, name: 'MULTIPLY' },
  '/':  { precedence: 3, name: 'DIVIDE' },
  '^':  { precedence: 4, name: 'EXPONENT' },
  ':':  { precedence: 5, name: 'ARRAY' }
};

// ============================================================================
// Token-range helpers
// ============================================================================

/**
 * Join token values in range [start, end) into a single string.
 */
function tokensToString(tokens, start, end) {
  let s = '';
  for (let i = start; i < end; i++) {
    s += tokens[i].value;
  }
  return s;
}

/**
 * Check if token range contains any "complex" tokens (operators, parens, colon).
 */
function hasComplexTokens(tokens, start, end) {
  for (let i = start; i < end; i++) {
    const t = tokens[i].type;
    if (t === TokenType.OP || t === TokenType.COMPARE || t === TokenType.COLON ||
        t === TokenType.LPAREN || t === TokenType.RPAREN ||
        t === TokenType.LBRACE || t === TokenType.RBRACE) {
      return true;
    }
  }
  return false;
}

/**
 * Split token range on COMMA at the range's base depth. Returns array of [argStart, argEnd) pairs.
 */
function splitArgs(tokens, start, end) {
  const args = [];
  let argStart = start;
  const baseDepth = start < end ? tokens[start].depth : 0;

  for (let i = start; i < end; i++) {
    if (tokens[i].type === TokenType.COMMA && tokens[i].depth === baseDepth) {
      args.push([argStart, i]);
      argStart = i + 1;
    }
  }
  args.push([argStart, end]);
  return args;
}

/**
 * Check if a minus OP token at index i is unary (not binary subtraction).
 * Unary if at start of range, or preceded by OP, COMPARE, COMMA, or LPAREN.
 */
function isUnaryMinus(tokens, i, rangeStart) {
  if (i === rangeStart) return true;
  const prev = tokens[i - 1].type;
  return prev === TokenType.OP || prev === TokenType.COMPARE ||
         prev === TokenType.COMMA || prev === TokenType.LPAREN;
}

/**
 * Find the main operator in token range [start, end).
 * Returns token index of the rightmost lowest-precedence operator at base depth, or -1.
 */
function findMainOperator(tokens, start, end) {
  let mainIdx = -1;
  let minPrecedence = Infinity;
  const baseDepth = start < end ? tokens[start].depth : 0;

  for (let i = start; i < end; i++) {
    const t = tokens[i];
    if (t.depth !== baseDepth) continue;

    // Check OP tokens (+, -, *, /, ^)
    if (t.type === TokenType.OP) {
      if (t.value === '-' && isUnaryMinus(tokens, i, start)) continue;

      const info = OPERATORS[t.value];
      if (info && info.precedence <= minPrecedence) {
        minPrecedence = info.precedence;
        mainIdx = i;
      }
    }
    // Check COMPARE tokens (=, <, >, <=, >=, <>)
    else if (t.type === TokenType.COMPARE) {
      const info = OPERATORS[t.value];
      if (info && info.precedence <= minPrecedence) {
        minPrecedence = info.precedence;
        mainIdx = i;
      }
    }
    // Check COLON
    else if (t.type === TokenType.COLON) {
      const info = OPERATORS[':'];
      if (info.precedence <= minPrecedence) {
        minPrecedence = info.precedence;
        mainIdx = i;
      }
    }
  }

  return mainIdx;
}

/**
 * Find the matching closer for an opening bracket/paren at index openIdx.
 * Uses token depth: the matching closer has the same depth as the opener.
 */
function findMatchingCloser(tokens, openIdx, end, closerType) {
  const d = tokens[openIdx].depth;
  for (let i = openIdx + 1; i < end; i++) {
    if (tokens[i].type === closerType && tokens[i].depth === d) return i;
  }
  return -1;
}

// ============================================================================
// Core recursive parser
// ============================================================================

/**
 * Parse an argument — if complex, extract as anonymous expression; otherwise return as string.
 * Records provenance (token range and character span) in expressionMap.
 * Each key maps to an array of origins (same sub-expression can appear multiple times).
 *
 * Empty ranges (start === end) are treated as syntax errors — a missing operand
 * (trailing `+`, blank arg between commas, empty parens). The thrown span
 * points at the token immediately before the gap, so the caller's errorSpan
 * highlights e.g. the `+` in `=1+` or the `,` in `=SUM(A1,)`.
 */
function parseArg(tokens, start, end, anonymousExprs, expressionMap) {
  if (start === end) {
    const pointAt = Math.max(start - 1, 0);
    throw { type: 'SYNTAX', startToken: pointAt, endToken: pointAt + 1 };
  }

  if (hasComplexTokens(tokens, start, end)) {
    const key = '=' + tokensToString(tokens, start, end);
    anonymousExprs.push(key);
    const origin = {
      startToken: start,
      endToken: end
    };
    if (expressionMap[key]) {
      expressionMap[key].push(origin);
    } else {
      expressionMap[key] = [origin];
    }
    return key;
  }
  return tokensToString(tokens, start, end);
}

/**
 * Recursively parse a token range [start, end) into a precedents array.
 */
function parseExpression(tokens, start, end, anonymousExprs, expressionMap) {
  // Empty range
  if (start >= end) return ['PROCEED', ''];

  // 1. Function call / grouping: IDENT( ... ) or ( ... )
  const first = tokens[start];

  // 1a. Array literal: { ... }
  if (first.type === TokenType.LBRACE) {
    const braceClose = findMatchingCloser(tokens, start, end, TokenType.RBRACE);
    if (braceClose === end - 1) {
      const innerStart = start + 1;
      const innerEnd = braceClose;
      const argSpans = splitArgs(tokens, innerStart, innerEnd);
      const precedents = ['ARRAY'];
      for (const [aStart, aEnd] of argSpans) {
        precedents.push(parseArg(tokens, aStart, aEnd, anonymousExprs, expressionMap));
      }
      return precedents;
    }
  }

  // 1b. Function call / grouping: IDENT( ... ) or ( ... )
  if (first.type === TokenType.IDENT || first.type === TokenType.LPAREN) {
    let funcName, parenOpen;

    if (first.type === TokenType.IDENT && start + 1 < end && tokens[start + 1].type === TokenType.LPAREN) {
      funcName = first.value;
      parenOpen = start + 1;
    } else if (first.type === TokenType.LPAREN) {
      funcName = 'PROCEED';
      parenOpen = start;
    } else {
      funcName = null;
      parenOpen = -1;
    }

    if (parenOpen >= 0) {
      const parenClose = findMatchingCloser(tokens, parenOpen, end, TokenType.RPAREN);

      // Only treat as function call if matching ) is at the very end
      if (parenClose === end - 1) {
        const innerStart = parenOpen + 1;
        const innerEnd = parenClose;

        const argSpans = splitArgs(tokens, innerStart, innerEnd);
        const precedents = [funcName];

        for (const [aStart, aEnd] of argSpans) {
          precedents.push(parseArg(tokens, aStart, aEnd, anonymousExprs, expressionMap));
        }

        return precedents;
      }
    }
  }

  // 2. Main operator
  const mainIdx = findMainOperator(tokens, start, end);

  if (mainIdx >= 0) {
    const opToken = tokens[mainIdx];
    const opInfo = OPERATORS[opToken.value];

    // Special case: range operator (:)
    if (opToken.type === TokenType.COLON) {
      const leftStr = parseArg(tokens, start, mainIdx, anonymousExprs, expressionMap);
      const rightStr = parseArg(tokens, mainIdx + 1, end, anonymousExprs, expressionMap);

      if (!isCellReference(leftStr) || !isCellReference(rightStr)) {
        throw { type: 'SYNTAX', startToken: start, endToken: end };
      }

      const { cells } = expandRange(leftStr, rightStr);
      return ['ARRAY', ...cells];
    }

    return [
      opInfo.name,
      parseArg(tokens, start, mainIdx, anonymousExprs, expressionMap),
      parseArg(tokens, mainIdx + 1, end, anonymousExprs, expressionMap)
    ];
  }

  // 3. Unary minus (NEGATE)
  if (first.type === TokenType.OP && first.value === '-') {
    const restStart = start + 1;

    // Negative literal: single NUMBER token after the minus
    if (end - restStart === 1 && tokens[restStart].type === TokenType.NUMBER) {
      return ['PROCEED', '-' + tokens[restStart].value];
    }

    return ['NEGATE', parseArg(tokens, restStart, end, anonymousExprs, expressionMap)];
  }

  // 4. Single token
  if (end - start === 1) {
    return ['PROCEED', first.value];
  }

  // 5. Unparseable — syntax error
  throw { type: 'SYNTAX', startToken: start, endToken: end };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a token array into precedent structure.
 *
 * Token arrays must not contain WHITESPACE tokens — callers should strip them before passing.
 *
 * @param {Token[]} tokens - Normalized token array (no WHITESPACE)
 * @returns {ParseResult} Object with precedents array, anonymous expressions, expressionMap, and tokens
 */
export function parseFormula(tokens) {
  const anonymousExpressions = [];
  const expressionMap = {};

  try {
    // Skip leading EQUALS token
    const start = (tokens.length > 0 && tokens[0].type === TokenType.EQUALS) ? 1 : 0;

    if (start >= tokens.length) {
      return { precedents: ['PROCEED', ''], anonymousExpressions: [], expressionMap, tokens };
    }

    const precedents = parseExpression(tokens, start, tokens.length, anonymousExpressions, expressionMap);
    return { precedents, anonymousExpressions, expressionMap, tokens };

  } catch (err) {
    return {
      precedents: ['PROCEED', '#SYNTAX!'],
      anonymousExpressions: [],
      expressionMap,
      tokens,
      errorSpan: err.startToken != null
        ? { startToken: err.startToken, endToken: err.endToken }
        : null
    };
  }
}
