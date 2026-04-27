/**
 * NAME VALIDATION UTILITIES
 * =========================
 *
 * Shared validation logic for named entities (inputs, ranges, etc.)
 * Used by both CalcEngine and Orchestrator for consistent validation.
 */

import { getBuiltInFunctions } from './functions.js';
import { isCellReference } from './cellUtils.js';

/**
 * Validate syntax of a name (after normalization)
 * Checks format, length, reserved words, and function name conflicts
 *
 * @param {string} name - Already normalized (uppercase, underscores)
 * @returns {boolean} - True if name is valid
 */
export function isValidNameSyntax(name) {
  // Check for empty or invalid input
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Check length limits
  if (name.length > 255) {
    return false;
  }

  // Check valid format: letter/underscore followed by letters/numbers/underscores
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return false;
  }

  // Check if it looks like a cell reference (A1, B12, AA100, _STOP0, etc.)
  // Reject any name that matches the cell reference pattern
  if (isCellReference(name)) {
    return false;
  }

  // Reserved words (TRUE, FALSE are boolean literals)
  const reservedWords = new Set(['TRUE', 'FALSE']);
  if (reservedWords.has(name)) {
    return false;
  }

  // Check if it's a built-in function name
  const builtInFunctions = getBuiltInFunctions();
  if (builtInFunctions[name]) {
    return false;
  }

  return true;
}

/**
 * Normalize a user-provided name
 * Converts to uppercase and replaces spaces with underscores
 *
 * @param {string} name - Raw user input
 * @returns {string} - Normalized name
 */
export function normalizeName(name) {
  return name.trim().toUpperCase().replace(/\s+/g, '_');
}
