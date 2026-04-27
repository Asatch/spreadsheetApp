/**
 * MultiDiGraph — a directed multigraph with positional edge keys.
 *
 * Edges between the same (source, target) pair are distinguished by
 * `parentPosition` (the argument slot a parent fills in a child node).
 *
 * Dual adjacency maps (_adj + _pred) give O(1) lookups in both directions.
 */
export class MultiDiGraph {
  constructor() {
    /** @type {Map<string|number, Object>} id → attribute object */
    this._nodes = new Map();
    /** @type {Map<string|number, Map<string|number, Map<number, Object>>>} source → target → parentPosition → attrs */
    this._adj = new Map();
    /** @type {Map<string|number, Map<string|number, Map<number, Object>>>} target → source → parentPosition → attrs */
    this._pred = new Map();
    /** Graph-level metadata (name, input_node_ids, etc.) */
    this.graph = {};
  }

  // ── Nodes ──────────────────────────────────────────────────────────

  /**
   * Add a node with optional attributes.
   * @param {string|number} id
   * @param {Object} [attributes={}]
   */
  addNode(id, attributes = {}) {
    this._nodes.set(id, { ...attributes });
    if (!this._adj.has(id)) this._adj.set(id, new Map());
    if (!this._pred.has(id)) this._pred.set(id, new Map());
  }

  /**
   * Remove a node and all its connected edges.
   * @param {string|number} id
   */
  removeNode(id) {
    if (!this._nodes.has(id)) {
      throw new Error(`Node "${id}" does not exist`);
    }

    // Remove outgoing edges: for each target this node points to
    for (const [target] of this._adj.get(id)) {
      this._pred.get(target).delete(id);
    }
    this._adj.delete(id);

    // Remove incoming edges: for each source that points to this node
    for (const [source] of this._pred.get(id)) {
      this._adj.get(source).delete(id);
    }
    this._pred.delete(id);

    this._nodes.delete(id);
  }

  /**
   * @param {string|number} id
   * @returns {boolean}
   */
  hasNode(id) {
    return this._nodes.has(id);
  }

  /**
   * Get the mutable attributes object for a node.
   * @param {string|number} id
   * @returns {Object}
   */
  getNode(id) {
    if (!this._nodes.has(id)) {
      throw new Error(`Node "${id}" does not exist`);
    }
    return this._nodes.get(id);
  }

  /**
   * Set a single attribute on a node.
   * @param {string|number} id
   * @param {string} key
   * @param {*} value
   */
  setNodeAttr(id, key, value) {
    if (!this._nodes.has(id)) {
      throw new Error(`Node "${id}" does not exist`);
    }
    this._nodes.get(id)[key] = value;
  }

  /**
   * @returns {Array<string|number>} all node ids
   */
  nodeIds() {
    return [...this._nodes.keys()];
  }

  /**
   * @returns {Array<Object>} all nodes as {id, ...attributes}
   */
  nodes() {
    return [...this._nodes.entries()].map(([id, attrs]) => ({ id, ...attrs }));
  }

  /** @returns {number} */
  get nodeCount() {
    return this._nodes.size;
  }

  // ── Edges ──────────────────────────────────────────────────────────

  /**
   * Add an edge keyed by parentPosition.
   * Both source and target must already exist as nodes.
   * @param {string|number} source
   * @param {string|number} target
   * @param {number} parentPosition
   * @param {Object} [attributes={}]
   */
  addEdge(source, target, parentPosition, attributes = {}) {
    if (!this._nodes.has(source)) {
      throw new Error(`Source node "${source}" does not exist`);
    }
    if (!this._nodes.has(target)) {
      throw new Error(`Target node "${target}" does not exist`);
    }

    // _adj: source → target → parentPosition → attrs
    let adjTargets = this._adj.get(source);
    if (!adjTargets.has(target)) adjTargets.set(target, new Map());
    adjTargets.get(target).set(parentPosition, { ...attributes });

    // _pred: target → source → parentPosition → attrs
    let predSources = this._pred.get(target);
    if (!predSources.has(source)) predSources.set(source, new Map());
    predSources.get(source).set(parentPosition, { ...attributes });
  }

  /**
   * Remove a specific edge by (source, target, parentPosition).
   * @param {string|number} source
   * @param {string|number} target
   * @param {number} parentPosition
   */
  removeEdge(source, target, parentPosition) {
    const adjTargets = this._adj.get(source);
    if (!adjTargets || !adjTargets.has(target) || !adjTargets.get(target).has(parentPosition)) {
      throw new Error(`Edge (${source} → ${target}, position ${parentPosition}) does not exist`);
    }

    const posMap = adjTargets.get(target);
    posMap.delete(parentPosition);
    if (posMap.size === 0) adjTargets.delete(target);

    const predSources = this._pred.get(target);
    const predPosMap = predSources.get(source);
    predPosMap.delete(parentPosition);
    if (predPosMap.size === 0) predSources.delete(source);
  }

  /**
   * Remove all edges between source and target (all positions).
   * @param {string|number} source
   * @param {string|number} target
   */
  removeAllEdgesBetween(source, target) {
    const adjTargets = this._adj.get(source);
    if (adjTargets) adjTargets.delete(target);

    const predSources = this._pred.get(target);
    if (predSources) predSources.delete(source);
  }

  /**
   * Check if an edge exists. Without parentPosition, checks for any edge between the pair.
   * @param {string|number} source
   * @param {string|number} target
   * @param {number} [parentPosition]
   * @returns {boolean}
   */
  hasEdge(source, target, parentPosition) {
    const adjTargets = this._adj.get(source);
    if (!adjTargets || !adjTargets.has(target)) return false;
    if (parentPosition === undefined) return true;
    return adjTargets.get(target).has(parentPosition);
  }

  /**
   * Get all edges between a specific (source, target) pair.
   * @param {string|number} source
   * @param {string|number} target
   * @returns {Array<Object>} [{parentPosition, ...attributes}]
   */
  edgesBetween(source, target) {
    const adjTargets = this._adj.get(source);
    if (!adjTargets || !adjTargets.has(target)) return [];
    const result = [];
    for (const [parentPosition, attrs] of adjTargets.get(target)) {
      result.push({ parentPosition, ...attrs });
    }
    return result;
  }

  /**
   * Get all incoming edges to a node.
   * @param {string|number} nodeId
   * @returns {Array<Object>} [{source, target, parentPosition, ...attributes}]
   */
  inEdges(nodeId) {
    const predSources = this._pred.get(nodeId);
    if (!predSources) {
      if (!this._nodes.has(nodeId)) throw new Error(`Node "${nodeId}" does not exist`);
      return [];
    }
    const result = [];
    for (const [source, posMap] of predSources) {
      for (const [parentPosition, attrs] of posMap) {
        result.push({ source, target: nodeId, parentPosition, ...attrs });
      }
    }
    return result;
  }

  /**
   * Get all outgoing edges from a node.
   * @param {string|number} nodeId
   * @returns {Array<Object>} [{source, target, parentPosition, ...attributes}]
   */
  outEdges(nodeId) {
    const adjTargets = this._adj.get(nodeId);
    if (!adjTargets) {
      if (!this._nodes.has(nodeId)) throw new Error(`Node "${nodeId}" does not exist`);
      return [];
    }
    const result = [];
    for (const [target, posMap] of adjTargets) {
      for (const [parentPosition, attrs] of posMap) {
        result.push({ source: nodeId, target, parentPosition, ...attrs });
      }
    }
    return result;
  }

  /**
   * Get all edges in the graph.
   * @returns {Array<Object>} [{source, target, parentPosition, ...attributes}]
   */
  edges() {
    const result = [];
    for (const [source, targets] of this._adj) {
      for (const [target, posMap] of targets) {
        for (const [parentPosition, attrs] of posMap) {
          result.push({ source, target, parentPosition, ...attrs });
        }
      }
    }
    return result;
  }

  // ── Traversal ──────────────────────────────────────────────────────

  /**
   * Get unique predecessor node ids (nodes with edges pointing to nodeId).
   * @param {string|number} nodeId
   * @returns {Array<string|number>}
   */
  predecessors(nodeId) {
    const predSources = this._pred.get(nodeId);
    if (!predSources) {
      if (!this._nodes.has(nodeId)) throw new Error(`Node "${nodeId}" does not exist`);
      return [];
    }
    return [...predSources.keys()];
  }

  /**
   * Get unique successor node ids (nodes that nodeId has edges pointing to).
   * @param {string|number} nodeId
   * @returns {Array<string|number>}
   */
  successors(nodeId) {
    const adjTargets = this._adj.get(nodeId);
    if (!adjTargets) {
      if (!this._nodes.has(nodeId)) throw new Error(`Node "${nodeId}" does not exist`);
      return [];
    }
    return [...adjTargets.keys()];
  }

  /**
   * Number of incoming edges (counting each parentPosition separately).
   * @param {string|number} nodeId
   * @returns {number}
   */
  inDegree(nodeId) {
    return this.inEdges(nodeId).length;
  }

  /**
   * Number of outgoing edges (counting each parentPosition separately).
   * @param {string|number} nodeId
   * @returns {number}
   */
  outDegree(nodeId) {
    return this.outEdges(nodeId).length;
  }

  // ── Algorithms ─────────────────────────────────────────────────────

  /**
   * Topological sort via Kahn's algorithm.
   * @returns {Array<string|number>} sorted node ids
   * @throws {Error} if the graph contains a cycle
   */
  topologicalSort() {
    // Build in-degree counts
    const inDegree = new Map();
    for (const id of this._nodes.keys()) {
      inDegree.set(id, 0);
    }
    for (const [, targets] of this._adj) {
      for (const [target, posMap] of targets) {
        inDegree.set(target, inDegree.get(target) + posMap.size);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
      const node = queue.shift();
      sorted.push(node);

      const adjTargets = this._adj.get(node);
      if (adjTargets) {
        for (const [target, posMap] of adjTargets) {
          const newDeg = inDegree.get(target) - posMap.size;
          inDegree.set(target, newDeg);
          if (newDeg === 0) queue.push(target);
        }
      }
    }

    if (sorted.length !== this._nodes.size) {
      throw new Error('Graph contains a cycle — topological sort is not possible');
    }

    return sorted;
  }

  /**
   * Find all nodes reachable from startNodes in the given direction.
   * @param {Array<string|number>} startNodes
   * @param {'upstream'|'downstream'} direction - 'upstream' follows predecessors, 'downstream' follows successors
   * @returns {Set<string|number>} reachable node ids (includes start nodes)
   */
  reachableNodes(startNodes, direction) {
    const visited = new Set();
    const stack = [...startNodes];
    const getNeighbors = direction === 'upstream'
      ? (id) => this.predecessors(id)
      : (id) => this.successors(id);

    while (stack.length > 0) {
      const node = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node);
      for (const neighbor of getNeighbors(node)) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }

    return visited;
  }

  /**
   * Topological sort of a subset of nodes, considering only edges within the subset.
   * @param {Array<string|number>} nodeIds
   * @returns {Array<string|number>} sorted node ids
   * @throws {Error} if the induced subgraph contains a cycle
   */
  topologicalSortSubset(nodeIds) {
    const subset = new Set(nodeIds);

    const inDegree = new Map();
    for (const id of subset) inDegree.set(id, 0);

    for (const id of subset) {
      const predSources = this._pred.get(id);
      if (!predSources) continue;
      for (const [source, posMap] of predSources) {
        if (subset.has(source)) {
          inDegree.set(id, inDegree.get(id) + posMap.size);
        }
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
      const node = queue.shift();
      sorted.push(node);

      const adjTargets = this._adj.get(node);
      if (adjTargets) {
        for (const [target, posMap] of adjTargets) {
          if (!subset.has(target)) continue;
          const newDeg = inDegree.get(target) - posMap.size;
          inDegree.set(target, newDeg);
          if (newDeg === 0) queue.push(target);
        }
      }
    }

    if (sorted.length !== subset.size) {
      throw new Error('Subgraph contains a cycle — topological sort is not possible');
    }

    return sorted;
  }

  /**
   * Check whether the graph is a directed acyclic graph.
   * @returns {boolean}
   */
  isDAG() {
    try {
      this.topologicalSort();
      return true;
    } catch {
      return false;
    }
  }

  // ── Metadata & copy ────────────────────────────────────────────────

  /**
   * Deep clone the entire graph. The returned graph is fully independent.
   * @returns {MultiDiGraph}
   */
  copy() {
    const g = new MultiDiGraph();
    g.graph = structuredClone(this.graph);

    for (const [id, attrs] of this._nodes) {
      g._nodes.set(id, structuredClone(attrs));
    }

    for (const [source, targets] of this._adj) {
      const targetMap = new Map();
      for (const [target, posMap] of targets) {
        const newPosMap = new Map();
        for (const [pos, attrs] of posMap) {
          newPosMap.set(pos, structuredClone(attrs));
        }
        targetMap.set(target, newPosMap);
      }
      g._adj.set(source, targetMap);
    }

    for (const [target, sources] of this._pred) {
      const sourceMap = new Map();
      for (const [source, posMap] of sources) {
        const newPosMap = new Map();
        for (const [pos, attrs] of posMap) {
          newPosMap.set(pos, structuredClone(attrs));
        }
        sourceMap.set(source, newPosMap);
      }
      g._pred.set(target, sourceMap);
    }

    return g;
  }

  /**
   * Rename nodes in-place. Only nodes present in the mapping are renamed;
   * others keep their current ids.
   * @param {Object} mapping - {oldId: newId}
   */
  relabelNodes(mapping) {
    // Handle maps properly — mapping keys might be numbers but stored as string object keys
    const remapId = (id) => {
      if (Object.hasOwn(mapping, id)) return mapping[id];
      // Check string version for numeric ids
      const strId = String(id);
      if (Object.hasOwn(mapping, strId)) return mapping[strId];
      return id;
    };

    // Rebuild _nodes
    const newNodes = new Map();
    for (const [id, attrs] of this._nodes) {
      newNodes.set(remapId(id), attrs);
    }
    this._nodes = newNodes;

    // Rebuild _adj
    const newAdj = new Map();
    for (const [source, targets] of this._adj) {
      const newSource = remapId(source);
      const newTargets = new Map();
      for (const [target, posMap] of targets) {
        newTargets.set(remapId(target), posMap);
      }
      newAdj.set(newSource, newTargets);
    }
    this._adj = newAdj;

    // Rebuild _pred
    const newPred = new Map();
    for (const [target, sources] of this._pred) {
      const newTarget = remapId(target);
      const newSources = new Map();
      for (const [source, posMap] of sources) {
        newSources.set(remapId(source), posMap);
      }
      newPred.set(newTarget, newSources);
    }
    this._pred = newPred;
  }
}
