import { describe, it, expect } from 'vitest';
import {
  getOrderedParentIds,
  subsetGraph,
  eliminateProceedNodes,
  renumberNodes,
} from '../../transpiler/dagOperations.js';
import { MultiDiGraph } from '../../utils/graphModel.js';

describe('dagOperations', () => {
  describe('getOrderedParentIds', () => {
    it('returns parent IDs in parent_position order', () => {
      const G = new MultiDiGraph();
      G.addNode('a', {});
      G.addNode('b', {});
      G.addNode('c', {});
      G.addEdge('b', 'c', 1);
      G.addEdge('a', 'c', 0);

      const parents = getOrderedParentIds(G, 'c');
      expect(parents).toEqual(['a', 'b']);
    });

    it('returns empty array for source nodes', () => {
      const G = new MultiDiGraph();
      G.addNode('a', {});
      expect(getOrderedParentIds(G, 'a')).toEqual([]);
    });
  });

  describe('subsetGraph', () => {
    it('keeps only nodes upstream of specified outputs', () => {
      // Build a valid graph with disconnected nodes
      const G = new MultiDiGraph();
      G.addNode(1, { node_type: 'input', data_type: 'Number', input_name: 'X', input_order: 0 });
      G.addNode(2, { node_type: 'function', data_type: 'Number', function_name: 'ADD', output_name: 'R', output_order: 0 });
      G.addNode(3, { node_type: 'constant', data_type: 'Number', value: '99' });
      G.addEdge(1, 2, 0);
      G.addEdge(3, 2, 1);
      G.graph.input_node_ids = [1];
      G.graph.output_node_ids = [2];
      G.graph.max_node_id = 3;
      G.graph.name = 'TEST';

      // Add a disconnected branch
      G.addNode(10, { node_type: 'constant', data_type: 'Number', value: '0' });
      G.addNode(11, { node_type: 'function', data_type: 'Number', function_name: 'SUB' });
      G.addEdge(10, 11, 0);

      const subset = subsetGraph(G, [2]);
      expect(subset.hasNode(1)).toBe(true);
      expect(subset.hasNode(2)).toBe(true);
      expect(subset.hasNode(3)).toBe(true);
      expect(subset.hasNode(10)).toBe(false);
      expect(subset.hasNode(11)).toBe(false);
    });
  });

  describe('eliminateProceedNodes', () => {
    it('removes PROCEED nodes and reconnects edges', () => {
      const G = new MultiDiGraph();
      // input → PROCEED → ADD
      G.addNode(1, { node_type: 'input', data_type: 'Number', input_name: 'X', input_order: 0 });
      G.addNode(2, { node_type: 'function', data_type: 'Number', function_name: 'PROCEED' });
      G.addNode(3, { node_type: 'constant', data_type: 'Number', value: '5' });
      G.addNode(4, { node_type: 'function', data_type: 'Number', function_name: 'ADD', output_name: 'R', output_order: 0 });
      G.addEdge(1, 2, 0);
      G.addEdge(2, 4, 0);  // PROCEED feeds into position 0 of ADD
      G.addEdge(3, 4, 1);  // constant feeds into position 1 of ADD
      G.graph.input_node_ids = [1];
      G.graph.output_node_ids = [4];
      G.graph.max_node_id = 4;
      G.graph.name = 'TEST';

      eliminateProceedNodes(G);

      expect(G.hasNode(2)).toBe(false);
      expect(G.hasNode(1)).toBe(true);
      expect(G.hasNode(4)).toBe(true);
      // input should now connect directly to ADD
      expect(G.hasEdge(1, 4)).toBe(true);
    });

    it('handles chain of PROCEED nodes', () => {
      const G = new MultiDiGraph();
      G.addNode(1, { node_type: 'input', data_type: 'Number', input_name: 'X', input_order: 0 });
      G.addNode(2, { node_type: 'function', data_type: 'Number', function_name: 'PROCEED' });
      G.addNode(3, { node_type: 'function', data_type: 'Number', function_name: 'PROCEED' });
      G.addNode(4, { node_type: 'constant', data_type: 'Number', value: '5' });
      G.addNode(5, { node_type: 'function', data_type: 'Number', function_name: 'ADD', output_name: 'R', output_order: 0 });
      G.addEdge(1, 2, 0);
      G.addEdge(2, 3, 0);
      G.addEdge(3, 5, 0);
      G.addEdge(4, 5, 1);
      G.graph.input_node_ids = [1];
      G.graph.output_node_ids = [5];
      G.graph.max_node_id = 5;
      G.graph.name = 'TEST';

      eliminateProceedNodes(G);

      expect(G.hasNode(2)).toBe(false);
      expect(G.hasNode(3)).toBe(false);
      expect(G.hasEdge(1, 5)).toBe(true);
    });
  });

  describe('renumberNodes', () => {
    it('renumbers nodes sequentially starting from 1', () => {
      const G = new MultiDiGraph();
      G.addNode(10, { node_type: 'input', data_type: 'Number', input_name: 'X', input_order: 0 });
      G.addNode(20, { node_type: 'function', data_type: 'Number', function_name: 'ADD', output_name: 'R', output_order: 0 });
      G.addEdge(10, 20, 0);
      G.graph.input_node_ids = [10];
      G.graph.output_node_ids = [20];
      G.graph.max_node_id = 20;
      G.graph.name = 'TEST';

      renumberNodes(G);

      const ids = G.nodeIds().map(Number).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2]);
      expect(G.graph.max_node_id).toBe(2);
    });
  });
});
