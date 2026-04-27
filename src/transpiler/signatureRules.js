/**
 * Conversion rules — signature matching, type resolution, and rule management.
 *
 * Ported from server/transpiler/conversion_rules.py.
 *
 * Key adaptations from Python:
 *   - networkx → MultiDiGraph from ../utils/graphModel.js (graph G passed as parameter)
 *   - File I/O, interactive prompts, and serialization dropped
 *   - `partial()` → closures
 *   - `G.nodes[id]` → `G.getNode(id)`
 *   - `dags.get_ordered_parent_ids` → imported from dagOperations.js
 *   - `dags.node_location_description` → inline helper
 */

import * as validation from './validation.js';
import { throwConversionRulesError, requireInt } from './errors.js';
import { getObjectFieldTypes } from '../utils/typeService.js';
import { getOrderedParentIds } from './dagOperations.js';

/**
 * Inline description of a node's location (replaces dags.node_location_description).
 */
function nodeLocationDescription(G, nodeId) {
  return `node ${nodeId} in ${G.graph.name}`;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Create an empty conversion-rules dictionary.
 */
export function initializeConversionRules() {
  return {
    signatures: {},
    templates: {},
    functions: {},
    transforms: {},
    function_logic_dags: {},
  };
}

/**
 * Merge `higherPriorityRules` into `lowerPriorityRules` in place.
 * Signatures are matched by exact input match; other sections are
 * simple Object.assign merges.
 */
export function updateConversionRules(lowerPriorityRules, higherPriorityRules) {
  // Merge signatures with matching logic
  for (const [funcName, higherSignatures] of Object.entries(higherPriorityRules.signatures)) {
    if (!(funcName in lowerPriorityRules.signatures)) {
      lowerPriorityRules.signatures[funcName] = higherSignatures;
    } else {
      for (const higherSig of higherSignatures) {
        let matched = false;
        for (let idx = 0; idx < lowerPriorityRules.signatures[funcName].length; idx++) {
          const lowerSig = lowerPriorityRules.signatures[funcName][idx];
          if (matchInputSignature(higherSig.inputs, lowerSig.inputs, 'exact')) {
            lowerPriorityRules.signatures[funcName][idx] = higherSig;
            matched = true;
            break;
          }
        }
        if (!matched) {
          lowerPriorityRules.signatures[funcName].push(higherSig);
        }
      }
    }
  }

  // Other sections: simple merge
  const sections = [
    'templates',
    'functions',
    'transforms',
    'function_logic_dags',
  ];
  for (const section of sections) {
    if (section in higherPriorityRules) {
      Object.assign(lowerPriorityRules[section], higherPriorityRules[section]);
    }
  }

  // Merge custom function overrides
  if (higherPriorityRules.customFunctionOverrides) {
    if (!lowerPriorityRules.customFunctionOverrides) {
      lowerPriorityRules.customFunctionOverrides = {};
    }
    Object.assign(lowerPriorityRules.customFunctionOverrides, higherPriorityRules.customFunctionOverrides);
  }
}

/**
 * Get the ordered data types of a node's parents.
 */
export function getParentDataTypes(G, nodeId) {
  const parents = getOrderedParentIds(G, nodeId);
  return parents.map(parentId => G.getNode(parentId).data_type);
}

/**
 * Find the first matching signature for a specific graph node.
 * Returns null if no match is found.
 */
export function matchFirstSignatureForNode(G, nodeId, conversionRules) {
  const functionName = G.getNode(nodeId).function_name;
  const parentDataTypes = getParentDataTypes(G, nodeId);
  return matchFirstSignature(conversionRules, functionName, parentDataTypes, 'permissive');
}

/**
 * Find the first matching signature for a function name and input types.
 * Returns null if no match is found.
 */
function matchFirstSignature(conversionRules, functionName, inputDataTypes, matchMode) {
  const matchingSignatures = conversionRules.signatures[functionName];
  if (!matchingSignatures) return null;

  for (const signature of matchingSignatures) {
    if (matchInputSignature(inputDataTypes, signature.inputs, matchMode)) {
      // First match wins — more specific signatures should be listed first.
      return signature;
    }
  }
  return null;
}

/**
 * Identify required signatures that have no conversion instructions.
 */
function getFunctionsWithoutConversionInstructions(signatureDefinitions, requiredSignatures) {
  const missingSignatures = { signatures: {} };

  for (const [funcName, funcRequiredSignatures] of Object.entries(requiredSignatures.signatures)) {
    for (const requiredSig of funcRequiredSignatures) {
      let matchFound = false;
      const existing = signatureDefinitions.signatures[funcName] || [];
      for (const sig of existing) {
        if (matchInputSignature(requiredSig.inputs, sig.inputs, 'permissive')) {
          if (!('no_code' in sig)) {
            matchFound = true;
            break;
          }
        }
      }

      if (!matchFound) {
        if (!(funcName in missingSignatures.signatures)) {
          missingSignatures.signatures[funcName] = [];
        }
        missingSignatures.signatures[funcName].push(requiredSig);
      }
    }
  }

  if (!validation.isValidSignatureDefinitionDict(missingSignatures, false, false)) {
    throw new Error('Signature dictionary is not valid.');
  }
  return missingSignatures;
}

/**
 * Build the set of signatures currently required by the graph.
 */
function buildCurrentSignatureDefinitions(G) {
  const signatures = { signatures: {} };

  for (const nodeId of G.nodeIds()) {
    const attrs = G.getNode(nodeId);
    if (attrs.node_type !== 'function') continue;

    // Skip special internal nodes (ARRAY is handled in getDataTypes, not via signatures)
    if (['PROCEED', 'LOOP', 'ARRAY'].includes(attrs.function_name)) continue;

    // Skip INDEX on Object/Array — resolved via special case in codegen, not via signatures
    if (attrs.function_name === 'INDEX') {
      const parentTypes = getParentDataTypes(G, nodeId);
      if (parentTypes[0]?.startsWith('Object[') || parentTypes[0]?.startsWith('ARRAY[')) continue;
    }

    const matchSig = matchFirstSignatureForNode(G, nodeId, signatures);
    if (matchSig) {
      if (matchSig.source === 'Required signatures') {
        matchSig.locations.push(nodeLocationDescription(G, nodeId));
      }
      continue;
    }

    const parentDataTypes = getParentDataTypes(G, nodeId);
    const returnType = attrs.data_type;
    const additionalParams = { locations: [nodeLocationDescription(G, nodeId)] };
    addFunctionSignature(
      signatures,
      attrs.function_name,
      parentDataTypes,
      [returnType],
      'Required signatures',
      false,
      additionalParams,
    );
  }

  if (!validation.isValidSignatureDefinitionDict(signatures, false, false)) {
    throw new Error('Signature dictionary is not valid.');
  }
  return signatures;
}

/**
 * Check for missing conversion instructions and throw if any are found.
 */
export function ifMissingSigsError(signatureDefinitions, G) {
  const currentRequired = buildCurrentSignatureDefinitions(G);
  const missing = getFunctionsWithoutConversionInstructions(signatureDefinitions, currentRequired);
  if (Object.keys(missing.signatures).length > 0) {
    throw new Error(
      `Missing conversion instructions for some functions: ${JSON.stringify(missing.signatures, null, 2)}`
    );
  }
}

/**
 * Add a single function signature to a signature-definition dictionary.
 *
 * The `noCode` flag marks signatures that intentionally have no translation
 * code associated with them.
 */
function addFunctionSignature(
  signatureDefinitionDict,
  functionName,
  inputDataTypes,
  returnDataTypes,
  source,
  noCode,
  additionalParams = {},
) {
  if (!(functionName in signatureDefinitionDict.signatures)) {
    signatureDefinitionDict.signatures[functionName] = [];
  }
  const entry = { inputs: inputDataTypes, outputs: returnDataTypes, source };
  if (noCode) {
    entry.no_code = true;
  }
  for (const [k, v] of Object.entries(additionalParams)) {
    entry[k] = v;
  }
  signatureDefinitionDict.signatures[functionName].push(entry);
}

/**
 * Compare two data types for matching.
 *
 * @param {string|null} type1
 * @param {string|null} type2
 * @param {boolean} isOrdered  - if true, only check (type1, type2) not (type2, type1)
 */
export function matchType(type1, type2, isOrdered) {
  const isMatch = (t1, t2) => {
    if (t1 === null || t1 === t2) return true;
    // Wildcard: ARRAY[*] matches ARRAY[<anything>]
    if (t2 !== null && t2.endsWith('[*]') && t1 !== null) {
      const prefix = t2.slice(0, -2); // e.g. "ARRAY[*]" → "ARRAY["
      return t1.startsWith(prefix) && t1.endsWith(']');
    }
    return false;
  };

  if (isOrdered) return isMatch(type1, type2);
  return isMatch(type1, type2) || isMatch(type2, type1);
}

/**
 * Determine if parent data types match an input signature.
 *
 * Match modes:
 *   - "exact"      — arrays must be identical (for dedup)
 *   - "permissive" — allows null matching (for type resolution)
 */
function matchInputSignature(parentDataTypes, inputSignature, matchMode) {
  if (parentDataTypes.length !== inputSignature.length) return false;

  if (matchMode === 'exact') {
    return parentDataTypes.every((t, i) => t === inputSignature[i]);
  }

  return parentDataTypes.every((t, i) => matchType(t, inputSignature[i], true));
}

/**
 * Add one set of signatures into a library of signatures.
 */
export function addSignaturesToLibrary(newSigDict, libSigDict, source, allowMultipleOutputs) {
  if (!validation.isValidSignatureDefinitionDict(newSigDict, allowMultipleOutputs, false)) {
    throw new Error('invalid signature dictionary');
  }
  if (!validation.isValidSignatureDefinitionDict(libSigDict, allowMultipleOutputs, false)) {
    throw new Error('invalid signature dictionary');
  }

  const newSigs = newSigDict.signatures;
  const library = libSigDict.signatures;

  for (const [key, value] of Object.entries(newSigs)) {
    if (!(key in library)) {
      library[key] = [];
    }

    for (const item of value) {
      let found = false;
      for (const existingItem of library[key]) {
        if (
          matchInputSignature(item.inputs, existingItem.inputs, 'exact') &&
          JSON.stringify(item.outputs) === JSON.stringify(existingItem.outputs)
        ) {
          if (source !== null) {
            if (!('source' in existingItem)) {
              existingItem.source = [source];
            } else {
              existingItem.source.push(source);
            }
          }
          found = true;
          break;
        }
      }

      if (!found) {
        const newItem = { ...item, source: [source] };
        library[key].push(newItem);
      }
    }
  }
}

/**
 * Internal: match all signatures for a function, returning every match.
 */
function _matchAllSignatures(conversionRules, functionName, inputDataTypes) {
  const matches = [];
  const signatures = conversionRules.signatures[functionName];
  if (!signatures) return matches;

  for (const signature of signatures) {
    if (matchInputSignature(inputDataTypes, signature.inputs, 'permissive')) {
      matches.push([signature.outputs, signature.inputs, signature.source || null]);
    }
  }
  return matches;
}

/**
 * Determine the data types for a node.
 *
 * Resolves data types using conversion rules, falling back to the
 * signature-definition library. If `autoAdd` is true and exactly one
 * library match exists it is added automatically; otherwise a hard
 * error is thrown (interactive prompts are not supported client-side).
 *
 * @returns {string[]} array of return data types
 */
export function getDataTypes(G, nodeId, conversionRules, signatureDefinitionLibrary, functionLogicDags) {
  if (!validation.isValidConversionRulesDict(conversionRules)) {
    throw new Error('signature is not valid');
  }
  if (!validation.isValidSignatureDefinitionDict(signatureDefinitionLibrary, true, true)) {
    throw new Error('signature dictionary is not valid');
  }

  const functionName = G.getNode(nodeId).function_name;

  // Special case: ARRAY — variadic constructor, all parents must share a base type
  if (functionName === 'ARRAY') {
    const parentTypes = getParentDataTypes(G, nodeId);
    if (parentTypes.length === 0) {
      throw new Error(`ARRAY node ${nodeId} has no parents`);
    }
    const baseType = parentTypes[0];
    for (let i = 1; i < parentTypes.length; i++) {
      if (parentTypes[i] !== baseType) {
        throw new Error(
          `ARRAY node ${nodeId}: mixed types (${baseType}, ${parentTypes[i]})`
        );
      }
    }
    return [`ARRAY[${baseType}]`];
  }

  const parentDataTypes = getParentDataTypes(G, nodeId);

  // Special case: INDEX on Object — resolve per-field return type from constant key
  if (functionName === 'INDEX') {
    if (parentDataTypes.length === 2 && parentDataTypes[0]?.startsWith('Object[')) {
      return [_resolveIndexOnObject(G, nodeId, parentDataTypes[0], functionLogicDags)];
    }
  }

  // 1. Try conversion rules directly
  let matchingTuples = _matchAllSignatures(
    conversionRules, functionName, parentDataTypes
  );
  if (matchingTuples.length > 1) {
    // Use the first (most specific) match
    matchingTuples = matchingTuples.slice(0, 1);
  }
  if (matchingTuples.length === 1) {
    const [returnTypes] = matchingTuples[0];
    // Wrap multi-output results as Object type
    if (returnTypes.length > 1) {
      return [`Object[${returnTypes.join(', ')}]`];
    }
    return returnTypes;
  }

  const missingSignatureInfo =
    `function name: ${functionName} with input signature ${parentDataTypes.join(', ')}`;

  // 2. Try the signature-definition library
  const libMatchingTuples = _matchAllSignatures(
    signatureDefinitionLibrary, functionName, parentDataTypes
  );

  if (libMatchingTuples.length > 0) {
    if (libMatchingTuples.length === 1) {
      const [returnTypes, sigInputs, sources] = libMatchingTuples[0];
      addFunctionSignature(
        conversionRules, functionName, sigInputs, returnTypes, sources, true
      );
      // Wrap multi-output results as Object type
      if (returnTypes.length > 1) {
        return [`Object[${returnTypes.join(', ')}]`];
      }
      return returnTypes;
    }

    // Multiple matches and no interactive prompt available
    throw new Error(
      `Signature for ${missingSignatureInfo} has ${libMatchingTuples.length} matches in the library but no auto-add possible (multiple ambiguous matches). Graph: ${G.graph.name}`,
    );
  }

  // 3. No match anywhere
  throwConversionRulesError(
    G,
    nodeId,
    `Signature for ${missingSignatureInfo} not found. Node ${nodeId} in tree: ${G.graph.name}. Aborting`,
  );
}

/**
 * Resolve the 0-based output index for a named output in a function logic DAG.
 * Searches both standard outputs (output_node_ids) and loop outputs (_loop_output_info).
 *
 * @param {Object} funcDag - The function's logic DAG
 * @param {string} keyName - Uppercase output name to find
 * @returns {number} 0-based index
 * @throws if the output name is not found
 */
export function resolveOutputNameIndex(funcDag, keyName) {
  const outputNodeIds = funcDag.graph.output_node_ids || [];
  const loopOutputInfo = funcDag.graph._loop_output_info || [];

  for (let idx = 0; idx < outputNodeIds.length; idx++) {
    const outNode = funcDag.getNode(outputNodeIds[idx]);
    if ((outNode.output_name || '').toUpperCase() === keyName) {
      return idx;
    }
  }

  for (let idx = 0; idx < loopOutputInfo.length; idx++) {
    if (loopOutputInfo[idx].name === keyName) {
      return idx;
    }
  }

  const availableOutputs = loopOutputInfo.length > 0
    ? loopOutputInfo.map(info => info.name)
    : outputNodeIds.map(oid => funcDag.getNode(oid).output_name);
  throw new Error(
    `Output '${keyName}' not found in function '${funcDag.graph.name}'. ` +
    `Available outputs: ${JSON.stringify(availableOutputs)}`
  );
}

/**
 * Resolve the return type for INDEX on an Object type.
 * Requires the key to be a constant node.
 */
function _resolveIndexOnObject(G, nodeId, objectType, functionLogicDags) {
  const parents = getOrderedParentIds(G, nodeId);
  const keyNode = G.getNode(parents[1]);

  if (keyNode.node_type !== 'constant') {
    throw new Error(
      `INDEX on multi-output function requires a constant key. ` +
      `Node ${nodeId} in ${G.graph.name} has a non-constant key.`
    );
  }

  const fieldTypes = getObjectFieldTypes(objectType);

  if (keyNode.data_type === 'Number') {
    const position = requireInt(keyNode.value);
    if (position < 1 || position > fieldTypes.length) {
      throw new Error(
        `INDEX position ${position} out of range for Object with ${fieldTypes.length} fields. ` +
        `Node ${nodeId} in ${G.graph.name}.`
      );
    }
    return fieldTypes[position - 1];
  }

  if (keyNode.data_type === 'Text') {
    const keyName = (keyNode.value || '').toUpperCase();
    const sourceNodeId = parents[0];
    const sourceNode = G.getNode(sourceNodeId);
    const sourceFuncName = sourceNode.function_name;

    if (functionLogicDags && functionLogicDags[sourceFuncName]) {
      const idx = resolveOutputNameIndex(functionLogicDags[sourceFuncName], keyName);
      return fieldTypes[idx];
    }

    throw new Error(
      `Cannot resolve text key '${keyName}' for INDEX on Object without function logic DAGs. ` +
      `Node ${nodeId} in ${G.graph.name}.`
    );
  }

  throw new Error(
    `INDEX key must be Number or Text, got ${keyNode.data_type}. Node ${nodeId} in ${G.graph.name}.`
  );
}

/**
 * Create a signature dictionary from a map of function-logic DAGs.
 *
 * @param {Object} functionLogicDags - { funcName: MultiDiGraph }
 */
export function createSignatureDictionary(functionLogicDags) {
  const newSigDict = initializeConversionRules();
  const newSigs = newSigDict.signatures;

  for (const [funcName, dag] of Object.entries(functionLogicDags)) {
    const inputNodeIds = dag.graph.input_node_ids;
    const outputNodeIds = dag.graph.output_node_ids;

    const inputs = inputNodeIds.map(id => dag.getNode(id).data_type);
    const outputs = outputNodeIds.map(id => dag.getNode(id).data_type);

    newSigs[funcName] = [{ inputs, outputs }];
  }

  return newSigDict;
}

/**
 * Create signatures for loop functions.
 *
 * Loop functions have the same signature format as regular functions.
 * The `is_helper_function` flag indicates this signature uses the
 * default function-call pattern rather than needing explicit code
 * mechanics.
 *
 * @param {Object} loopFunctions - { funcName: { graph: DAG, xmlTree?: Document } }
 */
export function createLoopFunctionSignatures(loopFunctions) {
  const newSigDict = initializeConversionRules();
  const newSigs = newSigDict.signatures;

  for (const [funcName, data] of Object.entries(loopFunctions)) {
    const dag = data.graph;
    const xmlTree = data.xmlTree || null;

    // Input types from the DAG
    const inputNodeIds = dag.graph.input_node_ids || [];
    const inputs = inputNodeIds.map(id =>
      dag.getNode(id).data_type || 'Number',
    );

    // Output types — node-based or XML-based
    let outputs = [];
    const outputNodeIds = dag.graph.output_node_ids || [];
    if (outputNodeIds.length > 0) {
      outputs = outputNodeIds.map(id =>
        dag.getNode(id).data_type || 'Number',
      );
    } else if (xmlTree !== null) {
      // Loop function with register-based outputs from XML
      const outputElems = xmlTree.querySelectorAll
        ? xmlTree.querySelectorAll('Output')
        : [];
      for (const elem of outputElems) {
        const baseType = elem.getAttribute('data_type') || 'Number';
        const mode = elem.getAttribute('output_mode') || 'last';
        outputs.push(mode === 'all' ? `ARRAY[${baseType}]` : baseType);
      }
    }

    newSigs[funcName] = [{ inputs, outputs, is_helper_function: true }];
  }

  return newSigDict;
}
