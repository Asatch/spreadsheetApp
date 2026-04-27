/**
 * graphBuilder — parse spreadsheet XML into a MultiDiGraph.
 *
 * Ported from server/transpiler/dags.py (build_nx_graph, is_loop_sheet,
 * get_node_to_cell_mapping). Only graph-construction logic lives here;
 * no transpilation or DAG transformation.
 */

import { MultiDiGraph } from '../utils/graphModel.js';

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Parse a DOM Document into a MultiDiGraph.
 *
 * Port of `build_nx_graph(lxml_tree)`.
 *
 * @param {Document} doc - parsed XML document
 * @returns {MultiDiGraph}
 */
export function buildGraph(doc) {
  const root = doc.documentElement;
  let maxNodeId = 0;
  const treeName = root.getAttribute('name');

  const G = new MultiDiGraph();

  // Collect output attributes and IDs
  /** @type {Map<number, Object>} */
  const outputAttributes = new Map();
  const outputNodeIds = new Set();
  const inputNodeIds = new Set();

  const isLoop = isLoopSheet(doc);

  // ── Outputs ────────────────────────────────────────────────────────
  const outputElements = root.querySelectorAll(':scope > Outputs > Output');
  for (const output of outputElements) {
    const nodeIdAttr = output.getAttribute('node_id');
    if (nodeIdAttr !== null) {
      // Regular DAG: output points to a specific node
      const outputNodeId = parseInt(nodeIdAttr, 10);
      outputNodeIds.add(outputNodeId);
      // Gather all attributes except node_id
      const attrs = {};
      for (const attr of output.attributes) {
        if (attr.name !== 'node_id') {
          attrs[attr.name] = attr.value;
        }
      }
      outputAttributes.set(outputNodeId, attrs);
    } else if (isLoop) {
      // Loop sheet: output is a register/column name, not a node — skip
    } else {
      throw new Error(
        `Output element missing required node_id attribute: ${serializeAttrs(output)}`
      );
    }
  }

  // ── Nodes ──────────────────────────────────────────────────────────
  const nodeElements = root.querySelectorAll(':scope > Nodes > Node');
  for (const node of nodeElements) {
    const nodeAttrs = {};
    for (const attr of node.attributes) {
      nodeAttrs[attr.name] = attr.value;
    }

    const nodeId = parseInt(nodeAttrs.node_id, 10);
    delete nodeAttrs.node_id;
    maxNodeId = Math.max(maxNodeId, nodeId);

    if (nodeAttrs.node_type === 'input') {
      inputNodeIds.add(nodeId);
    }

    // Parse input_order to integer
    if ('input_order' in nodeAttrs) {
      nodeAttrs.input_order = parseInt(nodeAttrs.input_order, 10);
    }

    // Convert numeric values from string to float (dates are serial numbers)
    if (['Number', 'Date', 'Datetime'].includes(nodeAttrs.data_type) && 'value' in nodeAttrs) {
      const num = Number(nodeAttrs.value);
      if (!Number.isNaN(num)) {
        nodeAttrs.value = num;
      }
      // Keep as string if conversion fails
    }

    // Convert boolean values from string to boolean
    if (nodeAttrs.data_type === 'Boolean' && 'value' in nodeAttrs) {
      nodeAttrs.value = String(nodeAttrs.value).toLowerCase() === 'true';
    }

    // Merge output attributes, checking for overlaps
    if (outputAttributes.has(nodeId)) {
      const outAttrs = outputAttributes.get(nodeId);
      for (const [key, value] of Object.entries(outAttrs)) {
        if (key in nodeAttrs && key !== 'data_type') {
          if (key === 'type') {
            if (nodeAttrs[key] !== value) {
              throw new Error(
                `Type mismatch detected for node ${nodeId}: node type '${nodeAttrs[key]}' vs output type '${value}' in tree: ${treeName}`
              );
            }
          } else {
            throw new Error(
              `Attribute overlap detected for node ${nodeId}: '${key}' in tree: ${treeName}`
            );
          }
        }
        nodeAttrs[key] = value;
      }
    }

    // Parse output_order to integer (arrives as string from XML attributes)
    if ('output_order' in nodeAttrs) {
      nodeAttrs.output_order = parseInt(nodeAttrs.output_order, 10);
    }

    G.addNode(nodeId, nodeAttrs);
  }

  // ── Edges (NodeDependencies) ───────────────────────────────────────
  const depElements = root.querySelectorAll(
    ':scope > NodeDependencies > NodeDependency'
  );
  for (const dep of depElements) {
    const parentNode = parseInt(dep.getAttribute('parent_node_id'), 10);
    const childNode = parseInt(dep.getAttribute('child_node_id'), 10);
    const parentPosition = parseInt(dep.getAttribute('parent_position'), 10);
    G.addEdge(parentNode, childNode, parentPosition);
  }

  // ── NamedNodes (aliases, addresses) ────────────────────────────────
  const NAME_TYPE_PRIORITY = {
    alias: 1,
    address: 2,
    array_formula_parent_address: 3,
  };

  const namedNodeElements = root.querySelectorAll(
    ':scope > NamedNodes > NamedNode'
  );
  for (const namedNode of namedNodeElements) {
    const nodeId = parseInt(namedNode.getAttribute('node_id'), 10);
    const nodeAttribs = G.getNode(nodeId);
    const currentNameType = nodeAttribs.node_name_type ?? null;
    const newNameType = namedNode.getAttribute('node_name_type');

    if (!(newNameType in NAME_TYPE_PRIORITY)) {
      throw new Error(`Unrecognized node_name_type: ${newNameType}`);
    }

    const currentPriority =
      currentNameType === null
        ? Infinity
        : (NAME_TYPE_PRIORITY[currentNameType] ?? Infinity);

    if (
      currentNameType === null ||
      NAME_TYPE_PRIORITY[newNameType] < currentPriority
    ) {
      nodeAttribs.node_name_type = newNameType;
      nodeAttribs.node_name = namedNode.getAttribute('node_name');
    } else if (newNameType === currentNameType) {
      throw new Error(
        `Duplicate node_name_type detected. Node_id: ${nodeId}, node_name_type: ${currentNameType}`
      );
    }
  }

  // ── Graph-level metadata ───────────────────────────────────────────
  G.graph.max_node_id = maxNodeId;
  G.graph.name = treeName;

  const sortedInputs = [...inputNodeIds].sort(
    (a, b) => G.getNode(a).input_order - G.getNode(b).input_order
  );
  G.graph.input_node_ids = sortedInputs;

  const sortedOutputs = [...outputNodeIds].sort(
    (a, b) => G.getNode(a).output_order - G.getNode(b).output_order
  );
  G.graph.output_node_ids = sortedOutputs;

  return G;
}

/**
 * Check if the XML represents a loop sheet (vs regular DAG).
 *
 * Port of `is_loop_sheet(lxml_tree)`.
 *
 * @param {Document} doc - parsed XML document
 * @returns {boolean}
 */
export function isLoopSheet(doc) {
  return doc.documentElement.getAttribute('sheetType') === 'loop';
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Serialize an element's attributes into a readable string for error messages. */
function serializeAttrs(element) {
  const parts = [];
  for (const attr of element.attributes) {
    parts.push(`${attr.name}="${attr.value}"`);
  }
  return parts.join(', ');
}
