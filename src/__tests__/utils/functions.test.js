/**
 * Tests for Built-In Spreadsheet Functions
 *
 * Tests all function implementations including:
 * - Special functions (PROCEED, ARRAY, NEGATE)
 * - Arithmetic operators (ADD, SUBTRACT, MULTIPLY, DIVIDE, EXPONENT, LOG)
 * - Comparison operators (EQUAL, NOTEQUAL, LESS, GREATER, LESSEQUAL, GREATEREQUAL)
 * - Logical functions (IF, AND, OR)
 * - Aggregation functions (SUM)
 */

import { getBuiltInFunctions } from '../../utils/functions.js';
import { validateAndExecute } from '../../utils/functionValidation.js';

describe('Built-In Functions', () => {
  let functions;

  beforeAll(() => {
    functions = getBuiltInFunctions();
  });

  /**
   * Helper to call a function with validation (mimics calc engine behavior)
   * Args are passed directly as [{refValue, type}, ...]
   */
  function callFunc(funcDef, args) {
    return validateAndExecute(args, funcDef);
  }

  describe('getBuiltInFunctions', () => {
    it('should export all expected functions', () => {
      expect(functions).toHaveProperty('PROCEED');
      expect(functions).toHaveProperty('ARRAY');
      expect(functions).toHaveProperty('NEGATE');
      expect(functions).toHaveProperty('ADD');
      expect(functions).toHaveProperty('SUBTRACT');
      expect(functions).toHaveProperty('MULTIPLY');
      expect(functions).toHaveProperty('DIVIDE');
      expect(functions).toHaveProperty('EXPONENT');
      expect(functions).toHaveProperty('EQUAL');
      expect(functions).toHaveProperty('NOTEQUAL');
      expect(functions).toHaveProperty('LESS');
      expect(functions).toHaveProperty('GREATER');
      expect(functions).toHaveProperty('LESSEQUAL');
      expect(functions).toHaveProperty('GREATEREQUAL');
      expect(functions).toHaveProperty('IF');
      expect(functions).toHaveProperty('AND');
      expect(functions).toHaveProperty('OR');
      expect(functions).toHaveProperty('SUM');
    });

    it('should provide variants array or arrayConstructor for each function', () => {
      Object.values(functions).forEach(funcDef => {
        if (funcDef.arrayConstructor) {
          expect(funcDef).toHaveProperty('impl');
          expect(typeof funcDef.impl).toBe('function');
          return;
        }
        expect(funcDef).toHaveProperty('variants');
        expect(Array.isArray(funcDef.variants)).toBe(true);
        expect(funcDef.variants.length).toBeGreaterThan(0);
        funcDef.variants.forEach(variant => {
          expect(variant).toHaveProperty('impl');
          expect(typeof variant.impl).toBe('function');
          expect(variant).toHaveProperty('argTypes');
          expect(variant).toHaveProperty('returnType');
        });
      });
    });
  });

  describe('PROCEED', () => {
    it('should pass through a single value unchanged', () => {
      const result = callFunc(functions.PROCEED, [{ refValue: 42, type: 'Number' }]);
      expect(result).toEqual({ refValue: 42, type: 'Number' });
    });

    it('should pass through text values', () => {
      const result = callFunc(functions.PROCEED, [{ refValue: 'Hello', type: 'Text' }]);
      expect(result).toEqual({ refValue: 'Hello', type: 'Text' });
    });

    it('should pass through date values', () => {
      const result = callFunc(functions.PROCEED, [{ refValue: 45000, type: 'Date' }]);
      expect(result).toEqual({ refValue: 45000, type: 'Date' });
    });

    it('should return error if not exactly one argument', () => {
      const result = callFunc(functions.PROCEED, [
        { refValue: 42, type: 'Number' },
        { refValue: 43, type: 'Number' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('ARRAY', () => {
    it('should create a flat array from cell values', () => {
      const result = callFunc(functions.ARRAY, [
        { refValue: 1, type: 'Number' },
        { refValue: 2, type: 'Number' },
        { refValue: 3, type: 'Number' },
        { refValue: 4, type: 'Number' }
      ]);

      expect(result.type).toBe('ARRAY[Number]');
      expect(result.refValue).toEqual([1, 2, 3, 4]);
    });

    it('should create a single-cell array', () => {
      const result = callFunc(functions.ARRAY, [
        { refValue: 42, type: 'Number' }
      ]);

      expect(result.type).toBe('ARRAY[Number]');
      expect(result.refValue).toEqual([42]);
    });

    it('should return error if no arguments', () => {
      const result = callFunc(functions.ARRAY, []);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('NEGATE', () => {
    it('should negate positive numbers', () => {
      const result = callFunc(functions.NEGATE, [{ refValue: 42, type: 'Number' }]);
      expect(result).toEqual({ refValue: -42, type: 'Number' });
    });

    it('should negate negative numbers', () => {
      const result = callFunc(functions.NEGATE, [{ refValue: -42, type: 'Number' }]);
      expect(result).toEqual({ refValue: 42, type: 'Number' });
    });

    it('should negate zero', () => {
      const result = callFunc(functions.NEGATE, [{ refValue: 0, type: 'Number' }]);
      expect(result).toEqual({ refValue: -0, type: 'Number' });
    });

    it('should return error for non-numeric types', () => {
      const result = callFunc(functions.NEGATE, [{ refValue: 'text', type: 'Text' }]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });

    it('should propagate errors', () => {
      const result = callFunc(functions.NEGATE, [{ refValue: '#REF!', type: 'Error' }]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#REF!');
    });
  });

  describe('ADD', () => {
    it('should add two numbers', () => {
      const result = callFunc(functions.ADD, [
        { refValue: 5, type: 'Number' },
        { refValue: 3, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 8, type: 'Number' });
    });

    it('should add negative numbers', () => {
      const result = callFunc(functions.ADD, [
        { refValue: -5, type: 'Number' },
        { refValue: 3, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: -2, type: 'Number' });
    });

    it('should add date and integer number', () => {
      const result = callFunc(functions.ADD, [
        { refValue: 45000, type: 'Date' },
        { refValue: 7, type: 'Number' }
      ]);
      expect(result.refValue).toBe(45007);
      expect(result.type).toBe('Date');
    });

    it('should add number and date (commutative)', () => {
      const result = callFunc(functions.ADD, [
        { refValue: 7, type: 'Number' },
        { refValue: 45000, type: 'Date' }
      ]);
      expect(result.refValue).toBe(45007);
      expect(result.type).toBe('Date');
    });

    it('should add datetime and number', () => {
      const result = callFunc(functions.ADD, [
        { refValue: 45000.5, type: 'Datetime' },
        { refValue: 0.5, type: 'Number' }
      ]);
      expect(result.refValue).toBe(45001);
      expect(result.type).toBe('Datetime');
    });

    it('should truncate when adding fractional number to date', () => {
      // Date + fractional number is truncated to whole days
      const result = callFunc(functions.ADD, [
        { refValue: 45000, type: 'Date' },
        { refValue: 0.5, type: 'Number' }
      ]);
      expect(result.type).toBe('Date');
      expect(result.refValue).toBe(45000); // Truncated
    });

    it('should return type error for incompatible types', () => {
      const result = callFunc(functions.ADD, [
        { refValue: 5, type: 'Number' },
        { refValue: 'text', type: 'Text' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });

    it('should propagate errors', () => {
      const result = callFunc(functions.ADD, [
        { refValue: 5, type: 'Number' },
        { refValue: '#DIV/0!', type: 'Error' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#DIV/0!');
    });
  });

  describe('SUBTRACT', () => {
    it('should subtract two numbers', () => {
      const result = callFunc(functions.SUBTRACT, [
        { refValue: 10, type: 'Number' },
        { refValue: 3, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 7, type: 'Number' });
    });

    it('should subtract date - number', () => {
      const result = callFunc(functions.SUBTRACT, [
        { refValue: 45007, type: 'Date' },
        { refValue: 7, type: 'Number' }
      ]);
      expect(result.refValue).toBe(45000);
      expect(result.type).toBe('Date');
    });

    it('should subtract date - date to get difference', () => {
      const result = callFunc(functions.SUBTRACT, [
        { refValue: 45010, type: 'Date' },
        { refValue: 45000, type: 'Date' }
      ]);
      expect(result.refValue).toBe(10);
      expect(result.type).toBe('Number'); // Difference is a number
    });

    it('should truncate when subtracting fractional number from date', () => {
      // Date - fractional number is truncated to whole days
      const result = callFunc(functions.SUBTRACT, [
        { refValue: 45000, type: 'Date' },
        { refValue: 0.5, type: 'Number' }
      ]);
      expect(result.type).toBe('Date');
      expect(result.refValue).toBe(44999); // Truncated (45000 - 0.5 = 44999.5 -> 44999)
    });

    it('should subtract datetime - datetime', () => {
      const result = callFunc(functions.SUBTRACT, [
        { refValue: 45000.5, type: 'Datetime' },
        { refValue: 45000, type: 'Datetime' }
      ]);
      expect(result.refValue).toBe(0.5);
      expect(result.type).toBe('Number'); // Difference is a number
    });

    it('should return type error for incompatible types', () => {
      const result = callFunc(functions.SUBTRACT, [
        { refValue: 10, type: 'Number' },
        { refValue: 'text', type: 'Text' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('MULTIPLY', () => {
    it('should multiply two numbers', () => {
      const result = callFunc(functions.MULTIPLY, [
        { refValue: 6, type: 'Number' },
        { refValue: 7, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 42, type: 'Number' });
    });

    it('should handle multiplication by zero', () => {
      const result = callFunc(functions.MULTIPLY, [
        { refValue: 999, type: 'Number' },
        { refValue: 0, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 0, type: 'Number' });
    });

    it('should handle negative multiplication', () => {
      const result = callFunc(functions.MULTIPLY, [
        { refValue: -5, type: 'Number' },
        { refValue: 3, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: -15, type: 'Number' });
    });

    it('should return type error for non-numeric types', () => {
      const result = callFunc(functions.MULTIPLY, [
        { refValue: 5, type: 'Number' },
        { refValue: 'text', type: 'Text' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('DIVIDE', () => {
    it('should divide two numbers', () => {
      const result = callFunc(functions.DIVIDE, [
        { refValue: 10, type: 'Number' },
        { refValue: 2, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 5, type: 'Number' });
    });

    it('should handle division resulting in decimal', () => {
      const result = callFunc(functions.DIVIDE, [
        { refValue: 7, type: 'Number' },
        { refValue: 2, type: 'Number' }
      ]);
      expect(result.refValue).toBe(3.5);
      expect(result.type).toBe('Number');
    });

    it('should return Infinity with #DOMAIN! errorMeta when dividing by zero', () => {
      const result = callFunc(functions.DIVIDE, [
        { refValue: 10, type: 'Number' },
        { refValue: 0, type: 'Number' }
      ]);
      // Runtime error: type stays 'number', value is Infinity, errorMeta tracks the issue
      expect(result.type).toBe('Number');
      expect(result.refValue).toBe(Infinity);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#DOMAIN!')).toBe(true);
    });

    it('should handle zero divided by non-zero', () => {
      const result = callFunc(functions.DIVIDE, [
        { refValue: 0, type: 'Number' },
        { refValue: 5, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 0, type: 'Number' });
    });

    it('should return type error for non-numeric types', () => {
      const result = callFunc(functions.DIVIDE, [
        { refValue: 10, type: 'Number' },
        { refValue: 'text', type: 'Text' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('EXPONENT', () => {
    it('should raise number to power', () => {
      const result = callFunc(functions.EXPONENT, [
        { refValue: 2, type: 'Number' },
        { refValue: 8, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 256, type: 'Number' });
    });

    it('should handle fractional exponents (square root)', () => {
      const result = callFunc(functions.EXPONENT, [
        { refValue: 16, type: 'Number' },
        { refValue: 0.5, type: 'Number' }
      ]);
      expect(result.refValue).toBe(4);
      expect(result.type).toBe('Number');
    });

    it('should handle negative exponents', () => {
      const result = callFunc(functions.EXPONENT, [
        { refValue: 2, type: 'Number' },
        { refValue: -3, type: 'Number' }
      ]);
      expect(result.refValue).toBe(0.125);
      expect(result.type).toBe('Number');
    });

    it('should handle zero exponent', () => {
      const result = callFunc(functions.EXPONENT, [
        { refValue: 99, type: 'Number' },
        { refValue: 0, type: 'Number' }
      ]);
      expect(result).toEqual({ refValue: 1, type: 'Number' });
    });

    it('should return type error for non-numeric types', () => {
      const result = callFunc(functions.EXPONENT, [
        { refValue: 2, type: 'Number' },
        { refValue: 'text', type: 'Text' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('LN', () => {
    it('should calculate natural logarithm', () => {
      const result = callFunc(functions.LN, [
        { refValue: Math.E, type: 'Number' }
      ]);
      expect(result.refValue).toBeCloseTo(1);
      expect(result.type).toBe('Number');
    });

    it('should calculate ln(1) = 0', () => {
      const result = callFunc(functions.LN, [
        { refValue: 1, type: 'Number' }
      ]);
      expect(result.refValue).toBe(0);
    });

    it('should return -Infinity with #DOMAIN! errorMeta for zero', () => {
      const result = callFunc(functions.LN, [
        { refValue: 0, type: 'Number' }
      ]);
      expect(result.type).toBe('Number');
      expect(result.refValue).toBe(-Infinity);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#DOMAIN!')).toBe(true);
    });

    it('should return NaN with #DOMAIN! errorMeta for negative numbers', () => {
      const result = callFunc(functions.LN, [
        { refValue: -5, type: 'Number' }
      ]);
      expect(result.type).toBe('Number');
      expect(Number.isNaN(result.refValue)).toBe(true);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#DOMAIN!')).toBe(true);
    });

    it('should return #TYPE! error for wrong number of arguments', () => {
      const result = callFunc(functions.LN, [
        { refValue: 1, type: 'Number' },
        { refValue: 2, type: 'Number' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });
  });

  describe('EXP', () => {
    it('should calculate e^x', () => {
      const result = callFunc(functions.EXP, [
        { refValue: 1, type: 'Number' }
      ]);
      expect(result.refValue).toBeCloseTo(Math.E);
      expect(result.type).toBe('Number');
    });

    it('should return 1 for e^0', () => {
      const result = callFunc(functions.EXP, [
        { refValue: 0, type: 'Number' }
      ]);
      expect(result.refValue).toBe(1);
    });

    it('should handle negative exponents', () => {
      const result = callFunc(functions.EXP, [
        { refValue: -1, type: 'Number' }
      ]);
      expect(result.refValue).toBeCloseTo(1 / Math.E);
    });
  });

  describe('SIN', () => {
    it('should calculate sine of 0', () => {
      const result = callFunc(functions.SIN, [
        { refValue: 0, type: 'Number' }
      ]);
      expect(result.refValue).toBe(0);
    });

    it('should calculate sine of pi/2', () => {
      const result = callFunc(functions.SIN, [
        { refValue: Math.PI / 2, type: 'Number' }
      ]);
      expect(result.refValue).toBeCloseTo(1);
    });

    it('should calculate sine of pi', () => {
      const result = callFunc(functions.SIN, [
        { refValue: Math.PI, type: 'Number' }
      ]);
      expect(result.refValue).toBeCloseTo(0);
    });
  });

  describe('FLOOR', () => {
    it('should round down positive numbers', () => {
      const result = callFunc(functions.FLOOR, [
        { refValue: 3.7, type: 'Number' }
      ]);
      expect(result.refValue).toBe(3);
    });

    it('should round down negative numbers (toward negative infinity)', () => {
      const result = callFunc(functions.FLOOR, [
        { refValue: -3.2, type: 'Number' }
      ]);
      expect(result.refValue).toBe(-4);
    });

    it('should return integers unchanged', () => {
      const result = callFunc(functions.FLOOR, [
        { refValue: 5, type: 'Number' }
      ]);
      expect(result.refValue).toBe(5);
    });

    it('should handle zero', () => {
      const result = callFunc(functions.FLOOR, [
        { refValue: 0, type: 'Number' }
      ]);
      expect(result.refValue).toBe(0);
    });
  });

  describe('INDEX', () => {
    it('should access object value by position (1-indexed)', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: { DOUBLE: 20, HALF: 5 }, type: 'Object[Number, Number]' },
        { refValue: 1, type: 'Number' }
      ]);
      expect(result.refValue).toBe(20);
    });

    it('should access object value by name', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: { DOUBLE: 20, HALF: 5 }, type: 'Object[Number, Number]' },
        { refValue: 'HALF', type: 'Text' }
      ]);
      expect(result.refValue).toBe(5);
    });

    it('should be case-insensitive for name lookup', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: { DOUBLE: 20 }, type: 'Object[Number]' },
        { refValue: 'double', type: 'Text' }
      ]);
      expect(result.refValue).toBe(20);
    });

    it('should return #REF! for out-of-range position', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: { A: 1 }, type: 'Object[Number]' },
        { refValue: 5, type: 'Number' }
      ]);
      expect(Number.isNaN(result.refValue)).toBe(true);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#REF!')).toBe(true);
    });

    it('should return #REF! for unknown name', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: { A: 1 }, type: 'Object[Number]' },
        { refValue: 'NOPE', type: 'Text' }
      ]);
      expect(Number.isNaN(result.refValue)).toBe(true);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#REF!')).toBe(true);
    });

    it('should return #VALUE! for null input', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: null, type: 'Object[Number]' },
        { refValue: 1, type: 'Number' }
      ]);
      expect(Number.isNaN(result.refValue)).toBe(true);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#VALUE!')).toBe(true);
    });

    it('should access array value by position (1-indexed)', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: [10, 20, 30], type: 'ARRAY[Number]' },
        { refValue: 2, type: 'Number' }
      ]);
      expect(result.refValue).toBe(20);
    });

    it('should return #REF! for out-of-range array position', () => {
      const result = callFunc(functions.INDEX, [
        { refValue: [10, 20], type: 'ARRAY[Number]' },
        { refValue: 5, type: 'Number' }
      ]);
      expect(Number.isNaN(result.refValue)).toBe(true);
      expect(result.errorMeta).toBeDefined();
      expect(result.errorMeta.some(m => m.error === '#REF!')).toBe(true);
    });
  });

  describe('Comparison Operators', () => {
    describe('EQUAL', () => {
      it('should return true for equal numbers', () => {
        const result = callFunc(functions.EQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return false for unequal numbers', () => {
        const result = callFunc(functions.EQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 3, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });

      it('should compare dates', () => {
        const result = callFunc(functions.EQUAL, [
          { refValue: 45000, type: 'Date' },
          { refValue: 45000, type: 'Date' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return type error for mismatched types', () => {
        const result = callFunc(functions.EQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 45000, type: 'Date' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#TYPE!');
      });
    });

    describe('NOTEQUAL', () => {
      it('should return true for unequal numbers', () => {
        const result = callFunc(functions.NOTEQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 3, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return false for equal numbers', () => {
        const result = callFunc(functions.NOTEQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });
    });

    describe('LESS', () => {
      it('should return true when left < right', () => {
        const result = callFunc(functions.LESS, [
          { refValue: 3, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return false when left >= right', () => {
        const result = callFunc(functions.LESS, [
          { refValue: 5, type: 'Number' },
          { refValue: 3, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });
    });

    describe('GREATER', () => {
      it('should return true when left > right', () => {
        const result = callFunc(functions.GREATER, [
          { refValue: 5, type: 'Number' },
          { refValue: 3, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return false when left <= right', () => {
        const result = callFunc(functions.GREATER, [
          { refValue: 3, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });
    });

    describe('LESSEQUAL', () => {
      it('should return true when left <= right', () => {
        const result = callFunc(functions.LESSEQUAL, [
          { refValue: 3, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return true when equal', () => {
        const result = callFunc(functions.LESSEQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });
    });

    describe('GREATEREQUAL', () => {
      it('should return true when left >= right', () => {
        const result = callFunc(functions.GREATEREQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 3, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return true when equal', () => {
        const result = callFunc(functions.GREATEREQUAL, [
          { refValue: 5, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });
    });
  });

  describe('Logical Functions', () => {
    describe('IF', () => {
      it('should return true branch when condition is true', () => {
        const result = callFunc(functions.IF, [
          { refValue: true, type: 'Boolean' },
          { refValue: 'Yes', type: 'Text' },
          { refValue: 'No', type: 'Text' }
        ]);
        expect(result).toEqual({ refValue: 'Yes', type: 'Text' });
      });

      it('should return false branch when condition is false', () => {
        const result = callFunc(functions.IF, [
          { refValue: false, type: 'Boolean' },
          { refValue: 'Yes', type: 'Text' },
          { refValue: 'No', type: 'Text' }
        ]);
        expect(result).toEqual({ refValue: 'No', type: 'Text' });
      });

      it('should return error if condition is not a boolean', () => {
        const result = callFunc(functions.IF, [
          { refValue: 'text', type: 'Text' },
          { refValue: 'Yes', type: 'Text' },
          { refValue: 'No', type: 'Text' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#TYPE!');
      });

      it('should return error if condition is a number', () => {
        const result = callFunc(functions.IF, [
          { refValue: 5, type: 'Number' },
          { refValue: 'Yes', type: 'Text' },
          { refValue: 'No', type: 'Text' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#TYPE!');
      });

      it('should propagate errors from condition only', () => {
        const result = callFunc(functions.IF, [
          { refValue: '#REF!', type: 'Error' },
          { refValue: 'Yes', type: 'Text' },
          { refValue: 'No', type: 'Text' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#REF!');
      });

      it('should propagate structural errors from any branch (strict propagation)', () => {
        // Per architecture: structural errors (type: 'Error') have strict propagation
        // They cannot be short-circuited, even by IF
        const result = callFunc(functions.IF, [
          { refValue: true, type: 'Boolean' },
          { refValue: 'Yes', type: 'Text' },
          { refValue: '#REF!', type: 'Error' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#REF!');
      });
    });

    describe('AND', () => {
      it('should return true when all arguments are true', () => {
        const result = callFunc(functions.AND, [
          { refValue: [true, true, true], type: 'ARRAY[Boolean]' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return false when any argument is false', () => {
        const result = callFunc(functions.AND, [
          { refValue: [true, false, true], type: 'ARRAY[Boolean]' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });

      it('should return false when all arguments are false', () => {
        const result = callFunc(functions.AND, [
          { refValue: [false, false], type: 'ARRAY[Boolean]' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });

      it('should return error if argument is not an array of booleans', () => {
        const result = callFunc(functions.AND, [
          { refValue: 5, type: 'Number' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#TYPE!');
      });

      it('should return error if no arguments', () => {
        const result = callFunc(functions.AND, []);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#TYPE!');
      });
    });

    describe('OR', () => {
      it('should return true when any argument is true', () => {
        const result = callFunc(functions.OR, [
          { refValue: [false, true, false], type: 'ARRAY[Boolean]' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return false when all arguments are false', () => {
        const result = callFunc(functions.OR, [
          { refValue: [false, false, false], type: 'ARRAY[Boolean]' }
        ]);
        expect(result).toEqual({ refValue: false, type: 'Boolean' });
      });

      it('should return true when all arguments are true', () => {
        const result = callFunc(functions.OR, [
          { refValue: [true, true], type: 'ARRAY[Boolean]' }
        ]);
        expect(result).toEqual({ refValue: true, type: 'Boolean' });
      });

      it('should return error if argument is not an array of booleans', () => {
        const result = callFunc(functions.OR, [
          { refValue: 5, type: 'Number' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#TYPE!');
      });
    });

    describe('NOT', () => {
      it('should negate true to false', () => {
        const result = callFunc(functions.NOT, [
          { refValue: true, type: 'Boolean' }
        ]);
        expect(result.refValue).toBe(false);
        expect(result.type).toBe('Boolean');
      });

      it('should negate false to true', () => {
        const result = callFunc(functions.NOT, [
          { refValue: false, type: 'Boolean' }
        ]);
        expect(result.refValue).toBe(true);
      });

      it('should return NaN for non-boolean input', () => {
        const result = callFunc(functions.NOT, [
          { refValue: 1, type: 'Boolean' }
        ]);
        expect(Number.isNaN(result.refValue)).toBe(true);
      });
    });
  });

  describe('SUM', () => {
    it('should sum multiple numbers', () => {
      const result = callFunc(functions.SUM, [
        { refValue: [1, 2, 3], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 6, type: 'Number' });
    });

    it('should sum single number', () => {
      const result = callFunc(functions.SUM, [
        { refValue: [42], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 42, type: 'Number' });
    });

    it('should sum with negative numbers', () => {
      const result = callFunc(functions.SUM, [
        { refValue: [10, -5, 3], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 8, type: 'Number' });
    });

    it('should return error for empty args', () => {
      const result = callFunc(functions.SUM, []);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });

    it('should return type error if argument is not an array of numbers', () => {
      const result = callFunc(functions.SUM, [
        { refValue: 'text', type: 'Text' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#TYPE!');
    });

    it('should propagate errors', () => {
      const result = callFunc(functions.SUM, [
        { refValue: '#DIV/0!', type: 'Error' }
      ]);
      expect(result.type).toBe('Error');
      expect(result.refValue).toBe('#DIV/0!');
    });
  });

  describe('MIN', () => {
    it('should return the minimum of multiple numbers', () => {
      const result = callFunc(functions.MIN, [
        { refValue: [5, 2, 8], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 2, type: 'Number' });
    });

    it('should handle negative numbers', () => {
      const result = callFunc(functions.MIN, [
        { refValue: [-3, 1, -7], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: -7, type: 'Number' });
    });

    it('should return the value for a single number', () => {
      const result = callFunc(functions.MIN, [
        { refValue: [42], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 42, type: 'Number' });
    });

    it('should ignore NaN values', () => {
      const result = callFunc(functions.MIN, [
        { refValue: [5, NaN], type: 'ARRAY[Number]' }
      ]);
      expect(result.refValue).toBe(5);
    });
  });

  describe('MAX', () => {
    it('should return the maximum of multiple numbers', () => {
      const result = callFunc(functions.MAX, [
        { refValue: [5, 2, 8], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 8, type: 'Number' });
    });

    it('should handle negative numbers', () => {
      const result = callFunc(functions.MAX, [
        { refValue: [-3, -1, -7], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: -1, type: 'Number' });
    });

    it('should return the value for a single number', () => {
      const result = callFunc(functions.MAX, [
        { refValue: [42], type: 'ARRAY[Number]' }
      ]);
      expect(result).toEqual({ refValue: 42, type: 'Number' });
    });

    it('should ignore NaN values', () => {
      const result = callFunc(functions.MAX, [
        { refValue: [5, NaN], type: 'ARRAY[Number]' }
      ]);
      expect(result.refValue).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    describe('Error Propagation', () => {
      it('should propagate #REF! errors', () => {
        const result = callFunc(functions.ADD, [
          { refValue: 5, type: 'Number' },
          { refValue: '#REF!', type: 'Error' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#REF!');
      });

      it('should propagate first error encountered', () => {
        const result = callFunc(functions.ADD, [
          { refValue: '#DIV/0!', type: 'Error' },
          { refValue: '#VALUE!', type: 'Error' }
        ]);
        expect(result.type).toBe('Error');
        expect(result.refValue).toBe('#DIV/0!'); // First error
      });
    });

    describe('Array Input', () => {
      it('should accept ARRAY[Number] input for aggregation functions', () => {
        const result = callFunc(functions.SUM, [
          { refValue: [1, 2], type: 'ARRAY[Number]' }
        ]);
        expect(result.refValue).toBe(3);
      });

      it('should handle multi-element arrays', () => {
        // 4-element flat array
        const result = callFunc(functions.SUM, [
          { refValue: [1, 2, 3, 4], type: 'ARRAY[Number]' }
        ]);
        expect(result).toEqual({ refValue: 10, type: 'Number' });
      });
    });

    describe('Boundary Values', () => {
      it('should handle very large numbers', () => {
        const result = callFunc(functions.ADD, [
          { refValue: 1e15, type: 'Number' },
          { refValue: 1e15, type: 'Number' }
        ]);
        expect(result.refValue).toBe(2e15);
      });

      it('should handle very small numbers', () => {
        const result = callFunc(functions.MULTIPLY, [
          { refValue: 1e-15, type: 'Number' },
          { refValue: 1e-15, type: 'Number' }
        ]);
        expect(result.refValue).toBe(1e-30);
      });

      it('should handle zero in various operations', () => {
        expect(callFunc(functions.ADD, [
          { refValue: 0, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]).refValue).toBe(5);

        expect(callFunc(functions.MULTIPLY, [
          { refValue: 0, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]).refValue).toBe(0);

        expect(callFunc(functions.EXPONENT, [
          { refValue: 0, type: 'Number' },
          { refValue: 5, type: 'Number' }
        ]).refValue).toBe(0);
      });
    });
  });
});
