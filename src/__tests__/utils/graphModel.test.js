import { describe, it, expect, beforeEach } from 'vitest';
import { MultiDiGraph } from '../../utils/graphModel.js';

describe('MultiDiGraph', () => {
  let g;

  beforeEach(() => {
    g = new MultiDiGraph();
  });

  // ── Node operations ────────────────────────────────────────────

  describe('nodes', () => {
    it('adds and retrieves nodes', () => {
      g.addNode('a', { node_type: 'value' });
      expect(g.hasNode('a')).toBe(true);
      expect(g.getNode('a')).toEqual({ node_type: 'value' });
      expect(g.nodeCount).toBe(1);
    });

    it('adds node without attributes', () => {
      g.addNode('a');
      expect(g.getNode('a')).toEqual({});
    });

    it('overwrites node attributes on re-add', () => {
      g.addNode('a', { x: 1 });
      g.addNode('a', { y: 2 });
      expect(g.getNode('a')).toEqual({ y: 2 });
    });

    it('getNode returns mutable reference', () => {
      g.addNode('a', { x: 1 });
      const attrs = g.getNode('a');
      attrs.x = 99;
      expect(g.getNode('a').x).toBe(99);
    });

    it('setNodeAttr sets a single attribute', () => {
      g.addNode('a', { x: 1 });
      g.setNodeAttr('a', 'y', 2);
      expect(g.getNode('a')).toEqual({ x: 1, y: 2 });
    });

    it('nodeIds returns all ids', () => {
      g.addNode('a');
      g.addNode('b');
      g.addNode('c');
      expect(g.nodeIds()).toEqual(['a', 'b', 'c']);
    });

    it('nodes() returns id + attributes', () => {
      g.addNode('a', { v: 1 });
      g.addNode('b', { v: 2 });
      expect(g.nodes()).toEqual([
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ]);
    });

    it('removeNode removes a node', () => {
      g.addNode('a');
      g.removeNode('a');
      expect(g.hasNode('a')).toBe(false);
      expect(g.nodeCount).toBe(0);
    });

    it('throws on getNode for nonexistent node', () => {
      expect(() => g.getNode('x')).toThrow('does not exist');
    });

    it('throws on removeNode for nonexistent node', () => {
      expect(() => g.removeNode('x')).toThrow('does not exist');
    });

    it('throws on setNodeAttr for nonexistent node', () => {
      expect(() => g.setNodeAttr('x', 'k', 'v')).toThrow('does not exist');
    });
  });

  // ── Edge operations ────────────────────────────────────────────

  describe('edges', () => {
    beforeEach(() => {
      g.addNode('a');
      g.addNode('b');
      g.addNode('c');
    });

    it('adds and checks single edge', () => {
      g.addEdge('a', 'b', 0, { label: 'x' });
      expect(g.hasEdge('a', 'b')).toBe(true);
      expect(g.hasEdge('a', 'b', 0)).toBe(true);
      expect(g.hasEdge('a', 'b', 1)).toBe(false);
      expect(g.hasEdge('b', 'a')).toBe(false);
    });

    it('supports multi-edges with different positions', () => {
      g.addEdge('a', 'b', 0, { role: 'first' });
      g.addEdge('a', 'b', 1, { role: 'second' });
      expect(g.hasEdge('a', 'b', 0)).toBe(true);
      expect(g.hasEdge('a', 'b', 1)).toBe(true);
      expect(g.edgesBetween('a', 'b')).toEqual([
        { parentPosition: 0, role: 'first' },
        { parentPosition: 1, role: 'second' },
      ]);
    });

    it('edges() returns all edges', () => {
      g.addEdge('a', 'b', 0);
      g.addEdge('b', 'c', 0);
      const all = g.edges();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual({ source: 'a', target: 'b', parentPosition: 0 });
      expect(all).toContainEqual({ source: 'b', target: 'c', parentPosition: 0 });
    });

    it('inEdges returns incoming edges', () => {
      g.addEdge('a', 'c', 0);
      g.addEdge('b', 'c', 1);
      const incoming = g.inEdges('c');
      expect(incoming).toHaveLength(2);
      expect(incoming).toContainEqual({ source: 'a', target: 'c', parentPosition: 0 });
      expect(incoming).toContainEqual({ source: 'b', target: 'c', parentPosition: 1 });
    });

    it('outEdges returns outgoing edges', () => {
      g.addEdge('a', 'b', 0);
      g.addEdge('a', 'c', 1);
      const outgoing = g.outEdges('a');
      expect(outgoing).toHaveLength(2);
      expect(outgoing).toContainEqual({ source: 'a', target: 'b', parentPosition: 0 });
      expect(outgoing).toContainEqual({ source: 'a', target: 'c', parentPosition: 1 });
    });

    it('removeEdge removes specific edge', () => {
      g.addEdge('a', 'b', 0);
      g.addEdge('a', 'b', 1);
      g.removeEdge('a', 'b', 0);
      expect(g.hasEdge('a', 'b', 0)).toBe(false);
      expect(g.hasEdge('a', 'b', 1)).toBe(true);
      expect(g.hasEdge('a', 'b')).toBe(true);
    });

    it('removeEdge cleans up empty maps', () => {
      g.addEdge('a', 'b', 0);
      g.removeEdge('a', 'b', 0);
      expect(g.hasEdge('a', 'b')).toBe(false);
    });

    it('removeAllEdgesBetween removes all positions', () => {
      g.addEdge('a', 'b', 0);
      g.addEdge('a', 'b', 1);
      g.addEdge('a', 'b', 2);
      g.removeAllEdgesBetween('a', 'b');
      expect(g.hasEdge('a', 'b')).toBe(false);
      expect(g.edges()).toHaveLength(0);
    });

    it('removeNode cascades edge cleanup', () => {
      g.addEdge('a', 'b', 0);
      g.addEdge('b', 'c', 0);
      g.addEdge('a', 'c', 1);
      g.removeNode('b');
      expect(g.hasEdge('a', 'b')).toBe(false);
      expect(g.hasEdge('b', 'c')).toBe(false);
      expect(g.hasEdge('a', 'c', 1)).toBe(true);
      expect(g.edges()).toHaveLength(1);
    });

    it('throws when adding edge to nonexistent node', () => {
      expect(() => g.addEdge('a', 'z', 0)).toThrow('does not exist');
      expect(() => g.addEdge('z', 'a', 0)).toThrow('does not exist');
    });

    it('throws when removing nonexistent edge', () => {
      expect(() => g.removeEdge('a', 'b', 0)).toThrow('does not exist');
    });

    it('edgesBetween returns empty array for no edges', () => {
      expect(g.edgesBetween('a', 'b')).toEqual([]);
    });

    it('addEdge stores attributes by copy', () => {
      const attrs = { weight: 1 };
      g.addEdge('a', 'b', 0, attrs);
      attrs.weight = 999;
      expect(g.edgesBetween('a', 'b')[0].weight).toBe(1);
    });
  });

  // ── Traversal ──────────────────────────────────────────────────

  describe('traversal', () => {
    beforeEach(() => {
      // Diamond: a → b, a → c, b → d, c → d
      g.addNode('a');
      g.addNode('b');
      g.addNode('c');
      g.addNode('d');
      g.addEdge('a', 'b', 0);
      g.addEdge('a', 'c', 1);
      g.addEdge('b', 'd', 0);
      g.addEdge('c', 'd', 1);
    });

    it('predecessors returns unique source ids', () => {
      expect(g.predecessors('d').sort()).toEqual(['b', 'c']);
      expect(g.predecessors('a')).toEqual([]);
    });

    it('successors returns unique target ids', () => {
      expect(g.successors('a').sort()).toEqual(['b', 'c']);
      expect(g.successors('d')).toEqual([]);
    });

    it('inDegree counts all incoming edges', () => {
      expect(g.inDegree('d')).toBe(2);
      expect(g.inDegree('a')).toBe(0);
    });

    it('outDegree counts all outgoing edges', () => {
      expect(g.outDegree('a')).toBe(2);
      expect(g.outDegree('d')).toBe(0);
    });

    it('multi-edges counted separately in degree', () => {
      g.addEdge('b', 'd', 2); // additional edge
      expect(g.inDegree('d')).toBe(3);
      // predecessors still unique
      expect(g.predecessors('d').sort()).toEqual(['b', 'c']);
    });

    it('throws for nonexistent node', () => {
      expect(() => g.predecessors('z')).toThrow('does not exist');
      expect(() => g.successors('z')).toThrow('does not exist');
    });
  });

  // ── Algorithms ─────────────────────────────────────────────────

  describe('topologicalSort', () => {
    it('sorts a simple chain', () => {
      g.addNode(1);
      g.addNode(2);
      g.addNode(3);
      g.addEdge(1, 2, 0);
      g.addEdge(2, 3, 0);
      expect(g.topologicalSort()).toEqual([1, 2, 3]);
    });

    it('sorts a diamond DAG', () => {
      g.addNode('a');
      g.addNode('b');
      g.addNode('c');
      g.addNode('d');
      g.addEdge('a', 'b', 0);
      g.addEdge('a', 'c', 1);
      g.addEdge('b', 'd', 0);
      g.addEdge('c', 'd', 1);
      const sorted = g.topologicalSort();
      // a must come before b,c; b,c must come before d
      expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
      expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('c'));
      expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'));
      expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'));
    });

    it('handles disconnected nodes', () => {
      g.addNode('x');
      g.addNode('y');
      const sorted = g.topologicalSort();
      expect(sorted).toHaveLength(2);
      expect(sorted).toContain('x');
      expect(sorted).toContain('y');
    });

    it('throws on cycle', () => {
      g.addNode('a');
      g.addNode('b');
      g.addEdge('a', 'b', 0);
      g.addEdge('b', 'a', 0);
      expect(() => g.topologicalSort()).toThrow('cycle');
    });

    it('throws on self-loop', () => {
      g.addNode('a');
      g.addEdge('a', 'a', 0);
      expect(() => g.topologicalSort()).toThrow('cycle');
    });

    it('detects cycle in larger graph', () => {
      g.addNode('a');
      g.addNode('b');
      g.addNode('c');
      g.addEdge('a', 'b', 0);
      g.addEdge('b', 'c', 0);
      g.addEdge('c', 'a', 0);
      expect(() => g.topologicalSort()).toThrow('cycle');
    });
  });

  describe('reachableNodes', () => {
    beforeEach(() => {
      //  1 → 2 → 4
      //  1 → 3 → 4 → 5
      //  6 (disconnected)
      g.addNode(1);
      g.addNode(2);
      g.addNode(3);
      g.addNode(4);
      g.addNode(5);
      g.addNode(6);
      g.addEdge(1, 2, 0);
      g.addEdge(1, 3, 1);
      g.addEdge(2, 4, 0);
      g.addEdge(3, 4, 1);
      g.addEdge(4, 5, 0);
    });

    it('downstream from root reaches all connected', () => {
      const reached = g.reachableNodes([1], 'downstream');
      expect(reached).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it('upstream from leaf reaches all connected', () => {
      const reached = g.reachableNodes([5], 'upstream');
      expect(reached).toEqual(new Set([5, 4, 2, 3, 1]));
    });

    it('downstream from mid-node', () => {
      const reached = g.reachableNodes([2], 'downstream');
      expect(reached).toEqual(new Set([2, 4, 5]));
    });

    it('upstream from mid-node', () => {
      const reached = g.reachableNodes([4], 'upstream');
      expect(reached).toEqual(new Set([4, 2, 3, 1]));
    });

    it('disconnected node not included', () => {
      const reached = g.reachableNodes([1], 'downstream');
      expect(reached.has(6)).toBe(false);
    });

    it('multiple start nodes', () => {
      const reached = g.reachableNodes([2, 3], 'downstream');
      expect(reached).toEqual(new Set([2, 3, 4, 5]));
    });

    it('single disconnected start', () => {
      expect(g.reachableNodes([6], 'downstream')).toEqual(new Set([6]));
      expect(g.reachableNodes([6], 'upstream')).toEqual(new Set([6]));
    });
  });

  // ── copy + relabelNodes ────────────────────────────────────────

  describe('copy', () => {
    it('produces an independent clone', () => {
      g.addNode('a', { v: 1 });
      g.addNode('b', { v: 2 });
      g.addEdge('a', 'b', 0, { w: 10 });
      g.graph.name = 'test';

      const clone = g.copy();

      // Same structure
      expect(clone.nodeCount).toBe(2);
      expect(clone.hasEdge('a', 'b', 0)).toBe(true);
      expect(clone.getNode('a')).toEqual({ v: 1 });
      expect(clone.graph.name).toBe('test');

      // Modifications don't affect original
      clone.setNodeAttr('a', 'v', 999);
      expect(g.getNode('a').v).toBe(1);

      clone.graph.name = 'changed';
      expect(g.graph.name).toBe('test');
    });

    it('deep clones nested attributes', () => {
      g.addNode('a', { nested: { deep: true } });
      const clone = g.copy();
      clone.getNode('a').nested.deep = false;
      expect(g.getNode('a').nested.deep).toBe(true);
    });
  });

  describe('relabelNodes', () => {
    it('renames nodes and updates edges', () => {
      g.addNode('a');
      g.addNode('b');
      g.addEdge('a', 'b', 0);

      g.relabelNodes({ a: 'x', b: 'y' });

      expect(g.hasNode('x')).toBe(true);
      expect(g.hasNode('y')).toBe(true);
      expect(g.hasNode('a')).toBe(false);
      expect(g.hasEdge('x', 'y', 0)).toBe(true);
    });

    it('handles partial mapping (only some nodes renamed)', () => {
      g.addNode('a');
      g.addNode('b');
      g.addNode('c');
      g.addEdge('a', 'b', 0);
      g.addEdge('b', 'c', 0);

      g.relabelNodes({ a: 'x' }); // only rename 'a'

      expect(g.hasNode('x')).toBe(true);
      expect(g.hasNode('b')).toBe(true);
      expect(g.hasNode('c')).toBe(true);
      expect(g.hasEdge('x', 'b', 0)).toBe(true);
      expect(g.hasEdge('b', 'c', 0)).toBe(true);
    });

    it('preserves node attributes through relabel', () => {
      g.addNode('a', { type: 'input' });
      g.relabelNodes({ a: 'z' });
      expect(g.getNode('z')).toEqual({ type: 'input' });
    });

    it('preserves edge attributes through relabel', () => {
      g.addNode('a');
      g.addNode('b');
      g.addEdge('a', 'b', 0, { weight: 5 });
      g.relabelNodes({ a: 'x' });
      expect(g.edgesBetween('x', 'b')).toEqual([{ parentPosition: 0, weight: 5 }]);
    });

    it('works with numeric ids', () => {
      g.addNode(1);
      g.addNode(2);
      g.addEdge(1, 2, 0);
      g.relabelNodes({ 1: 10, 2: 20 });
      expect(g.hasNode(10)).toBe(true);
      expect(g.hasNode(20)).toBe(true);
      expect(g.hasEdge(10, 20, 0)).toBe(true);
    });
  });

  // ── topologicalSortSubset ──────────────────────────────────────

  describe('topologicalSortSubset', () => {
    it('sorts a subset of a larger graph', () => {
      // 1 → 2 → 3 → 4, also 1 → 5
      g.addNode(1); g.addNode(2); g.addNode(3); g.addNode(4); g.addNode(5);
      g.addEdge(1, 2, 0); g.addEdge(2, 3, 0); g.addEdge(3, 4, 0); g.addEdge(1, 5, 0);

      const sorted = g.topologicalSortSubset([1, 2, 3]);
      expect(sorted).toEqual([1, 2, 3]);
    });

    it('ignores edges to nodes outside subset', () => {
      // a → b → c, b → d
      g.addNode('a'); g.addNode('b'); g.addNode('c'); g.addNode('d');
      g.addEdge('a', 'b', 0); g.addEdge('b', 'c', 0); g.addEdge('b', 'd', 0);

      const sorted = g.topologicalSortSubset(['a', 'b', 'd']);
      expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
      expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'));
      expect(sorted).not.toContain('c');
    });

    it('handles disconnected subset nodes', () => {
      g.addNode(1); g.addNode(2); g.addNode(3);
      g.addEdge(1, 2, 0);
      const sorted = g.topologicalSortSubset([1, 3]);
      expect(sorted).toHaveLength(2);
      expect(sorted).toContain(1);
      expect(sorted).toContain(3);
    });

    it('throws on cycle within subset', () => {
      g.addNode('a'); g.addNode('b'); g.addNode('c');
      g.addEdge('a', 'b', 0); g.addEdge('b', 'c', 0); g.addEdge('c', 'a', 0);
      expect(() => g.topologicalSortSubset(['a', 'b', 'c'])).toThrow('cycle');
    });

    it('cycle in full graph but not in subset is fine', () => {
      g.addNode('a'); g.addNode('b'); g.addNode('c');
      g.addEdge('a', 'b', 0); g.addEdge('b', 'c', 0); g.addEdge('c', 'a', 0);
      // Subset [a, b] has no cycle (c→a edge is excluded since c not in subset)
      expect(g.topologicalSortSubset(['a', 'b'])).toEqual(['a', 'b']);
    });
  });

  // ── isDAG ─────────────────────────────────────────────────────

  describe('isDAG', () => {
    it('returns true for a DAG', () => {
      g.addNode(1); g.addNode(2); g.addNode(3);
      g.addEdge(1, 2, 0); g.addEdge(2, 3, 0);
      expect(g.isDAG()).toBe(true);
    });

    it('returns true for empty graph', () => {
      expect(g.isDAG()).toBe(true);
    });

    it('returns false for graph with cycle', () => {
      g.addNode('a'); g.addNode('b');
      g.addEdge('a', 'b', 0); g.addEdge('b', 'a', 0);
      expect(g.isDAG()).toBe(false);
    });

    it('returns false for self-loop', () => {
      g.addNode('a');
      g.addEdge('a', 'a', 0);
      expect(g.isDAG()).toBe(false);
    });
  });

  // ── Graph metadata ─────────────────────────────────────────────

  describe('graph metadata', () => {
    it('stores and retrieves graph-level metadata', () => {
      g.graph.name = 'my_function';
      g.graph.input_node_ids = [1, 2];
      g.graph.output_node_ids = [5];
      expect(g.graph.name).toBe('my_function');
      expect(g.graph.input_node_ids).toEqual([1, 2]);
    });
  });
});
