/**
 * @file Calculation Engine
 * @description Topological evaluation engine for spreadsheet formulas with dependency tracking.
 *
 * **Architecture:**
 * - Uses init() pattern for dependency injection
 * - READ-ONLY: Does not write to CanonicalValuesEngine (single responsibility)
 * - Maintains internal derived state (nodeCalcData, directDependentsGraph)
 * - Orchestrator manages history checkpoints via central functions
 *
 * **Key Features:**
 * - Topological sort for proper evaluation order
 * - Circular dependency detection
 * - Prefix notation for formulas (Polish notation)
 * - Built-in function registry
 * - Anonymous sub-expression support
 * - Efficient dependency graph for incremental recalculation
 *
 * **Data Flow:**
 * 1. CanonicalValuesEngine → processInputs (parsed values)
 * 2. CalcEngine → evaluate formulas in topological order
 * 3. CalcEngine → onComputeDisplayDpn callback (format display)
 *
 * @example
 * const calcEngine = createCalculationEngine();
 * calcEngine.init({
 *   onComputeDisplay: (node, cellKey) => { ... }
 * });
 *
 * // Process parsed inputs from CanonicalValuesEngine
 * calcEngine.processInputs(new Map([
 *   ['A1', { type: 'Number', parsed: 42 }],
 *   ['B2', { type: 'formula', parsed: ['ADD', 'A1', '10'] }]
 * ]));
 */

/**
 * @typedef {Object} CalcNode
 * @property {Array<string>|undefined} precedents - Prefix notation array: [operator/function, ...args]
 *   - precedents[0]: Function/operator name (e.g., 'ADD', 'SUM', 'MULTIPLY')
 *   - precedents[1..n]: Arguments (cell refs, ranges, literals, anonymous expressions)
 *   - Allocated lazily (only for formulas, not simple values)
 * @property {*} refValue - Computed result (number, string, array for ranges, function object)
 *   - For runtime errors: NaN, Infinity, -Infinity
 * @property {string} type - Result type: 'Number', 'Text', 'Boolean', 'Date', 'Datetime', 'Error', 'Array', 'function'
 * @property {Array<string>|undefined} errorMeta - Error metadata chain (accumulates through calculations)
 *   - Present when value has error history (e.g., upstream runtime error)
 *   - Each entry is an error code like '#DOMAIN!', '#REF!'
 *   - Propagates even through short-circuits
 *
 * @example
 * // Formula: =A1+B1
 * { precedents: ['ADD', 'A1', 'B1'], refValue: 42, type: 'Number' }
 *
 * @example
 * // Simple value: 42
 * { refValue: 42, type: 'Number' }  // No precedents
 *
 * @example
 * // Runtime error (division by zero)
 * { refValue: Infinity, type: 'Number', errorMeta: ['#DOMAIN!'] }
 *
 * @example
 * // Structural error
 * { refValue: '#NAME!', type: 'Error', errorMeta: ['#NAME!'] }
 *
 * @example
 * // Built-in function
 * { refValue: { impl: function }, type: 'function' }
 */

/**
 * @typedef {Object} ParsedValueInfo
 * @property {string} type - Value type ('Number', 'formula', 'Text', 'Date', 'Datetime', 'Error')
 * @property {*} parsed - Parsed value:
 *   - For formulas: Array in prefix notation ['ADD', 'A1', 'B1']
 *   - For numbers: Number value (e.g., 42, 3.14)
 *   - For text: String value
 *   - For dates/datetime: Serial number
 */

/**
 * @typedef {Object} InitConfig
 * @property {function(CalcNode, string): void} onComputeDisplayDpn - Callback to format display after calculation
 *   - First param: The calculated node with refValue and type
 *   - Second param: The cell key (e.g., "A1")
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {*} refValue - The evaluated value
 * @property {string} type - The type of the evaluated value
 * @property {Array<string>|undefined} errorMeta - Error metadata chain (if present)
 */

import { getBuiltInFunctions } from '../utils/functions.js';
import { isCellReference } from '../utils/cellUtils.js';
import { validateAndExecute, matchSignature, argTypesEqual } from '../utils/functionValidation.js';
import { TypeService } from '../utils/typeService.js';

function sourceMetaFromFuncDef(funcDef) {
  return {
    id: funcDef.id,
    versionId: funcDef.versionId || null,
    name: funcDef.name,
    version: funcDef.version,
    description: funcDef.description,
    author: funcDef.author,
    sheetType: funcDef.sheetType || 'standard',
    signature: funcDef.signature
  };
}

/**
 * Create a calculation engine instance.
 *
 * Factory function that creates a calculation engine with dependency injection pattern.
 * The engine maintains internal derived state and processes formula evaluations.
 *
 * **Internal State:**
 * - `nodeCalcData`: Map<string, CalcNode> - All cells, formulas, and functions
 * - `directDependentsGraph`: Map<string, Set<string>> - Reverse dependency tracking
 *
 * **Processing Phases:**
 * 1. Update dependency graph and store values
 * 2. Dependency validation (topological sort preparation)
 * 3. Evaluation in topological order
 *
 * @returns {{
 *   init: function(InitConfig): void,
 *   processInputs: function(Map<string, ParsedValueInfo>): void,
 *   getCellValue: function(string): *,
 *   getNode: function(string): CalcNode|undefined
 * }} Calculation engine public API
 *
 * @example
 * const calcEngine = createCalculationEngine();
 * calcEngine.init({ onComputeDisplayDpn: (node, key) => {...} });
 * calcEngine.processInputs(changedInfo);
 */
function createCalculationEngine() {
  /**
   * Derived state - stores all calculated nodes (cells, formulas, functions).
   * Rebuilt on undo operations.
   * @type {Map<string, CalcNode>}
   */
  const nodeCalcData = new Map();

  /**
   * Reverse dependency graph - tracks which cells/formulas depend on each node.
   * Format: Map<precedentKey, Set<dependentKeys>>
   * @type {Map<string, Set<string>>}
   *
   * @example
   * // If C1=A1+B1, then:
   * directDependentsGraph.get('A1') // Set {'C1'}
   * directDependentsGraph.get('ADD') // Set {'C1'}
   */
  const directDependentsGraph = new Map();

  /**
   * Keys whose display formatting should be skipped (e.g. preview-evaluation slots).
   * Populated by external engines via markSkipDisplay().
   * @type {Set<string>}
   */
  const skipDisplayKeys = new Set();

  /**
   * Display formatting callback injected via init().
   * @type {function(CalcNode, string): void|null}
   */
  let computeDisplayValue = null;

  /**
   * Callback to notify CanonicalValuesEngine when anonymous expressions are GC'd.
   * @type {function(string): void|null}
   */
  let onDeleteAnonymous = null;

  /**
   * Temporary structures for evaluation phases.
   * - dependencyValidationCells: Cells to validate in Phase 2
   * - evaluationCells: Cells ready for evaluation in Phase 3
   * - unresolvedCount: Count of unresolved precedents per cell
   * @type {Set<string>}
   * @type {Set<string>}
   * @type {Object<string, number>}
   */
  let currentBatchKeys = null;  // Track keys in current batch to avoid redundant cascading
  let dependencyValidationCells = new Set(), evaluationCells = new Set(),
      unresolvedCount = {};

  /**
   * Process changed cell inputs and trigger recalculation.
   *
   * **Three-phase processing:**
   * 1. Update dependency graph and store values
   * 2. Dependency validation (build unresolved counts)
   * 3. Topological evaluation (process in order)
   *
   * @param {Map<string, ParsedValueInfo>} changedInfo - Map of cell keys to parsed value info
   * @throws {Error} If changedInfo is not a Map
   *
   * @example
   * calcEngine.processInputs(new Map([
   *   ['A1', { type: 'Number', parsed: 42 }],
   *   ['B1', { type: 'formula', parsed: ['ADD', 'A1', '10'] }]
   * ]));
   */
  function processInputs(changedInfo) {
    // Validate input
    if (!(changedInfo instanceof Map)) {
      throw new Error('processInputs requires a Map of changed cell info');
    }

    // Note: History checkpoints managed by orchestrator's central functions

    // Track batch keys to avoid redundant cascading when dependents are also in the batch
    currentBatchKeys = new Set(changedInfo.keys());

    // PHASE 1: Update Dependency Graph & Store Values
    for (const [key, info] of changedInfo) {
      const { type, parsed } = info;

      // Step 1: Clear old dependencies
      clearNodePrecedents(key);

      // Step 2: Store value & add new dependencies
      if (type === 'formula') {
        // Formula: Store in nodeCalcData with precedents
        let node = nodeCalcData.get(key);
        if (!node) {
          node = {};
          nodeCalcData.set(key, node);
        }
        node.precedents = parsed;  // Cache for next change (to get old precedents)

        // Add new dependencies
        parsed.filter(dep => !isLiteral(dep)).forEach(dep => addDependency(dep, key));

        // Queue for evaluation
        dependencyValidationCells.add(key);

      } else if (parsed === '' && type === 'Text') {
        // Deletion: Clear display and remove node entirely
        // (referencing a deleted cell should return #REF!, same as never-touched cell)
        if (!skipDisplayKeys.has(key)) computeDisplayValue({ refValue: '', type: 'Text' }, key);

        // Queue dependents for re-evaluation BEFORE deleting
        queueDependents(key);

        // Delete the node so it behaves like it never existed
        nodeCalcData.delete(key);
      } else {
        // Simple value: Store directly in nodeCalcData
        const node = {
          refValue: parsed,  // Already parsed (e.g., 42, 45306, "hello")
          type: type
        };
        nodeCalcData.set(key, node);

        if (!skipDisplayKeys.has(key)) computeDisplayValue(node, key);

        // No precedents, but need to queue dependents for re-evaluation
        queueDependents(key);
      }
    }

    // PHASE 2: Dependency Validation
    processPhase2();

    // Clear batch tracking after processing complete
    currentBatchKeys = null;
  }


/**
 * Clear all precedents for a node and remove it from their dependency lists.
 *
 * Called before updating a cell to clean up old dependencies.
 *
 * @param {string} nodeRef - Cell key or node reference to clear
 * @inner
 */
function clearNodePrecedents(nodeRef) {
  // Remove this node from its precedents' dependents lists
  /** @type {CalcNode|undefined} */
  const node = nodeCalcData.get(nodeRef);
  if (node?.precedents) {
    node.precedents.filter(dep => !isLiteral(dep)).forEach(dep => removeDependency(dep, nodeRef));
  }
}

/**
 * Check if a string is a numeric literal.
 *
 * @param {string} str - String to test
 * @returns {boolean} True if string represents a number (including negative)
 * @inner
 *
 * @example
 * isNumber("42")    // true
 * isNumber("-3.14") // true
 * isNumber("A1")    // false
 */
function isNumber(str) {
  return /^-?\d+(\.\d+)?$/.test(str);

}

/**
 * Check if a string is a literal value (number, error, or boolean).
 *
 * Literals don't need to be looked up in nodeCalcData.
 *
 * @param {string} str - String to test
 * @returns {boolean} True if string is a literal (error starting with #, number, or boolean)
 * @inner
 *
 * @example
 * isLiteral("#REF!")  // true
 * isLiteral("42")     // true
 * isLiteral("TRUE")   // true
 * isLiteral("FALSE")  // true
 * isLiteral('"hello"') // true (quoted string)
 * isLiteral("A1")     // false
 */
function isLiteral(str) {
  return str.startsWith('#') || isNumber(str) || str === 'TRUE' || str === 'FALSE' || isQuotedString(str);
}

/**
 * Check if a string is a quoted string literal.
 *
 * @param {string} str - String to test
 * @returns {boolean} True if string is quoted (starts and ends with double quotes)
 * @inner
 *
 * @example
 * isQuotedString('"hello"')  // true
 * isQuotedString('"B47"')    // true
 * isQuotedString('hello')    // false
 * isQuotedString('A1')       // false
 */
function isQuotedString(str) {
  return str.length >= 2 && str.startsWith('"') && str.endsWith('"');
}

/**
 * Add a dependency relationship to the reverse dependency graph.
 *
 * @param {string} precedentRef - The node being referenced (e.g., "A1", "ADD", "=A1+B1")
 * @param {string} dependentRef - The node that references it (e.g., "C1")
 * @inner
 *
 * @example
 * // If C1 = A1 + B1, then:
 * addDependency('A1', 'C1')   // A1 is used by C1
 * addDependency('ADD', 'C1')  // ADD function is used by C1
 */
function addDependency(precedentRef, dependentRef) {
  /** @type {Set<string>} */
  const deps = directDependentsGraph.get(precedentRef) || new Set();
  deps.add(dependentRef);
  directDependentsGraph.set(precedentRef, deps);
}

/**
 * Remove a dependency relationship from the reverse dependency graph.
 *
 * Performs garbage collection: if a precedent has no more dependents,
 * it's removed from the graph. Anonymous expressions (starting with '=')
 * are also deleted from nodeCalcData.
 *
 * @param {string} precedentRef - The node being referenced
 * @param {string} dependentRef - The node that referenced it
 * @inner
 */
function removeDependency(precedentRef, dependentRef) {
  /** @type {Set<string>|undefined} */
  const dependents = directDependentsGraph.get(precedentRef);
  if (dependents) {
    dependents.delete(dependentRef);
    if (dependents.size === 0) {
      directDependentsGraph.delete(precedentRef);
      // Only delete node data for anonymous extracted expressions
      if (precedentRef.startsWith('=')) {
        // CRITICAL: Clear the anonymous node's own precedents before deleting
        // This removes it from its precedents' dependent lists (e.g., =A2:B4 from A2, B2, etc.)
        clearNodePrecedents(precedentRef);
        nodeCalcData.delete(precedentRef);
        // Notify CanonicalValuesEngine to GC the anonymous expression from its
        // storage — but NOT if this anon is being re-established in the current
        // batch. cve has already written fresh storage + prov for it in the
        // same batch (it's in changedInfo), and it'll get a new nodeCalcData
        // entry when iteration reaches its key. Telling cve to delete here
        // would orphan prov, which findErrorSpans relies on.
        if (onDeleteAnonymous && !(currentBatchKeys && currentBatchKeys.has(precedentRef))) {
          onDeleteAnonymous(precedentRef);
        }
      }
    }
  }
}

/**
 * Convert a literal string to an evaluation result object.
 *
 * @param {string} str - Literal string (error like "#REF!", number like "42", or boolean like "TRUE")
 * @returns {EvaluationResult} Result object with refValue, type, and errorMeta for errors
 * @throws {Error} If called on a non-literal
 * @inner
 *
 * @example
 * convertLiteral("#REF!")  // { refValue: "#REF!", type: "error", errorMeta: ["#REF!"] }
 * convertLiteral("42")     // { refValue: 42, type: "number" }
 * convertLiteral("-3.14")  // { refValue: -3.14, type: "number" }
 * convertLiteral("TRUE")   // { refValue: true, type: "boolean" }
 * convertLiteral("FALSE")  // { refValue: false, type: "boolean" }
 * convertLiteral('"hello"') // { refValue: "hello", type: "text" }
 */
function convertLiteral(str) {
  if (str.startsWith('#')) {
    // Error literals - include errorMeta for tracking (unstamped, will be stamped in processPhase3)
    return {refValue: str, type: 'Error', errorMeta: [{ error: str }]};
  }
  if (str === 'TRUE') {
    // Boolean literal TRUE
    return {refValue: true, type: 'Boolean'};
  }
  if (str === 'FALSE') {
    // Boolean literal FALSE
    return {refValue: false, type: 'Boolean'};
  }
  if (isNumber(str)) {
    return {refValue: parseFloat(str), type: 'Number'};
  }
  if (isQuotedString(str)) {
    // Quoted string literal - strip the surrounding quotes
    return {refValue: str.slice(1, -1), type: 'Text'};
  }
  // Not a literal - shouldn't happen if called correctly
  throw new Error(`convertLiteral called on non-literal: ${str}`);
}

/**
 * Phase 2: Dependency validation and propagation.
 *
 * Builds unresolved precedent counts for all cells in the evaluation queue.
 * Propagates through the dependency graph to find all cells that need evaluation.
 *
 * @inner
 */
function processPhase2() {
  unresolvedCount = {};  // Reset precedent counts

  while (dependencyValidationCells.size > 0) {
    const [cellRef] = dependencyValidationCells;
    dependencyValidationCells.delete(cellRef);

    // Only add to evaluation set if it's actually a formula (has precedents)
    /** @type {CalcNode|undefined} */
    const node = nodeCalcData.get(cellRef);
    if (node?.precedents) {
      evaluationCells.add(cellRef);
    }

    // Propagate to dependents (even if this cell isn't a formula, its dependents might need re-evaluation)
    /** @type {Set<string>|undefined} */
    const dependents = directDependentsGraph.get(cellRef);
    if (dependents) {
      for (const depRef of dependents) {
        // Always increment count for this dependent (needed for topological sort)
        // (it has cellRef as a precedent that needs evaluation)
        unresolvedCount[depRef] = (unresolvedCount[depRef] || 0) + 1;

        // Skip adding to queue if dependent is in current batch - already added in Phase 1
        if (currentBatchKeys && currentBatchKeys.has(depRef)) {
          continue;
        }

        // Only add to queue if not already in evaluationCells (i.e., not processed)
        if (!evaluationCells.has(depRef)) {
          dependencyValidationCells.add(depRef);
        }
      }
    }
  }

  processPhase3();
}

/**
 * Phase 3: Topological evaluation.
 *
 * Processes formulas in topological order using Kahn's algorithm:
 * 1. Start with cells that have no unresolved precedents (count = 0)
 * 2. Evaluate each cell and update its dependents' unresolved counts
 * 3. When a dependent's count reaches 0, add it to the ready queue
 *
 * **Circular Dependency Detection:**
 * If no cells are ready but evaluationCells is not empty, there's a cycle.
 *
 * @inner
 */
function processPhase3() {
  // Counts already built in Phase 2 - no need to recalculate

  /** @type {string[]} */
  const readyQueue = [];

  // Find all cells with 0 unresolved precedents
  for (const cellRef of evaluationCells) {
    if ((unresolvedCount[cellRef] || 0) === 0) {
      readyQueue.push(cellRef);
    }
  }

  // If no cells are ready, we have a circular dependency
  if (readyQueue.length === 0 && evaluationCells.size > 0) {
    handleCircularDependency();
    return;
  }

  // Process ready cells
  while (readyQueue.length > 0) {
    /** @type {string} */
    const cellRef = readyQueue.shift();
    evaluationCells.delete(cellRef);

    // Evaluate node
    /** @type {CalcNode} */
    const node = nodeCalcData.get(cellRef);
    /** @type {EvaluationResult} */
    const result = evaluateExpr(node.precedents);

    // Explicitly assign properties to ensure errorMeta is cleared when not present
    node.refValue = result.refValue;
    node.type = result.type;

    // Stamp any unstamped errors with current cell as source
    if (result.errorMeta) {
      node.errorMeta = result.errorMeta.map(meta =>
        meta.source ? meta : { source: cellRef, error: meta.error }
      );
    } else {
      node.errorMeta = undefined; // Clear stale errorMeta
    }

    if (!skipDisplayKeys.has(cellRef)) computeDisplayValue(node, cellRef);

    // Update dependents
    /** @type {Set<string>|undefined} */
    const dependents = directDependentsGraph.get(cellRef);
    if (dependents) {
      for (const depRef of dependents) {
        // Decrement unresolved count
        unresolvedCount[depRef]--;

        // If now ready, add to queue
        if (unresolvedCount[depRef] === 0 && evaluationCells.has(depRef)) {
          readyQueue.push(depRef);
        }
      }
    }
  }

  // Check for remaining cells in evaluationCells (partial circular dependencies)
  // These cells were part of a cycle but didn't block all cells initially
  if (evaluationCells.size > 0) {
    for (const nodeRef of evaluationCells) {
      /** @type {CalcNode} */
      const node = nodeCalcData.get(nodeRef);
      node.refValue = '#CIRCULAR!';
      node.type = 'Error';
      node.errorMeta = [{ source: nodeRef, error: '#CIRCULAR!' }];

      // Refresh display for this cell
      if (!skipDisplayKeys.has(nodeRef)) computeDisplayValue(node, nodeRef);
    }
  }

  // Clear evaluation state
  evaluationCells.clear();
  unresolvedCount = {};
}

/**
 * Handle circular dependency errors.
 *
 * All cells stuck in the evaluation queue (unable to resolve) are part of
 * a circular dependency chain. Mark them all with #CIRCULAR! error.
 *
 * @inner
 *
 * @example
 * // If A1=B1 and B1=A1, both get marked as #CIRCULAR!
 */
function handleCircularDependency() {
  // ALL stuck nodes get propagated error marker
  for (const nodeRef of evaluationCells) {
    /** @type {CalcNode} */
    const node = nodeCalcData.get(nodeRef);
    node.refValue = '#CIRCULAR!';
    node.type = 'Error';
    node.errorMeta = [{ source: nodeRef, error: '#CIRCULAR!' }];

    // Refresh display for this cell
    if (!skipDisplayKeys.has(nodeRef)) computeDisplayValue(node, nodeRef);
  }

  evaluationCells.clear();
  unresolvedCount = {};
}


/**
 * Evaluate an expression in prefix notation.
 *
 * **Prefix format:** `[functionName, arg1, arg2, ...]`
 *
 * Arguments are passed directly to the function validation layer.
 * Each argument is a {refValue, type} object.
 *
 * @param {string[]} precedents - Prefix notation array (e.g., ['ADD', 'A1', '10'])
 * @returns {EvaluationResult} Result object with refValue and type
 * @inner
 *
 * @example
 * evaluateExpr(['ADD', 'A1', '10'])
 * // Returns: { refValue: 52, type: 'Number' } (if A1=42)
 */
function evaluateExpr(precedents) {
  /** @type {string} */
  const funcNameRef = precedents[0];
  /** @type {string[]} */
  const args = precedents.slice(1);

  // Resolve function from node (since functions are now precedents)
  /** @type {CalcNode|undefined} */
  const funcNode = nodeCalcData.get(funcNameRef);
  if (!funcNode) {
    return {refValue: '#NAME!', type: 'Error', errorMeta: [{ error: '#NAME!' }]};
  }
  /** @type {Object} */
  const funcDef = funcNode.refValue;

  // Evaluate all arguments - each is {refValue, type}
  /** @type {Array} */
  const evaluatedArgs = args.map(arg => evaluateExprArg(arg));

  // Pass directly to validation - no dimensional wrapping
  return validateAndExecute(evaluatedArgs, funcDef);
}

/**
 * Evaluate a single argument to an expression.
 *
 * Handles both literal values and references (cell refs, named ranges, anonymous expressions).
 * Always returns the full {refValue, type} structure for consistency.
 *
 * @param {string} arg - Argument string (literal like "42", reference like "A1", or anonymous expression like "=A1+B1")
 * @returns {EvaluationResult} Result object with refValue, type, and optional errorMeta
 * @inner
 *
 * @example
 * evaluateExprArg("42")    // { refValue: 42, type: 'Number' }
 * evaluateExprArg("A1")    // { refValue: <value>, type: <type> }
 * evaluateExprArg("=A1+B1") // { refValue: <result>, type: 'Number' }
 * evaluateExprArg("=A1:B2") // { refValue: [val, val, ...], type: 'ARRAY[Number]' }
 */
function evaluateExprArg(arg) {
  if (isLiteral(arg)) {
    return convertLiteral(arg);
  }

  // Return full result object for all types, including arrays
  return evaluateReference(arg);
}

/**
 * Evaluate a reference to get its value.
 *
 * Looks up cell references, named ranges, function names, or anonymous expressions
 * in nodeCalcData and returns their evaluated values.
 *
 * **Error handling:**
 * - #REF! - Reference looks like a cell (e.g., "A1") but is empty/undefined
 * - #NAME! - Reference is not a valid cell format (e.g., function or named range that doesn't exist)
 *
 * @param {string} ref - Reference string (e.g., "A1", "SUM", "=A1+B1")
 * @returns {EvaluationResult} Result object with refValue, type, and errorMeta (if present)
 * @inner
 *
 * @example
 * evaluateReference("A1")    // { refValue: 42, type: 'Number' }
 * evaluateReference("SUM")   // { refValue: {impl: Function}, type: 'function' }
 * evaluateReference("=A1+B1") // { refValue: <evaluated>, type: 'Number' }
 * evaluateReference("A1")    // { refValue: '#REF!', type: 'Error', errorMeta: ['#REF!'] } (if A1 is empty)
 * evaluateReference("XYZ")   // { refValue: '#NAME!', type: 'Error', errorMeta: ['#NAME!'] } (unknown name)
 */
function evaluateReference(ref) {
  // Everything is now stored as nodes - just look it up
  /** @type {CalcNode|undefined} */
  const node = nodeCalcData.get(ref);
  if (!node) {
    // Distinguish between empty cell references (#REF!) and unknown names (#NAME!)
    // These errors are stamped with the ref itself as source since there's no cell
    if (isCellReference(ref)) {
      return {refValue: '#REF!', type: 'Error', errorMeta: [{ source: ref, error: '#REF!' }]};
    }
    return {refValue: '#NAME!', type: 'Error', errorMeta: [{ error: '#NAME!' }]};
  }

  // Return object with value, type, and errorMeta if present
  const result = {refValue: node.refValue, type: node.type};
  if (node.errorMeta) {
    result.errorMeta = node.errorMeta;
  }
  return result;
}




/**
 * Queue all dependents of a node for re-evaluation.
 *
 * When a cell's value changes, all cells that reference it need to be recalculated.
 * This adds them to the dependency validation queue.
 *
 * @param {string} nodeRef - Cell key or reference whose dependents should be queued
 * @inner
 *
 * @example
 * // If C1=A1+B1 and D1=A1*2, changing A1 queues both C1 and D1
 * queueDependents('A1')  // Adds C1 and D1 to dependencyValidationCells
 */
function queueDependents(nodeRef) {
  /** @type {Set<string>|undefined} */
  const dependents = directDependentsGraph.get(nodeRef);
  if (dependents) {
    for (const depRef of dependents) {
      // Skip dependents that are also in the current batch - they'll be processed directly
      if (currentBatchKeys && currentBatchKeys.has(depRef)) {
        continue;
      }
      dependencyValidationCells.add(depRef);
    }
  }
}



  // Return public API
  return {
    /**
     * Initialize the calculation engine with dependencies.
     *
     * Must be called before processInputs(). Sets up display formatting callback
     * and loads built-in functions into nodeCalcData.
     *
     * @param {InitConfig} config - Configuration object with callbacks
     * @param {function(CalcNode, string): void} config.onComputeDisplayDpn - Display formatting callback
     *
     * @example
     * calcEngine.init({
     *   onComputeDisplayDpn: (node, cellKey) => {
     *     formattingEngine.formatDisplay(node, cellKey);
     *   }
     * });
     */
    init(deps) {
      ({
        computeDisplayValue,
        onDeleteAnonymous
      } = deps);

      // Load built-in functions
      this.registerFunction(getBuiltInFunctions());
    },

    processInputs,

    /**
     * Register a key whose display-value computation should be skipped.
     * Used for ephemeral slots (e.g. formula-bar preview) that go through the full
     * evaluation pipeline but shouldn't produce display output.
     */
    markSkipDisplay(key) {
      skipDisplayKeys.add(key);
    },

    /**
     * Get the computed value of a cell.
     *
     * Returns the evaluated refValue from nodeCalcData. For formulas, this is the
     * computed result. For simple values, it's the stored value.
     *
     * @param {string} cellRef - Cell key (e.g., "A1", "B2")
     * @returns {*} The cell's value, or undefined if not found
     *
     * @example
     * calcEngine.getCellValue('A1')  // 42
     * calcEngine.getCellValue('B1')  // "hello"
     * calcEngine.getCellValue('C1')  // undefined (not found)
     */
    getCellValue(cellRef) {
      // Now ALWAYS in nodeCalcData (formulas AND simple values)
      /** @type {CalcNode|undefined} */
      const node = nodeCalcData.get(cellRef);
      if (node) return node.refValue;

      // Not found
      return undefined;
    },

    /**
     * Get the complete node data for a cell.
     *
     * Exposes the full CalcNode including type, refValue, and precedents (if any).
     * Useful for testing, inspection, and debugging.
     *
     * @param {string} cellRef - Cell key (e.g., "A1", "B2")
     * @returns {CalcNode|undefined} The complete node data, or undefined if not found
     *
     * @example
     * calcEngine.getNode('A1')
     * // Returns: { refValue: 42, type: 'Number' }
     *
     * @example
     * calcEngine.getNode('B1')
     * // Returns: { precedents: ['ADD', 'A1', '10'], refValue: 52, type: 'Number' }
     */
    getNode(cellRef) {
      // Just return from nodeCalcData - everything is there
      return nodeCalcData.get(cellRef);
    },

    /**
     * Get all cells that have formulas depending on the specified cell.
     *
     * Returns a Set of cell keys that directly reference the given cell in their formulas.
     * Uses the directDependentsGraph which tracks precedent → dependent relationships.
     *
     * @param {string} cellKey - Cell key to find dependents for (e.g., "A1", "B2")
     * @returns {Set<string>} Set of cell keys that depend on this cell (empty Set if none)
     *
     * @example
     * // If C1=A1+B1 and D1=A1*2, then:
     * calcEngine.getDependentsOf('A1')  // Set {'C1', 'D1'}
     * calcEngine.getDependentsOf('B1')  // Set {'C1'}
     * calcEngine.getDependentsOf('E1')  // Set {} (no dependents)
     */
    getDependentsOf(cellKey) {
      return directDependentsGraph.get(cellKey) || new Set();
    },

    /**
     * Get the internal nodeCalcData Map for persistence/export.
     *
     * Returns the complete Map of all calculated nodes including cells, formulas,
     * and functions. Used by StorageEngine for XML export.
     *
     * @returns {Map<string, CalcNode>} The nodeCalcData Map
     */
    getNodeCalcData() {
      return nodeCalcData;
    },

    /**
     * Register functions.
     *
     * Adds functions to nodeCalcData so they can be used in formulas.
     * Works for both built-in and custom functions.
     *
     * Built-in funcDefs (no `id`) replace whatever was there. User funcDefs
     * (with `id`) merge their variants into any existing entry under the
     * same name, with each variant tagged by its source `id`. A second source
     * cannot register a variant whose `argTypes` collide with an existing
     * variant from a different source unless `options.replace` is true; same-id
     * re-registration always replaces in place (treated as a reload).
     *
     * @param {Object} functions - Object mapping names to function definitions { NAME: funcDef, ... }
     * @param {Object} [options]
     * @param {boolean} [options.replace=false] - If true, conflicting variants from other sources are replaced.
     * @returns {{success: boolean, count: number, conflicts: Array<{name: string, argTypes: string[], existingSourceId: string}>}}
     */
    registerFunction(functions, options = {}) {
      const replace = !!options.replace;
      const conflicts = [];
      let count = 0;

      for (const [name, funcDef] of Object.entries(functions)) {
        const sourceId = funcDef.id || null;
        const existing = nodeCalcData.get(name);

        // Built-in path: no source tracking, simple set/replace.
        if (sourceId === null) {
          nodeCalcData.set(name, { type: 'function', refValue: funcDef });
          queueDependents(name);
          count++;
          continue;
        }

        // User path.
        const sourceMeta = sourceMetaFromFuncDef(funcDef);
        const incomingVariants = (funcDef.variants || []).map(v => ({
          ...v,
          source: sourceMeta
        }));

        const existingIsUser = existing && existing.type === 'function'
          && existing.refValue?.variants?.some(v => v.source);

        // No existing entry, or existing is built-in: fresh user entry replaces it.
        // (Shadowing built-ins by name preserves prior behavior.)
        if (!existingIsUser) {
          nodeCalcData.set(name, {
            type: 'function',
            refValue: { name: funcDef.name || name, variants: incomingVariants }
          });
          queueDependents(name);
          count++;
          continue;
        }

        // Merge into existing user entry. Same-source variants are dropped first
        // (silent in-place reload); collisions across sources require replace.
        const merged = existing.refValue.variants.filter(v => v.source?.id !== sourceId);
        let entryConflicts = [];
        for (const incoming of incomingVariants) {
          const collidingIdx = merged.findIndex(v => argTypesEqual(v.argTypes, incoming.argTypes));
          if (collidingIdx === -1) {
            merged.push(incoming);
          } else if (replace) {
            merged[collidingIdx] = incoming;
          } else {
            entryConflicts.push({
              name,
              argTypes: incoming.argTypes,
              existingSourceId: merged[collidingIdx].source?.id || null
            });
          }
        }

        if (entryConflicts.length > 0) {
          conflicts.push(...entryConflicts);
          continue;
        }

        nodeCalcData.set(name, {
          type: 'function',
          refValue: { name: existing.refValue.name || funcDef.name || name, variants: merged }
        });
        queueDependents(name);
        count++;
      }

      processPhase2();
      return { success: conflicts.length === 0, count, conflicts };
    },

    /**
     * Unregister variants belonging to a specific source (functionId).
     *
     * Removes only the variants whose `source.id` matches. If no variants
     * remain under the name, the entry itself is removed.
     *
     * @param {string} functionId - Source function ID
     * @returns {{name: string, fullyRemoved: boolean, dependents: string[]}|null} The affected name, whether the entry was removed entirely, and the dependents captured before removal. null if no match.
     */
    unregisterFunctionById(functionId) {
      if (!functionId) return null;

      let foundName = null;
      let foundNode = null;
      for (const [name, node] of nodeCalcData) {
        if (node.type !== 'function') continue;
        if (node.refValue?.variants?.some(v => v.source?.id === functionId)) {
          foundName = name;
          foundNode = node;
          break;
        }
      }

      if (!foundNode) return null;

      const dependents = Array.from(directDependentsGraph.get(foundName) || []);

      const remaining = foundNode.refValue.variants.filter(v => v.source?.id !== functionId);
      const fullyRemoved = remaining.length === 0;

      if (fullyRemoved) {
        nodeCalcData.delete(foundName);
      } else {
        nodeCalcData.set(foundName, {
          type: 'function',
          refValue: { name: foundNode.refValue.name, variants: remaining }
        });
      }

      queueDependents(foundName);
      processPhase2();

      return { name: foundName, fullyRemoved, dependents };
    },

    /**
     * Get all registered user-loaded functions with metadata.
     *
     * Returns one row per source — a single name with two source-tagged
     * variants yields two rows so each can be unloaded/renamed independently.
     *
     * @returns {Array<{name: string, id?: string, version?: string, description?: string}>}
     */
    getFunctionsWithMetadata() {
      const result = [];
      const seen = new Set();
      for (const [name, node] of nodeCalcData) {
        if (node.type !== 'function') continue;
        const variants = node.refValue?.variants;
        if (!variants) continue;
        for (const variant of variants) {
          const src = variant.source;
          if (!src) continue;
          const key = `${name}::${src.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({
            name,                          // consumer name (registration key)
            canonicalName: src.name,       // source's published name
            id: src.id,
            versionId: src.versionId,
            version: src.version,
            sheetType: src.sheetType,
            description: src.description,
            author: src.author,
            signature: src.signature
          });
        }
      }
      return result;
    },

    /**
     * Get drill-down info for a cell if its outermost function is a custom function.
     *
     * Used to open a custom function's definition spreadsheet with the current argument values.
     *
     * @param {string} cellKey - Cell key to check (e.g., "A1")
     * @returns {{functionId: string, versionId: string|null, functionName: string|null, argValues: Array, sheetType: string}|null} Drill-down info or null if not applicable
     *
     * @example
     * // If A1 = =DISCOUNT(100, 20) and DISCOUNT is a custom function
     * calcEngine.getDrilldownInfo('A1')
     * // Returns: { functionId: 'uuid', versionId: 'version-uuid', functionName: 'DISCOUNT', argValues: [100, 20], sheetType: 'standard' }
     */
    getDrilldownInfo(cellKey) {
      const node = nodeCalcData.get(cellKey);

      // Must have precedents (be a formula)
      if (!node?.precedents || node.precedents.length === 0) {
        return null;
      }

      // Find the first custom function in the precedents (not just the outermost)
      let funcName = null;
      let funcNode = null;
      const visited = new Set();
      const stack = [cellKey];

      while (stack.length > 0) {
        const key = stack.pop();
        if (visited.has(key)) continue;
        visited.add(key);

        const n = nodeCalcData.get(key);
        if (!n?.precedents) continue;

        for (const p of n.precedents) {
          const pNode = nodeCalcData.get(p);
          if (pNode?.type === 'function' && pNode.refValue?.variants?.some(v => v.source)) {
            funcName = p;
            funcNode = pNode;
            break;
          }
          stack.push(p);
        }
        if (funcNode) break;
      }

      if (!funcNode) {
        return null;
      }

      // Get the resolved values of the arguments from the cell that calls this function
      // Find the direct caller of funcName
      const callerNode = nodeCalcData.get(
        [...visited].find(k => {
          const n = nodeCalcData.get(k);
          return n?.precedents?.[0] === funcName;
        }) || cellKey
      );

      // Serialize arg values to strings that round-trip through detectType,
      // so drilldown inputs receive the correct types (not raw String() coercion).
      // Also collect typed arg objects so we can match the correct variant for drilldown.
      const argValues = [];
      const typedArgs = [];
      if (callerNode?.precedents?.[0] === funcName) {
        for (let i = 1; i < callerNode.precedents.length; i++) {
          const arg = callerNode.precedents[i];
          let typed;
          if (isLiteral(arg)) {
            typed = convertLiteral(arg);
          } else {
            const argNode = nodeCalcData.get(arg);
            typed = argNode
              ? { refValue: argNode.refValue, type: argNode.type }
              : { refValue: '', type: 'Text' };
          }
          typedArgs.push(typed);
          argValues.push(TypeService.serializeForInput(typed.refValue, typed.type));
        }
      }

      // Pick the source matching the call's argument types.
      const variants = funcNode.refValue.variants;
      let matchedSource = null;
      for (const variant of variants) {
        if (!variant.source) continue;
        if (matchSignature(typedArgs, variant.argTypes).success) {
          matchedSource = variant.source;
          break;
        }
      }
      // Fallback: first sourced variant (preserves drilldown for partial-match cases).
      if (!matchedSource) {
        const firstSourced = variants.find(v => v.source);
        if (!firstSourced) return null;
        matchedSource = firstSourced.source;
      }

      return {
        functionId: matchedSource.id,
        versionId: matchedSource.versionId || null,
        functionName: matchedSource.name || null,
        argValues,
        sheetType: matchedSource.sheetType || 'standard'
      };
    },

    /**
     * Silently delete keys without triggering dependency cascades or display updates.
     *
     * Used by loop sheets to efficiently clear generated rows before regeneration.
     * Cleans up nodeCalcData and directDependentsGraph without calling
     * computeDisplayValue or queueDependents.
     *
     * @param {string[]} keys - Array of cell keys to delete
     */
    silentDeleteKeys(keys) {
      for (const key of keys) {
        // Remove this cell from its precedents' dependents lists
        clearNodePrecedents(key);

        // Remove this cell's entry in directDependentsGraph (its dependents)
        directDependentsGraph.delete(key);

        // Delete the node data
        nodeCalcData.delete(key);
      }
    }
  };
}

export { createCalculationEngine };