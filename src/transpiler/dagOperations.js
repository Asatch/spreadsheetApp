/**
 * DAG operations — all graph manipulation functions ported from dags.py,
 * EXCEPT build_nx_graph, is_loop_sheet, and get_node_to_cell_mapping
 * (which live in graphBuilder.js).
 */

import { MultiDiGraph } from '../utils/graphModel.js';
import * as validation from './validation.js';
import * as sig from './signatureRules.js';
import * as errors from './errors.js';
import { requireInt } from './errors.js';

/** Find the maximum value in an array without spreading (avoids call-stack limits on large arrays). */
function maxId(ids) {
  let max = -Infinity;
  for (const id of ids) { if (id > max) max = id; }
  return max;
}

/**
 * Extract edge attributes (everything except source/target) from an edge object.
 */
function edgeData(edge) {
  const data = { ...edge };
  delete data.source;
  delete data.target;
  return data;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// getOrderedParentIds
// ---------------------------------------------------------------------------

export function getOrderedParentIds(graph, nodeId) {
  const edges = graph.inEdges(nodeId);
  edges.sort((a, b) => a.parentPosition - b.parentPosition);
  return edges.map(e => e.source);
}

// ---------------------------------------------------------------------------
// subsetGraph
// ---------------------------------------------------------------------------

export function subsetGraph(originalGraph, outputsToKeep, skipValidation = false) {
  const newGraph = new MultiDiGraph();
  const visited = new Set();
  const newInputs = new Set();

  function selectNodesAndEdges(node) {
    if (visited.has(node)) return;
    visited.add(node);
    newGraph.addNode(node, { ...originalGraph.getNode(node) });
    if (originalGraph.getNode(node).node_type === 'input') {
      newInputs.add(node);
    }
    for (const pred of originalGraph.predecessors(node)) {
      for (const edge of originalGraph.edgesBetween(pred, node)) {
        const { parentPosition, ...attrs } = edge;
        if (!newGraph.hasNode(pred)) {
          newGraph.addNode(pred, { ...originalGraph.getNode(pred) });
        }
        newGraph.addEdge(pred, node, parentPosition, { ...attrs });
      }
      selectNodesAndEdges(pred);
    }
  }

  for (const output of outputsToKeep) {
    selectNodesAndEdges(output);
  }

  newGraph.graph.name = originalGraph.graph.name;

  const sortedInputs = [...newInputs].sort(
    (a, b) => originalGraph.graph.input_node_ids.indexOf(a) - originalGraph.graph.input_node_ids.indexOf(b)
  );
  const sortedOutputs = [...outputsToKeep].sort(
    (a, b) => originalGraph.graph.output_node_ids.indexOf(a) - originalGraph.graph.output_node_ids.indexOf(b)
  );

  newGraph.graph.input_node_ids = sortedInputs;
  newGraph.graph.output_node_ids = sortedOutputs;
  newGraph.graph.max_node_id = maxId(newGraph.nodeIds());

  if (originalGraph.graph.custom_functions) {
    newGraph.graph.custom_functions = { ...originalGraph.graph.custom_functions };
  }

  if (!skipValidation && !validation.isValidGraph(newGraph, false)) {
    throw new Error(`Graph ${newGraph.graph.name} is not valid. function: subset graph`);
  }

  return newGraph;
}

// ---------------------------------------------------------------------------
// renumberNodes
// ---------------------------------------------------------------------------

export function renumberNodes(graph) {
  function updateIoLists(mapping) {
    for (const prop of ['input_node_ids', 'output_node_ids']) {
      if (graph.graph[prop]) {
        graph.graph[prop] = graph.graph[prop]
          .filter(id => mapping[id] !== undefined)
          .map(id => mapping[id]);
      }
    }
  }

  if (!validation.isValidGraph(graph, false)) {
    console.warn('[renumberNodes] invalid graph:', graph.graph.name, 'nodes:', graph.nodeIds(), 'graph metadata:', graph.graph);
    throw new Error(`Graph "${graph.graph.name}" is not valid prior to renumbering nodes`);
  }

  const offset = graph.graph.max_node_id + 1;
  const tempMapping = {};
  for (const id of graph.nodeIds()) {
    tempMapping[id] = id + offset;
  }
  graph.relabelNodes(tempMapping);
  updateIoLists(tempMapping);

  const finalMapping = {};
  const nodeIds = graph.nodeIds();
  nodeIds.forEach((oldId, idx) => {
    finalMapping[oldId] = idx + 1;
  });
  graph.relabelNodes(finalMapping);
  updateIoLists(finalMapping);

  graph.graph.max_node_id = Object.keys(finalMapping).length;

  if (!validation.isValidGraph(graph, false)) {
    throw new Error('Graph is not valid after renumbering nodes');
  }
  return graph;
}

// ---------------------------------------------------------------------------
// removeNodeRewireChildrenToParent
// ---------------------------------------------------------------------------

function removeNodeRewireChildrenToParent(G, nodeId, parentNodeId) {
  // Collect outgoing edges before removing the node
  const outgoingEdges = [];
  for (const successor of G.successors(nodeId)) {
    for (const edge of G.edgesBetween(nodeId, successor)) {
      outgoingEdges.push({ successor, parentPosition: edge.parentPosition });
    }
  }

  G.removeNode(nodeId);

  for (const { successor, parentPosition } of outgoingEdges) {
    G.addEdge(parentNodeId, successor, parentPosition);
  }
}

// ---------------------------------------------------------------------------
// removeAllNonOutputSinkNodes
// ---------------------------------------------------------------------------

function removeAllNonOutputSinkNodes(G) {
  const removed = [];

  function shouldPreserve(nodeId) {
    const attrs = G.getNode(nodeId);
    if (attrs.output_name !== undefined) return true;
    if (attrs.loop_cell_addr !== undefined) return true;
    if (attrs.node_type === 'input') return true;
    return false;
  }

  const initialSinkNodes = G.nodeIds().filter(
    nodeId => G.outDegree(nodeId) === 0 && !shouldPreserve(nodeId)
  );
  const queue = [...initialSinkNodes];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!G.hasNode(node)) continue;
    const predecessors = G.predecessors(node);
    G.removeNode(node);
    removed.push(node);
    for (const pred of predecessors) {
      if (G.hasNode(pred) && G.outDegree(pred) === 0 && !shouldPreserve(pred)) {
        queue.push(pred);
      }
    }
  }

  return removed;
}

// ---------------------------------------------------------------------------
// topoSortSubgraph
// ---------------------------------------------------------------------------

function topoSortSubgraph(graph, nodes) {
  return graph.topologicalSortSubset(nodes);
}

// ---------------------------------------------------------------------------
// findNodesToLopOff
// ---------------------------------------------------------------------------

function findNodesToLopOff(graph) {
  const fixed = new Set();
  const dynamic = new Set();
  const transition = new Set();

  const sortedNodes = graph.topologicalSort();

  for (const node of sortedNodes) {
    const nodeType = graph.getNode(node).node_type;

    if (nodeType === 'constant') {
      fixed.add(node);
    } else if (nodeType === 'input') {
      dynamic.add(node);
    } else if (nodeType === 'function') {
      const parents = graph.predecessors(node);
      if (parents.every(p => fixed.has(p))) {
        fixed.add(node);
      } else {
        dynamic.add(node);
        for (const parent of parents) {
          if (fixed.has(parent) && graph.getNode(parent).node_type === 'function') {
            transition.add(parent);
          }
        }
      }
    }
  }

  return transition;
}

// ---------------------------------------------------------------------------
// foldConstantNodes
// ---------------------------------------------------------------------------

function foldConstantNodes(G, nodesToFold) {
  if (!nodesToFold || nodesToFold.size === 0) return {};

  const results = {};

  const simpleOps = {
    ADD: (a, b) => a + b,
    SUBTRACT: (a, b) => a - b,
    MULTIPLY: (a, b) => a * b,
    DIVIDE: (a, b) => b !== 0 ? a / b : Infinity,
    EXPONENT: (a, b) => a ** b,
  };

  const sortedNodes = G.topologicalSort().filter(n => nodesToFold.has(n));

  for (const nodeId of sortedNodes) {
    const nodeAttrs = G.getNode(nodeId);
    if (nodeAttrs.node_type !== 'function') continue;

    const functionName = (nodeAttrs.function_name || '').toUpperCase();

    const edges = G.inEdges(nodeId).sort((a, b) =>
      (a.parentPosition || 0) - (b.parentPosition || 0)
    );

    let parentValues = [];
    let valid = true;
    for (const edge of edges) {
      const parentAttrs = G.getNode(edge.source);
      if (parentAttrs.node_type === 'constant') {
        let value = parentAttrs.value;
        if (parentAttrs.data_type === 'Number') {
          const num = parseFloat(value);
          if (!isNaN(num)) value = num;
        }
        parentValues.push(value);
      } else if (results[edge.source] !== undefined) {
        parentValues.push(results[edge.source]);
      } else {
        valid = false;
        break;
      }
    }

    if (!valid) continue;

    let computedValue = null;
    if (simpleOps[functionName] && parentValues.length === 2) {
      try {
        computedValue = simpleOps[functionName](parentValues[0], parentValues[1]);
      } catch {
        // skip
      }
    }

    if (computedValue !== null) {
      results[nodeId] = computedValue;

      // Remove incoming edges — this node is now a literal constant,
      // not a computed result, so the parent dependencies are stale.
      for (const edge of G.inEdges(nodeId)) {
        G.removeEdge(edge.source, nodeId, edge.parentPosition);
      }

      nodeAttrs.node_type = 'constant';
      nodeAttrs.value = computedValue;
      nodeAttrs.data_type = 'Number';
      delete nodeAttrs.function_name;
      delete nodeAttrs.canonical;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// eliminateProceedNodes
// ---------------------------------------------------------------------------

export function eliminateProceedNodes(G, nodeToCell = null) {
  const cellPattern = /^([A-Z]+)(\d+)$/;
  const initSources = {};

  const outputNodeIds = [...(G.graph.output_node_ids || [])];

  // Find all PROCEED nodes
  const proceedNodes = [];
  for (const { id, ...attrs } of G.nodes()) {
    if (attrs.node_type === 'function' && (attrs.function_name || '').toUpperCase() === 'PROCEED') {
      proceedNodes.push(id);
    }
  }

  for (const proceedId of proceedNodes) {
    const parents = G.predecessors(proceedId);
    if (parents.length === 0) continue;

    const parentId = parents[0];

    let columnLetter = null;
    if (nodeToCell && nodeToCell[proceedId] !== undefined) {
      const cellAddr = nodeToCell[proceedId];
      const match = cellPattern.exec(cellAddr);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2], 10);
        if (row === 0) {
          columnLetter = col;
          initSources[col] = parentId;
        }
      }
    }

    const children = G.successors(proceedId);

    for (const childId of children) {
      const edgesBetween = G.edgesBetween(proceedId, childId);
      for (const edge of edgesBetween) {
        const { parentPosition, ...edgeAttrs } = edge;
        const newAttrs = { ...edgeAttrs };
        if (columnLetter) {
          newAttrs.temporal = 'previous';
          newAttrs.source_column = columnLetter;
        }
        G.addEdge(parentId, childId, parentPosition, newAttrs);
      }

      G.removeAllEdgesBetween(proceedId, childId);
    }

    G.removeAllEdgesBetween(parentId, proceedId);

    if (outputNodeIds.includes(proceedId)) {
      const proceedAttrs = G.getNode(proceedId);
      const parentAttrs = G.getNode(parentId);
      for (const attr of ['output_name', 'output_order', 'output_mode']) {
        if (proceedAttrs[attr] !== undefined) {
          parentAttrs[attr] = proceedAttrs[attr];
        }
      }
      const idx = outputNodeIds.indexOf(proceedId);
      outputNodeIds[idx] = parentId;
    }

    // Remove any other parents that are now orphaned (no remaining children).
    // This happens when PROCEED has multiple parents — only parents[0] gets
    // rewired, so the rest (e.g. position constants) become dangling sinks.
    for (const otherId of parents) {
      if (otherId === parentId) continue;
      G.removeAllEdgesBetween(otherId, proceedId);
      if (G.outDegree(otherId) === 0 && !outputNodeIds.includes(otherId)) {
        G.removeNode(otherId);
      }
    }

    G.removeNode(proceedId);
  }

  G.graph.output_node_ids = outputNodeIds;
  if (proceedNodes.length > 0 && G.nodeIds().length > 0) {
    G.graph.max_node_id = maxId(G.nodeIds());
  }
  return initSources;
}

// ---------------------------------------------------------------------------
// updateDagWithDataTypes
// ---------------------------------------------------------------------------

function updateDagWithDataTypes(
  G, topoSortedNodes, signatureDefinitions,
  signatureDefinitionLibrary, functionLogicDags
) {
  if (!G.isDAG()) {
    throw new Error(`${G.graph.name} is not a DAG`);
  }
  if (!validation.isValidConversionRulesDict(signatureDefinitions)) {
    throw new Error('signature is not valid');
  }
  if (!validation.isValidSignatureDefinitionDict(signatureDefinitionLibrary, true, true)) {
    throw new Error('signature is not valid');
  }

  for (const nodeId of topoSortedNodes) {
    const attrs = G.getNode(nodeId);
    if (attrs.data_type) continue;
    if (!attrs.function_name) {
      errors.throwNodeError(
        G, nodeId,
        `Node id: ${nodeId} does not have data_type but is not a function.`
      );
      return;
    }

    const dataTypes = sig.getDataTypes(
      G, nodeId, signatureDefinitions, signatureDefinitionLibrary, functionLogicDags
    );

    if (dataTypes.length === 1) {
      attrs.data_type = dataTypes[0];
    } else {
      throw new Error(`getDataTypes returned unexpected list for Node ${nodeId}: ${JSON.stringify(dataTypes)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// identifySubGraphNodes
// ---------------------------------------------------------------------------

function identifySubGraphNodes(G, subGraphOutputNodeId) {
  const stack = [subGraphOutputNodeId];
  const subGraphNodes = new Set();

  while (stack.length > 0) {
    const currentNode = stack.pop();
    if (subGraphNodes.has(currentNode)) continue;
    if (G.getNode(currentNode).persist) continue;
    subGraphNodes.add(currentNode);
    stack.push(...G.predecessors(currentNode));
  }

  return subGraphNodes;
}

// ---------------------------------------------------------------------------
// calculateUpstreamCountsToposort
// ---------------------------------------------------------------------------

function calculateUpstreamCountsToposort(G, subGraphNodes) {
  const nodeArr = [...subGraphNodes];

  const stepCounts = {};
  for (const node of nodeArr) {
    stepCounts[node] = G.getNode(node).node_type === 'function' ? 1 : 0;
  }

  const sorted = G.topologicalSortSubset(nodeArr);

  for (const node of sorted) {
    for (const pred of G.predecessors(node)) {
      if (subGraphNodes.has(pred)) {
        stepCounts[node] += (stepCounts[pred] || 0);
      }
    }
  }

  return stepCounts;
}

// ---------------------------------------------------------------------------
// persistSubGraphWhereOptimal
// ---------------------------------------------------------------------------

function persistSubGraphWhereOptimal(G, outputNodeId, stepCountTradeOff, prohibitedTypes) {
  const subGraphNodes = identifySubGraphNodes(G, outputNodeId);
  const stepCounts = calculateUpstreamCountsToposort(G, subGraphNodes);

  const permissibleNodes = [...subGraphNodes]
    .filter(node => !prohibitedTypes.includes(G.getNode(node).data_type));

  const stepCountSaves = {};
  for (const node of permissibleNodes) {
    stepCountSaves[node] = stepCounts[node] * (G.successors(node).length - 1);
  }

  if (Object.keys(stepCountSaves).length === 0) return 0;

  const eligibleNodes = {};
  for (const [node, saves] of Object.entries(stepCountSaves)) {
    if (saves > stepCountTradeOff) {
      eligibleNodes[node] = saves;
    }
  }

  // Pick the node with the LEAST eligible savings (not the max). Because this
  // runs iteratively, picking the max-savings node risks choosing one deep in
  // the graph that becomes trivial once an upstream node is persisted in a later
  // round. Picking the barely-eligible node avoids wasted persist decisions.
  if (Object.keys(eligibleNodes).length > 0) {
    let minNode = null;
    let minSaves = Infinity;
    for (const [node, saves] of Object.entries(eligibleNodes)) {
      if (saves < minSaves) {
        minSaves = saves;
        minNode = Number(node);
      }
    }
    G.getNode(minNode).persist = true;
    return minNode;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// persistWhereOptimal
// ---------------------------------------------------------------------------

function persistWhereOptimal(G, stepCountTradeOff, prohibitedTypes) {
  const nodesToCheck = [];
  for (const nodeId of G.nodeIds()) {
    const attrs = G.getNode(nodeId);
    if (attrs.persist || attrs.output_name !== undefined) {
      nodesToCheck.push(nodeId);
    }
  }

  const stack = [...nodesToCheck];
  while (stack.length > 0) {
    const nodeId = stack.shift();
    const returnVal = persistSubGraphWhereOptimal(G, nodeId, stepCountTradeOff, prohibitedTypes);
    if (returnVal) {
      stack.push(nodeId);
    }
  }
}

// ---------------------------------------------------------------------------
// reduceSubGraphToThreshold
// ---------------------------------------------------------------------------

function reduceSubGraphToThreshold(G, subGraphOutputNodeId, maxStepCount, prohibitedTypes) {
  const subGraphNodes = identifySubGraphNodes(G, subGraphOutputNodeId);
  const stepCounts = calculateUpstreamCountsToposort(G, subGraphNodes);

  if (Object.values(stepCounts).reduce((a, b) => a + b, 0) <= maxStepCount) return;

  const rootCount = stepCounts[subGraphOutputNodeId];
  const integerComponent = Math.floor(rootCount / maxStepCount);
  const targetStepCount = rootCount / (integerComponent + 1);

  const permissibleNodes = [...subGraphNodes]
    .filter(node => !prohibitedTypes.includes(G.getNode(node).data_type));

  if (permissibleNodes.length === 0) {
    throw new Error(
      'Unable to reduce step count within threshold: no permissible nodes to persist.'
    );
  }

  const permissibleStepCounts = {};
  for (const node of permissibleNodes) {
    permissibleStepCounts[node] = stepCounts[node];
  }

  let nodeToPersist = permissibleNodes[0];
  let bestDist = Math.abs(permissibleStepCounts[nodeToPersist] - targetStepCount);
  for (const node of permissibleNodes) {
    const dist = Math.abs(permissibleStepCounts[node] - targetStepCount);
    if (
      dist < bestDist ||
      (dist === bestDist && permissibleStepCounts[node] > permissibleStepCounts[nodeToPersist])
    ) {
      bestDist = dist;
      nodeToPersist = node;
    }
  }

  G.getNode(nodeToPersist).persist = true;
  reduceSubGraphToThreshold(G, subGraphOutputNodeId, maxStepCount, prohibitedTypes);
}

// ---------------------------------------------------------------------------
// reduceAllSubGraphsToThreshold
// ---------------------------------------------------------------------------

function reduceAllSubGraphsToThreshold(G, maxStepCount, prohibitedTypes) {
  const nodesToCheck = G.nodeIds().filter(nodeId => !G.getNode(nodeId).persist);
  for (const nodeId of nodesToCheck) {
    reduceSubGraphToThreshold(G, nodeId, maxStepCount, prohibitedTypes);
  }
}

// ---------------------------------------------------------------------------
// calculateBranchDepthAndPersist
// ---------------------------------------------------------------------------

function calculateBranchDepthAndPersist(G, maxBranchingDepth, conversionRules, prohibitedTypes) {
  const branchDepths = {};
  for (const nodeId of G.nodeIds()) branchDepths[nodeId] = 0;

  const sorted = G.topologicalSort();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const nodeId = sorted[i];
    const nodeAttribs = G.getNode(nodeId);

    if (!nodeAttribs.function_name) { branchDepths[nodeId] = 1; continue; }
    if (nodeAttribs.persist) { branchDepths[nodeId] = 1; continue; }
    if (nodeAttribs.output_order !== undefined) { branchDepths[nodeId] = 1; continue; }

    const functionSignature = sig.matchFirstSignatureForNode(G, nodeId, conversionRules);

    let currentDepth = 1;
    for (const successor of G.successors(nodeId)) {
      if (branchDepths[successor] > currentDepth) currentDepth = branchDepths[successor];
    }

    currentDepth += (functionSignature && functionSignature.branching_function) ? 1 : 0;

    if (currentDepth > maxBranchingDepth) {
      if (prohibitedTypes.includes(nodeAttribs.data_type)) {
        throw new Error(
          `Add support for using branching functions with prohibited data types. Node ID: ${nodeId}`
        );
      }
      G.getNode(nodeId).persist = true;
      branchDepths[nodeId] = 1;
    } else {
      branchDepths[nodeId] = currentDepth;
    }
  }
}

// ---------------------------------------------------------------------------
// persistNodeOrPredecessors
// ---------------------------------------------------------------------------

function persistNodeOrPredecessors(G, nodeId, prohibitedTypes) {
  if (prohibitedTypes.includes(G.getNode(nodeId).data_type)) {
    for (const predId of G.predecessors(nodeId)) {
      persistNodeOrPredecessors(G, predId, prohibitedTypes);
    }
  } else {
    G.getNode(nodeId).persist = true;
  }
}

// ---------------------------------------------------------------------------
// markNodesToPersistByUsageCount
// ---------------------------------------------------------------------------

function markNodesToPersistByUsageCount(G, usageCountThreshold, prohibitedTypes) {
  for (const nodeId of G.nodeIds()) {
    if (G.getNode(nodeId).function_name) {
      if (G.successors(nodeId).length > usageCountThreshold) {
        persistNodeOrPredecessors(G, nodeId, prohibitedTypes);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// markNodesToPersist
// ---------------------------------------------------------------------------

export function markNodesToPersist({
  G, conversionRules,
  prohibitedTypes = [],
  allOutputs = false,
  allArrayNodes = false,
  stepCountTradeOff = 150,
  branchingThreshold = 0,
  totalStepsThreshold = 1000,
  usageCountThreshold = 0,
}) {
  if (!validation.isValidGraph(G, true)) {
    throw new Error('Graph is not valid at start of mark nodes for persisting');
  }

  function checkAndRaiseForProhibitedTypes(nodeId, rule) {
    if (prohibitedTypes.includes(G.getNode(nodeId).data_type)) {
      throw new Error(
        `Node ${nodeId} required to be persisted by rule ${rule}, but has a prohibited data type for persisting.`
      );
    }
  }

  // 1. Mark all output nodes
  if (allOutputs) {
    for (const nodeId of G.graph.output_node_ids) {
      checkAndRaiseForProhibitedTypes(nodeId, 'Cache Outputs');
      const attrs = G.getNode(nodeId);
      if (attrs.node_type === 'input' || attrs.node_type === 'function') {
        attrs.persist = true;
      }
    }
    if (!validation.isValidGraph(G, true)) {
      throw new Error('Graph is not valid. Mark nodes for persisting. After 1');
    }
  }

  // 2. Mark all array nodes
  if (allArrayNodes) {
    for (const nodeId of G.nodeIds()) {
      if ((G.getNode(nodeId).function_name || '').toUpperCase() === 'ARRAY') {
        checkAndRaiseForProhibitedTypes(nodeId, 'Cache Array Nodes');
        G.getNode(nodeId).persist = true;
      }
    }
    if (!validation.isValidGraph(G, true)) {
      throw new Error('Graph is not valid. Mark nodes for persisting. After 2');
    }
  }

  // 3. Function-specific persisting requirements
  for (const nodeId of G.nodeIds()) {
    const attrs = G.getNode(nodeId);
    if (attrs.node_type === 'function') {
      const functionSignature = sig.matchFirstSignatureForNode(G, nodeId, conversionRules);
      if (functionSignature) {
        if (
          functionSignature.requires_persist ||
          (functionSignature.template &&
           conversionRules.templates &&
           conversionRules.templates[functionSignature.template] &&
           conversionRules.templates[functionSignature.template]['force-persist'])
        ) {
          checkAndRaiseForProhibitedTypes(nodeId, `Signature ${attrs.function_name} Requires Caching`);
          attrs.persist = true;
        }
      }
    }
  }
  if (!validation.isValidGraph(G, true)) {
    throw new Error('Graph is not valid. Mark nodes for persisting. After 3');
  }

  // 4. Step count trade-off
  if (stepCountTradeOff > 0) {
    persistWhereOptimal(G, stepCountTradeOff, prohibitedTypes);
    if (!validation.isValidGraph(G, true)) {
      throw new Error('Graph is not valid. Mark nodes for persisting. After 4');
    }
  }

  // 5. Usage count threshold (deprecated)
  if (usageCountThreshold > 0) {
    markNodesToPersistByUsageCount(G, usageCountThreshold, prohibitedTypes);
    if (!validation.isValidGraph(G, true)) {
      throw new Error('Graph is not valid. Mark nodes for persisting. After 5');
    }
  }

  // 6. Branching depth threshold
  if (branchingThreshold > 0) {
    calculateBranchDepthAndPersist(G, branchingThreshold, conversionRules, prohibitedTypes);
    if (!validation.isValidGraph(G, true)) {
      throw new Error('Graph is not valid. Mark nodes for persisting. After 6');
    }
  }

  // 7. Total steps threshold
  if (totalStepsThreshold > 0) {
    reduceAllSubGraphsToThreshold(G, totalStepsThreshold, prohibitedTypes);
  }

  if (!validation.isValidGraph(G, true)) {
    throw new Error('Graph is not valid after mark nodes for persisting.');
  }
}

// ---------------------------------------------------------------------------
// expandNode
// ---------------------------------------------------------------------------

function expandNode(
  nodeIdToExpand,
  functionLogicDag,
  baseDag,
  signatureDefinitions,
  signatureDefinitionLibrary,
  skipValidation = false
) {
  function mimicOutputAttribs(nodeIdToExp, newOutputNodeId) {
    const nodeToExpandAttrs = baseDag.getNode(nodeIdToExp);
    const newOutputAttrs = baseDag.getNode(newOutputNodeId);

    if (nodeToExpandAttrs.data_type !== undefined && newOutputAttrs.data_type !== undefined) {
      if (nodeToExpandAttrs.data_type !== newOutputAttrs.data_type) {
        errors.throwNodeError(
            baseDag, nodeIdToExp,
            `Type mismatch on function expansion. Node ${nodeIdToExp} in tree: ${baseDag.graph.name}. ` +
            `Call site type: ${nodeToExpandAttrs.data_type}, expanded output type: ${newOutputAttrs.data_type}, ` +
            `expanding: ${functionLogicDag.graph.name}.`
          );
      }
    }

    if (nodeToExpandAttrs.output_order !== undefined) {
      newOutputAttrs.output_order = nodeToExpandAttrs.output_order;
    }
    if (nodeToExpandAttrs.output_name !== undefined) {
      newOutputAttrs.output_name = nodeToExpandAttrs.output_name;
    }
    if (nodeToExpandAttrs.loop_cell_addr !== undefined) {
      newOutputAttrs.loop_cell_addr = nodeToExpandAttrs.loop_cell_addr;
    }
  }

  if (!skipValidation) {
    if (!validation.isValidBaseGraph(baseDag, false)) {
      throw new Error(
        `base_dag ${baseDag.graph.name} is not a valid graph. Check before expanding node for ${functionLogicDag.graph.name}.`
      );
    }
  }

  // Step 1: Retrieve Ordered List of Parent Nodes
  const parents = getOrderedParentIds(baseDag, nodeIdToExpand);

  if (parents.length !== functionLogicDag.graph.input_node_ids.length) {
    errors.throwTwoDagError(
      `Node ${nodeIdToExpand} in tree: ${baseDag.graph.name} has ${parents.length} parents. Expected ${functionLogicDag.graph.input_node_ids.length} for function ${functionLogicDag.graph.name}. Dag1 = base_dag; Dag2 = function_logic_dag.`
    );
  }

  const idOffset = baseDag.graph.max_node_id;

  // Steps 2 and 3: iterate through function logic nodes
  // First pass: add all non-input nodes
  for (const { id: nodeId, ...data } of functionLogicDag.nodes()) {
    if (data.node_type === 'function' || data.node_type === 'constant') {
      const newId = nodeId + idOffset;
      const filteredData = { ...data };
      delete filteredData.output_name;
      delete filteredData.output_order;
      baseDag.addNode(newId, filteredData);
    }
  }
  // Second pass: add edges for non-input nodes
  for (const { id: nodeId, ...data } of functionLogicDag.nodes()) {
    if (data.node_type === 'function' || data.node_type === 'constant') {
      const newId = nodeId + idOffset;

      // Add edges (dependencies)
      for (const edge of functionLogicDag.outEdges(nodeId)) {
        const newTargetId = edge.target + idOffset;
        const { parentPosition, ...edgeAttrs } = edgeData(edge);
        baseDag.addEdge(newId, newTargetId, parentPosition, edgeAttrs);
      }
    } else if (data.node_type === 'input') {
      const inputOrder = parseInt(data.input_order, 10);
      if (inputOrder > parents.length - 1) {
        errors.throwNodeError(
          functionLogicDag, nodeId,
          `function_logic DAG ${functionLogicDag.graph.name} has an input node with an invalid input order.`
        );
      }
      const correspondingParentNodeId = parents[inputOrder];

      for (const edge of functionLogicDag.outEdges(nodeId)) {
        const { parentPosition, ...edgeAttrs } = edgeData(edge);
        baseDag.addEdge(correspondingParentNodeId, edge.target + idOffset, parentPosition, edgeAttrs);
      }
    }
  }

  // Step 4: Rewire Output Dependencies
  const outputNodeIds = functionLogicDag.graph.output_node_ids;
  let newOutputNodeIds;

  if (outputNodeIds.length === 1) {
    const outputNodeId = outputNodeIds[0];
    // If the to-pattern output is an input node (identity transform: e.g. NEGATE(NEGATE(x)) → x),
    // use the corresponding matched parent from baseDag instead of adding a new node.
    const outputNodeAttrs = functionLogicDag.getNode(outputNodeId);
    const newOutputNodeId = outputNodeAttrs.node_type === 'input'
      ? parents[parseInt(outputNodeAttrs.input_order, 10)]
      : outputNodeId + idOffset;

    // Collect outgoing edges first, then add new ones, then remove old ones
    const outEdges = [...baseDag.outEdges(nodeIdToExpand)];
    for (const edge of outEdges) {
      const { parentPosition, ...edgeAttrs } = edgeData(edge);
      baseDag.addEdge(newOutputNodeId, edge.target, parentPosition, edgeAttrs);
      baseDag.removeEdge(nodeIdToExpand, edge.target, parentPosition);
    }

    mimicOutputAttribs(nodeIdToExpand, newOutputNodeId);
    newOutputNodeIds = [newOutputNodeId];

    if (baseDag.graph.output_node_ids.includes(nodeIdToExpand)) {
      baseDag.graph.output_node_ids = baseDag.graph.output_node_ids.map(
        nid => nid === nodeIdToExpand ? newOutputNodeId : nid
      );
    }
  } else if (outputNodeIds.length > 1) {
    newOutputNodeIds = [];
    const nodesToRemove = [];
    const edgesToRemove = [];
    const edgesToAdd = [];
    const outputRemapping = [];

    for (let idx = 0; idx < outputNodeIds.length; idx++) {
      const outputNodeId = outputNodeIds[idx];
      let newOutputIsUsed = false;
      const newOutputNodeId = outputNodeId + idOffset;

      for (const indexNodeId of baseDag.successors(nodeIdToExpand)) {
        const indexNode = baseDag.getNode(indexNodeId);
        if (indexNode.function_name !== 'INDEX') {
          throw new Error(
            `Multi-output function '${functionLogicDag.graph.name}' consumed by ` +
            `'${indexNode.function_name}' (node ${indexNodeId}) — only INDEX is allowed.`
          );
        }

        // Determine which output position this INDEX accesses
        const indexParents = getOrderedParentIds(baseDag, indexNodeId);
        const keyNodeId = indexParents[1];
        const keyNode = baseDag.getNode(keyNodeId);

        let position;
        if (keyNode.data_type === 'Number') {
          position = requireInt(keyNode.value);
        } else if (keyNode.data_type === 'Text') {
          const keyName = (keyNode.value || '').toUpperCase();
          position = sig.resolveOutputNameIndex(functionLogicDag, keyName) + 1; // 1-based
        } else {
          throw new Error(`INDEX key must be Number or Text, got ${keyNode.data_type}`);
        }

        if (position - 1 === idx) {
          newOutputIsUsed = true;
          const grandkids = baseDag.successors(indexNodeId);
          for (const grandkid of grandkids) {
            for (const edge of baseDag.edgesBetween(indexNodeId, grandkid)) {
              const { parentPosition, ...edgeAttrs } = edge;
              edgesToRemove.push({ source: indexNodeId, target: grandkid, parentPosition });
              edgesToAdd.push({ source: newOutputNodeId, target: grandkid, parentPosition, attrs: edgeAttrs });
            }
          }
          mimicOutputAttribs(indexNodeId, newOutputNodeId);
          // Also remove the key constant node if it only feeds this INDEX
          if (baseDag.outDegree(keyNodeId) === 1) {
            nodesToRemove.push(keyNodeId);
          }
          nodesToRemove.push(indexNodeId);
          outputRemapping.push([indexNodeId, newOutputNodeId]);
        }
      }

      if (newOutputIsUsed) {
        newOutputNodeIds.push(newOutputNodeId);
      }
    }

    for (const { source, target, parentPosition } of edgesToRemove) {
      baseDag.removeEdge(source, target, parentPosition);
    }
    for (const node of nodesToRemove) {
      baseDag.removeNode(node);
    }
    for (const { source, target, parentPosition, attrs } of edgesToAdd) {
      baseDag.addEdge(source, target, parentPosition, attrs);
    }

    const remapDict = Object.fromEntries(outputRemapping);
    baseDag.graph.output_node_ids = baseDag.graph.output_node_ids.map(
      nid => remapDict[nid] !== undefined ? remapDict[nid] : nid
    );
  } else {
    throw new Error(
      `Function logic DAG ${functionLogicDag.graph.name} has an invalid number of outputs.`
    );
  }

  baseDag.removeNode(nodeIdToExpand);

  const skipStack = removeAllNonOutputSinkNodes(baseDag);

  baseDag.graph.max_node_id = maxId(baseDag.nodeIds());

  const newNodes = baseDag.nodeIds().filter(id => id > idOffset);

  const sortedNewNodes = topoSortSubgraph(baseDag, newNodes);
  updateDagWithDataTypes(
    baseDag, sortedNewNodes, signatureDefinitions, signatureDefinitionLibrary
  );

  // Safety net
  if ((baseDag.graph.output_node_ids || []).includes(nodeIdToExpand)) {
    throw new Error(
      `Cannot expand multi-output function '${functionLogicDag.graph.name}' ` +
      `because it is also an output of '${baseDag.graph.name}'. ` +
      `Multi-output function results cannot be loop registers. ` +
      `Move the function call to a column without a Row 0 entry, ` +
      `and use INDEX extraction columns as the register outputs.`
    );
  }

  if (!skipValidation) {
    if (!validation.isValidBaseGraph(baseDag, false)) {
      throw new Error(
        `base_dag ${baseDag.graph.name} is not a valid graph. Check after expanding node for ${functionLogicDag.graph.name}.`
      );
    }
  }

  return [newOutputNodeIds, skipStack];
}

// ---------------------------------------------------------------------------
// transformFromTo
// ---------------------------------------------------------------------------

function transformFromTo(
  baseDag, transformFromToDag, nodeIdToReplace, matchMapping,
  conversionRules, signatureDefinitionLibrary
) {
  if (!validation.isValidBaseGraph(baseDag, true)) {
    throw new Error(`base_dag is not valid before transform ${transformFromToDag.graph.name}`);
  }

  // Step 1: excise nodes and rewire
  const fromToOutputs = transformFromToDag.graph.output_node_ids;
  const fromDag = subsetGraph(transformFromToDag, [fromToOutputs[0]], true);
  const toDag = subsetGraph(transformFromToDag, [fromToOutputs[1]], true);
  const fromInputs = fromDag.graph.input_node_ids;
  const fromOutput = fromDag.graph.output_node_ids[0];

  if (nodeIdToReplace !== matchMapping[`t-${fromOutput}`]) {
    throw new Error('nodeIdToReplace must be the mapped node from the output of the from_dag');
  }

  // Collect edges to delete (all incoming edges to nodeIdToReplace)
  const edgesToDelete = baseDag.inEdges(nodeIdToReplace).map(e => ({
    source: e.source, target: e.target, parentPosition: e.parentPosition,
  }));

  const matchingBNodes = fromDag.nodeIds().map(
    nodeId => matchMapping[`t-${nodeId}`]
  );

  const potentialNodesToDelete = fromDag.nodeIds()
    .filter(nodeId => nodeId !== fromOutput && !fromInputs.includes(nodeId))
    .map(nodeId => matchMapping[`t-${nodeId}`]);

  function canDeleteNode(node, graph, allowedSuccessors) {
    for (const successor of graph.successors(node)) {
      if (!allowedSuccessors.includes(successor)) return false;
    }
    return true;
  }

  const nodesToDelete = potentialNodesToDelete.filter(
    id => canDeleteNode(id, baseDag, matchingBNodes)
  );

  // Apply deletions of edges
  for (const { source, target, parentPosition } of edgesToDelete) {
    baseDag.removeEdge(source, target, parentPosition);
  }

  // Remove nodes
  for (const n of nodesToDelete) {
    baseDag.removeNode(n);
  }

  // Apply additions of new edges — only wire up the inputs that toDag actually uses,
  // in toDag input order. For identity outputs (toDag output = input node), the
  // input_order attributes are remapped to compact indices so expandNode can find
  // the right parent via parents[inputOrder].
  const toDagInputIds = toDag.graph.input_node_ids;
  toDagInputIds.forEach((inputNodeId, i) => {
    toDag.getNode(inputNodeId).input_order = i;
  });
  for (let i = 0; i < toDagInputIds.length; i++) {
    const toDagInputNodeId = toDagInputIds[i];
    const baseNodeId = matchMapping[`t-${toDagInputNodeId}`];
    baseDag.addEdge(baseNodeId, nodeIdToReplace, i);
  }

  // Step 2: expand node. Skip the pre-expansion validity check because the
  // intermediate state (after excising the from-pattern) may have function
  // nodes with no parents (constant-output transforms) or unused input sinks.
  // The post-transform isValidBaseGraph call below catches real issues.
  const [newId, skipStack] = expandNode(
    nodeIdToReplace, toDag, baseDag,
    conversionRules, signatureDefinitionLibrary,
    true,
  );

  if (!validation.isValidBaseGraph(baseDag, true)) {
    throw new Error(`base_dag is not valid after transform ${transformFromToDag.graph.name}`);
  }

  return [newId, skipStack];
}

// ---------------------------------------------------------------------------
// dictOfMatchingNodeIds
// ---------------------------------------------------------------------------

function dictOfMatchingNodeIds(baseDag, transformDag, baseNodeId, transformNodeId) {
  function nodeMatch(bsAttrs, trAttrs) {
    if (!sig.matchType(bsAttrs.data_type || null, trAttrs.data_type || null, false)) {
      return false;
    }

    if (bsAttrs.node_type === 'input') {
      return trAttrs.node_type === 'input';
    }
    if (bsAttrs.output_name !== undefined) {
      return trAttrs.output_name !== undefined;
    }
    if (trAttrs.node_type === 'input') {
      return true;
    }
    if (bsAttrs.node_type !== trAttrs.node_type) {
      return false;
    }
    if (bsAttrs.node_type === 'function') {
      return bsAttrs.function_name === trAttrs.function_name;
    }
    if (bsAttrs.node_type === 'constant') {
      return bsAttrs.value === trAttrs.value && bsAttrs.data_type === trAttrs.data_type;
    }

    throw new Error(`Unsupported node comparison: ${bsAttrs.node_type}`);
  }

  function dfs(bNodeId, tNodeId, mapping) {
    if (!nodeMatch(baseDag.getNode(bNodeId), transformDag.getNode(tNodeId))) {
      return false;
    }

    const baseKey = `b-${bNodeId}`;
    const transformKey = `t-${tNodeId}`;

    if (mapping[baseKey] !== undefined || mapping[transformKey] !== undefined) {
      if (mapping[baseKey] !== tNodeId || mapping[transformKey] !== bNodeId) {
        return false;
      }
    }

    mapping[`b-${bNodeId}`] = tNodeId;
    mapping[`t-${tNodeId}`] = bNodeId;

    const basePreds = baseDag.inEdges(bNodeId)
      .sort((a, b) => a.parentPosition - b.parentPosition)
      .map(e => e.source);

    const transformPreds = transformDag.inEdges(tNodeId)
      .sort((a, b) => a.parentPosition - b.parentPosition)
      .map(e => e.source);

    if (transformPreds.length > 0) {
      if (basePreds.length !== transformPreds.length) return false;
      for (let i = 0; i < basePreds.length; i++) {
        if (!dfs(basePreds[i], transformPreds[i], mapping)) return false;
      }
    }

    return true;
  }

  const mapping = {};
  const matchFound = dfs(baseNodeId, transformNodeId, mapping);
  return matchFound ? mapping : {};
}

// ---------------------------------------------------------------------------
// generateTransformsCategories
// ---------------------------------------------------------------------------

function generateTransformsCategories(transformsDict) {
  const transformsFromTo = {};
  const transformsProtect = {};

  for (const transformLogicDag of Object.values(transformsDict)) {
    const outputs = transformLogicDag.graph.output_node_ids;
    const originalOutputCount = outputs.length;

    // Handle protect transforms
    for (let i = 2; i < originalOutputCount; i++) {
      const outputNodeIdToKeep = outputs[i];
      const transformProtect = subsetGraph(transformLogicDag, [outputNodeIdToKeep], true);
      const protectFunctionName = transformProtect.getNode(outputNodeIdToKeep).function_name;
      if (!transformsProtect[protectFunctionName]) {
        transformsProtect[protectFunctionName] = [];
      }
      transformsProtect[protectFunctionName].push(transformProtect);
    }

    // Handle from-to transforms
    if (originalOutputCount >= 2) {
      const fromTo = subsetGraph(transformLogicDag, outputs.slice(0, 2), true);
      const fromFunctionName = fromTo.getNode(outputs[0]).function_name;
      if (!transformsFromTo[fromFunctionName]) {
        transformsFromTo[fromFunctionName] = [];
      }
      transformsFromTo[fromFunctionName].push(fromTo);
    }
  }

  return [transformsFromTo, transformsProtect];
}

// ---------------------------------------------------------------------------
// prepareLoopFunctionForExpansion
// ---------------------------------------------------------------------------
//
// Prepares a loop function's outer DAG for inline expansion into a caller.
// The result is a DAG with a LOOP node whose iteration_body_dag attribute
// carries the fully processed inner DAG. When expandNode copies this LOOP
// node into the caller, the iteration body travels with it, and codegen
// can render the loop inline (IIFE, recursive CTE, etc.).

function prepareLoopFunctionForExpansion(
  loopData, funcName,
  conversionRules, signatureDefinitionLibrary,
  customFunctionDags
) {
  const preparedGraph = loopData.graph.copy();
  const [outerDag, innerDag] = transformLoopToOuterInner(
    preparedGraph, loopData.xmlTree, funcName, customFunctionDags,
  );

  eliminateProceedNodes(outerDag);
  eliminateProceedNodes(innerDag);

  // Process inner DAG (resolve types, expand nested custom functions)
  const innerSigLib = sig.initializeConversionRules();
  convertGraph({
    dagToConvert: innerDag,
    conversionRules,
    signatureDefinitionLibrary: innerSigLib,
    renumNodes: true,
  });

  // Stash the iteration body DAG on the LOOP node's attributes so it
  // survives expandNode (which copies all node attributes).
  for (const nodeId of outerDag.nodeIds()) {
    const attrs = outerDag.getNode(nodeId);
    if (attrs.function_name === 'LOOP') {
      attrs.iteration_body_dag = innerDag;
      break;
    }
  }

  return outerDag;
}

// ---------------------------------------------------------------------------
// convertGraph
// ---------------------------------------------------------------------------

export function convertGraph({
  dagToConvert, conversionRules, signatureDefinitionLibrary,
  renumNodes,
}) {
  if (!validation.isValidBaseGraph(dagToConvert, false)) {
    throw new Error('dag is not valid');
  }
  if (!validation.isValidConversionRulesDict(conversionRules)) {
    throw new Error('conversion rules dictionary is not valid');
  }
  if (!validation.isValidSignatureDefinitionDict(signatureDefinitionLibrary, true, true)) {
    throw new Error('signature is not valid');
  }

  const customFunctionDags = conversionRules.custom_function_dags || {};
  const systemFunctionDags = conversionRules.system_function_dags || {};
  const [transformsFromToDict, transformsProtect] = generateTransformsCategories(
    conversionRules.transforms || {}
  );

  // Create combined signature dictionary
  const allFuncSigs = {};
  for (const dag of Object.values(customFunctionDags)) {
    const name = dag.graph.name;
    allFuncSigs[name] = dag;
  }
  const customLoopFunctions = conversionRules.custom_loop_functions || {};
  for (const data of Object.values(customLoopFunctions)) {
    const loopDag = data.graph;
    synthesizeLoopOutputInfo(loopDag, data.xmlTree);
    allFuncSigs[loopDag.graph.name] = loopDag;
  }
  Object.assign(allFuncSigs, systemFunctionDags);

  const funcLogicSigs = sig.createSignatureDictionary(allFuncSigs);
  sig.addSignaturesToLibrary(funcLogicSigs, signatureDefinitionLibrary, 'function_logic_dag', true);

  updateDagWithDataTypes(
    dagToConvert,
    dagToConvert.topologicalSort(),
    conversionRules,
    signatureDefinitionLibrary,
    allFuncSigs
  );
  if (!validation.isValidBaseGraph(dagToConvert, true)) {
    throw new Error('dag is not valid');
  }

  const seen = new Set();
  const stack = [...dagToConvert.graph.output_node_ids];
  const skipStack = new Set();
  for (const id of stack) seen.add(id);

  function addToQueue(nodeIds) {
    for (const id of nodeIds) {
      if (!seen.has(id)) {
        stack.push(id);
        seen.add(id);
      }
    }
  }

  const protectNodesDict = {};

  function addToProtectNodesDict(matchingNodesMapping, protectDag) {
    const protectFromDagName = protectDag.graph.name;
    for (const [key, nodeId] of Object.entries(matchingNodesMapping)) {
      if (key.startsWith('t-')) {
        if (!protectNodesDict[nodeId]) protectNodesDict[nodeId] = [];
        protectNodesDict[nodeId].push(protectFromDagName);
      }
    }
  }

  const functionLogicDagsWithTypesAdded = new Set();

  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!dagToConvert.hasNode(nodeId)) continue;
    if (skipStack.has(nodeId)) continue;

    if (dagToConvert.getNode(nodeId).node_type !== 'function') continue;
    const functionName = dagToConvert.getNode(nodeId).function_name;

    // LOOP nodes are isolation barriers
    if (functionName === 'LOOP') {
      addToQueue(dagToConvert.predecessors(nodeId));
      continue;
    }

    // Check protections
    if (transformsProtect[functionName]) {
      for (const protectDag of transformsProtect[functionName]) {
        const protectId = protectDag.graph.output_node_ids[0];
        const matchMap = dictOfMatchingNodeIds(
          dagToConvert, protectDag, nodeId, protectId
        );
        if (Object.keys(matchMap).length > 0) {
          addToProtectNodesDict(matchMap, protectDag);
        }
      }
    }

    // Check transforms
    let continueToWhile = false;
    if (transformsFromToDict[functionName]) {
      for (const transformLogicDag of transformsFromToDict[functionName]) {
        const transformName = transformLogicDag.graph.name;
        if (!(protectNodesDict[nodeId] || []).includes(transformName)) {
          const transformFromNodeId = transformLogicDag.graph.output_node_ids[0];
          const matchMap = dictOfMatchingNodeIds(
            dagToConvert, transformLogicDag, nodeId, transformFromNodeId
          );
          if (Object.keys(matchMap).length > 0) {
            const [newIds, newSkipStack] = transformFromTo(
              dagToConvert, transformLogicDag, nodeId, matchMap,
              conversionRules, signatureDefinitionLibrary
            );
            addToQueue(newIds);
            for (const id of newSkipStack) skipStack.add(id);
            continueToWhile = true;
            break;
          }
        }
      }
    }
    if (continueToWhile) continue;

    // ID-based function resolution
    const customFuncsMapping = dagToConvert.graph.custom_functions || {};
    const customFunctionOverrides = conversionRules.customFunctionOverrides || {};
    let functionLogicDag = null;
    if (customFuncsMapping[functionName]) {
      const functionId = customFuncsMapping[functionName];
      functionLogicDag = customFunctionDags[functionId] || null;

      // Loop functions are stored separately — prepare and expand them inline.
      // This transforms the loop into an outer DAG with a LOOP node that carries
      // its iteration_body_dag, so it can be expanded into the caller and rendered
      // inline (IIFE in JS, recursive CTE in SQL) instead of as a separate function.
      if (!functionLogicDag && customLoopFunctions[functionId]) {
        functionLogicDag = prepareLoopFunctionForExpansion(
          customLoopFunctions[functionId], functionName,
          conversionRules, signatureDefinitionLibrary,
          customFunctionDags
        );
      }
    } else if (systemFunctionDags[functionName]) {
      functionLogicDag = systemFunctionDags[functionName];
    }

    // If the language pack provides a hand-written override for this
    // custom function, skip DAG expansion — keep the call node intact
    // so it emits a function call, and the override code will be
    // prepended to the output by transpileDags.
    if (functionLogicDag !== null && functionName in customFunctionOverrides) {
      addToQueue(dagToConvert.predecessors(nodeId));
      continue;
    }

    if (functionLogicDag !== null) {
      if (!functionLogicDagsWithTypesAdded.has(functionLogicDag.graph.name)) {
        updateDagWithDataTypes(
          functionLogicDag,
          functionLogicDag.topologicalSort(),
          conversionRules,
          signatureDefinitionLibrary
        );
        functionLogicDagsWithTypesAdded.add(functionLogicDag.graph.name);
      }

      const [newIds, newSkipStack] = expandNode(
        nodeId, functionLogicDag, dagToConvert,
        conversionRules, signatureDefinitionLibrary
      );

      const nestedCustomFuncs = functionLogicDag.graph.custom_functions || {};
      if (Object.keys(nestedCustomFuncs).length > 0) {
        if (!dagToConvert.graph.custom_functions) {
          dagToConvert.graph.custom_functions = {};
        }
        Object.assign(dagToConvert.graph.custom_functions, nestedCustomFuncs);

        for (const [nestedName, nestedUuid] of Object.entries(nestedCustomFuncs)) {
          if (customFunctionDags[nestedUuid]) {
            allFuncSigs[nestedName] = customFunctionDags[nestedUuid];
          }
        }
      }

      addToQueue(newIds);
      for (const id of newSkipStack) skipStack.add(id);
      continue;
    }

    // Add parent nodes
    addToQueue(dagToConvert.predecessors(nodeId));
  }

  // Find transition nodes
  const nodesToFold = findNodesToLopOff(dagToConvert);
  if (nodesToFold.size > 0) {
    foldConstantNodes(dagToConvert, nodesToFold);
  }
  // Clean up any nodes left orphaned by constant folding
  removeAllNonOutputSinkNodes(dagToConvert);
  const remainingIds = dagToConvert.nodeIds();
  if (remainingIds.length > 0) {
    dagToConvert.graph.max_node_id = maxId(remainingIds);
  }

  if (renumNodes) {
    renumberNodes(dagToConvert);
  }

  if (!validation.isValidBaseGraph(dagToConvert, true)) {
    throw new Error('converted dag is not valid');
  }
  if (!validation.isValidConversionRulesDict(conversionRules)) {
    throw new Error('Conversion rules dictionary is not valid');
  }
}

// ---------------------------------------------------------------------------
// removeEdgeByPosition
// ---------------------------------------------------------------------------

function removeEdgeByPosition(G, nodeId, parentNodeId, parentPosition) {
  for (const edge of G.inEdges(nodeId)) {
    if (edge.source === parentNodeId && edge.parentPosition === parentPosition) {
      G.removeEdge(edge.source, nodeId, edge.parentPosition);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// transformLoopToOuterInner
// ---------------------------------------------------------------------------

export function transformLoopToOuterInner(G, lxmlTree, funcName, customFunctionDags = null) {
  const cellPattern = /^([A-Z_]+)(\d+)$/;

  // Get node-to-cell mapping and optional maxIterations
  let nodeToCell;
  let maxIterations;
  if (typeof lxmlTree === 'object' && !lxmlTree.querySelector) {
    nodeToCell = lxmlTree;
  } else {
    nodeToCell = {};
    const namedNodes = lxmlTree.querySelectorAll('NamedNodes > *');
    for (const nn of namedNodes) {
      const nid = parseInt(nn.getAttribute('node_id'), 10);
      const nname = nn.getAttribute('node_name');
      const ntype = nn.getAttribute('node_name_type');
      if (ntype === 'address') nodeToCell[nid] = nname;
    }
    const rawMax = lxmlTree.documentElement.getAttribute('maxIterations');
    if (rawMax != null) {
      const parsed = parseInt(rawMax, 10);
      if (!isNaN(parsed)) maxIterations = parsed;
    }
  }

  // Classify nodes by row
  const row0Nodes = {}; // nodeId -> column
  const row1Nodes = {}; // nodeId -> column
  const inputNodes = [];
  const otherNodes = [];

  for (const id of G.nodeIds()) {
    const attrs = G.getNode(id);
    if (attrs.node_type === 'input') {
      inputNodes.push(id);
      continue;
    }

    const cellAddr = nodeToCell[id];
    if (cellAddr) {
      const match = cellPattern.exec(cellAddr);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2], 10);
        if (row === 0) { row0Nodes[id] = col; continue; }
        if (row === 1) { row1Nodes[id] = col; continue; }
      }
    }
    otherNodes.push(id);
  }

  // Identify output columns
  const outputColumns = new Set();
  const outputColumnsXmlOrder = [];

  const outputModes = {};

  if (lxmlTree.querySelector) {
    const root = lxmlTree.documentElement || lxmlTree;
    const outputsElem = root.querySelector('Outputs');
    if (outputsElem) {
      const orderedOutputs = [];
      for (const out of outputsElem.children) {
        const col = out.getAttribute('output_name') || out.getAttribute('key') || '';
        const order = parseInt(out.getAttribute('output_order') || '0', 10);
        const mode = out.getAttribute('output_mode') || 'last';
        if (col) {
          const cleanCol = col.toUpperCase().replace(/[0-9]+$/, '');
          outputColumns.add(cleanCol);
          orderedOutputs.push([order, cleanCol]);
          if (mode === 'all') {
            outputModes[cleanCol] = 'all';
          }
        }
      }
      orderedOutputs.sort((a, b) => a[0] - b[0]);
      outputColumnsXmlOrder.push(...orderedOutputs.map(([, col]) => col));
    }
  }

  // Find _STOP1 node
  let stopNodeId = null;
  for (const [nodeId, col] of Object.entries(row1Nodes)) {
    if (col.toUpperCase() === '_STOP') {
      stopNodeId = Number(nodeId);
      break;
    }
  }

  // Find _STOP0 node
  let stop0NodeId = null;
  for (const [nodeId, col] of Object.entries(row0Nodes)) {
    if (col.toUpperCase() === '_STOP') {
      stop0NodeId = Number(nodeId);
      break;
    }
  }

  // Identify register columns
  const registerCols = new Set();
  const inputNodeSet = new Set(inputNodes);

  function findRow0Refs(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (row0Nodes[nodeId] !== undefined) {
      registerCols.add(row0Nodes[nodeId]);
      return;
    }
    if (inputNodeSet.has(nodeId)) return;
    for (const predId of G.predecessors(nodeId)) {
      findRow0Refs(predId, visited);
    }
  }

  for (const nodeId of Object.keys(row1Nodes).map(Number)) {
    findRow0Refs(nodeId);
  }

  if (registerCols.size === 0) {
    throw new Error(
      `Loop '${funcName}' has no register columns — Row 1 nodes must ` +
      `reference at least one Row 0 value to carry state between iterations.`
    );
  }

  const ctx = {
    G, funcName, row0Nodes, row1Nodes, inputNodes, inputNodeSet,
    registerCols, outputColumns, outputColumnsXmlOrder, outputModes,
    stopNodeId, stop0NodeId, customFunctionDags, maxIterations,
  };

  const { innerDag, sortedExternalInputs } = buildLoopInnerDag(ctx);
  const outerDag = buildLoopOuterDag(ctx, innerDag, sortedExternalInputs);

  return [outerDag, innerDag];
}

// ---------------------------------------------------------------------------
// buildLoopInnerDag (helper for transformLoopToOuterInner)
// ---------------------------------------------------------------------------

function buildLoopInnerDag(ctx) {
  const {
    G, funcName, row0Nodes, row1Nodes, inputNodeSet,
    registerCols, outputColumns, stopNodeId, customFunctionDags,
  } = ctx;

  const innerDag = new MultiDiGraph();
  innerDag.graph.name = `${funcName}_iteration`;

  let nextId = 1;
  const oldToInner = {};

  // Create synthetic prev_* input nodes for each register column
  const syntheticInputs = {};
  for (const col of [...registerCols].sort()) {
    let dataType = 'Number';
    for (const [nodeId, c] of Object.entries(row0Nodes)) {
      if (c === col) {
        dataType = G.getNode(Number(nodeId)).data_type || 'Number';
        break;
      }
    }
    innerDag.addNode(nextId, {
      node_type: 'input',
      input_name: `prev_${col}`,
      data_type: dataType,
      input_order: Object.keys(syntheticInputs).length,
    });
    syntheticInputs[col] = nextId;
    nextId++;
  }

  // Find external inputs used by Row 1
  const externalInputsUsed = new Set();

  function findUsedInputs(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (inputNodeSet.has(nodeId)) {
      externalInputsUsed.add(nodeId);
      return;
    }
    if (row0Nodes[nodeId] !== undefined) return;
    for (const predId of G.predecessors(nodeId)) {
      findUsedInputs(predId, visited);
    }
  }

  for (const nodeId of Object.keys(row1Nodes).map(Number)) {
    findUsedInputs(nodeId);
  }

  // Add external inputs to inner DAG
  let externalInputOrder = Object.keys(syntheticInputs).length;
  const sortedExternalInputs = [...externalInputsUsed].sort(
    (a, b) => (G.getNode(a).input_order || 0) - (G.getNode(b).input_order || 0)
  );
  for (const nodeId of sortedExternalInputs) {
    const attrs = { ...G.getNode(nodeId) };
    attrs.input_order = externalInputOrder;
    externalInputOrder++;
    innerDag.addNode(nextId, attrs);
    oldToInner[nodeId] = nextId;
    nextId++;
  }

  // Add Row 1 nodes to inner DAG
  for (const nodeId of Object.keys(row1Nodes).map(Number)) {
    const attrs = { ...G.getNode(nodeId) };
    delete attrs.output_name;
    delete attrs.output_order;
    innerDag.addNode(nextId, attrs);
    oldToInner[nodeId] = nextId;
    nextId++;
  }

  // Add dependencies (constants, etc.)
  function addDependencies(nodeId) {
    for (const predId of G.predecessors(nodeId)) {
      if (oldToInner[predId] !== undefined) continue;
      if (row0Nodes[predId] !== undefined) continue;
      if (inputNodeSet.has(predId)) continue;
      const attrs = { ...G.getNode(predId) };
      innerDag.addNode(nextId, attrs);
      oldToInner[predId] = nextId;
      nextId++;
      addDependencies(predId);
    }
  }

  for (const nodeId of Object.keys(row1Nodes).map(Number)) {
    addDependencies(nodeId);
  }

  // Add edges — Row 1 nodes
  for (const nodeId of Object.keys(row1Nodes).map(Number)) {
    addInnerEdges(G, innerDag, nodeId, oldToInner[nodeId], oldToInner, row0Nodes, syntheticInputs);
  }

  // Add edges — dependency nodes (constants, intermediate functions)
  for (const [oldIdStr, innerId] of Object.entries(oldToInner)) {
    const oldId = Number(oldIdStr);
    if (row1Nodes[oldId] !== undefined || inputNodeSet.has(oldId)) continue;
    addInnerEdges(G, innerDag, oldId, innerId, oldToInner, row0Nodes, syntheticInputs);
  }

  // Set inner DAG input/output IDs
  innerDag.graph.input_node_ids = [
    ...Object.values(syntheticInputs),
    ...sortedExternalInputs.filter(n => oldToInner[n] !== undefined).map(n => oldToInner[n]),
  ];

  // Configure outputs
  setInnerDagOutputs(
    G, innerDag, oldToInner, row1Nodes,
    registerCols, outputColumns, stopNodeId, customFunctionDags, funcName
  );

  innerDag.graph.max_node_id = nextId - 1;
  innerDag.graph.register_cols = [...registerCols].sort();
  innerDag.graph.synthetic_inputs = syntheticInputs;

  if (G.graph.custom_functions) {
    innerDag.graph.custom_functions = { ...G.graph.custom_functions };
  }

  return { innerDag, oldToInner, syntheticInputs, sortedExternalInputs };
}

/**
 * Add edges from an original-graph node's predecessors into the inner DAG,
 * mapping through row0→synthetic inputs or oldToInner for other nodes.
 */
function addInnerEdges(G, innerDag, oldId, innerId, oldToInner, row0Nodes, syntheticInputs) {
  for (const predId of G.predecessors(oldId)) {
    for (const edge of G.edgesBetween(predId, oldId)) {
      const { parentPosition, ...edgeAttrs } = edge;
      if (row0Nodes[predId] !== undefined) {
        const col = row0Nodes[predId];
        if (syntheticInputs[col] !== undefined) {
          innerDag.addEdge(syntheticInputs[col], innerId, parentPosition, edgeAttrs);
        }
      } else if (oldToInner[predId] !== undefined) {
        innerDag.addEdge(oldToInner[predId], innerId, parentPosition, edgeAttrs);
      }
    }
  }
}

/**
 * Configure inner DAG outputs: register columns first, then XML output columns,
 * then _STOP. Also validates that register columns don't contain multi-output functions.
 */
function setInnerDagOutputs(
  G, innerDag, oldToInner, row1Nodes,
  registerCols, outputColumns, stopNodeId, customFunctionDags, funcName
) {
  const innerOutputIds = [];
  let outputOrder = 0;
  const columnsAdded = new Set();

  // Detect multi-output function calls in register columns
  if (customFunctionDags) {
    const customFuncs = G.graph.custom_functions || {};
    for (const col of [...registerCols].sort()) {
      for (const [nodeIdStr, c] of Object.entries(row1Nodes)) {
        const nodeId = Number(nodeIdStr);
        if (c === col) {
          const nodeFuncName = G.getNode(nodeId).function_name;
          if (nodeFuncName && customFuncs[nodeFuncName]) {
            const funcId = customFuncs[nodeFuncName];
            if (customFunctionDags[funcId]) {
              const funcDag = customFunctionDags[funcId];
              const nOutputs = (funcDag.graph.output_node_ids || []).length;
              if (nOutputs > 1) {
                throw new Error(
                  `Column ${col} in loop '${funcName}' contains multi-output ` +
                  `function ${nodeFuncName} (returns ${nOutputs} values) ` +
                  `and cannot be a loop register. Move the function call to ` +
                  `a column without a Row 0 entry, and use INDEX to extract ` +
                  `values into the register columns.`
                );
              }
            }
          }
          break;
        }
      }
    }
  }

  // Register columns first
  for (const col of [...registerCols].sort()) {
    for (const [nodeIdStr, c] of Object.entries(row1Nodes)) {
      const nodeId = Number(nodeIdStr);
      if (c === col && oldToInner[nodeId] !== undefined) {
        const innerId = oldToInner[nodeId];
        innerDag.getNode(innerId).output_name = col;
        innerDag.getNode(innerId).output_order = outputOrder;
        innerOutputIds.push(innerId);
        outputOrder++;
        columnsAdded.add(col);
        break;
      }
    }
  }

  // Then output columns from XML
  for (const col of [...outputColumns].sort()) {
    if (columnsAdded.has(col)) continue;
    for (const [nodeIdStr, c] of Object.entries(row1Nodes)) {
      const nodeId = Number(nodeIdStr);
      if (c === col && oldToInner[nodeId] !== undefined) {
        const innerId = oldToInner[nodeId];
        innerDag.getNode(innerId).output_name = col;
        innerDag.getNode(innerId).output_order = outputOrder;
        innerOutputIds.push(innerId);
        outputOrder++;
        columnsAdded.add(col);
        break;
      }
    }
  }

  if (stopNodeId && oldToInner[stopNodeId] !== undefined) {
    const innerStop = oldToInner[stopNodeId];
    innerDag.getNode(innerStop).output_name = '_STOP';
    innerDag.getNode(innerStop).output_order = outputOrder;
    innerOutputIds.push(innerStop);
  }

  innerDag.graph.output_node_ids = innerOutputIds;
}

// ---------------------------------------------------------------------------
// buildLoopOuterDag (helper for transformLoopToOuterInner)
// ---------------------------------------------------------------------------

function buildLoopOuterDag(ctx, innerDag, sortedExternalInputs) {
  const {
    G, funcName, row0Nodes, inputNodes, inputNodeSet,
    registerCols, outputColumns, outputColumnsXmlOrder, outputModes,
    stop0NodeId, maxIterations,
  } = ctx;

  const outerDag = new MultiDiGraph();
  outerDag.graph.name = funcName;

  let nextId = 1;
  const oldToOuter = {};

  // Add external inputs
  const sortedInputNodes = [...inputNodes].sort(
    (a, b) => (G.getNode(a).input_order || 0) - (G.getNode(b).input_order || 0)
  );
  for (const nodeId of sortedInputNodes) {
    const attrs = { ...G.getNode(nodeId) };
    outerDag.addNode(nextId, attrs);
    oldToOuter[nodeId] = nextId;
    nextId++;
  }

  // Add Row 0 init nodes for:
  // - register columns (carry state between iterations)
  // - output columns (needed for _STOP0 early return initialization)
  // - _STOP (early exit condition)
  const neededRow0Cols = new Set([...registerCols, ...outputColumns, '_STOP']);
  for (const [nodeIdStr, col] of Object.entries(row0Nodes)) {
    const nodeId = Number(nodeIdStr);
    if (!neededRow0Cols.has(col)) continue;
    const attrs = { ...G.getNode(nodeId) };
    outerDag.addNode(nextId, attrs);
    oldToOuter[nodeId] = nextId;
    nextId++;
  }

  // Add dependencies of Row 0 nodes (recursive — pulls in full dependency chain)
  function addOuterDependencies(nodeId) {
    for (const predId of G.predecessors(nodeId)) {
      if (oldToOuter[predId] !== undefined) continue;
      if (inputNodeSet.has(predId)) continue;
      const attrs = { ...G.getNode(predId) };
      outerDag.addNode(nextId, attrs);
      oldToOuter[predId] = nextId;
      nextId++;
      addOuterDependencies(predId);
    }
  }

  for (const nodeIdStr of Object.keys(row0Nodes)) {
    const nodeId = Number(nodeIdStr);
    if (oldToOuter[nodeId] === undefined) continue;
    addOuterDependencies(nodeId);
  }

  // Add edges for Row 0 nodes and all their dependencies
  const outerNodesToWire = Object.keys(row0Nodes)
    .map(Number)
    .filter(id => oldToOuter[id] !== undefined);
  // Also wire edges for dependency nodes (non-Row-0, non-input nodes in oldToOuter)
  for (const [oldIdStr, ] of Object.entries(oldToOuter)) {
    const oldId = Number(oldIdStr);
    if (inputNodeSet.has(oldId)) continue;
    if (row0Nodes[oldId] !== undefined) continue;
    outerNodesToWire.push(oldId);
  }

  for (const nodeId of outerNodesToWire) {
    const outerNode = oldToOuter[nodeId];
    for (const predId of G.predecessors(nodeId)) {
      if (oldToOuter[predId] !== undefined) {
        for (const edge of G.edgesBetween(predId, nodeId)) {
          const { parentPosition, ...edgeAttrs } = edge;
          outerDag.addEdge(oldToOuter[predId], outerNode, parentPosition, edgeAttrs);
        }
      }
    }
  }

  // Create the LOOP node
  const loopNodeId = nextId;
  nextId++;

  const loopInputCols = [...registerCols].sort();
  const outputCol = outputColumns.size > 0 ? [...outputColumns][0] : loopInputCols[0];

  // Output-only columns: outputs that aren't registers (need Row 0 init for _STOP0)
  const outputOnlyInitCols = [...outputColumns].filter(c => !registerCols.has(c)).sort();

  // Determine data_type for the LOOP node
  const allOutputCols = outputColumns.size > 0 ? [...outputColumns].sort() : [outputCol];

  function getColType(col) {
    for (const [nodeIdStr, c] of Object.entries(row0Nodes)) {
      if (c === col) return G.getNode(Number(nodeIdStr)).data_type || 'Number';
    }
    return 'Number';
  }

  let loopDataType;
  if (allOutputCols.length === 1 && outputModes[allOutputCols[0]] === 'all') {
    loopDataType = `ARRAY[${getColType(allOutputCols[0])}]`;
  } else if (allOutputCols.length > 1) {
    const types = allOutputCols.map(col => {
      if (outputModes[col] === 'all') return `ARRAY[${getColType(col)}]`;
      return getColType(col);
    });
    loopDataType = `Object[${types.join(', ')}]`;
  } else {
    loopDataType = getColType(allOutputCols[0]);
  }

  outerDag.addNode(loopNodeId, {
    node_type: 'function',
    function_name: 'LOOP',
    data_type: loopDataType,
    iteration_dag_name: `${funcName}_iteration`,
    register_cols: loopInputCols,
    output_only_init_cols: outputOnlyInitCols,
    output_col: outputCol,
    output_cols: allOutputCols,
    output_cols_xml_order: outputColumnsXmlOrder.length > 0
      ? outputColumnsXmlOrder
      : allOutputCols,
    output_modes: Object.keys(outputModes).length > 0 ? outputModes : undefined,
    max_iterations: maxIterations,
  });

  // Connect Row 0 nodes to LOOP node: registers first, then output-only inits
  let parentPos = 0;
  for (const col of loopInputCols) {
    for (const [nodeIdStr, c] of Object.entries(row0Nodes)) {
      if (c === col) {
        outerDag.addEdge(oldToOuter[Number(nodeIdStr)], loopNodeId, parentPos);
        parentPos++;
        break;
      }
    }
  }

  for (const col of outputOnlyInitCols) {
    for (const [nodeIdStr, c] of Object.entries(row0Nodes)) {
      if (c === col) {
        outerDag.addEdge(oldToOuter[Number(nodeIdStr)], loopNodeId, parentPos);
        parentPos++;
        break;
      }
    }
  }

  // Connect external inputs to LOOP node
  for (const nodeId of sortedExternalInputs) {
    outerDag.addEdge(oldToOuter[nodeId], loopNodeId, parentPos);
    parentPos++;
  }

  // Handle _STOP0
  if (stop0NodeId !== null) {
    const stop0Attrs = G.getNode(stop0NodeId);
    const isRealCondition = stop0Attrs.node_type !== 'constant' ||
      (stop0Attrs.value !== '' && stop0Attrs.value != null);

    if (isRealCondition && oldToOuter[stop0NodeId] !== undefined) {
      outerDag.addEdge(oldToOuter[stop0NodeId], loopNodeId, parentPos);
      parentPos++;
      outerDag.getNode(loopNodeId).has_stop0 = true;
    }
  }

  // Propagate column display names
  const columnNames = G.graph.column_names || {};
  if (Object.keys(columnNames).length > 0) {
    outerDag.graph.column_names = columnNames;
    const outputColsList = outputColumns.size > 0 ? [...outputColumns].sort() : [outputCol];
    const outputColumnNames = {};
    for (const col of outputColsList) {
      outputColumnNames[col] = columnNames[col] || col;
    }
    outerDag.getNode(loopNodeId).output_column_names = outputColumnNames;
  }

  // Set outer DAG metadata
  outerDag.graph.input_node_ids = inputNodes.map(n => oldToOuter[n]);
  outerDag.graph.output_node_ids = [loopNodeId];
  outerDag.graph.max_node_id = nextId - 1;

  outerDag.getNode(loopNodeId).output_name = outputColumns.size > 0 ? outputCol : 'result';
  outerDag.getNode(loopNodeId).output_order = 0;

  outerDag.graph.iteration_body_dag = innerDag;

  if (G.graph.custom_functions) {
    outerDag.graph.custom_functions = { ...G.graph.custom_functions };
  }

  return outerDag;
}

// ---------------------------------------------------------------------------
// synthesizeLoopOutputInfo
// ---------------------------------------------------------------------------

function synthesizeLoopOutputInfo(loopDag, xmlTree) {
  const columnNames = loopDag.graph.column_names || {};

  const outputInfo = [];
  if (xmlTree.querySelectorAll) {
    const outputElems = xmlTree.querySelectorAll('Output');
    for (const elem of outputElems) {
      const col = elem.getAttribute('output_name');
      const order = parseInt(elem.getAttribute('output_order') || '0', 10);
      if (col) {
        const displayName = columnNames[col] || col;
        outputInfo.push({ name: displayName, order });
      }
    }
  }

  outputInfo.sort((a, b) => a.order - b.order);
  loopDag.graph._loop_output_info = outputInfo;
}
