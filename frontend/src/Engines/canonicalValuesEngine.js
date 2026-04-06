/**
 * @file Canonical Values Engine
 * @description Centralized storage and interpretation of all spreadsheet input values.
 * Separates data management from computation.
 *
 * **Responsibilities:**
 * - Own canonicalValues storage (single source of truth for user input)
 * - Interpret user input (type detection + parsing)
 * - Manage named entities (inputs, ranges)
 * - Notify CalcEngine of changes
 *
 * **Storage structure:**
 * ```
 * Map {
 *   'A1' => '42',                // Just canonical strings
 *   'B1' => 'hello',             // Simple values
 *   'C1' => '2024-01-15',        // Dates (ISO format)
 *   'D1' => '=A1+B1',            // Formulas
 *   '=A1*B1' => '=A1*B1'         // Anonymous expressions
 * }
 * ```
 *
 * Parsing happens in interpretInput(), but results are passed to CalcEngine,
 * not stored here. CanonicalValuesEngine = "source code", CalcEngine = "runtime".
 */

import { TypeService } from '../utils/typeService.js';
import { DATE_INPUT_FORMAT } from '../utils/serialDate.js';
import { parseFormula as parseFormulaUtil, splitOnCommas } from '../utils/formulaParser.js';
import { isCellReference, expandRange } from '../utils/cellUtils.js';

/**
 * @typedef {Object} InterpretedInput
 * @property {string} canonical - Canonical form of the input (normalized)
 * @property {string} type - Type of input ('formula', 'Number', 'Text', 'Date', etc.)
 * @property {*} parsed - Parsed value (precedents array for formulas, native value for others)
 * @property {string[]} [anonymousExprs] - Anonymous expressions to queue (formulas only)
 */

/**
 * @typedef {Object} InterpretContext
 * @property {number} [iter] - Current iteration number for ITER substitution (loop sheets only)
 */

/**
 * @typedef {Object} ParsedValueInfo
 * @property {string} type - Type of the value ('formula', 'Number', 'Text', 'Date', etc.)
 * @property {*} parsed - Parsed value (precedents array for formulas, native value for others)
 */

/**
 * @typedef {Object} InitConfig
 * @property {function(Map<string, ParsedValueInfo>): void} onValueChangeDpn - Callback when values change (notifies CalcEngine)
 * @property {string} dateInputFormatDpn - Date input format ('US' or 'EU')
 * @property {function(string): string} normalizeNameDpn - Function to normalize entity names
 * @property {function(string): boolean} isValidNameSyntaxDpn - Function to validate name syntax
 * @property {function(string): boolean} onCheckIfFunctionDpn - Function to check if name is a built-in function
 * @property {string[]} singleArrayFunctionsDpn - Built-in function names that take a single ARRAY argument
 * @property {function(string, string[]): void} recordChangesDpn - Function to record changes for history
 * @property {function(string, Map, function): void} onRegisterHistoryMapDpn - Function to register storage with history engine
 */

/**
 * @typedef {Object} NamedEntityResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if operation failed
 * @property {string} [name] - The entity name (if successful)
 */

/**
 * @typedef {Object} NamedRangeResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if operation failed
 * @property {string} [name] - The range name (if successful)
 * @property {string} [notation] - The range notation (if successful)
 */

/**
 * @typedef {Object} RenameResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if operation failed
 * @property {string} [oldName] - The old name (if successful)
 * @property {string} [newName] - The new name (if successful)
 */

/**
 * @typedef {Object} NamedRange
 * @property {string} name - The name of the range
 * @property {string} notation - The range notation (e.g., "A1:B2")
 */

/**
 * Creates the canonical values engine.
 *
 * Manages the storage and interpretation of all user input values. Acts as the "source code"
 * layer while CalcEngine handles the "runtime" layer. Maintains three key indexes:
 * - Named inputs (can exist without storage entry when empty)
 * - Named ranges (must have storage entry)
 * - Range-to-name reverse lookup (for O(1) lookups)
 *
 * @returns {{
 *   init: function(InitConfig): void,
 *   setValue: function(string, string): void,
 *   setBatch: function(Array<[string, string]>): void,
 *   getValue: function(string): string|undefined,
 *   createNamedInput: function(string): NamedEntityResult,
 *   renameNamedInput: function(string, string): RenameResult,
 *   deleteNamedInput: function(string): NamedEntityResult,
 *   createNamedRange: function(string, string): NamedRangeResult,
 *   deleteNamedRange: function(string): NamedEntityResult,
 *   renameNamedRange: function(string, string): RenameResult,
 *   moveNamedRange: function(string, string): NamedRangeResult,
 *   getAllNamedRanges: function(): NamedRange[],
 *   resolveNamedRange: function(string): string|null,
 *   lookupRangeName: function(string): string|null,
 *   getAllNamedInputs: function(): string[],
 *   reorderNamedInputs: function(string[]): void
 * }} Engine instance with public API methods
 */
export function createCanonicalValuesEngine() {
  /**
   * Storage: canonical strings only (Map<string, string>)
   * Note: Empty values are GC'd from storage. Named inputs can exist in index without storage entry.
   * @type {Map<string, string>}
   */
  const storage = new Map();

  /**
   * Processing queue: key → rawValue (Map provides automatic deduping)
   * @type {Map<string, string>}
   */
  const processingQueue = new Map();

  /**
   * Indexes for named entities (track membership independent of storage)
   * - namedInputs: Can exist WITHOUT storage entry (when empty)
   * - namedRanges: MUST have storage entry (the =notation value)
   * @type {Set<string>}
   */
  const namedInputs = new Set();

  /** @type {Set<string>} */
  const namedRanges = new Set();

  /**
   * Notation → name (O(1) reverse lookup)
   * @type {Map<string, string>}
   */
  const rangeToName = new Map();

  /**
   * Functions that take a single ARRAY[Type] argument (e.g., SUM, MIN, MAX).
   * Populated at init from built-in function registry; updated when custom functions
   * are registered/unregistered.
   * @type {Set<string>}
   */
  const singleArrayFunctions = new Set();

  /**
   * Callbacks (injected via init)
   * @type {function(Map<string, ParsedValueInfo>): void|null}
   */
  let onValueChange = null;

  /** @type {function(string): string|null} */
  let normalizeName = null;

  /** @type {function(string): boolean|null} */
  let isValidNameSyntax = null;

  /** @type {function(string): boolean|null} */
  let onCheckIfFunction = null;

  /** @type {function(string, string[]): void|null} */
  let recordChanges = null;

  /** @type {function(string, Map, function): void|null} */
  let onRegisterHistoryMap = null;

  /**
   * Date input format preference (US: MM/DD/YYYY, EU: DD/MM/YYYY)
   * @type {string}
   */
  let dateInputFormat = DATE_INPUT_FORMAT.US;

  /**
   * Checks if a key is an anonymous node.
   *
   * @param {string} key - The key to check
   * @returns {boolean} True if key starts with '=' (e.g., "=A1+B1")
   */
  function isAnonymous(key) {
    return key.startsWith('=');
  }

  /**
   * Checks if a key is a named entity.
   *
   * Uses imported isCellReference() from cellUtils.js for consistency.
   *
   * @param {string} key - The key to check
   * @returns {boolean} True if key is neither a cell reference nor anonymous (e.g., "Revenue", "TaxRate", "VAL1")
   */
  function isNamedEntity(key) {
    return !isCellReference(key) && !isAnonymous(key);
  }

  /** @type {RegExp} Matches bare cell range like A1:B2 (no nested expressions) */
  const BARE_RANGE_RE = /^[A-Z]+\d+:[A-Z]+\d+$/;

  /**
   * Optionally rewrites a canonical formula string to wrap scalar args in ARRAY()
   * for functions that expect a single ARRAY argument (e.g., SUM, MIN, MAX).
   *
   * Returns the canonical string unchanged if the function isn't a single-array
   * function or has only one argument after range expansion.
   *
   * @param {string} canonical - Normalized formula string (e.g., '=SUM(A1,A2,A3)')
   * @returns {string} Original or wrapped canonical (e.g., '=SUM(ARRAY(A1,A2,A3))')
   */
  function maybeWrapArrayArgs(canonical) {
    const body = canonical.slice(1); // Remove leading =
    const parenOpen = body.indexOf('(');
    if (parenOpen === -1) return canonical;

    const funcName = body.slice(0, parenOpen);
    if (!singleArrayFunctions.has(funcName)) return canonical;

    const argsStr = body.slice(parenOpen + 1, -1);
    const argParts = splitOnCommas(argsStr);

    // Expand bare ranges into individual cell references
    const expandedArgs = [];
    for (const arg of argParts) {
      if (BARE_RANGE_RE.test(arg)) {
        const colonIdx = arg.indexOf(':');
        const { cells } = expandRange(arg.slice(0, colonIdx), arg.slice(colonIdx + 1));
        expandedArgs.push(...cells);
      } else {
        expandedArgs.push(arg);
      }
    }

    if (expandedArgs.length <= 1) return canonical;

    return `=${funcName}(ARRAY(${expandedArgs.join(',')}))`;
  }

  /**
   * Interprets raw input value and determines type/parsed form.
   *
   * Handles formulas (parses precedents), numbers, text, and dates. For formulas,
   * parses precedents and anonymous expressions, then normalizes for single-array
   * functions (wrapping scalar args into ARRAY nodes).
   *
   * For values, delegates to TypeService.
   *
   * @param {string} rawValue - The raw input value to interpret
   * @returns {InterpretedInput} Interpreted result with canonical form, type, parsed value, and optional anonymous expressions
   */
  function interpretInput(rawValue) {
    // Check for formulas BEFORE calling TypeService
    // (TypeService should only handle VALUE types)
    // Handle undefined/null to avoid calling .startsWith() on non-string values
    if (rawValue && rawValue.startsWith('=')) {
      const canonical = rawValue.toUpperCase().replace(/\s/g, '');
      const formulaToParse = maybeWrapArrayArgs(canonical);
      const { precedents, anonymousExpressions } = parseFormulaUtil(formulaToParse);

      return {
        canonical,
        type: 'formula',
        parsed: precedents,
        anonymousExprs: anonymousExpressions
      };
    }

    // Use TypeService for all VALUE types (numbers, dates, text)
    // TypeService.detectType handles null/undefined gracefully
    const result = TypeService.detectType(rawValue, dateInputFormat);

    return {
      canonical: result.canonicalValue,
      type: result.type,
      parsed: result.value
    };
  }

  /**
   * Flag to skip history recording (used by loop sheets for generated rows)
   * @type {boolean}
   */
  let skipHistoryRecording = false;

  /**
   * Processes the queue and notifies CalcEngine of all changes.
   *
   * Continues processing until queue is empty, handling cascading additions from
   * anonymous expressions. Records history before any mutations, interprets all
   * queued values, updates storage, and sends batch notification to CalcEngine.
   */
  function processQueueAndNotify() {
    // Record history before any mutations (captures initial queue only)
    // Note: Anonymous expressions added during processing are derived and will be GC'd
    // Skip if skipHistoryRecording flag is set (e.g., for loop sheet generated rows)
    if (recordChanges && processingQueue.size > 0 && !skipHistoryRecording) {
      const keysToChange = Array.from(processingQueue.keys());
      recordChanges('canonicalValues', keysToChange);
    }

    /** @type {Map<string, ParsedValueInfo>} key → {type, parsed} */
    const changedInfo = new Map();

    while (processingQueue.size > 0) {
      // Get first entry
      const [key, rawValue] = processingQueue.entries().next().value;
      processingQueue.delete(key);

      // Interpret the input
      /** @type {InterpretedInput} */
      const entry = interpretInput(rawValue);

      // Handle deletion (empty value parsed)
      // Note: TypeService returns canonicalValue="'" for empty strings
      if (entry.type === 'Text' && entry.parsed === '') {
        // GC Policy: Always delete empties from storage
        // Philosophy:
        // - Named inputs can exist in namedInputs Set with NO storage entry (empty value)
        // - Named ranges MUST have storage entry (the =notation) - if empty, they don't exist
        // - Indexes track existence/membership, storage tracks values
        if (storage.has(key)) {
          storage.delete(key);
        }

        // ALWAYS notify CalcEngine about deletion (clears stale dependents)
        changedInfo.set(key, { type: 'Text', parsed: '' });
        continue;
      }

      // Store ONLY the canonical string
      storage.set(key, entry.canonical);

      // Track change info (to pass to CalcEngine)
      changedInfo.set(key, {
        type: entry.type,
        parsed: entry.parsed
      });

      // Queue anonymous expressions for parsing (RECURSIVE!)
      // Always queue them even if already in storage, because CalcEngine may have deleted them
      // when clearing old dependencies during formula edits
      if (entry.anonymousExprs) {
        entry.anonymousExprs.forEach(expr => {
          processingQueue.set(expr, expr);
        });
      }
    }

    // Notify CalcEngine once with all changed info
    if (changedInfo.size > 0 && onValueChange) {
      onValueChange(changedInfo);
    }
  }

  /**
   * Sets a single value (queues and processes immediately).
   *
   * Internal function used by both public API and internal operations. Skips
   * processing if value hasn't changed (treats undefined and empty string as equivalent).
   *
   * @param {string} key - The cell key or entity name
   * @param {string} rawValue - The raw value to set
   */
  function setValue(key, rawValue) {
    // Check if value actually changed
    const currentValue = storage.get(key);

    // Treat undefined and empty string as equivalent (both mean "no value")
    const isEmpty = (val) => val === undefined || val === '';

    if (isEmpty(currentValue) && isEmpty(rawValue)) {
      // Both empty, no change
      return;
    }

    if (currentValue === rawValue) {
      // Same value, no change
      return;
    }

    processingQueue.set(key, rawValue);
    processQueueAndNotify();
  }

  /**
   * Sets multiple values in a batch (single notification).
   *
   * Internal function used by both public API and internal operations. Filters
   * out unchanged values before processing to optimize performance.
   *
   * @param {Array<[string, string]>} entries - Array of [key, value] pairs to set
   * @param {Object} [options] - Optional settings
   * @param {boolean} [options.skipHistory=false] - Skip history recording (for generated rows)
   */
  function setBatch(entries, options = {}) {
    // Treat undefined and empty string as equivalent (both mean "no value")
    const isEmpty = (val) => val === undefined || val === '';

    // Filter out unchanged values
    let hasChanges = false;
    for (const [key, value] of entries) {
      const currentValue = storage.get(key);

      // Skip if both are empty
      if (isEmpty(currentValue) && isEmpty(value)) {
        continue;
      }

      // Skip if values are identical
      if (currentValue === value) {
        continue;
      }

      processingQueue.set(key, value);
      hasChanges = true;
    }

    // Only process if there are actual changes
    if (hasChanges) {
      // Set skip flag if requested (for loop sheet generated rows)
      if (options.skipHistory) {
        skipHistoryRecording = true;
      }
      processQueueAndNotify();
      skipHistoryRecording = false;
    }
  }

  // Public API
  return {
    /**
     * Initializes the engine with injected dependencies.
     *
     * Registers storage Map and namedInputs snapshot with HistoryEngine for undo/redo support.
     * Sets up rebuild callbacks to restore state during history operations.
     *
     * @param {InitConfig} config - Configuration object with dependencies
     */
    init(deps) {
      ({
        onValueChange,
        dateInputFormat,
        normalizeName,
        isValidNameSyntax,
        onCheckIfFunction,
        recordChanges,
        onRegisterHistoryMap
      } = deps);

      // Initialize single-array functions set from built-in function registry
      if (deps.singleArrayFunctions) {
        for (const name of deps.singleArrayFunctions) {
          singleArrayFunctions.add(name);
        }
      }

      // Register storage Map with HistoryEngine
      if (onRegisterHistoryMap) {
        onRegisterHistoryMap('canonicalValues', storage, (delta) => {
          // Rebuild callback: Receive old values from HistoryEngine and restore them
          // Convert delta Map to entries array (undefined → '' for deletion)
          const entries = Array.from(delta.entries()).map(([key, value]) => [key, value ?? '']);

          // Use setBatch to restore values (will mutate storage and notify CalcEngine)
          // isRestoring flag prevents recording these changes as new history
          setBatch(entries);
        });

        // Register snapshot provider for namedInputs index
        // This piggybacks on any checkpoint to capture the current state
        if (onRegisterHistoryMap.registerSnapshotProvider) {
          onRegisterHistoryMap.registerSnapshotProvider(
            'namedInputs',
            // Getter: Return snapshot of current state
            () => {
              const snapshot = new Set(namedInputs);
              return snapshot;
            },
            // Restorer: Rebuild indexes from restored storage + snapshot
            (snapshot) => {
              // Restore namedInputs from snapshot
              namedInputs.clear();
              for (const name of snapshot) {
                namedInputs.add(name);
              }

              // Rebuild other indexes from storage (they're derived)
              namedRanges.clear();
              rangeToName.clear();

              for (const [key, canonical] of storage.entries()) {
                const isNamed = isNamedEntity(key);
                const startsWithEquals = canonical && canonical.startsWith('=');

                if (isNamed && startsWithEquals) {
                  namedRanges.add(key);
                  const notation = canonical.substring(1);
                  rangeToName.set(notation, key);
                }
              }

            }
          );
        }
      }

    },

    /**
     * Sets a single value (queues and processes immediately).
     *
     * @param {string} key - The cell key or entity name
     * @param {string} rawValue - The raw value to set (can be formula, number, text, or date)
     */
    setValue,

    /**
     * Sets multiple values in a batch (single notification to CalcEngine).
     *
     * More efficient than multiple setValue calls when changing many cells at once.
     *
     * @param {Array<[string, string]>} entries - Array of [key, value] pairs to set
     */
    setBatch,

    /**
     * Gets the canonical value (what user typed).
     *
     * @param {string} key - The cell key or entity name
     * @returns {string|undefined} The canonical value string, or undefined if not found
     */
    getValue(key) {
      return storage.get(key);  // Now just returns the string
    },

    /**
     * Silently removes an anonymous expression from storage (GC callback from CalcEngine).
     *
     * Called by CalcEngine when an anonymous expression has no more dependents.
     * Does NOT notify CalcEngine (would be circular since CalcEngine already cleaned up).
     * Only operates on anonymous expressions (keys starting with '=').
     *
     * @param {string} key - The anonymous expression key (e.g., "=A1:B2")
     */
    deleteAnonymousExpression(key) {
      // Safety check: only delete anonymous expressions
      if (!isAnonymous(key)) {
        console.warn('[CanonicalValuesEngine] deleteAnonymousExpression called with non-anonymous key:', key);
        return;
      }
      storage.delete(key);
    },

    /**
     * Creates a named input with validation.
     *
     * Validates name syntax, checks for conflicts with existing names/functions,
     * and adds to namedInputs index. Named input is created with empty value.
     *
     * @param {string} name - The name to create (will be normalized)
     * @returns {NamedEntityResult} Result with success flag and normalized name or error
     */
    createNamedInput(name) {
      const normalized = normalizeName(name);

      // Validate syntax
      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }

      // Check if already exists (in index or storage)
      if (namedInputs.has(normalized) || namedRanges.has(normalized) || storage.has(normalized)) {
        return { success: false, error: 'Name already exists' };
      }

      // Check if it's a built-in function
      if (onCheckIfFunction && onCheckIfFunction(normalized)) {
        return { success: false, error: 'Cannot overwrite built-in function' };
      }

      // Add to index (tracks membership)
      namedInputs.add(normalized);

      // Create with empty value - will be GC'd from storage but name stays in index
      // (recordChanges called automatically in processQueueAndNotify)
      processingQueue.set(normalized, '');
      processQueueAndNotify();

      return { success: true, name: normalized };
    },

    /**
     * Renames a named input with validation.
     *
     * Validates new name syntax, checks for conflicts, transfers value from old to new name,
     * and updates namedInputs index. Uses setBatch for atomic operation with history tracking.
     *
     * @param {string} oldName - The current name
     * @param {string} newName - The new name (will be normalized)
     * @returns {RenameResult} Result with success flag and names or error
     */
    renameNamedInput(oldName, newName) {
      const normalized = normalizeName(newName);

      // Validate syntax
      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }

      // Check if target already exists (unless it's the same name)
      if (normalized !== oldName && (namedInputs.has(normalized) || namedRanges.has(normalized) || storage.has(normalized))) {
        return { success: false, error: 'Name already exists' };
      }

      // Check if source exists in index
      if (!namedInputs.has(oldName)) {
        return { success: false, error: 'Source name does not exist' };
      }

      // Get old value (now just a string)
      const value = storage.get(oldName);

      // Update indexes
      namedInputs.delete(oldName);
      namedInputs.add(normalized);

      // Use setBatch to handle both deletion and creation
      // recordChanges will be called automatically in processQueueAndNotify
      setBatch([
        [oldName, ''],         // Delete old name (empties are always GC'd from storage)
        [normalized, value || '']  // Create new name with same value (or empty if no value)
      ]);

      return { success: true, oldName, newName: normalized };
    },

    /**
     * Deletes a named input with validation.
     *
     * Removes from namedInputs index and clears value from storage. Validates
     * that the name exists before deletion.
     *
     * @param {string} name - The name to delete
     * @returns {NamedEntityResult} Result with success flag and name or error
     */
    deleteNamedInput(name) {
      // Check if exists in index
      if (!namedInputs.has(name)) {
        return { success: false, error: 'Name does not exist' };
      }

      // Remove from index
      namedInputs.delete(name);

      // Use setValue to handle deletion - empties are always GC'd from storage
      // (recordChanges called automatically)
      setValue(name, '');

      return { success: true, name };
    },

    /**
     * Creates a named range with validation.
     *
     * Validates name syntax, checks for conflicts, stores range as formula (=notation),
     * and adds to namedRanges index with reverse lookup.
     *
     * @param {string} name - Name for the range (will be normalized)
     * @param {string} notation - Range notation (e.g., "A1:B2") or single cell (e.g., "A1")
     * @returns {NamedRangeResult} Result with success flag and name/notation or error
     */
    createNamedRange(name, notation) {
      const normalized = normalizeName(name);

      // Validate syntax
      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }

      // Check if already exists (in index or storage)
      if (namedInputs.has(normalized) || namedRanges.has(normalized) || storage.has(normalized)) {
        return { success: false, error: 'Name already exists' };
      }

      // Check if it's a built-in function
      if (onCheckIfFunction && onCheckIfFunction(normalized)) {
        return { success: false, error: 'Cannot overwrite built-in function' };
      }

      // Add to indexes (tracks membership)
      namedRanges.add(normalized);
      rangeToName.set(notation, normalized);

      // Use setValue to handle parsing and notification (recordChanges called automatically)
      const canonical = `=${notation.toUpperCase()}`;
      setValue(normalized, canonical);

      return { success: true, name: normalized, notation };
    },

    /**
     * Deletes a named range with validation.
     *
     * Removes from namedRanges index, reverse lookup, and clears value from storage.
     * Validates that the name exists before deletion.
     *
     * @param {string} name - Name to delete
     * @returns {NamedEntityResult} Result with success flag and name or error
     */
    deleteNamedRange(name) {
      // Check if exists in index
      if (!namedRanges.has(name)) {
        return { success: false, error: 'Name does not exist' };
      }

      // Get notation from storage (if it exists)
      const canonical = storage.get(name);
      if (canonical && canonical.startsWith('=')) {
        const notation = canonical.substring(1);
        rangeToName.delete(notation);
      }

      // Remove from index
      namedRanges.delete(name);

      // Use setValue to handle deletion - empties are always GC'd from storage
      // (recordChanges called automatically)
      setValue(name, '');

      return { success: true, name };
    },

    /**
     * Renames a named range with validation.
     *
     * Validates new name syntax, checks for conflicts, transfers canonical value
     * from old to new name, and updates namedRanges index and rangeToName reverse lookup.
     * Uses setBatch for atomic operation with history tracking.
     *
     * @param {string} oldName - The current name
     * @param {string} newName - The new name (will be normalized)
     * @returns {RenameResult} Result with success flag and names or error
     */
    renameNamedRange(oldName, newName) {
      const normalized = normalizeName(newName);

      // Validate syntax
      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }

      // Check if target already exists (unless it's the same name)
      if (normalized !== oldName && (namedInputs.has(normalized) || namedRanges.has(normalized) || storage.has(normalized))) {
        return { success: false, error: 'Name already exists' };
      }

      // Check if source exists in index
      if (!namedRanges.has(oldName)) {
        return { success: false, error: 'Source name does not exist' };
      }

      // Get old canonical value (e.g., "=A1:B2")
      const canonical = storage.get(oldName);

      // Update namedRanges index
      namedRanges.delete(oldName);
      namedRanges.add(normalized);

      // Update rangeToName reverse lookup
      if (canonical && canonical.startsWith('=')) {
        const notation = canonical.substring(1);
        rangeToName.delete(notation);
        rangeToName.set(notation, normalized);
      }

      // Use setBatch to handle both deletion and creation
      // recordChanges will be called automatically in processQueueAndNotify
      setBatch([
        [oldName, ''],              // Delete old name
        [normalized, canonical || '']  // Create new name with same value
      ]);

      return { success: true, oldName, newName: normalized };
    },

    /**
     * Prepares a named range move to a new notation (used during cut/paste operations).
     *
     * Updates the reverse lookup Map and returns the batch entry for the caller to include
     * in their setBatch() call. This allows named range moves to be atomic with other updates.
     *
     * @param {string} name - Name of the range to move
     * @param {string} newNotation - New range notation (e.g., "C3:D4")
     * @returns {{success: boolean, entry: [string, string], name: string, notation: string, error?: string}}
     *          Result with success flag, batch entry [name, '=NOTATION'], and name/notation or error
     */
    moveNamedRange(name, newNotation) {
      // Check if exists in index
      if (!namedRanges.has(name)) {
        return { success: false, error: 'Named range does not exist' };
      }

      // Get current canonical value from storage
      const oldCanonical = storage.get(name);
      if (!oldCanonical || !oldCanonical.startsWith('=')) {
        return { success: false, error: 'Named range has no value' };
      }

      // Extract old notation and update reverse lookup
      const oldNotation = oldCanonical.substring(1);
      rangeToName.delete(oldNotation);
      rangeToName.set(newNotation.toUpperCase(), name);

      // Return the batch entry for caller to include in setBatch()
      const newCanonical = `=${newNotation.toUpperCase()}`;
      return {
        success: true,
        entry: [name, newCanonical],
        name,
        notation: newNotation
      };
    },

    /**
     * Gets all named ranges with their notations.
     *
     * Filters namedRanges index to only include entries that have storage with '=' prefix,
     * then maps to objects with name and notation.
     *
     * @returns {NamedRange[]} Array of named range objects
     */
    getAllNamedRanges() {
      return Array.from(namedRanges)
        .filter(name => {
          const canonical = storage.get(name);
          return canonical && canonical.startsWith('=');
        })
        .map(name => {
          const canonical = storage.get(name);
          return {
            name,
            notation: canonical.substring(1)  // Strip =
          };
        });
    },

    /**
     * Resolves a named range to its notation.
     *
     * @param {string} name - Named range name (e.g., "TOTAL")
     * @returns {string|null} Notation (e.g., "A5" or "A1:B2") or null if not a named range
     */
    resolveNamedRange(name) {
      if (!namedRanges.has(name)) return null;
      const canonical = storage.get(name);
      if (!canonical || !canonical.startsWith('=')) return null;
      return canonical.substring(1);
    },

    /**
     * Looks up range name by notation (O(1) reverse lookup).
     *
     * Uses the rangeToName Map for fast reverse lookup from notation to name.
     *
     * @param {string} notation - Range notation (e.g., "A1:B2")
     * @returns {string|null} Range name or null if not found
     */
    lookupRangeName(notation) {
      return rangeToName.get(notation) || null;
    },

    /**
     * Gets all named inputs in order.
     *
     * Returns names in the order they appear in the Set (insertion order, or
     * as modified by reorderNamedInputs).
     *
     * @returns {string[]} Array of named input names in order
     */
    getAllNamedInputs() {
      return Array.from(namedInputs);
    },

    /**
     * Reorders named inputs.
     *
     * Rebuilds the namedInputs Set in the new order. Only includes names that
     * were previously in the index (validates against current state). Named inputs
     * can exist without storage entry (when empty).
     *
     * @param {string[]} orderedArray - Array of names in desired order
     */
    reorderNamedInputs(orderedArray) {
      // Rebuild Set in new order
      // Note: Named inputs can exist in the index without a storage entry (empty value)
      // so we validate against the current index, not storage
      const currentInputs = new Set(namedInputs);
      namedInputs.clear();

      for (const name of orderedArray) {
        // Only add if it was in the index before (validate)
        if (currentInputs.has(name)) {
          namedInputs.add(name);
        }
      }
      console.log('[CanonicalValuesEngine] Reordered named inputs:', orderedArray);
    },

    /**
     * Update the set of functions that take a single ARRAY argument.
     * Called by the orchestrator when custom functions are registered/unregistered.
     *
     * @param {string} name - Function name
     * @param {boolean} isArrayFn - True to add, false to remove
     */
    updateSingleArrayFunctions(name, isArrayFn) {
      if (isArrayFn) {
        singleArrayFunctions.add(name);
      } else {
        singleArrayFunctions.delete(name);
      }
    },

    /**
     * Re-normalize formulas for the given cell keys.
     * Re-runs interpretInput on stored canonical strings, which applies
     * the current singleArrayFunctions set during normalization.
     *
     * Used when a custom function's signature changes (loaded/unloaded),
     * requiring dependent formulas to be re-parsed with updated normalization.
     *
     * @param {string[]} cellKeys - Cell keys to re-normalize
     */
    renormalizeFormulas(cellKeys) {
      for (const key of cellKeys) {
        const canonical = storage.get(key);
        if (canonical && canonical.startsWith('=')) {
          processingQueue.set(key, canonical);
        }
      }
      if (processingQueue.size > 0) {
        processQueueAndNotify();
      }
    },

    /**
     * Updates the date input format preference.
     *
     * Used when the user changes the spreadsheet default date entry format.
     * Affects how ambiguous dates like "03/04/2024" are interpreted (MM/DD vs DD/MM).
     *
     * @param {string} newFormat - New date input format ('US' or 'EU')
     */
    setDateInputFormat(newFormat) {
      if (newFormat === DATE_INPUT_FORMAT.US || newFormat === DATE_INPUT_FORMAT.EU) {
        dateInputFormat = newFormat;
        console.log('[CanonicalValuesEngine] Date input format updated to:', newFormat);
      } else {
        console.warn('[CanonicalValuesEngine] Invalid date input format:', newFormat);
      }
    },

    /**
     * Gets a snapshot of all state for persistence.
     *
     * @returns {{canonicalValues: Array, namedInputs: Array, namedRanges: Array}} Serializable snapshot
     */
    getSnapshot() {
      return {
        canonicalValues: Array.from(storage.entries()),
        namedInputs: Array.from(namedInputs),
        namedRanges: Array.from(namedRanges).map(name => {
          const canonical = storage.get(name);
          return [name, canonical ? canonical.substring(1) : ''];  // Strip = prefix
        })
      };
    },

    /**
     * Restores state from a snapshot.
     *
     * @param {{canonicalValues: Array, namedInputs: Array, namedRanges: Array}} data - Snapshot to restore
     */
    restoreSnapshot(data) {
      console.log('[CanonicalValuesEngine] Restoring snapshot...');

      // Capture keys that exist before clearing so we can notify about removals
      const previousKeys = new Set(storage.keys());

      // Clear all state
      storage.clear();
      namedInputs.clear();
      namedRanges.clear();
      rangeToName.clear();

      // Restore storage
      for (const [key, value] of data.canonicalValues || []) {
        storage.set(key, value);
      }

      // Restore namedInputs
      for (const name of data.namedInputs || []) {
        namedInputs.add(name);
      }

      // Restore namedRanges
      for (const [name, notation] of data.namedRanges || []) {
        namedRanges.add(name);
        rangeToName.set(notation, name);
      }

      // Rebuild everything: parse all values and notify CalcEngine
      const allKeys = Array.from(storage.keys());
      const changedInfo = new Map();

      // Helper to recursively add anonymous expressions to changedInfo
      function addToChangedInfo(key, rawValue) {
        if (changedInfo.has(key)) return; // Already processed

        const parsed = interpretInput(rawValue);
        changedInfo.set(key, { type: parsed.type, parsed: parsed.parsed });

        // Recursively add anonymous expressions (sub-expressions extracted by formula parser)
        if (parsed.anonymousExprs?.length > 0) {
          for (const expr of parsed.anonymousExprs) {
            addToChangedInfo(expr, expr);
          }
        }
      }

      for (const cellKey of allKeys) {
        const rawValue = storage.get(cellKey);
        addToChangedInfo(cellKey, rawValue);
      }

      // Include removed cells so CalcEngine clears their values and the grid refreshes
      for (const key of previousKeys) {
        if (!changedInfo.has(key)) {
          changedInfo.set(key, { type: 'Text', parsed: '' });
        }
      }

      // Notify CalcEngine to rebuild
      if (onValueChange) {
        onValueChange(changedInfo);
      }

      console.log('[CanonicalValuesEngine] Restored:', {
        cells: storage.size,
        namedInputs: namedInputs.size,
        namedRanges: namedRanges.size
      });
    },

    /**
     * Silently delete keys from storage without notifying CalcEngine.
     *
     * Used by loop sheets to efficiently clear generated rows before regeneration.
     * Does not trigger calculation cascade (caller handles regeneration).
     *
     * @param {string[]} keys - Array of cell keys to delete
     */
    silentDeleteKeys(keys) {
      for (const key of keys) {
        storage.delete(key);
      }
    }
  };
}
