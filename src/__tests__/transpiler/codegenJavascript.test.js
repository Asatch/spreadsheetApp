import { describe, it, expect } from 'vitest';
import { jsSafeName, constantValueInCode } from '../../transpiler/codegenJavascript.js';

describe('codegenJavascript', () => {
  describe('jsSafeName', () => {
    it('returns valid names unchanged', () => {
      expect(jsSafeName('BALANCE')).toBe('BALANCE');
      expect(jsSafeName('my_var')).toBe('my_var');
      expect(jsSafeName('x1')).toBe('x1');
    });

    it('avoids JS reserved words', () => {
      const result = jsSafeName('return');
      expect(result).not.toBe('return');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles names starting with digits', () => {
      const result = jsSafeName('1abc');
      // Should prefix with _ or otherwise make valid
      expect(result).toMatch(/^[a-zA-Z_]/);
    });

    it('replaces invalid characters', () => {
      const result = jsSafeName('my-var');
      expect(result).not.toContain('-');
    });
  });

  describe('constantValueInCode', () => {
    it('converts numbers', () => {
      expect(constantValueInCode('42', 'Number')).toBe('42');
      expect(constantValueInCode('3.14', 'Number')).toBe('3.14');
    });

    it('converts text with quotes', () => {
      const result = constantValueInCode('hello', 'Text');
      expect(result).toContain('hello');
      // Should be wrapped in quotes
      expect(result.startsWith('"') || result.startsWith("'")).toBe(true);
    });

    it('converts booleans', () => {
      const trueResult = constantValueInCode('true', 'Boolean');
      expect(trueResult).toBe('true');
      const falseResult = constantValueInCode('false', 'Boolean');
      expect(falseResult).toBe('false');
    });
  });
});
