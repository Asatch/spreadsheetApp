/**
 * @file Formula Parser
 * @description Pure formula parsing utility that takes normalized formula strings and returns precedent structures.
 *
 * **Key Features:**
 * - Parses formulas into precedent arrays for calculation engine
 * - Handles operator precedence and parentheses
 * - Extracts anonymous sub-expressions for recursive evaluation
 * - Supports unary minus (NEGATE) operator
 *
 * **Unary Minus Handling:**
 * - Negative literals: `=-5` → `['PROCEED', '-5']`
 * - Negated cell refs: `=-A1` → `['NEGATE', 'A1']`
 * - Negated expressions: `=-(A1+B1)` → `['NEGATE', '=A1+B1']`
 * - In complex formulas: `=A1+-5` → `['ADD', 'A1', '=-5']`
 *
 * **Input:** Normalized formula (uppercase, no spaces), starting with `=`
 * **Output:** `{ precedents: Array, anonymousExpressions: Array }`
 * **Error Handling:** Returns `['PROCEED', '#SYNTAX!']` on parse error
 *
 * @example
 * const result = parseFormula('=A1+B1');
 * // Returns: {
 * //   precedents: ['ADD', 'A1', 'B1'],
 * //   anonymousExpressions: []
 * // }
 */

import { expandRange, isCellReference } from './cellUtils.js';

/**
 * @typedef {Object} ParseResult
 * @property {Array<string>} precedents - Array of precedents, first element is operation name
 * @property {Array<string>} anonymousExpressions - Array of extracted sub-expressions to be parsed recursively
 */

/**
 * @typedef {Object} OperatorInfo
 * @property {string} op - The operator character(s) (e.g., '+', '<=', '^')
 * @property {string} name - The operator name for precedent array (e.g., 'ADD', 'LESSEQUAL')
 * @property {number} index - Position of operator in formula string
 * @property {number} length - Length of operator (1 or 2 characters)
 */

/**
 * Splits a string on commas at depth 0 (ignoring commas inside parentheses).
 *
 * Used to parse function arguments where commas separate args but commas
 * inside nested expressions should be ignored.
 *
 * @param {string} str - The string to split (e.g., "A1,SUM(B1,B2),C1")
 * @returns {string[]} Array of parts split by top-level commas
 *
 * @example
 * splitOnCommas("A1,SUM(B1,B2),C1")
 * // Returns: ["A1", "SUM(B1,B2)", "C1"]
 */
export function splitOnCommas(str) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string} */
  let current = '';
  /** @type {number} */
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Checks if a minus sign at position i is unary (not binary subtraction).
 *
 * A minus is unary if it appears:
 * - At the start of the formula
 * - After an operator or delimiter (e.g., `(`, `,`, `+`, `-`, `*`, `/`, `^`, `=`, `<`, `>`)
 *
 * @param {string} formula - The formula string
 * @param {number} i - Position of the minus sign to check
 * @returns {boolean} True if the minus is unary (negation), false if binary (subtraction)
 *
 * @example
 * isUnaryMinus("A1+-5", 2)  // true (after +)
 * isUnaryMinus("A1-5", 2)   // false (binary subtraction)
 */
function isUnaryMinus(formula, i) {
  // At start of formula
  if (i === 0) return true;

  // After operators or delimiters
  const prev = formula[i - 1];
  return '(,+-*/^=<>'.includes(prev);
}

/**
 * Finds the main operator in a formula by precedence (lowest precedence wins).
 *
 * Only considers operators at depth 0 (outside parentheses). Returns the rightmost
 * operator when multiple operators have the same precedence (left-to-right evaluation).
 *
 * **Operator precedence (lowest to highest):**
 * 1. Comparison: `=`, `<>`, `<=`, `>=`, `<`, `>`
 * 2. Addition/Subtraction: `+`, `-`
 * 3. Multiplication/Division: `*`, `/`
 * 4. Exponentiation: `^`
 * 5. Range: `:`
 *
 * @param {string} formula - The formula string (without leading =)
 * @returns {OperatorInfo|null} Info about the main operator, or null if none found
 *
 * @example
 * findMainOperator("A1+B1*C1")
 * // Returns: { op: '+', name: 'ADD', index: 2, length: 1 }
 */
function findMainOperator(formula) {
  /**
   * Operator definitions with precedence and operation names.
   * @type {Object<string, {precedence: number, name: string}>}
   */
  const operators = {
    '=': { precedence: 1, name: 'EQUAL' },
    '<>': { precedence: 1, name: 'NOTEQUAL' },
    '<=': { precedence: 1, name: 'LESSEQUAL' },
    '>=': { precedence: 1, name: 'GREATEREQUAL' },
    '<': { precedence: 1, name: 'LESS' },
    '>': { precedence: 1, name: 'GREATER' },
    '+': { precedence: 2, name: 'ADD' },
    '-': { precedence: 2, name: 'SUBTRACT' },
    '*': { precedence: 3, name: 'MULTIPLY' },
    '/': { precedence: 3, name: 'DIVIDE' },
    '^': { precedence: 4, name: 'EXPONENT' },
    ':': { precedence: 5, name: 'ARRAY' }
  };

  /** @type {OperatorInfo|null} */
  let mainOp = null;
  /** @type {number} */
  let minPrecedence = Infinity;
  /** @type {number} */
  let depth = 0;

  for (let i = 0; i < formula.length; i++) {
    if (formula[i] === '(') {
      depth++;
    } else if (formula[i] === ')') {
      depth--;
    } else if (depth === 0) {
      // Check for two-character operators first
      /** @type {string} */
      const twoChar = formula.substring(i, i + 2);
      if (operators[twoChar]) {
        if (operators[twoChar].precedence <= minPrecedence) {
          minPrecedence = operators[twoChar].precedence;
          mainOp = {
            op: twoChar,
            name: operators[twoChar].name,
            index: i,
            length: 2
          };
        }
        i++; // Skip next character (loop increment will move past this operator)
      } else if (operators[formula[i]]) {
        // Skip minus signs that are unary operators
        if (formula[i] === '-' && isUnaryMinus(formula, i)) {
          continue;
        }

        if (operators[formula[i]].precedence <= minPrecedence) {
          minPrecedence = operators[formula[i]].precedence;
          mainOp = {
            op: formula[i],
            name: operators[formula[i]].name,
            index: i,
            length: 1
          };
        }
      }
    }
  }

  return mainOp;
}

/**
 * Checks if a string contains operators, function calls, or parentheses (complex expression).
 *
 * Complex expressions need to be extracted as anonymous expressions for recursive parsing.
 *
 * @param {string} str - The string to check
 * @returns {boolean} True if string contains operators or parentheses
 *
 * @example
 * isComplex("A1+B1")  // true (has operator)
 * isComplex("(5)")    // true (has parentheses)
 * isComplex("A1")     // false (simple reference)
 * isComplex("42")     // false (simple literal)
 */
function isComplex(str) {
  // Check for operators or parentheses (including bare grouping like (5))
  /** @type {RegExp} Matches operators or parentheses */
  const complexPattern = /[+\-*/^=<>:()]/;
  return complexPattern.test(str);
}

/**
 * Checks if a string is a numeric literal (including negative numbers).
 *
 * Matches integers and decimals, with optional negative sign.
 *
 * @param {string} str - The string to check
 * @returns {boolean} True if string is a valid number literal
 *
 * @example
 * isNumber("42")      // true
 * isNumber("-3.14")   // true
 * isNumber("A1")      // false
 * isNumber("1.2.3")   // false
 */
function isNumber(str) {
  /** @type {RegExp} Matches optional minus, digits, optional decimal with digits */
  const numberPattern = /^-?\d+(\.\d+)?$/;
  return numberPattern.test(str);
}

/**
 * Parses an argument, detecting complex sub-expressions.
 *
 * If the argument is complex (contains operators/parentheses), it's extracted as an
 * anonymous expression for recursive parsing. The expression is prefixed with `=` and
 * added to the anonymousExprs array, then the full expression key is returned.
 *
 * Simple values (cell refs, literals) are returned as-is.
 *
 * @param {string} arg - The argument to parse (e.g., "A1", "5", "B1+C1")
 * @param {Array<string>} anonymousExprs - Array to collect anonymous expressions (mutated)
 * @returns {string} The argument (unchanged) or anonymous expression key (e.g., "=B1+C1")
 *
 * @example
 * const exprs = [];
 * parseArg("A1", exprs)      // Returns: "A1", exprs: []
 * parseArg("B1+C1", exprs)   // Returns: "=B1+C1", exprs: ["=B1+C1"]
 */
function parseArg(arg, anonymousExprs) {
  if (isComplex(arg)) {
    /** @type {string} */
    const extracted = `=${arg}`;
    anonymousExprs.push(extracted);
    return extracted;
  }
  // Return as string - literals will be converted during evaluation
  return arg;
}

/**
 * Main formula parser - converts normalized formula string into precedent structure.
 *
 * Takes a normalized formula (uppercase, no spaces, leading `=`) and parses it into
 * a precedent array that the calculation engine can execute. Extracts complex
 * sub-expressions as anonymous expressions for recursive parsing.
 *
 * **Precedent array format:**
 * - First element: Operation name (e.g., 'ADD', 'PROCEED', 'NEGATE', 'SUM')
 * - Remaining elements: Arguments (cell refs, literals, or anonymous expression keys)
 *
 * **Special operations:**
 * - `PROCEED`: Pass-through for simple values/refs (e.g., `['PROCEED', 'A1']`)
 * - `NEGATE`: Unary minus (e.g., `['NEGATE', 'A1']`)
 * - `ARRAY`: Expanded range (e.g., `['ARRAY', '2', '2', 'A1', 'A2', 'B1', 'B2']`)
 *
 * **Error handling:**
 * On parse error, returns `{ precedents: ['PROCEED', '#SYNTAX!'], anonymousExpressions: [] }`
 *
 * @param {string} formula - Normalized formula (uppercase, no spaces), starting with `=`
 * @returns {ParseResult} Object with precedents array and anonymous expressions array
 *
 * @example
 * parseFormula('=A1+B1')
 * // Returns: { precedents: ['ADD', 'A1', 'B1'], anonymousExpressions: [] }
 *
 * @example
 * parseFormula('=SUM(A1,B1+C1)')
 * // Returns: { precedents: ['SUM', 'A1', '=B1+C1'], anonymousExpressions: ['=B1+C1'] }
 *
 * @example
 * parseFormula('=-A1')
 * // Returns: { precedents: ['NEGATE', 'A1'], anonymousExpressions: [] }
 */
export function parseFormula(formula) {
  /** @type {string[]} */
  const anonymousExpressions = [];

  try {
    // Strip leading = and remove $ and ~ symbols
    // $ marks absolute references, ~ marks relative literals - both are adjustment markers
    // that don't affect the evaluated value, only how the formula adjusts during copy/fill
    /** @type {string} */
    const normalized = formula.substring(1).replace(/[$~]/g, '');

    // Check if entire expression is a function call or grouping
    // Must verify that opening ( matches closing ) at end (not just any parentheses)
    /** @type {RegExpMatchArray|null} */
    const funcMatch = normalized.match(/^([A-Z0-9_]*)\(/);
    if (funcMatch && normalized[normalized.length - 1] === ')') {
      // Verify the opening paren matches the closing paren
      // Count depth to ensure they're balanced
      /** @type {string} */
      const funcName = funcMatch[1] || 'PROCEED';
      /** @type {number} */
      const openIndex = funcMatch[0].length - 1; // Index of opening (
      /** @type {number} */
      let depth = 0;
      /** @type {number} */
      let matchingCloseIndex = -1;

      for (let i = openIndex; i < normalized.length; i++) {
        if (normalized[i] === '(') depth++;
        else if (normalized[i] === ')') {
          depth--;
          if (depth === 0) {
            matchingCloseIndex = i;
            break;
          }
        }
      }

      // Only treat as function if matching ) is at the very end
      if (matchingCloseIndex === normalized.length - 1) {
        /** @type {string} */
        const argsString = normalized.substring(openIndex + 1, matchingCloseIndex);
        /** @type {string[]} */
        const args = splitOnCommas(argsString);

        /** @type {string[]} */
        const precedents = [
          funcName,
          ...args.map(arg => parseArg(arg, anonymousExpressions))
        ];

        return { precedents, anonymousExpressions };
      }
    }

    // Find main operator (checked BEFORE unary minus to handle =-1-1 correctly)
    /** @type {OperatorInfo|null} */
    const mainOp = findMainOperator(normalized);
    if (mainOp) {
      /** @type {string} */
      const left = normalized.substring(0, mainOp.index);
      /** @type {string} */
      const right = normalized.substring(mainOp.index + mainOp.length);

      // Special case for range operator
      if (mainOp.op === ':') {
        /** @type {string} */
        const leftParsed = parseArg(left, anonymousExpressions);
        /** @type {string} */
        const rightParsed = parseArg(right, anonymousExpressions);

        // Validate that both sides are cell references
        if (!isCellReference(leftParsed) || !isCellReference(rightParsed)) {
          throw { type: 'SYNTAX' };
        }

        const { cells } = expandRange(leftParsed, rightParsed);
        /** @type {string[]} */
        const precedents = ['ARRAY', ...cells];

        return { precedents, anonymousExpressions };
      } else {
        /** @type {string[]} */
        const precedents = [
          mainOp.name,
          parseArg(left, anonymousExpressions),
          parseArg(right, anonymousExpressions)
        ];

        return { precedents, anonymousExpressions };
      }
    }

    // Check for unary minus (NEGATE operator)
    // Only reached if no main operator was found (e.g., =-5 or =-(1+1))
    if (normalized[0] === '-') {
      /** @type {string} */
      const rest = normalized.substring(1);

      // If what follows is a simple positive number, return as negative literal
      // (e.g., =-5 returns '-5' as a literal, not NEGATE of 5)
      // But =--5 should be NEGATE of -5, so only handle non-negative rest
      if (isNumber(rest) && rest[0] !== '-') {
        return {
          precedents: ['PROCEED', normalized],
          anonymousExpressions: []
        };
      }

      // Otherwise, wrap in NEGATE operator
      /** @type {string[]} */
      const precedents = [
        'NEGATE',
        parseArg(rest, anonymousExpressions)
      ];

      return { precedents, anonymousExpressions };
    }

    // Check for boolean literals (TRUE/FALSE)
    if (normalized === 'TRUE' || normalized === 'FALSE') {
      return {
        precedents: ['PROCEED', normalized],
        anonymousExpressions: []
      };
    }

    // Simple value or reference - wrap in PROCEED
    if (isComplex(normalized)) {
      throw { type: 'SYNTAX' };
    }

    /** @type {string[]} */
    const precedents = ['PROCEED', normalized];
    return { precedents, anonymousExpressions };

  } catch {
    // Syntax error - return error literal
    return {
      precedents: ['PROCEED', '#SYNTAX!'],
      anonymousExpressions: []
    };
  }
}
