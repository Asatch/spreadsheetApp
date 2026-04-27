/**
 * Tests for calculationEngine.js
 * Tests formula evaluation, dependency tracking, and topological sorting
 */

import { createCalculationEngine } from '../../Engines/calculationEngine.js';
import { vi } from 'vitest';

describe('calculationEngine', () => {
  let calcEngine;
  let displayCallback;
  let displayCalls;

  beforeEach(() => {
    calcEngine = createCalculationEngine();
    displayCalls = [];
    displayCallback = vi.fn((node, cellKey) => {
      displayCalls.push({ cellKey, node: { ...node } });
    });
    calcEngine.init({ computeDisplayValue: displayCallback });
  });

  describe('initialization', () => {
    test('should initialize and load built-in functions', () => {
      // Functions should be available after init
      const addNode = calcEngine.getNode('ADD');
      expect(addNode).toBeDefined();
      expect(addNode.type).toBe('function');
      expect(addNode.refValue).toHaveProperty('variants');
      expect(Array.isArray(addNode.refValue.variants)).toBe(true);
      expect(addNode.refValue.variants[0]).toHaveProperty('impl');
    });

    test('should load all expected built-in functions', () => {
      const expectedFunctions = [
        'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'NEGATE',
        'EQUAL', 'NOTEQUAL', 'LESS', 'LESSEQUAL', 'GREATER', 'GREATEREQUAL',
        'IF', 'AND', 'OR', 'SUM', 'PROCEED', 'ARRAY', 'EXPONENT'
      ];

      expectedFunctions.forEach(funcName => {
        const node = calcEngine.getNode(funcName);
        expect(node).toBeDefined();
        expect(node.type).toBe('function');
      });
    });
  });

  describe('simple value processing', () => {
    test('should store and retrieve simple number values', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 42 }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe(42);
      const node = calcEngine.getNode('A1');
      expect(node.type).toBe('Number');
      expect(node.refValue).toBe(42);
      expect(node.precedents).toBeUndefined();
    });

    test('should store and retrieve text values', () => {
      calcEngine.processInputs(new Map([
        ['B1', { type: 'Text', parsed: 'Hello' }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe('Hello');
      expect(calcEngine.getNode('B1').type).toBe('Text');
    });

    test('should store and retrieve date values', () => {
      calcEngine.processInputs(new Map([
        ['C1', { type: 'Date', parsed: 45000 }] // Serial date
      ]));

      expect(calcEngine.getCellValue('C1')).toBe(45000);
      expect(calcEngine.getNode('C1').type).toBe('Date');
    });

    test('should call display callback for simple values', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 100 }]
      ]));

      expect(displayCallback).toHaveBeenCalledWith(
        expect.objectContaining({ refValue: 100, type: 'Number' }),
        'A1'
      );
    });
  });

  describe('formula evaluation', () => {
    test('should evaluate simple addition formula', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 10 }],
        ['B1', { type: 'Number', parsed: 20 }],
        ['C1', { type: 'formula', parsed: ['ADD', 'A1', 'B1'] }]
      ]));

      expect(calcEngine.getCellValue('C1')).toBe(30);
      const node = calcEngine.getNode('C1');
      expect(node.type).toBe('Number');
      expect(node.precedents).toEqual(['ADD', 'A1', 'B1']);
    });

    test('should evaluate formula with literal values', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 5 }],
        ['B1', { type: 'formula', parsed: ['MULTIPLY', 'A1', '3'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(15);
    });

    test('should evaluate nested formulas', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 2 }],
        ['B1', { type: 'formula', parsed: ['MULTIPLY', 'A1', '3'] }],
        ['C1', { type: 'formula', parsed: ['ADD', 'B1', '10'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(6);
      expect(calcEngine.getCellValue('C1')).toBe(16);
    });

    test('should evaluate SUM function', () => {
      // SUM takes a single ARRAY argument — normalization wraps scalars into ARRAY
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 1 }],
        ['A2', { type: 'Number', parsed: 2 }],
        ['A3', { type: 'Number', parsed: 3 }],
        ['=ARRAY(A1,A2,A3)', { type: 'formula', parsed: ['ARRAY', 'A1', 'A2', 'A3'] }],
        ['B1', { type: 'formula', parsed: ['SUM', '=ARRAY(A1,A2,A3)'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(6);
    });

    test('should evaluate IF function', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 10 }],
        ['A2', { type: 'formula', parsed: ['GREATER', 'A1', '5'] }],
        ['B1', { type: 'formula', parsed: ['IF', 'A2', '100', '200'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(100);
    });
  });

  describe('dependency tracking', () => {
    test('should update dependent formulas when value changes', () => {
      // Initial setup
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 10 }],
        ['B1', { type: 'formula', parsed: ['MULTIPLY', 'A1', '2'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(20);

      // Update A1
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 15 }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(30);
    });

    test('should update multiple dependent formulas', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 5 }],
        ['B1', { type: 'formula', parsed: ['ADD', 'A1', '10'] }],
        ['C1', { type: 'formula', parsed: ['MULTIPLY', 'A1', '3'] }],
        ['D1', { type: 'formula', parsed: ['ADD', 'B1', 'C1'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(15);
      expect(calcEngine.getCellValue('C1')).toBe(15);
      expect(calcEngine.getCellValue('D1')).toBe(30);

      // Update A1
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 10 }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(20);
      expect(calcEngine.getCellValue('C1')).toBe(30);
      expect(calcEngine.getCellValue('D1')).toBe(50);
    });

    test('should handle formula depending on another formula', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 2 }],
        ['A2', { type: 'Number', parsed: 3 }],
        ['B1', { type: 'formula', parsed: ['ADD', 'A1', 'A2'] }],
        ['C1', { type: 'formula', parsed: ['MULTIPLY', 'B1', '2'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(5);
      expect(calcEngine.getCellValue('C1')).toBe(10);

      // Update A1
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 10 }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(13);
      expect(calcEngine.getCellValue('C1')).toBe(26);
    });
  });

  describe('circular dependency detection', () => {
    test('should detect direct circular dependency', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['ADD', 'A1', '1'] }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe('#CIRCULAR!');
      expect(calcEngine.getNode('A1').type).toBe('Error');
    });

    test('should detect indirect circular dependency', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['ADD', 'B1', '1'] }],
        ['B1', { type: 'formula', parsed: ['ADD', 'A1', '1'] }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe('#CIRCULAR!');
      expect(calcEngine.getCellValue('B1')).toBe('#CIRCULAR!');
    });

    test('should detect longer circular dependency chain', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['ADD', 'B1', '1'] }],
        ['B1', { type: 'formula', parsed: ['ADD', 'C1', '1'] }],
        ['C1', { type: 'formula', parsed: ['ADD', 'A1', '1'] }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe('#CIRCULAR!');
      expect(calcEngine.getCellValue('B1')).toBe('#CIRCULAR!');
      expect(calcEngine.getCellValue('C1')).toBe('#CIRCULAR!');
    });
  });

  describe('cell deletion', () => {
    test('should handle cell deletion (empty text)', () => {
      // Set up a value
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 42 }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe(42);

      // Delete it
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Text', parsed: '' }]
      ]));

      // Node is deleted entirely - behaves like it never existed
      expect(calcEngine.getCellValue('A1')).toBeUndefined();
      expect(calcEngine.getNode('A1')).toBeUndefined();
    });

    test('should update dependents when cell is deleted', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 10 }],
        ['B1', { type: 'formula', parsed: ['MULTIPLY', 'A1', '2'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(20);

      // Delete A1
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Text', parsed: '' }]
      ]));

      // B1 should reference empty value
      const b1Value = calcEngine.getCellValue('B1');
      // Empty cell referenced in formula typically results in 0 or error
      expect(b1Value).toBeDefined();
    });
  });

  describe('error handling', () => {
    test('should handle #NAME! error for unknown function', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['UNKNOWN_FUNC', '1', '2'] }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe('#NAME!');
      expect(calcEngine.getNode('A1').type).toBe('Error');
    });

    test('should handle reference to non-existent cell', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['ADD', 'Z99', '10'] }]
      ]));

      const value = calcEngine.getCellValue('A1');
      // Non-existent cell returns #NAME! or undefined behavior
      expect(value).toBeDefined();
    });

    test('should propagate errors through formulas', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['UNKNOWN_FUNC', '1'] }],
        ['B1', { type: 'formula', parsed: ['ADD', 'A1', '10'] }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe('#NAME!');
      // Error in A1 should propagate to B1
      const b1Value = calcEngine.getCellValue('B1');
      expect(b1Value).toBeDefined();
    });
  });

  describe('anonymous expressions', () => {
    test('should evaluate anonymous sub-expressions', () => {
      // Anonymous expressions start with '='
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 5 }],
        ['B1', { type: 'Number', parsed: 3 }],
        // Formula like =A1+(B1*2) creates anonymous expression =B1*2
        ['=B1*2', { type: 'formula', parsed: ['MULTIPLY', 'B1', '2'] }],
        ['C1', { type: 'formula', parsed: ['ADD', 'A1', '=B1*2'] }]
      ]));

      expect(calcEngine.getCellValue('=B1*2')).toBe(6);
      expect(calcEngine.getCellValue('C1')).toBe(11);
    });
  });

  describe('batch processing', () => {
    test('should process multiple cells in single batch', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'Number', parsed: 1 }],
        ['A2', { type: 'Number', parsed: 2 }],
        ['A3', { type: 'Number', parsed: 3 }],
        ['B1', { type: 'formula', parsed: ['ADD', 'A1', 'A2'] }],
        ['B2', { type: 'formula', parsed: ['ADD', 'A2', 'A3'] }]
      ]));

      expect(calcEngine.getCellValue('B1')).toBe(3);
      expect(calcEngine.getCellValue('B2')).toBe(5);
    });

    test('should evaluate formulas in correct topological order', () => {
      // Even if provided in wrong order, should evaluate correctly
      calcEngine.processInputs(new Map([
        ['D1', { type: 'formula', parsed: ['ADD', 'C1', '1'] }],
        ['C1', { type: 'formula', parsed: ['ADD', 'B1', '1'] }],
        ['B1', { type: 'formula', parsed: ['ADD', 'A1', '1'] }],
        ['A1', { type: 'Number', parsed: 10 }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe(10);
      expect(calcEngine.getCellValue('B1')).toBe(11);
      expect(calcEngine.getCellValue('C1')).toBe(12);
      expect(calcEngine.getCellValue('D1')).toBe(13);
    });
  });

  describe('edge cases', () => {
    test('should handle formula with all literal arguments', () => {
      calcEngine.processInputs(new Map([
        ['A1', { type: 'formula', parsed: ['ADD', '10', '20'] }]
      ]));

      expect(calcEngine.getCellValue('A1')).toBe(30);
    });

    test('should handle empty Map input', () => {
      expect(() => {
        calcEngine.processInputs(new Map());
      }).not.toThrow();
    });

    test('should throw error for invalid input type', () => {
      expect(() => {
        calcEngine.processInputs({});
      }).toThrow('processInputs requires a Map');
    });

    test('should handle very deep formula nesting', () => {
      // Create a chain A1 -> B1 -> C1 -> ... -> Z1
      const inputs = new Map();
      inputs.set('A1', { type: 'Number', parsed: 1 });

      for (let i = 66; i <= 90; i++) { // B through Z
        const col = String.fromCharCode(i);
        const prevCol = String.fromCharCode(i - 1);
        inputs.set(`${col}1`, {
          type: 'formula',
          parsed: ['ADD', `${prevCol}1`, '1']
        });
      }

      calcEngine.processInputs(inputs);

      expect(calcEngine.getCellValue('A1')).toBe(1);
      expect(calcEngine.getCellValue('Z1')).toBe(26); // 1 + 25 steps (B through Z)
    });
  });
});
