/**
 * Client-side transpiler — public entry point + pipeline.
 *
 * Usage:
 *   import { transpile } from '../transpiler/index.js';
 *   const { javascript, error } = transpile(xmlContent, customFunctions);
 *
 * Ported from server/app/services/transpiler_wrapper.py + server/transpiler/setup.py.
 *
 * Dropped: file I/O, Python/SQL paths, audit bundles, subprocess testing,
 *   interactive prompts, timing instrumentation.
 */

import { convertFunctionNames, cleanSchema } from './xmlPreprocessor.js';
import { normalizeDoc, extractColumnNames } from './convertXml.js';
import { buildGraph, isLoopSheet } from './graphBuilder.js';
import * as sig from './signatureRules.js';
import * as dags from './dagOperations.js';
import * as validation from './validation.js';
import { transpileDagsToJs, transpileDags, buildTestCases, jsSafeName } from './codegenJavascript.js';
import { getTransformLogicDags as buildTransformLogicDags } from './transforms.js';

// Data files (bundled as ES modules)
import javascriptFunctions from './data/javascriptFunctions.js';
import { functionSignatures } from '../functionSignatures.js';

// ── Signature library (built from shared functionSignatures) ─────────

/** Transpiler-specific metadata for signatures that need special handling. */
const TRANSPILER_METADATA = {
  INDEX: { branching_function: true },
  IF: { branching_function: true },
};

/**
 * Build the signature definition library from the shared function signatures.
 * Cached after first call. Returns a shallow copy so callers can mutate
 * (e.g. addSignaturesToLibrary for custom functions) without polluting
 * the cached base library.
 */
let _cachedSignatureLibrary = null;

function getSignatureDefinitionLibrary() {
  if (!_cachedSignatureLibrary) {
    const library = sig.initializeConversionRules();

    // Convert shared signatures to the transpiler's { inputs, outputs } format.
    // Filter out Object/Dynamic types — the transpiler handles multi-output
    // functions via its own codegen path, not through signature matching.
    const sigDict = { signatures: {} };
    for (const [funcName, sigs] of Object.entries(functionSignatures)) {
      const metadata = TRANSPILER_METADATA[funcName] || {};
      const filtered = sigs.filter(s =>
        !s.inputs.some(t => t === 'Object' || t.startsWith('Object[')) &&
        s.output !== 'Dynamic'
      );
      if (filtered.length > 0) {
        sigDict.signatures[funcName] = filtered.map(s => ({
          inputs: s.inputs,
          outputs: [s.output],
          ...metadata,
        }));
      }
    }

    sig.addSignaturesToLibrary(sigDict, library, 'bundled', false);

    if (!validation.isValidSignatureDefinitionDict(library, false, true)) {
      throw new Error('Bundled signature definition library is not valid');
    }

    _cachedSignatureLibrary = library;
  }

  // Return a copy — convertGraph mutates the library by adding custom
  // function signatures, and we don't want those leaking across calls.
  const copy = sig.initializeConversionRules();
  for (const [key, sigs] of Object.entries(_cachedSignatureLibrary.signatures)) {
    copy.signatures[key] = [...sigs];
  }
  return copy;
}

// ── Transform logic DAGs (pre-built patterns) ────────────────────────

function getTransformLogicDags() {
  return buildTransformLogicDags();
}

// ── Custom functions parsing ─────────────────────────────────────────

/**
 * Parse <CustomFunctions> section from DOM to get name → id mapping.
 * Must be called BEFORE normalizeDoc (which strips CustomFunctions).
 *
 * @param {Document} doc - DOM document
 * @returns {Object} name → id mapping
 */
function parseCustomFunctions(doc) {
  const mapping = {};
  for (const func of doc.querySelectorAll('CustomFunctions > Function')) {
    const id = func.getAttribute('id');
    const name = func.getAttribute('name');
    if (id && name) {
      mapping[name.toUpperCase()] = id;
    }
  }
  return mapping;
}

// ── Shared XML → DOM parsing ─────────────────────────────────────────

/**
 * Parse XML string to DOM and apply pre-normalization steps:
 * extract metadata (before stripping), clean schema, convert function names, normalize.
 *
 * @param {string} xmlContent - raw XML string
 * @returns {{ doc: Document, customFuncs: Object, columnNames: Object }}
 */
function parseAndPrepare(xmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent}`);
  }

  // Extract metadata before stripping
  const customFuncs = parseCustomFunctions(doc);
  const columnNames = extractColumnNames(doc);

  // Clean and normalize
  cleanSchema(doc);
  convertFunctionNames(doc);
  normalizeDoc(doc);

  return { doc, customFuncs, columnNames };
}

// ── DAG building from custom functions ───────────────────────────────

/**
 * Build DAGs from custom function XML content.
 *
 * @param {Object} customFunctionsData - keyed by ID: { xml_content, name }
 * @returns {{ customFunctionDags: Object, customLoopFunctions: Object }}
 */
function buildFunctionDags(customFunctionsData) {
  const customFunctionDags = {};
  const customLoopFunctions = {};

  // Cycle detection via adjacency, keyed by UUID to avoid false positives
  // when the same function name exists in multiple workfolders.
  const cycleGraph = {};  // key (UUID) → Set of dependency keys (UUIDs)

  function addToCycleDetection(dag, key) {
    if (!cycleGraph[key]) cycleGraph[key] = new Set();
    const customFuncs = dag.graph.custom_functions || {};

    for (const nodeId of dag.nodeIds()) {
      const attrs = dag.getNode(nodeId);
      if (attrs.function_name) {
        // Resolve to UUID via the DAG's custom_functions mapping.
        // Built-in functions (IF, ADD, etc.) aren't in the mapping and
        // are skipped — they can't cause cycles.
        const depKey = customFuncs[attrs.function_name];
        if (depKey) {
          if (!cycleGraph[depKey]) cycleGraph[depKey] = new Set();
          cycleGraph[key].add(depKey);
        }
      }
    }

    // DFS cycle check
    const visited = new Set();
    const inStack = new Set();
    function hasCycle(node) {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const dep of (cycleGraph[node] || [])) {
        if (hasCycle(dep)) return true;
      }
      inStack.delete(node);
      return false;
    }

    for (const node of Object.keys(cycleGraph)) {
      visited.clear();
      inStack.clear();
      if (hasCycle(node)) {
        throw new Error(`Circular dependency detected involving ${node}`);
      }
    }
  }

  function buildSingleFunction(xmlContent, name, key) {
    // Parse once: extract metadata, clean, normalize
    const { doc, customFuncs: customFuncsMapping, columnNames } = parseAndPrepare(xmlContent);

    // Check if it's a loop sheet
    if (isLoopSheet(doc)) {
      const loopGraph = buildGraph(doc);
      loopGraph.graph.custom_functions = customFuncsMapping;
      if (Object.keys(columnNames).length > 0) {
        loopGraph.graph.column_names = columnNames;
      }
      customLoopFunctions[key] = { graph: loopGraph, xmlTree: doc };
      return;
    }

    // Regular function — build and validate DAG
    const dag = buildGraph(doc);
    dag.graph.custom_functions = customFuncsMapping;

    // Remove disconnected nodes (display-only labels not connected to outputs)
    const outputNodeIds = dag.graph.output_node_ids || [];
    if (outputNodeIds.length > 0) {
      const connectedNodes = new Set();
      function traceUpstream(nodeId) {
        if (connectedNodes.has(nodeId)) return;
        connectedNodes.add(nodeId);
        for (const predId of dag.predecessors(nodeId)) {
          traceUpstream(predId);
        }
      }
      for (const outId of outputNodeIds) {
        traceUpstream(outId);
      }
      const disconnected = dag.nodeIds().filter(id => !connectedNodes.has(id));
      for (const id of disconnected) {
        dag.removeNode(id);
      }
      // Update max_node_id after removing nodes
      if (disconnected.length > 0 && dag.nodeIds().length > 0) {
        dag.graph.max_node_id = dag.nodeIds().reduce((a, b) => a > b ? a : b, -Infinity);
      }
    }

    // Eliminate PROCEED pass-through nodes
    dags.eliminateProceedNodes(dag);

    if (!validation.isValidLogicFunction(dag, `${name}.xml`, name)) {
      return; // Skip invalid functions
    }

    dags.renumberNodes(dag);
    addToCycleDetection(dag, key);

    customFunctionDags[key] = dag;
  }

  // Build all custom function DAGs
  for (const [funcId, data] of Object.entries(customFunctionsData)) {
    try {
      buildSingleFunction(data.xml_content, data.name.toUpperCase(), funcId);
    } catch (e) {
      // Log but don't fail the whole build for one bad function
      console.warn(`Failed to build DAG for custom function ${data.name} (${funcId}):`, e.message);
    }
  }

  return { customFunctionDags, customLoopFunctions };
}

// ── Settings initialization (replaces setup.py) ─────────────────────

/**
 * Build the settings object needed by the codegen module.
 * Replaces setup.get_standard_settings + initial_dag_objects.
 *
 * @param {Document} doc - normalized XML DOM document
 * @param {Object} columnNames - column display names from SpreadsheetMeta
 * @param {Object} customFunctionDags - keyed by ID
 * @param {Object} customLoopFunctions - keyed by ID
 * @param {Object} rootCustomFuncs - name → id mapping for the base function
 * @returns {Object} settings for transpileDagsToJs
 */
function buildSettings(doc, columnNames, customFunctionDags, customLoopFunctions, rootCustomFuncs, langFunctionsData = javascriptFunctions) {
  const signatureDefinitionLibrary = getSignatureDefinitionLibrary();
  const transforms = getTransformLogicDags();

  // Build the base DAG graph
  const baseDagGraph = buildGraph(doc);

  // Attach column display names
  if (Object.keys(columnNames).length > 0) {
    baseDagGraph.graph.column_names = columnNames;
  }

  // Attach root custom functions mapping
  if (rootCustomFuncs && Object.keys(rootCustomFuncs).length > 0) {
    baseDagGraph.graph.custom_functions = rootCustomFuncs;
  }

  // Initialize conversion rules
  const conversionRules = sig.initializeConversionRules();
  conversionRules.custom_function_dags = customFunctionDags;
  conversionRules.system_function_dags = {};
  conversionRules.custom_loop_functions = customLoopFunctions;
  conversionRules.system_loop_functions = {};
  conversionRules.transforms = transforms;

  // Merge language-specific rules
  sig.updateConversionRules(conversionRules, langFunctionsData);

  // Add loop function signatures
  const allLoopFunctions = {};
  for (const [, data] of Object.entries(customLoopFunctions)) {
    allLoopFunctions[data.graph.graph.name] = data;
  }
  if (Object.keys(allLoopFunctions).length > 0) {
    const loopSigs = sig.createLoopFunctionSignatures(allLoopFunctions);
    sig.updateConversionRules(conversionRules, loopSigs);
  }

  // Check if this is a loop sheet
  const isLoop = isLoopSheet(doc);
  let G;

  if (isLoop) {
    const funcName = doc.documentElement.getAttribute('name')?.toUpperCase() || 'LOOP_FUNC';

    // Transform loop BEFORE PROCEED elimination
    const [outerDag, innerDag] = dags.transformLoopToOuterInner(
      baseDagGraph, doc, funcName, customFunctionDags,
    );

    // Eliminate PROCEED nodes from both DAGs
    dags.eliminateProceedNodes(outerDag);
    dags.eliminateProceedNodes(innerDag);

    // Process inner DAG through standard convert_graph
    dags.convertGraph({
      dagToConvert: innerDag,
      conversionRules,
      signatureDefinitionLibrary,
      renumNodes: true,
    });

    // Update inner DAG reference on outer DAG
    outerDag.graph.iteration_body_dag = innerDag;
    G = outerDag;
  } else {
    // Regular DAG: PROCEED elimination then subset
    dags.eliminateProceedNodes(baseDagGraph);
    G = dags.subsetGraph(baseDagGraph, baseDagGraph.graph.output_node_ids);
  }

  if (!validation.isValidBaseGraph(G, false)) {
    throw new Error('Base DAG graph is not valid after preparation');
  }

  // Combine loop functions for helper generation (keyed by name)
  const loopFunctions = {};
  for (const [, data] of Object.entries(customLoopFunctions)) {
    loopFunctions[data.graph.graph.name] = data;
  }

  return {
    G,
    conversionRules,
    signatureDefinitionLibrary,
    loopFunctions,
    xmlTree: doc,
  };
}

// ── Test case extraction ─────────────────────────────────────────────

/**
 * Extract test cases from a normalized DOM document.
 * Test cases survive normalizeDoc so this can be called after parseAndPrepare.
 *
 * @param {Document} doc - normalized XML DOM document
 * @returns {Array<{ inputValues: Array<{value: string}>, outputValues: Array<{value: string}> }>}
 */
function extractTestCases(doc) {
  const cases = [];
  for (const tc of doc.querySelectorAll('TestCases > test_case')) {
    const inputValues = [...tc.querySelectorAll('input_value')]
      .map(el => ({ value: el.getAttribute('Value') }));
    const outputValues = [...tc.querySelectorAll('output_value')]
      .map(el => ({ value: el.getAttribute('Value') }));
    if (inputValues.length > 0 || outputValues.length > 0) {
      cases.push({ inputValues, outputValues });
    }
  }
  return cases;
}

// ── Self-validation ──────────────────────────────────────────────────

/**
 * Compare two values with numeric tolerance.
 */
function valuesMatch(actual, expected) {
  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return actual === expected;
  }
  const tolerance = Math.abs(expected) * 1e-6 || 1e-6;
  return Math.abs(actual - expected) < tolerance;
}

/**
 * Run transpiled JavaScript against typed test cases.
 *
 * @param {string} javascript - the transpiled JS code
 * @param {string} funcName - the JS-safe function name
 * @param {Array} typedCases - from buildTestCases()
 * @returns {{ passed: number, failed: number, failures: Array }}
 */
function runSelfTests(javascript, funcName, typedCases) {
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < typedCases.length; i++) {
    const tc = typedCases[i];
    try {
      const factory = new Function(javascript + '\nreturn ' + funcName + ';');
      const fn = factory();
      const actual = fn(...tc.inputs);

      // Extract actual values: multi-output functions return { name: value }
      let actuals;
      if (actual !== null && typeof actual === 'object' && !Array.isArray(actual)) {
        actuals = Object.values(actual);
      } else {
        actuals = [actual];
      }

      let allMatch = true;
      for (let j = 0; j < tc.expectedOutputs.length; j++) {
        if (!valuesMatch(actuals[j], tc.expectedOutputs[j])) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        passed++;
      } else {
        failed++;
        failures.push({
          testIndex: i,
          inputs: tc.inputs,
          expected: tc.expectedOutputs,
          actual: actuals,
        });
      }
    } catch (e) {
      failed++;
      failures.push({
        testIndex: i,
        inputs: tc.inputs,
        expected: tc.expectedOutputs,
        actual: null,
        error: e.message,
      });
    }
  }

  return { passed, failed, failures };
}

// ── Signature extraction from resolved graph ─────────────────────────

/**
 * Extract the function signature (input/output names and types) from the
 * resolved DAG graph. Called after transpilation so all types are finalized.
 *
 * @param {Object} G - The resolved DAG graph
 * @returns {{ inputs: Array<{name: string, type: string}>, outputs: Array<{name: string, type: string}> }}
 */
function extractSignatureFromGraph(G) {
  const inputNodeIds = G.graph.input_node_ids || [];
  const outputNodeIds = G.graph.output_node_ids || [];

  const inputs = inputNodeIds.map(nid => {
    const node = G.getNode(nid);
    return { name: node.input_name, type: node.data_type || 'Number' };
  });

  const outputs = outputNodeIds.map(nid => {
    const node = G.getNode(nid);
    return { name: node.output_name, type: node.data_type || 'Number' };
  });

  return { inputs, outputs };
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Transpile spreadsheet XML to JavaScript code.
 *
 * @param {string} xmlContent - the XML string to transpile
 * @param {Object} [customFunctions={}] - keyed by ID: { name, xml_content }
 * @returns {{ javascript: string|null, signature: Object|null, error: string|null, testResults: Object|null }}
 */
export function transpile(xmlContent, customFunctions = {}) {
  try {
    // Step 1: Parse DOM once — extract metadata, clean, normalize
    const { doc, customFuncs: rootCustomFuncs, columnNames } = parseAndPrepare(xmlContent);

    // Extract test cases from DOM (survives normalizeDoc)
    const rawTestCases = extractTestCases(doc);

    // Step 2: Build DAGs from custom function dependencies
    let customFunctionDags = {};
    let customLoopFunctions = {};

    if (Object.keys(customFunctions).length > 0) {
      const allCustomFunctions = {};
      for (const [funcId, data] of Object.entries(customFunctions)) {
        allCustomFunctions[funcId] = {
          xml_content: data.xml_content,
          name: data.name.toUpperCase(),
        };
      }
      const result = buildFunctionDags(allCustomFunctions);
      customFunctionDags = result.customFunctionDags;
      customLoopFunctions = result.customLoopFunctions;
    }

    // Step 3: Build settings (replaces setup.get_standard_settings + initial_dag_objects)
    const settings = buildSettings(
      doc, columnNames, customFunctionDags, customLoopFunctions, rootCustomFuncs,
    );

    // Step 4: Transpile to JavaScript
    const javascript = transpileDagsToJs(settings);

    // Step 5: Self-validate against test cases (if any)
    let testResults = null;
    if (rawTestCases.length > 0) {
      try {
        const typedCases = buildTestCases(rawTestCases, settings.G);
        const funcName = jsSafeName(
          settings.G.graph.name || doc.documentElement.getAttribute('name')?.toUpperCase() || 'UNKNOWN',
        );
        testResults = runSelfTests(javascript, funcName, typedCases);
      } catch (e) {
        // Test infrastructure failure — report but don't block transpilation
        testResults = { passed: 0, failed: 0, failures: [], error: e.message };
      }
    }

    const signature = extractSignatureFromGraph(settings.G);

    return { javascript, signature, error: null, testResults };
  } catch (e) {
    return { javascript: null, signature: null, error: e.message || String(e), testResults: null };
  }
}

/**
 * Transpile spreadsheet XML to code in a specified language.
 *
 * Like `transpile()` but uses a custom syntax object and functions data
 * instead of the built-in JavaScript ones. Skips self-tests (they execute
 * JS, which is meaningless for other languages).
 *
 * @param {string} xmlContent - the XML string to transpile
 * @param {Object} [customFunctions={}] - keyed by ID: { name, xml_content }
 * @param {Object} syntaxObject - Language syntax object (like JAVASCRIPT_SYNTAX)
 * @param {Object} functionsData - Language functions data (like javascriptFunctions)
 * @returns {{ code: string|null, error: string|null }}
 */
export function transpileToLang(xmlContent, customFunctions = {}, syntaxObject, functionsData) {
  try {
    const { doc, customFuncs: rootCustomFuncs, columnNames } = parseAndPrepare(xmlContent);

    let customFunctionDags = {};
    let customLoopFunctions = {};

    if (Object.keys(customFunctions).length > 0) {
      const allCustomFunctions = {};
      for (const [funcId, data] of Object.entries(customFunctions)) {
        allCustomFunctions[funcId] = {
          xml_content: data.xml_content,
          name: data.name.toUpperCase()
        };
      }
      const result = buildFunctionDags(allCustomFunctions);
      customFunctionDags = result.customFunctionDags;
      customLoopFunctions = result.customLoopFunctions;
    }

    const settings = buildSettings(
      doc, columnNames, customFunctionDags, customLoopFunctions, rootCustomFuncs, functionsData
    );

    const code = transpileDags(settings, syntaxObject);

    return { code, error: null };
  } catch (e) {
    return { code: null, error: e.message || String(e) };
  }
}
