import { describe, it, expect } from 'vitest';
import { validDataType, isValidGraph } from '../../transpiler/validation.js';
import { MultiDiGraph } from '../../utils/graphModel.js';

describe('validation', () => {
  describe('validDataType', () => {
    it('accepts base types', () => {
      expect(validDataType('Text')).toBe(true);
      expect(validDataType('Number')).toBe(true);
      expect(validDataType('Boolean')).toBe(true);
      expect(validDataType('Date')).toBe(true);
      expect(validDataType('Datetime')).toBe(true);
    });

    it('rejects Any', () => {
      expect(validDataType('Any')).toBe(false);
    });

    it('accepts ARRAY wrapped types', () => {
      expect(validDataType('ARRAY[Number]')).toBe(true);
      expect(validDataType('ARRAY[Text]')).toBe(true);
      expect(validDataType('ARRAY[Boolean]')).toBe(true);
    });

    it('rejects TABLE_COLUMN types', () => {
      expect(validDataType('TABLE_COLUMN[Number]')).toBe(false);
      expect(validDataType('TABLE_COLUMN[Text]')).toBe(false);
    });

    it('rejects Multiple wrapped types (removed)', () => {
      expect(validDataType('Multiple[Number]')).toBe(false);
      expect(validDataType('Multiple[ARRAY[Number]]')).toBe(false);
    });

    it('rejects invalid types', () => {
      expect(validDataType('Integer')).toBe(false);
      expect(validDataType('ARRAY[Integer]')).toBe(false);
      expect(validDataType('')).toBe(false);
      expect(validDataType('ARRAY[]')).toBe(false);
    });
  });

  describe('isValidGraph', () => {
    function buildSimpleGraph() {
      const G = new MultiDiGraph();
      G.addNode(1, { node_type: 'input', data_type: 'Number', input_name: 'X', input_order: 0 });
      G.addNode(2, { node_type: 'function', data_type: 'Number', function_name: 'ADD', output_name: 'RESULT', output_order: 0 });
      G.addEdge(1, 2, { parent_position: 0 });
      G.graph.input_node_ids = [1];
      G.graph.output_node_ids = [2];
      G.graph.max_node_id = 2;
      G.graph.name = 'TEST';
      return G;
    }

    it('accepts a valid simple graph', () => {
      const G = buildSimpleGraph();
      expect(isValidGraph(G, false)).toBe(true);
    });

    it('rejects graph with cycle', () => {
      const G = new MultiDiGraph();
      G.addNode(1, { node_type: 'function', data_type: 'Number', function_name: 'ADD' });
      G.addNode(2, { node_type: 'function', data_type: 'Number', function_name: 'ADD' });
      G.addEdge(1, 2, { parent_position: 0 });
      G.addEdge(2, 1, { parent_position: 0 });
      G.graph.input_node_ids = [];
      G.graph.output_node_ids = [];
      G.graph.max_node_id = 2;
      expect(isValidGraph(G, false)).toBe(false);
    });

    it('rejects graph with wrong max_node_id', () => {
      const G = buildSimpleGraph();
      G.graph.max_node_id = 999;
      expect(isValidGraph(G, false)).toBe(false);
    });

    it('rejects graph with mismatched input_node_ids', () => {
      const G = buildSimpleGraph();
      G.graph.input_node_ids = [999];
      expect(isValidGraph(G, false)).toBe(false);
    });

    it('rejects graph with mismatched output_node_ids', () => {
      const G = buildSimpleGraph();
      G.graph.output_node_ids = [999];
      expect(isValidGraph(G, false)).toBe(false);
    });

    it('rejects source node that is not input/constant', () => {
      const G = new MultiDiGraph();
      G.addNode(1, { node_type: 'function', data_type: 'Number', function_name: 'ADD', output_name: 'R', output_order: 0 });
      G.graph.input_node_ids = [];
      G.graph.output_node_ids = [1];
      G.graph.max_node_id = 1;
      expect(isValidGraph(G, false)).toBe(false);
    });
  });
});
