/**
 * Graph structure validators.
 *
 * Ported from server/transpiler/validation.py.
 * nx.is_directed_acyclic_graph() → G.isDAG()
 */

import { getObjectFieldTypes } from '../utils/typeService.js';

const VALID_BASE_TYPES = ['Text', 'Number', 'Boolean', 'Date', 'Datetime'];

export function validDataType(dataType) {
  if (VALID_BASE_TYPES.includes(dataType)) return true;

  if (dataType.startsWith('ARRAY[') && dataType.endsWith(']')) {
    const elementType = dataType.slice(6, -1);
    return elementType === '*' || VALID_BASE_TYPES.includes(elementType);
  }

  if (dataType.startsWith('Object[') && dataType.endsWith(']')) {
    const types = getObjectFieldTypes(dataType);
    return types !== null && types.every(t => validDataType(t));
  }
  return false;
}

/**
 * Validate a DAG's structural integrity.
 */
export function isValidGraph(G, requireTypes) {
  if (!G.isDAG()) { console.warn('[isValidGraph] not a DAG'); return false; }

  // Source nodes must be input or constant
  for (const id of G.nodeIds()) {
    if (G.inDegree(id) === 0) {
      const type = G.getNode(id).node_type;
      if (type !== 'constant' && type !== 'input') { console.warn(`[isValidGraph] source node ${id} has type "${type}" (expected input/constant)`, G.getNode(id)); return false; }
    }
  }

  // Persisted nodes must be function or input
  for (const id of G.nodeIds()) {
    const attrs = G.getNode(id);
    if (attrs.persist && attrs.node_type !== 'function' && attrs.node_type !== 'input') {
      console.warn(`[isValidGraph] persisted node ${id} has type "${attrs.node_type}"`, attrs); return false;
    }
  }

  // Validate input_node_ids
  const inputNodeIds = G.nodeIds().filter(id => {
    const a = G.getNode(id);
    return a.node_type === 'input' || 'input_order' in a || 'input_name' in a;
  });
  for (const id of inputNodeIds) {
    const a = G.getNode(id);
    if (!('input_name' in a) || !('input_order' in a)) { console.warn(`[isValidGraph] input node ${id} missing input_name or input_order`, a); return false; }
    if (a.node_type !== 'input') { console.warn(`[isValidGraph] node ${id} has input attrs but node_type="${a.node_type}"`, a); return false; }
  }
  const sortedInputs = [...inputNodeIds].sort((a, b) => G.getNode(a).input_order - G.getNode(b).input_order);
  const graphInputs = G.graph.input_node_ids;
  if (!graphInputs || graphInputs.length !== sortedInputs.length) { console.warn(`[isValidGraph] input_node_ids length mismatch: graph has ${graphInputs?.length}, found ${sortedInputs.length}`, { graphInputs, sortedInputs }); return false; }
  for (let i = 0; i < sortedInputs.length; i++) {
    if (graphInputs[i] !== sortedInputs[i]) { console.warn(`[isValidGraph] input_node_ids order mismatch at index ${i}: graph=${graphInputs[i]}, sorted=${sortedInputs[i]}`); return false; }
  }

  // Sink nodes (except input-type nodes) must have output_name.
  // Input nodes may legitimately become unused sinks after transforms eliminate
  // their dependents — they remain valid as function parameters.
  for (const id of G.nodeIds()) {
    if (G.outDegree(id) === 0) {
      const a = G.getNode(id);
      if (a.node_type === 'input') continue;
      if (!('output_name' in a)) { console.warn(`[isValidGraph] sink node ${id} missing output_name`, a); return false; }
    }
  }

  // Validate output_node_ids
  const outputNodeIds = G.nodeIds().filter(id => {
    const a = G.getNode(id);
    return 'output_name' in a || 'output_order' in a;
  });
  for (const id of outputNodeIds) {
    const a = G.getNode(id);
    if (!('output_name' in a) || !('output_order' in a)) { console.warn(`[isValidGraph] output node ${id} missing output_name or output_order`, a); return false; }
  }
  const sortedOutputs = [...outputNodeIds].sort((a, b) => G.getNode(a).output_order - G.getNode(b).output_order);
  const graphOutputs = G.graph.output_node_ids;
  if (!graphOutputs || graphOutputs.length !== sortedOutputs.length) { console.warn(`[isValidGraph] output_node_ids length mismatch: graph has ${graphOutputs?.length}, found ${sortedOutputs.length}`, { graphOutputs, sortedOutputs }); return false; }
  for (let i = 0; i < sortedOutputs.length; i++) {
    if (graphOutputs[i] !== sortedOutputs[i]) { console.warn(`[isValidGraph] output_node_ids order mismatch at index ${i}: graph=${graphOutputs[i]}, sorted=${sortedOutputs[i]}`); return false; }
  }

  // All edges must have parent_position (this is structural in our MultiDiGraph — always true)

  // Validate max_node_id
  const allIds = G.nodeIds();
  const actualMax = allIds.reduce((a, b) => a > b ? a : b, -Infinity);
  if (G.graph.max_node_id !== actualMax) { console.warn(`[isValidGraph] max_node_id mismatch: graph=${G.graph.max_node_id}, actual=${actualMax}`); return false; }

  // Type checks
  if (requireTypes) {
    for (const id of G.nodeIds()) {
      const a = G.getNode(id);
      if (!('data_type' in a)) {
        console.warn(`[isValidGraph] node ${id} missing data_type`, a); return false;
      }
    }
  }

  return true;
}

export function isValidBaseGraph(dag, requireTypes) {
  return isValidGraph(dag, requireTypes);
}

export function isValidLogicFunction(dag, filename, name) {
  if (name !== filename.split('.')[0].toUpperCase()) return false;
  return isValidGraph(dag, false);
}

export function isValidSignatureDefinitionDict(conversionRules, allowMultipleOutputs, isLibrary) {
  if (!conversionRules.signatures) return false;

  const seenInputs = {};
  for (const [funcName, signatures] of Object.entries(conversionRules.signatures)) {
    for (const sig of signatures) {
      if (!isLibrary) {
        const key = `${funcName}|${sig.inputs.join(',')}`;
        if (seenInputs[key]) return false;
        seenInputs[key] = true;
      }
      for (const t of sig.inputs) {
        if (!validDataType(t)) return false;
      }
      if (!allowMultipleOutputs && sig.outputs.length > 1) return false;
      for (const t of sig.outputs) {
        if (!validDataType(t)) return false;
      }
    }
  }
  return true;
}

export function isValidConversionRulesDict(rules) {
  if (!isValidSignatureDefinitionDict(rules, true, false)) return false;

  for (const signatures of Object.values(rules.signatures)) {
    for (const sig of signatures) {
      if (!sig.operator && !sig.code_before && !sig.code_after && !sig.template) {
        if (!sig.no_code && !sig.is_helper_function) return false;
      } else {
        if (sig.template) {
          if (sig.operator || sig.code_before || sig.code_after || sig.add_functions) return false;
          if (!rules.templates?.[sig.template]) return false;
        }
        if (sig.add_functions) {
          for (const fn of sig.add_functions) {
            if (!rules.functions?.[fn]) return false;
          }
        }
      }
      if (sig.template && !rules.templates?.[sig.template]) return false;
    }
  }

  if (!rules.templates) return false;
  for (const item of Object.values(rules.templates)) {
    if (typeof item !== 'object' || item === null) return false;
    if (!('force-persist-template' in item) && !('no-persist-template' in item)) return false;
  }

  if (!rules.functions) return false;
  for (const item of Object.values(rules.functions)) {
    if (typeof item !== 'object' || item === null) return false;
    if (!('text' in item)) return false;
  }

  if (!('transforms' in rules)) return false;
  if (!('function_logic_dags' in rules)) return false;

  // customFunctionOverrides is optional; when present, must map names to strings
  if ('customFunctionOverrides' in rules) {
    const overrides = rules.customFunctionOverrides;
    if (typeof overrides !== 'object' || overrides === null) return false;
    for (const value of Object.values(overrides)) {
      if (typeof value !== 'string') return false;
    }
  }

  return true;
}

