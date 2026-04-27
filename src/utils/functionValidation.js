/**
 * @file Function Validation and Execution
 * @description Variant-based validation system for spreadsheet functions.
 *
 * **Architecture:**
 * Functions define variants with {argTypes, returnType, impl}. This module
 * matches arguments to the appropriate variant and executes the function.
 * Arguments are passed directly as {refValue, type} objects - no dimensional wrapping.
 *
 * **Error Handling:**
 * Two error categories with different propagation semantics:
 *
 * 1. **Structural Errors** (`#SYNTAX!`, `#NAME!`, `#REF!`, `#TYPE!`)
 *    - Keep `type: 'Error'`
 *    - Strict propagation - cannot be short-circuited
 *    - Mean "the formula is fundamentally broken"
 *
 * 2. **Runtime Errors** (`#DOMAIN!`, etc.)
 *    - Keep original type (e.g., `type: 'Number'`)
 *    - Use JavaScript's NaN, Infinity, -Infinity as values
 *    - Can be short-circuited by IF, OR, AND, etc.
 *    - Mean "the calculation encountered an exceptional condition"
 *
 * **errorMeta:**
 * All values can carry an `errorMeta` array that accumulates through the
 * calculation chain. Functions return `{ value, generates }` where `generates`
 * is set when the function detects a problem. The wrapper merges input
 * errorMeta with any generated error.
 *
 * **Validation Flow:**
 * 1. Validate argument structure (each arg has {refValue, type})
 * 2. Collect errorMeta from all inputs
 * 3. Check for structural errors - strict propagation
 * 4. Try each variant's argTypes until one matches
 * 5. If no match: return #TYPE!
 * 6. Call matched variant's impl with processed args
 * 7. Wrap result with returnType and merged errorMeta
 *
 * **Type Syntax:**
 * - 'Number', 'Date', 'Text', 'Boolean', 'Datetime', 'Error' - Exact type match
 * - 'ARRAY[Type]' - Array of raw values with the specified element type
 *
 * ARRAY is the only variadic function and is handled as a special case
 * (arrayConstructor flag) before variant matching.
 */

import { isArrayType, isObjectType } from './typeService.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function argTypesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Validate that a value has proper {refValue, type} structure.
 * @param {Object} val - Value to validate
 * @param {number} index - Argument index for error message
 * @throws {Error} If structure is invalid (CalcEngine bug)
 */
function validateValue(val, index) {
  if (!val || typeof val !== 'object' || !Object.hasOwn(val, 'refValue') || !Object.hasOwn(val, 'type')) {
    throw new Error(`[Functions] Argument ${index} missing refValue/type properties - CalcEngine bug`);
  }
}

/**
 * Validate that all arguments have proper structure.
 * @param {Array} args - Arguments to validate
 * @throws {Error} If structure is invalid
 */
function validateArgs(args) {
  for (let i = 0; i < args.length; i++) {
    validateValue(args[i], i);
  }
}

// ============================================================================
// TYPE MATCHING
// ============================================================================

/**
 * Check if a single value matches a type specification.
 *
 * Supports:
 * - Simple types: 'Number', 'Text', 'Date', 'Boolean', etc.
 * - Parameterized array types: 'ARRAY[Number]', 'ARRAY[Date]', etc.
 *   Matches by comparing the declared type annotation, not per-element.
 *
 * @param {Object} value - Value with {refValue, type}
 * @param {string} typeSpec - Type specification string
 * @returns {boolean} True if value matches type
 */
function matchesType(value, typeSpec) {
  // Handle parameterized array types: ARRAY[InnerType]
  if (typeSpec.startsWith('ARRAY[') && typeSpec.endsWith(']')) {
    if (!isArrayType(value?.type)) return false;

    // Compare inner types (case-insensitive)
    const expectedInner = typeSpec.slice(6, -1).toLowerCase();
    const actualInner = value.type.slice(6, -1).toLowerCase();
    return expectedInner === actualInner;
  }

  // Unparameterized 'Object' matches any Object[...] value
  if (typeSpec === 'Object') {
    return isObjectType(value?.type);
  }

  // Parameterized Object[...] requires exact match
  if (typeSpec.startsWith('Object[') && typeSpec.endsWith(']')) {
    return value?.type === typeSpec;
  }

  return value?.type === typeSpec;
}

/**
 * Match arguments against a type signature (1:1 positional).
 *
 * @param {Array} args - Array of arguments with {refValue, type}
 * @param {Array} signature - Type signature to match against
 * @returns {{success: boolean, args?: Array}} Match result with processed args
 */
function matchSignature(args, signature) {
  if (args.length !== signature.length) return { success: false };

  for (let i = 0; i < signature.length; i++) {
    if (!matchesType(args[i], signature[i])) {
      return { success: false };
    }
  }

  return { success: true, args };
}

// ============================================================================
// ERROR META HANDLING
// ============================================================================

/**
 * Collect errorMeta from all input values.
 * Deduplicates by source.
 *
 * Each errorMeta entry is { source: cellRef, error: errorCode }.
 * When multiple paths lead to the same source error, we keep only one.
 *
 * Arrays carry merged errorMeta on the ARRAY node itself (from when the
 * ARRAY function was evaluated), so no recursion into array elements needed.
 *
 * @param {Array} args - Array of input arguments with {refValue, type}
 * @returns {Array} Deduplicated array of error metadata objects
 */
function collectErrorMeta(args) {
  const seen = new Map(); // source -> error object

  for (const arg of args) {
    if (!arg?.errorMeta) continue;
    for (const meta of arg.errorMeta) {
      const key = meta.source;
      if (!seen.has(key)) {
        seen.set(key, meta);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Check if any input has a structural error (type === 'Error').
 * Returns the first structural error found, or null.
 *
 * Structural errors in array elements are caught when the ARRAY function
 * is evaluated — the ARRAY node itself becomes type 'Error'. So no
 * recursion into array elements needed.
 *
 * @param {Array} args - Array of input arguments with {refValue, type}
 * @returns {Object|null} First structural error, or null
 */
function findStructuralError(args) {
  for (const arg of args) {
    if (!arg) continue;
    if (arg.type === 'Error') {
      return arg;
    }
  }
  return null;
}

// ============================================================================
// MAIN VALIDATION AND EXECUTION
// ============================================================================

/**
 * Wrap a function result based on returnType and merge errorMeta.
 *
 * Functions return `{ value, generates }` where:
 * - `value` is the computed result (may be NaN/Infinity for runtime errors)
 * - `generates` is set when the function detects a problem (e.g., '#DOMAIN!')
 *
 * This function merges input errorMeta with any generated error.
 *
 * @param {Object} result - Result from impl: { value, generates }
 * @param {string} returnType - Declared return type from schema
 * @param {Array} inputErrorMetas - Collected errorMeta from all inputs
 * @returns {Object} Result with {refValue, type, errorMeta?}
 */
function wrapResult(result, returnType, inputErrorMetas) {
  const { value, generates } = result;

  // Structural error objects pass through unchanged (but merge errorMeta)
  // Note: result.refValue here is an error code string - it will be stamped
  // with a source later in processPhase3
  if (result && typeof result === 'object' && result.type === 'Error') {
    // inputErrorMetas are already {source, error} objects; result.refValue is unstamped
    // Pass through - the unstamped error will be stamped in processPhase3
    const mergedMeta = [...inputErrorMetas, { error: result.refValue }];
    return { ...result, errorMeta: mergedMeta };
  }

  // Merge input error metas with any generated error
  const mergedMeta = [...inputErrorMetas];
  if (generates) {
    // Generated errors are also unstamped - will be stamped in processPhase3
    mergedMeta.push({ error: generates });
  }

  // Check for overflow (Infinity/NaN) not already flagged by upstream or generates
  if (typeof value === 'number' && !isFinite(value) && mergedMeta.length === 0) {
    mergedMeta.push({ error: '#OVERFLOW!' });
  }

  // Build final result
  const output = {
    refValue: value,
    type: returnType
  };

  // Only attach errorMeta if non-empty
  if (mergedMeta.length > 0) {
    output.errorMeta = mergedMeta;
  }

  return output;
}

/**
 * Validate arguments and execute a function.
 *
 * Main entry point for function execution:
 * 1. Validate argument structure
 * 2. Collect errorMeta from all inputs
 * 3. Check for structural errors - strict propagation
 * 4. Special case: ARRAY (arrayConstructor) — validate all args same type, execute
 * 5. Try each variant's argTypes until one matches
 * 6. If no match: return #TYPE!
 * 7. Call matched variant's impl with processed args and wrap result
 *
 * @param {Array} args - Array of arguments, each with {refValue, type}
 * @param {Object} funcDef - Function definition with variants (or arrayConstructor + impl)
 * @returns {Object} Result with {refValue, type, errorMeta?}
 */
function validateAndExecute(args, funcDef) {
  // Validate argument structure
  validateArgs(args);

  // Collect errorMeta from all inputs
  const inputErrorMetas = collectErrorMeta(args);

  // Check for structural errors - strict propagation (cannot be short-circuited)
  const structuralError = findStructuralError(args);
  if (structuralError) {
    return {
      refValue: structuralError.refValue,
      type: 'Error',
      errorMeta: [...inputErrorMetas, { error: structuralError.refValue }]
    };
  }

  // Special case: ARRAY — variadic constructor, all args must share a base type
  if (funcDef.arrayConstructor) {
    if (args.length === 0) {
      return { refValue: '#TYPE!', type: 'Error', errorMeta: [{ error: '#TYPE!' }] };
    }
    const baseType = args[0].type;
    for (let i = 1; i < args.length; i++) {
      if (args[i].type !== baseType) {
        return {
          refValue: '#TYPE!', type: 'Error',
          errorMeta: [...inputErrorMetas, { error: '#TYPE!' }]
        };
      }
    }
    const result = funcDef.impl(args);
    return wrapResult(result, `ARRAY[${baseType}]`, inputErrorMetas);
  }

  // Try each variant until one matches
  for (const variant of funcDef.variants) {
    const match = matchSignature(args, variant.argTypes);
    if (match.success) {
      const result = variant.impl(match.args);
      const returnType = funcDef.resolveReturnType
        ? funcDef.resolveReturnType(variant, match.args)
        : variant.returnType;
      return wrapResult(result, returnType, inputErrorMetas);
    }
  }

  // No match - type error
  return {
    refValue: '#TYPE!',
    type: 'Error',
    errorMeta: [...inputErrorMetas, { error: '#TYPE!' }]
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Main API
  validateAndExecute,

  argTypesEqual,

  // Helpers (for testing)
  validateArgs,
  matchSignature,
  matchesType,
  collectErrorMeta,
  findStructuralError,
  wrapResult,
};
