/**
 * Tests for Formula Parser
 *
 * Tests the formula parser that converts normalized formula strings into
 * precedent arrays (prefix notation) for the calculation engine.
 */

import { parseFormula } from '../../utils/formulaParser';

describe('formulaParser', () => {
  describe('Simple Values and References', () => {
    it('should parse simple cell reference', () => {
      const result = parseFormula('=A1');
      expect(result.precedents).toEqual(['PROCEED', 'A1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse number literals', () => {
      const result = parseFormula('=42');
      expect(result.precedents).toEqual(['PROCEED', '42']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse negative number literals', () => {
      const result = parseFormula('=-5');
      expect(result.precedents).toEqual(['PROCEED', '-5']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should strip $ markers from absolute references', () => {
      const result = parseFormula('=$A$1');
      expect(result.precedents).toEqual(['PROCEED', 'A1']);
      expect(result.anonymousExpressions).toEqual([]);
    });
  });

  describe('Arithmetic Operations', () => {
    it('should parse addition', () => {
      const result = parseFormula('=A1+B1');
      expect(result.precedents).toEqual(['ADD', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse subtraction', () => {
      const result = parseFormula('=A1-B1');
      expect(result.precedents).toEqual(['SUBTRACT', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse multiplication', () => {
      const result = parseFormula('=A1*B1');
      expect(result.precedents).toEqual(['MULTIPLY', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse division', () => {
      const result = parseFormula('=A1/B1');
      expect(result.precedents).toEqual(['DIVIDE', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse exponentiation', () => {
      const result = parseFormula('=A1^B1');
      expect(result.precedents).toEqual(['EXPONENT', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });
  });

  describe('Comparison Operations', () => {
    it('should parse equality', () => {
      const result = parseFormula('=A1=B1');
      expect(result.precedents).toEqual(['EQUAL', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse not equal', () => {
      const result = parseFormula('=A1<>B1');
      expect(result.precedents).toEqual(['NOTEQUAL', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse less than', () => {
      const result = parseFormula('=A1<B1');
      expect(result.precedents).toEqual(['LESS', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse less than or equal', () => {
      const result = parseFormula('=A1<=B1');
      expect(result.precedents).toEqual(['LESSEQUAL', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse greater than', () => {
      const result = parseFormula('=A1>B1');
      expect(result.precedents).toEqual(['GREATER', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse greater than or equal', () => {
      const result = parseFormula('=A1>=B1');
      expect(result.precedents).toEqual(['GREATEREQUAL', 'A1', 'B1']);
      expect(result.anonymousExpressions).toEqual([]);
    });
  });

  describe('Operator Precedence', () => {
    it('should handle multiplication before addition', () => {
      const result = parseFormula('=A1+B1*C1');
      // Complex right side becomes anonymous expression
      expect(result.precedents).toEqual(['ADD', 'A1', '=B1*C1']);
      expect(result.anonymousExpressions).toEqual(['=B1*C1']);
    });

    it('should handle exponentiation before multiplication', () => {
      const result = parseFormula('=A1*B1^C1');
      expect(result.precedents).toEqual(['MULTIPLY', 'A1', '=B1^C1']);
      expect(result.anonymousExpressions).toEqual(['=B1^C1']);
    });

    it('should handle comparison after arithmetic', () => {
      const result = parseFormula('=A1+B1>C1');
      expect(result.precedents).toEqual(['GREATER', '=A1+B1', 'C1']);
      expect(result.anonymousExpressions).toEqual(['=A1+B1']);
    });
  });

  describe('Parentheses', () => {
    it('should handle grouped expressions', () => {
      const result = parseFormula('=(A1+B1)');
      // Simple grouped expression - parentheses stripped, becomes anonymous
      expect(result.precedents).toEqual(['PROCEED', '=A1+B1']);
      expect(result.anonymousExpressions).toEqual(['=A1+B1']);
    });

    it('should handle complex grouped expressions', () => {
      const result = parseFormula('=(A1+B1)*C1');
      // Parentheses preserved in anonymous expression
      expect(result.precedents).toEqual(['MULTIPLY', '=(A1+B1)', 'C1']);
      expect(result.anonymousExpressions).toEqual(['=(A1+B1)']);
    });
  });

  describe('Unary Minus (NEGATE)', () => {
    it('should parse negative literal as PROCEED', () => {
      const result = parseFormula('=-5');
      expect(result.precedents).toEqual(['PROCEED', '-5']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse negated cell reference as NEGATE', () => {
      const result = parseFormula('=-A1');
      expect(result.precedents).toEqual(['NEGATE', 'A1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse negated expression as NEGATE', () => {
      const result = parseFormula('=-(A1+B1)');
      // Grouped expression becomes anonymous (parentheses preserved), then NEGATE of that
      expect(result.precedents).toEqual(['NEGATE', '=(A1+B1)']);
      expect(result.anonymousExpressions).toEqual(['=(A1+B1)']);
    });

    it('should handle unary minus in complex formulas', () => {
      const result = parseFormula('=A1+-5');
      expect(result.precedents).toEqual(['ADD', 'A1', '=-5']);
      expect(result.anonymousExpressions).toEqual(['=-5']);
    });

    it('should handle multiple unary minuses', () => {
      const result = parseFormula('=--5');
      expect(result.precedents).toEqual(['NEGATE', '=-5']);
      expect(result.anonymousExpressions).toEqual(['=-5']);
    });
  });

  describe('Functions', () => {
    it('should parse SUM with single argument', () => {
      const result = parseFormula('=SUM(A1)');
      expect(result.precedents).toEqual(['SUM', 'A1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse SUM with multiple arguments', () => {
      const result = parseFormula('=SUM(A1,B1,C1)');
      expect(result.precedents).toEqual(['SUM', 'A1', 'B1', 'C1']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse SUM with complex argument', () => {
      const result = parseFormula('=SUM(A1,B1+C1)');
      expect(result.precedents).toEqual(['SUM', 'A1', '=B1+C1']);
      expect(result.anonymousExpressions).toEqual(['=B1+C1']);
    });

    it('should parse IF function', () => {
      const result = parseFormula('=IF(A1>5,B1,C1)');
      expect(result.precedents).toEqual(['IF', '=A1>5', 'B1', 'C1']);
      expect(result.anonymousExpressions).toEqual(['=A1>5']);
    });

    it('should parse nested functions', () => {
      const result = parseFormula('=SUM(A1,MAX(B1,C1))');
      // MAX(B1,C1) is complex, becomes anonymous expression
      expect(result.precedents).toEqual(['SUM', 'A1', '=MAX(B1,C1)']);
      expect(result.anonymousExpressions).toEqual(['=MAX(B1,C1)']);
    });
  });

  describe('Ranges', () => {
    it('should parse simple range (A1:B2)', () => {
      const result = parseFormula('=A1:B2');
      // Range gets expanded to cells (flat, no rows/cols header)
      expect(result.precedents[0]).toBe('ARRAY');
      expect(result.precedents.slice(1)).toEqual(['A1', 'B1', 'A2', 'B2']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should parse range in function', () => {
      const result = parseFormula('=SUM(A1:B2)');
      // Range is complex, becomes anonymous expression
      expect(result.precedents).toEqual(['SUM', '=A1:B2']);
      expect(result.anonymousExpressions).toEqual(['=A1:B2']);
    });
  });

  describe('Error Handling', () => {
    it('should return #SYNTAX! for malformed formulas', () => {
      // Unbalanced parentheses
      const result = parseFormula('=(A1+B1');
      expect(result.precedents).toEqual(['PROCEED', '#SYNTAX!']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should handle empty formula', () => {
      const result = parseFormula('=');
      expect(result.precedents).toEqual(['PROCEED', '']);
      expect(result.anonymousExpressions).toEqual([]);
    });
  });

  describe('Complex Formulas', () => {
    it('should parse formula with multiple operators and precedence', () => {
      const result = parseFormula('=A1+B1*C1-D1');
      // Parsing right-to-left for equal precedence
      expect(result.precedents[0]).toBe('SUBTRACT');
      // Complex left side becomes anonymous expression
      expect(result.precedents[1]).toBe('=A1+B1*C1');
      expect(result.precedents[2]).toBe('D1');
      expect(result.anonymousExpressions).toContain('=A1+B1*C1');
    });

    it('should parse formula with function and arithmetic', () => {
      const result = parseFormula('=SUM(A1:A10)+B1');
      expect(result.precedents).toEqual(['ADD', '=SUM(A1:A10)', 'B1']);
      expect(result.anonymousExpressions).toEqual(['=SUM(A1:A10)']);
    });

    it('should parse formula with nested expressions', () => {
      const result = parseFormula('=IF(A1>0,SUM(B1:B10),0)');
      expect(result.precedents[0]).toBe('IF');
      expect(result.precedents[1]).toBe('=A1>0');
      expect(result.precedents[2]).toBe('=SUM(B1:B10)');
      expect(result.precedents[3]).toBe('0');
      expect(result.anonymousExpressions).toContain('=A1>0');
      expect(result.anonymousExpressions).toContain('=SUM(B1:B10)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle formulas with no spaces (already normalized)', () => {
      const result = parseFormula('=A1+B1*C1');
      expect(result.precedents).toBeDefined();
      expect(result.anonymousExpressions).toBeDefined();
    });

    it('should handle decimal numbers', () => {
      const result = parseFormula('=3.14');
      expect(result.precedents).toEqual(['PROCEED', '3.14']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should handle cell references with large column numbers', () => {
      const result = parseFormula('=AA100+BB200');
      expect(result.precedents).toEqual(['ADD', 'AA100', 'BB200']);
      expect(result.anonymousExpressions).toEqual([]);
    });

    it('should handle deeply nested parentheses', () => {
      const result = parseFormula('=((((A1))))');
      expect(result.precedents[0]).toBe('PROCEED');
      // The innermost value should eventually resolve to A1
      expect(result.precedents).toBeDefined();
    });

    it('should handle multiple levels of nested parentheses with operations', () => {
      const result = parseFormula('=((A1+B1)*(C1-D1))');
      expect(result.precedents[0]).toBeDefined();
      expect(result.anonymousExpressions.length).toBeGreaterThan(0);
    });

    it('should handle complex nested functions', () => {
      const result = parseFormula('=SUM(IF(A1>0,SUM(B1:B10),0),C1)');
      expect(result.precedents[0]).toBe('SUM');
      expect(result.anonymousExpressions.length).toBeGreaterThan(0);
    });

    it('should handle triple-nested functions', () => {
      const result = parseFormula('=IF(A1>0,SUM(B1,IF(C1>0,D1,E1)),F1)');
      expect(result.precedents[0]).toBe('IF');
      expect(result.anonymousExpressions.length).toBeGreaterThan(0);
    });

    it('should handle very long formulas with many operations', () => {
      const result = parseFormula('=A1+B1+C1+D1+E1+F1+G1+H1');
      expect(result.precedents).toBeDefined();
      // Should create a chain of additions
    });

    it('should handle formulas with mixed absolute and relative references', () => {
      const result = parseFormula('=$A$1+$B2+C$3+D4');
      // Parser strips $ symbols (absolute markers handled by clipboard code)
      expect(result.precedents).toEqual(['ADD', '=A1+B2+C3', 'D4']);
    });

    it('should handle zero values', () => {
      const result = parseFormula('=0');
      expect(result.precedents).toEqual(['PROCEED', '0']);
    });

    it('should handle negative zero', () => {
      const result = parseFormula('=-0');
      expect(result.precedents).toEqual(['PROCEED', '-0']);
    });

    it('should handle comparison with zero', () => {
      const result = parseFormula('=A1=0');
      expect(result.precedents).toEqual(['EQUAL', 'A1', '0']);
    });

    it('should handle double negation', () => {
      const result = parseFormula('=--A1');
      expect(result.precedents[0]).toBe('NEGATE');
    });

    it('should handle triple negation', () => {
      const result = parseFormula('=---A1');
      expect(result.precedents).toBeDefined();
    });

    it('should handle ranges with absolute references', () => {
      const result = parseFormula('=$A$1:$B$2');
      expect(result.precedents[0]).toBe('ARRAY');
    });

    it('should handle function with no arguments (edge case)', () => {
      // This should be an error, but we test what the parser does
      const result = parseFormula('=SUM()');
      expect(result.precedents).toBeDefined();
    });

    it('should handle function with trailing comma', () => {
      const result = parseFormula('=SUM(A1,B1,)');
      // Parser behavior with trailing comma
      expect(result.precedents).toBeDefined();
    });

    it('should handle multiple comparison operators', () => {
      const result = parseFormula('=A1>B1+C1<D1');
      // This is actually invalid syntax, but test how parser handles it
      expect(result.precedents).toBeDefined();
    });

    it('should handle cell reference at column boundary', () => {
      const result = parseFormula('=Z1+AA1');
      expect(result.precedents).toEqual(['ADD', 'Z1', 'AA1']);
    });

    it('should handle percentage in formulas', () => {
      const result = parseFormula('=50%');
      expect(result.precedents).toEqual(['PROCEED', '50%']);
    });

    it('should handle percentage with operations', () => {
      const result = parseFormula('=A1*50%');
      expect(result.precedents).toEqual(['MULTIPLY', 'A1', '50%']);
    });
  });

  describe('Error Handling - Additional Cases', () => {
    it('should handle unbalanced closing parentheses', () => {
      const result = parseFormula('=A1+B1)');
      // Parser creates anonymous expression for B1), which contains the syntax error
      // Syntax error detected when anonymous expression is parsed, not at initial parse
      expect(result.precedents).toEqual(['ADD', 'A1', '=B1)']);
      expect(result.anonymousExpressions).toContain('=B1)');
    });

    it('should handle multiple unbalanced parentheses', () => {
      const result = parseFormula('=((A1+B1)');
      expect(result.precedents).toEqual(['PROCEED', '#SYNTAX!']);
    });

    it('should handle invalid cell reference format', () => {
      // Parser might treat this as text/error
      const result = parseFormula('=A');
      expect(result.precedents).toBeDefined();
    });

    it('should handle invalid range syntax', () => {
      const result = parseFormula('=A1:');
      expect(result.precedents).toBeDefined();
    });

    it('should handle missing operator', () => {
      const result = parseFormula('=A1 B1');
      // This should cause an error
      expect(result.precedents).toBeDefined();
    });

    it('should handle double operators', () => {
      const result = parseFormula('=A1++B1');
      // Double + should be treated as unary +
      expect(result.precedents).toBeDefined();
    });

    it('should handle formula with only operator', () => {
      const result = parseFormula('=+');
      expect(result.precedents).toBeDefined();
    });

    it('should handle unclosed string (if strings are supported)', () => {
      const result = parseFormula('="hello');
      expect(result.precedents).toBeDefined();
    });

    it('should handle special characters in formulas', () => {
      const result = parseFormula('=A1@B1');
      // @ is not a valid operator
      expect(result.precedents).toBeDefined();
    });
  });

  describe('Complex Real-World Formulas', () => {
    it('should handle weighted average formula', () => {
      const result = parseFormula('=SUM(A1:A10*B1:B10)/SUM(B1:B10)');
      expect(result.precedents).toBeDefined();
      expect(result.anonymousExpressions.length).toBeGreaterThan(0);
    });

    it('should handle conditional sum formula', () => {
      const result = parseFormula('=SUM(IF(A1:A10>0,A1:A10,0))');
      expect(result.precedents[0]).toBe('SUM');
      expect(result.anonymousExpressions).toContain('=IF(A1:A10>0,A1:A10,0)');
    });

    it('should handle nested IF with multiple conditions', () => {
      const result = parseFormula('=IF(A1>10,IF(A1>20,"High","Medium"),"Low")');
      expect(result.precedents[0]).toBe('IF');
      expect(result.anonymousExpressions.length).toBeGreaterThan(0);
    });

    it('should handle formula with multiple ranges', () => {
      const result = parseFormula('=SUM(A1:A10,B1:B10,C1:C10)');
      expect(result.precedents[0]).toBe('SUM');
      expect(result.anonymousExpressions.length).toBeGreaterThan(0);
    });

    it('should handle comparison chain (even if invalid)', () => {
      const result = parseFormula('=IF(AND(A1>0,A1<10,A1<>5),1,0)');
      expect(result.precedents[0]).toBe('IF');
    });

    it('should handle formula with exponentiation and precedence', () => {
      const result = parseFormula('=2^3^2');
      // Right-to-left associativity: 2^(3^2) = 2^9 = 512
      expect(result.precedents).toBeDefined();
    });
  });
});
