/**
 * @file Built-In Spreadsheet Functions
 * @description Function implementations for spreadsheet formulas with type-aware operations.
 *
 * **Architecture:**
 * Functions are defined with variants - each variant specifies argument types,
 * return type, and implementation. The validation system matches arguments to
 * the appropriate variant and wraps the result with the declared return type.
 *
 * **Return Value Convention:**
 * Functions return `{ value, generates }` where:
 * - `value` is the computed result (may be NaN/Infinity for runtime errors)
 * - `generates` is set when the function detects a problem (e.g., '#DOMAIN!')
 *
 * The validation wrapper merges input errorMeta with any generated error.
 * Structural errors (type === 'error') are handled at the validation level
 * and strictly propagate - functions don't need to handle them.
 *
 * **Runtime Errors:**
 * - Use JavaScript's NaN, Infinity, -Infinity for runtime errors
 * - Set `generates` to document the error (e.g., '#DOMAIN!')
 * - Let JS do what it naturally does (1/0 = Infinity, etc.)
 *
 * **Supported Types:**
 * - `number` - Numeric values (NaN/Inf are runtime errors)
 * - `date` - Date values (integer days)
 * - `datetime` - Datetime values (fractional days allowed)
 * - `text` - String values
 * - `boolean` - true/false (NaN for indeterminate)
 * - `range` - Range of cells
 *
 * @example
 * // Simple transformer
 * function MULTIPLY(values) {
 *   return { value: values[0].refValue * values[1].refValue };
 * }
 *
 * @example
 * // With domain validation
 * function DIVIDE(values) {
 *   const [left, right] = values;
 *   let generates;
 *   if (right.refValue === 0) {
 *     generates = '#DOMAIN!';
 *   }
 *   return { value: left.refValue / right.refValue, generates };
 * }
 */


import { isObjectType, getObjectFieldTypes } from './typeService.js';
import { functionSignatures } from '../functionSignatures.js';

/**
 * Build variants from shared signatures with a single impl for all variants.
 */
function variants(funcName, impl) {
  return functionSignatures[funcName].map(sig => ({
    argTypes: sig.inputs,
    returnType: sig.output,
    impl,
  }));
}

/**
 * Build variants from a subset of shared signatures.
 * @param {string} funcName - function name in shared signatures
 * @param {Function} impl - impl for all matched variants
 * @param {Function} filter - predicate to select which signatures to include
 */
function variantsFiltered(funcName, impl, filter) {
  return functionSignatures[funcName].filter(filter).map(sig => ({
    argTypes: sig.inputs,
    returnType: sig.output,
    impl,
  }));
}

// ============================================================================
// SPECIAL FUNCTIONS
// ============================================================================

/**
 * PROCEED - Pass through a single value unchanged.
 * @param {Array} values - Array with single value
 * @returns {Object} { value }
 */
function PROCEED(values) {
  return { value: values[0].refValue };
}

/**
 * ARRAY - Collect cell values into a flat array of raw values.
 * @param {Array} args - Array of {refValue, type} cell values
 * @returns {Object} { value: [val, val, ...] }
 */
function ARRAY(args) {
  return { value: args.map(a => a.refValue) };
}

/**
 * NEGATE - Negate a numeric value (unary minus).
 * @param {Array} values - Array with single numeric value
 * @returns {Object} { value }
 */
function NEGATE(values) {
  return { value: -values[0].refValue };
}

/**
 * INDEX - Access a value from an object by key/position.
 * Used to extract individual outputs from multi-output functions.
 * @param {Array} values - [object, key/index]
 * @returns {Object} { value }
 * @example INDEX({DOUBLE: 20, HALF: 5}, 1) => 20 (by position, 1-indexed)
 * @example INDEX({DOUBLE: 20, HALF: 5}, "HALF") => 5 (by name)
 */
function INDEX(values) {
  const obj = values[0].refValue;
  const key = values[1].refValue;

  if (obj === null || obj === undefined) {
    return { value: NaN, generates: '#VALUE!' };
  }

  if (typeof key === 'number') {
    const vals = Object.values(obj);
    if (key < 1 || key > vals.length) {
      return { value: NaN, generates: '#REF!' };
    }
    return { value: vals[key - 1] };
  }

  // Access by name (case-insensitive — output names are uppercase,
  // but text constants from cells may be mixed case)
  const upperKey = key.toUpperCase();
  const match = Object.keys(obj).find(k => k.toUpperCase() === upperKey);
  if (match === undefined) {
    return { value: NaN, generates: '#REF!' };
  }
  return { value: obj[match] };
}

/**
 * INDEX_ARRAY - Access a value from an array by position (1-indexed).
 * @param {Array} values - [array, position]
 * @returns {Object} { value }
 */
function INDEX_ARRAY(values) {
  const arr = values[0].refValue;
  const key = values[1].refValue;

  if (arr === null || arr === undefined) {
    return { value: NaN, generates: '#VALUE!' };
  }

  if (key < 1 || key > arr.length) {
    return { value: NaN, generates: '#REF!' };
  }
  return { value: arr[key - 1] };
}


// ============================================================================
// ARITHMETIC OPERATORS
// ============================================================================

/**
 * ADD - Add two values (number or datetime arithmetic).
 * @param {Array} values - Array with two values
 * @returns {Object} { value }
 */
function ADD(values) {
  return { value: values[0].refValue + values[1].refValue };
}

/**
 * ADD_DATE - Add date + number, truncating to whole days.
 * @param {Array} values - Array with two values
 * @returns {Object} { value }
 */
function ADD_DATE(values) {
  const [left, right] = values;
  return { value: Math.trunc(left.refValue + right.refValue) };
}

/**
 * SUBTRACT - Subtract two values (number or datetime arithmetic).
 * @param {Array} values - Array with two values
 * @returns {Object} { value }
 */
function SUBTRACT(values) {
  return { value: values[0].refValue - values[1].refValue };
}

/**
 * SUBTRACT_DATE - Subtract number from date, truncating to whole days.
 * @param {Array} values - Array with two values
 * @returns {Object} { value }
 */
function SUBTRACT_DATE(values) {
  const [left, right] = values;
  return { value: Math.trunc(left.refValue - right.refValue) };
}

/**
 * MULTIPLY - Multiply two numbers.
 * @param {Array} values - Array with two numeric values
 * @returns {Object} { value }
 */
function MULTIPLY(values) {
  return { value: values[0].refValue * values[1].refValue };
}

/**
 * DIVIDE - Divide two numbers.
 * @param {Array} values - Array with two numeric values
 * @returns {Object} { value, generates? }
 */
function DIVIDE(values) {
  const [left, right] = values;
  let generates;

  if (right.refValue === 0) {
    generates = '#DOMAIN!';
  }

  // JS naturally produces Infinity for x/0
  return { value: left.refValue / right.refValue, generates };
}

/**
 * EXPONENT - Raise a number to a power.
 * @param {Array} values - Array with two numeric values (base, exponent)
 * @returns {Object} { value }
 */
function EXPONENT(values) {
  return { value: Math.pow(values[0].refValue, values[1].refValue) };
}


/**
 * LN - Calculate natural logarithm (base e).
 * @param {Array} values - Array with 1 numeric value
 * @returns {Object} { value, generates? }
 */
function LN(values) {
  const [number] = values;
  let generates;

  if (number.refValue <= 0) {
    generates = '#DOMAIN!';
  }

  return { value: Math.log(number.refValue), generates };
}



/**
 * EXP - Calculate e raised to a power.
 * @param {Array} values - Array with 1 numeric value
 * @returns {Object} { value }
 */
function EXP(values) {
  return { value: Math.exp(values[0].refValue) };
}

/**
 * SIN - Calculate sine of angle in radians.
 * @param {Array} values - Array with 1 numeric value (angle in radians)
 * @returns {Object} { value }
 */
function SIN(values) {
  return { value: Math.sin(values[0].refValue) };
}

/**
 * FLOOR - Round down to nearest integer (toward negative infinity).
 * @param {Array} values - Array with 1 numeric value
 * @returns {Object} { value }
 */
function FLOOR(values) {
  return { value: Math.floor(values[0].refValue) };
}

/**
 * MOD - Modulo (remainder after division).
 * @param {Array} values - Array with 2 numeric values [dividend, divisor]
 * @returns {Object} { value }
 */
function MOD(values) {
  return { value: values[0].refValue % values[1].refValue };
}


// ============================================================================
// COMPARISON OPERATORS
// ============================================================================

/**
 * EQUAL - Test numeric equality.
 * Non-finite inputs (NaN/Inf) propagate as NaN.
 * @param {Array} values - Array with two numeric values
 * @returns {Object} { value: boolean or NaN }
 */
function EQUAL(values) {
  const [left, right] = values;
  if (!isFinite(left.refValue) || !isFinite(right.refValue)) {
    return { value: NaN };
  }
  return { value: left.refValue === right.refValue };
}

/**
 * EQUAL_GENERAL - Test equality for text/boolean.
 * NaN propagates (a !== a is only true for NaN).
 * @param {Array} values - Array with two values
 * @returns {Object} { value: boolean or NaN }
 */
function EQUAL_GENERAL(values) {
  const [left, right] = values;
  if (left.refValue !== left.refValue || right.refValue !== right.refValue) {
    return { value: NaN };
  }
  return { value: left.refValue === right.refValue };
}

/**
 * NOTEQUAL - Test numeric inequality.
 * Non-finite inputs (NaN/Inf) propagate as NaN.
 * @param {Array} values - Array with two numeric values
 * @returns {Object} { value: boolean or NaN }
 */
function NOTEQUAL(values) {
  const [left, right] = values;
  if (!isFinite(left.refValue) || !isFinite(right.refValue)) {
    return { value: NaN };
  }
  return { value: left.refValue !== right.refValue };
}

/**
 * NOTEQUAL_GENERAL - Test inequality for text/boolean.
 * NaN propagates (a !== a is only true for NaN).
 * @param {Array} values - Array with two values
 * @returns {Object} { value: boolean or NaN }
 */
function NOTEQUAL_GENERAL(values) {
  const [left, right] = values;
  if (left.refValue !== left.refValue || right.refValue !== right.refValue) {
    return { value: NaN };
  }
  return { value: left.refValue !== right.refValue };
}

/**
 * LESS - Test less than.
 * Non-finite inputs (NaN/Inf) propagate as NaN.
 * @param {Array} values - Array with two values
 * @returns {Object} { value: boolean or NaN }
 */
function LESS(values) {
  const [left, right] = values;
  if (!isFinite(left.refValue) || !isFinite(right.refValue)) {
    return { value: NaN };
  }
  return { value: left.refValue < right.refValue };
}

/**
 * GREATER - Test greater than.
 * Non-finite inputs (NaN/Inf) propagate as NaN.
 * @param {Array} values - Array with two values
 * @returns {Object} { value: boolean or NaN }
 */
function GREATER(values) {
  const [left, right] = values;
  if (!isFinite(left.refValue) || !isFinite(right.refValue)) {
    return { value: NaN };
  }
  return { value: left.refValue > right.refValue };
}

/**
 * LESSEQUAL - Test less than or equal.
 * Non-finite inputs (NaN/Inf) propagate as NaN.
 * @param {Array} values - Array with two values
 * @returns {Object} { value: boolean or NaN }
 */
function LESSEQUAL(values) {
  const [left, right] = values;
  if (!isFinite(left.refValue) || !isFinite(right.refValue)) {
    return { value: NaN };
  }
  return { value: left.refValue <= right.refValue };
}

/**
 * GREATEREQUAL - Test greater than or equal.
 * Non-finite inputs (NaN/Inf) propagate as NaN.
 * @param {Array} values - Array with two values
 * @returns {Object} { value: boolean or NaN }
 */
function GREATEREQUAL(values) {
  const [left, right] = values;
  if (!isFinite(left.refValue) || !isFinite(right.refValue)) {
    return { value: NaN };
  }
  return { value: left.refValue >= right.refValue };
}

// ============================================================================
// LOGICAL FUNCTIONS
// ============================================================================

/**
 * IF - Conditional function.
 * Non-boolean condition returns NaN (can't decide which branch).
 * @param {Array} values - Array with 3 values: condition, true_value, false_value
 * @returns {Object} { value }
 */
function IF(values) {
  const [condition, valueIfTrue, valueIfFalse] = values;

  // Non-boolean condition → can't decide which branch
  if (condition.refValue !== true && condition.refValue !== false) {
    return { value: NaN };
  }

  const selected = condition.refValue === true ? valueIfTrue : valueIfFalse;
  return { value: selected.refValue };
}

/**
 * AND - Logical AND function with short-circuit semantics.
 * Receives a single ARRAY[Boolean] argument. Short-circuits on false.
 * Non-boolean values (NaN) tracked but don't short-circuit.
 * @param {Array} values - Array with one ARRAY[Boolean] element
 * @returns {Object} { value: boolean or NaN }
 */
function AND(values) {
  const arr = values[0].refValue;
  let sawNaN = false;

  for (const val of arr) {
    if (val === false) {
      return { value: false };
    }
    if (val !== true) {
      sawNaN = true;
    }
  }

  return { value: sawNaN ? NaN : true };
}

/**
 * OR - Logical OR function with short-circuit semantics.
 * Receives a single ARRAY[Boolean] argument. Short-circuits on true.
 * Non-boolean values (NaN) tracked but don't short-circuit.
 * @param {Array} values - Array with one ARRAY[Boolean] element
 * @returns {Object} { value: boolean or NaN }
 */
function OR(values) {
  const arr = values[0].refValue;
  let sawNaN = false;

  for (const val of arr) {
    if (val === true) {
      return { value: true };
    }
    if (val !== false) {
      sawNaN = true;
    }
  }

  return { value: sawNaN ? NaN : false };
}

/**
 * NOT - Logical negation.
 * @param {Array} values - Array with 1 boolean value
 * @returns {Object} { value: boolean or NaN }
 */
function NOT(values) {
  const val = values[0].refValue;
  if (typeof val !== 'boolean') {
    return { value: NaN };
  }
  return { value: !val };
}

// ============================================================================
// ARRAY FUNCTIONS
// ============================================================================

/**
 * LEN - Return the length of an array.
 * Receives a single ARRAY argument.
 * @param {Array} values - Array with one ARRAY element
 * @returns {Object} { value }
 */
function LEN(values) {
  return { value: values[0].refValue.length };
}

// ============================================================================
// AGGREGATION FUNCTIONS
// ============================================================================

/**
 * SUM - Sum all numeric values.
 * Receives a single ARRAY[Number] argument. NaN/Infinity propagate naturally.
 * @param {Array} values - Array with one ARRAY[Number] element
 * @returns {Object} { value }
 */
function SUM(values) {
  const arr = values[0].refValue;
  let total = 0;
  for (const val of arr) {
    total += val;
  }
  return { value: total };
}

/**
 * MIN - Return the minimum of all numeric values.
 * Receives a single ARRAY[Number] argument.
 * @param {Array} values - Array with one ARRAY[Number] element
 * @returns {Object} { value }
 */
function MIN(values) {
  const arr = values[0].refValue;
  let min = Infinity;
  for (const val of arr) {
    if (val < min) min = val;
  }
  return { value: min };
}

/**
 * MAX - Return the maximum of all numeric values.
 * Receives a single ARRAY[Number] argument.
 * @param {Array} values - Array with one ARRAY[Number] element
 * @returns {Object} { value }
 */
function MAX(values) {
  const arr = values[0].refValue;
  let max = -Infinity;
  for (const val of arr) {
    if (val > max) max = val;
  }
  return { value: max };
}

// ============================================================================
// FUNCTION REGISTRY
// ============================================================================

/**
 * Get the built-in function registry.
 *
 * Type signatures come from ../functionSignatures.js (shared with transpiler).
 * This file attaches runtime implementations to those signatures.
 *
 * Each function has:
 * - `variants`: Array of {argTypes, returnType, impl} — built from shared signatures
 * - `arrayConstructor` (ARRAY only): special handling for variadic array construction
 *
 * @returns {Object} Function registry
 */
export function getBuiltInFunctions() {
  return {
    PROCEED: { variants: variants('PROCEED', PROCEED) },

    ARRAY: { arrayConstructor: true, impl: ARRAY },

    NEGATE: { variants: variants('NEGATE', NEGATE) },

    // INDEX uses two impls: INDEX for Object access, INDEX_ARRAY for ARRAY access.
    // resolveReturnType handles dynamic return types for Object[...] inputs.
    INDEX: {
      variants: [
        { argTypes: ['Object', 'Number'], returnType: 'Dynamic', impl: INDEX },
        { argTypes: ['Object', 'Text'], returnType: 'Dynamic', impl: INDEX },
        { argTypes: ['ARRAY[Number]', 'Number'], returnType: 'Number', impl: INDEX_ARRAY },
        { argTypes: ['ARRAY[Text]', 'Number'], returnType: 'Text', impl: INDEX_ARRAY },
        { argTypes: ['ARRAY[Boolean]', 'Number'], returnType: 'Boolean', impl: INDEX_ARRAY },
        { argTypes: ['ARRAY[Date]', 'Number'], returnType: 'Date', impl: INDEX_ARRAY },
        { argTypes: ['ARRAY[Datetime]', 'Number'], returnType: 'Datetime', impl: INDEX_ARRAY },
      ],
      resolveReturnType(variant, args) {
        const objType = args[0].type;
        if (!isObjectType(objType)) return variant.returnType;
        const fieldTypes = getObjectFieldTypes(objType);
        const key = args[1].refValue;
        const pos = typeof key === 'number'
          ? key - 1
          : Object.keys(args[0].refValue).findIndex(k => k.toUpperCase() === key.toUpperCase());
        if (pos < 0 || pos >= fieldTypes.length) return 'Error';
        return fieldTypes[pos];
      }
    },

    ADD: {
      variants: [
        { argTypes: ['Number', 'Number'], returnType: 'Number', impl: ADD },
        { argTypes: ['Date', 'Number'], returnType: 'Date', impl: ADD_DATE },
        { argTypes: ['Number', 'Date'], returnType: 'Date', impl: ADD_DATE },
        { argTypes: ['Datetime', 'Number'], returnType: 'Datetime', impl: ADD },
        { argTypes: ['Number', 'Datetime'], returnType: 'Datetime', impl: ADD },
      ],
    },

    SUBTRACT: {
      variants: [
        { argTypes: ['Number', 'Number'], returnType: 'Number', impl: SUBTRACT },
        { argTypes: ['Date', 'Number'], returnType: 'Date', impl: SUBTRACT_DATE },
        { argTypes: ['Date', 'Date'], returnType: 'Number', impl: SUBTRACT },
        { argTypes: ['Datetime', 'Number'], returnType: 'Datetime', impl: SUBTRACT },
        { argTypes: ['Datetime', 'Datetime'], returnType: 'Number', impl: SUBTRACT },
      ],
    },

    MULTIPLY: { variants: variants('MULTIPLY', MULTIPLY) },
    DIVIDE: { variants: variants('DIVIDE', DIVIDE) },
    EXPONENT: { variants: variants('EXPONENT', EXPONENT) },
    LN: { variants: variants('LN', LN) },
    EXP: { variants: variants('EXP', EXP) },
    SIN: { variants: variants('SIN', SIN) },
    FLOOR: { variants: variants('FLOOR', FLOOR) },

    MOD: { variants: variants('MOD', MOD) },

    EQUAL: {
      variants: [
        ...variantsFiltered('EQUAL', EQUAL_GENERAL, sig => sig.inputs[0] === 'Text'),
        ...variantsFiltered('EQUAL', EQUAL, sig => sig.inputs[0] === 'Number'),
        ...variantsFiltered('EQUAL', EQUAL_GENERAL, sig => sig.inputs[0] === 'Boolean'),
        ...variantsFiltered('EQUAL', EQUAL, sig => ['Date', 'Datetime'].includes(sig.inputs[0])),
      ],
    },

    NOTEQUAL: {
      variants: [
        ...variantsFiltered('NOTEQUAL', NOTEQUAL_GENERAL, sig => sig.inputs[0] === 'Text'),
        ...variantsFiltered('NOTEQUAL', NOTEQUAL, sig => sig.inputs[0] === 'Number'),
        ...variantsFiltered('NOTEQUAL', NOTEQUAL_GENERAL, sig => sig.inputs[0] === 'Boolean'),
        ...variantsFiltered('NOTEQUAL', NOTEQUAL, sig => ['Date', 'Datetime'].includes(sig.inputs[0])),
      ],
    },

    LESS: { variants: variants('LESS', LESS) },
    GREATER: { variants: variants('GREATER', GREATER) },
    LESSEQUAL: { variants: variants('LESSEQUAL', LESSEQUAL) },
    GREATEREQUAL: { variants: variants('GREATEREQUAL', GREATEREQUAL) },

    IF: { variants: variants('IF', IF) },
    AND: { variants: variants('AND', AND) },
    OR: { variants: variants('OR', OR) },
    NOT: { variants: variants('NOT', NOT) },

    LEN: { variants: variants('LEN', LEN) },

    SUM: { variants: variants('SUM', SUM) },
    MIN: { variants: variants('MIN', MIN) },
    MAX: { variants: variants('MAX', MAX) },
  };
}

/**
 * Derive the list of built-in functions that take a single ARRAY argument
 * (e.g. SUM, MIN, MAX, AND, OR). Used by canonicalValuesEngine to know
 * which functions need ARRAY wrapping.
 */
export function deriveSingleArrayFunctions(builtIns = getBuiltInFunctions()) {
  const result = [];
  for (const [name, def] of Object.entries(builtIns)) {
    if (!def.variants) continue;
    if (def.variants.every(v => v.argTypes.length === 1 && v.argTypes[0].startsWith('ARRAY['))) {
      result.push(name);
    }
  }
  return result;
}

/**
 * Look up the return type of a built-in function given actual argument types.
 * Returns the matching variant's returnType, or falls back to the consensus
 * return type across all variants, or 'Number' as a last resort.
 *
 * @param {string} funcName
 * @param {string[]} argTypes
 * @param {Object} [builtIns] - override built-in function registry
 * @returns {string}
 */
export function inferReturnType(funcName, argTypes, builtIns = getBuiltInFunctions()) {
  const def = builtIns[funcName];
  if (!def?.variants) return 'Number';
  for (const variant of def.variants) {
    if (variant.argTypes.length !== argTypes.length) continue;
    if (variant.argTypes.every((expected, i) => expected === argTypes[i])) {
      return variant.returnType;
    }
  }
  const returnTypes = new Set(def.variants.map(v => v.returnType));
  if (returnTypes.size === 1) return returnTypes.values().next().value;
  return 'Number';
}
