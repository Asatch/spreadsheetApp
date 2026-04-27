/**
 * Tests for nameValidation.js
 * Validates name syntax and normalization for named entities
 */

import { isValidNameSyntax, normalizeName } from '../../utils/nameValidation.js';

describe('nameValidation', () => {
  describe('normalizeName', () => {
    it('should convert to uppercase', () => {
      expect(normalizeName('revenue')).toBe('REVENUE');
      expect(normalizeName('TaxRate')).toBe('TAXRATE');
      expect(normalizeName('TOTAL')).toBe('TOTAL');
    });

    it('should replace spaces with underscores', () => {
      expect(normalizeName('tax rate')).toBe('TAX_RATE');
      expect(normalizeName('total revenue')).toBe('TOTAL_REVENUE');
      expect(normalizeName('annual  budget')).toBe('ANNUAL_BUDGET'); // multiple spaces
    });

    it('should trim leading and trailing whitespace', () => {
      expect(normalizeName('  revenue  ')).toBe('REVENUE');
      expect(normalizeName('\ttax\t')).toBe('TAX');
      expect(normalizeName('  total revenue  ')).toBe('TOTAL_REVENUE');
    });

    it('should handle underscores in input', () => {
      expect(normalizeName('tax_rate')).toBe('TAX_RATE');
      expect(normalizeName('_private')).toBe('_PRIVATE');
      expect(normalizeName('my_var_name')).toBe('MY_VAR_NAME');
    });

    it('should handle numbers', () => {
      expect(normalizeName('value1')).toBe('VALUE1');
      expect(normalizeName('Q4 2023')).toBe('Q4_2023');
    });

    it('should handle empty string', () => {
      expect(normalizeName('')).toBe('');
      expect(normalizeName('   ')).toBe('');
    });
  });

  describe('isValidNameSyntax', () => {
    describe('Valid names', () => {
      it('should accept simple alphabetic names', () => {
        expect(isValidNameSyntax('REVENUE')).toBe(true);
        expect(isValidNameSyntax('TAX')).toBe(true);
        expect(isValidNameSyntax('TOTAL')).toBe(true);
      });

      it('should accept names with underscores', () => {
        expect(isValidNameSyntax('TAX_RATE')).toBe(true);
        expect(isValidNameSyntax('TOTAL_REVENUE')).toBe(true);
        expect(isValidNameSyntax('_PRIVATE')).toBe(true);
        expect(isValidNameSyntax('MY_VAR_NAME')).toBe(true);
      });

      it('should accept names with numbers (not starting)', () => {
        expect(isValidNameSyntax('VALUE1')).toBe(true);
        expect(isValidNameSyntax('Q4_2023')).toBe(true);
        expect(isValidNameSyntax('RATE2')).toBe(true);
      });

      it('should accept single letter names (if not cell refs)', () => {
        expect(isValidNameSyntax('X')).toBe(true);
        expect(isValidNameSyntax('Y')).toBe(true);
        expect(isValidNameSyntax('Z')).toBe(true);
      });

      it('should accept long names (under limit)', () => {
        const longName = 'A'.repeat(255);
        expect(isValidNameSyntax(longName)).toBe(true);
      });
    });

    describe('Invalid names - Format', () => {
      it('should reject empty or null/undefined', () => {
        expect(isValidNameSyntax('')).toBe(false);
        expect(isValidNameSyntax(null)).toBe(false);
        expect(isValidNameSyntax(undefined)).toBe(false);
      });

      it('should reject names starting with numbers', () => {
        expect(isValidNameSyntax('1REVENUE')).toBe(false);
        expect(isValidNameSyntax('2023Q4')).toBe(false);
        expect(isValidNameSyntax('99PROBLEMS')).toBe(false);
      });

      it('should reject names with spaces', () => {
        expect(isValidNameSyntax('TAX RATE')).toBe(false);
        expect(isValidNameSyntax('TOTAL REVENUE')).toBe(false);
        expect(isValidNameSyntax('MY VAR')).toBe(false);
      });

      it('should reject names with special characters', () => {
        expect(isValidNameSyntax('REVENUE!')).toBe(false);
        expect(isValidNameSyntax('TAX-RATE')).toBe(false);
        expect(isValidNameSyntax('TOTAL@REVENUE')).toBe(false);
        expect(isValidNameSyntax('VALUE#1')).toBe(false);
        expect(isValidNameSyntax('PRICE$')).toBe(false);
        expect(isValidNameSyntax('RATE%')).toBe(false);
        expect(isValidNameSyntax('TOTAL&REVENUE')).toBe(false);
        expect(isValidNameSyntax('VALUE*2')).toBe(false);
        expect(isValidNameSyntax('REVENUE+')).toBe(false);
        expect(isValidNameSyntax('TOTAL=')).toBe(false);
      });

      it('should reject lowercase names (must be normalized first)', () => {
        expect(isValidNameSyntax('revenue')).toBe(false);
        expect(isValidNameSyntax('TaxRate')).toBe(false);
        expect(isValidNameSyntax('myVar')).toBe(false);
      });

      it('should reject names exceeding length limit', () => {
        const tooLong = 'A'.repeat(256);
        expect(isValidNameSyntax(tooLong)).toBe(false);
      });

      it('should reject non-string types', () => {
        expect(isValidNameSyntax(123)).toBe(false);
        expect(isValidNameSyntax(true)).toBe(false);
        expect(isValidNameSyntax({})).toBe(false);
        expect(isValidNameSyntax([])).toBe(false);
      });
    });

    describe('Invalid names - Cell references', () => {
      it('should reject single-letter single-digit cell refs', () => {
        expect(isValidNameSyntax('A1')).toBe(false);
        expect(isValidNameSyntax('B2')).toBe(false);
        expect(isValidNameSyntax('Z9')).toBe(false);
      });

      it('should reject single-letter multi-digit cell refs', () => {
        expect(isValidNameSyntax('A10')).toBe(false);
        expect(isValidNameSyntax('B99')).toBe(false);
        expect(isValidNameSyntax('Z1000')).toBe(false);
      });

      it('should reject double-letter cell refs', () => {
        expect(isValidNameSyntax('AA1')).toBe(false);
        expect(isValidNameSyntax('AB10')).toBe(false);
        expect(isValidNameSyntax('ZZ999')).toBe(false);
      });

      it('should accept triple-letter patterns (pattern only supports 1-2 letters)', () => {
        // CELL_REF_PATTERN in cellUtils.js limits to [A-Z]{1,2}, so triple-letter
        // patterns like AAA1 are NOT recognized as cell references
        expect(isValidNameSyntax('AAA1')).toBe(true);
        expect(isValidNameSyntax('ABC100')).toBe(true);
        expect(isValidNameSyntax('ZZZ999')).toBe(true);
      });

      it('should accept names that look like cell refs but have extra chars', () => {
        // These are NOT valid cell references
        expect(isValidNameSyntax('A1B')).toBe(true);
        expect(isValidNameSyntax('A_1')).toBe(true);
        expect(isValidNameSyntax('A1_VALUE')).toBe(true);
      });
    });

    describe('Invalid names - Reserved words', () => {
      it('should reject TRUE', () => {
        expect(isValidNameSyntax('TRUE')).toBe(false);
      });

      it('should reject FALSE', () => {
        expect(isValidNameSyntax('FALSE')).toBe(false);
      });
    });

    describe('Invalid names - Built-in functions', () => {
      it('should reject arithmetic function names', () => {
        expect(isValidNameSyntax('ADD')).toBe(false);
        expect(isValidNameSyntax('SUBTRACT')).toBe(false);
        expect(isValidNameSyntax('MULTIPLY')).toBe(false);
        expect(isValidNameSyntax('DIVIDE')).toBe(false);
        expect(isValidNameSyntax('NEGATE')).toBe(false);
      });

      it('should reject comparison function names', () => {
        expect(isValidNameSyntax('EQUAL')).toBe(false);
        expect(isValidNameSyntax('NOTEQUAL')).toBe(false);
        expect(isValidNameSyntax('LESS')).toBe(false);
        expect(isValidNameSyntax('LESSEQUAL')).toBe(false);
        expect(isValidNameSyntax('GREATER')).toBe(false);
        expect(isValidNameSyntax('GREATEREQUAL')).toBe(false);
      });

      it('should reject logical function names', () => {
        expect(isValidNameSyntax('IF')).toBe(false);
        expect(isValidNameSyntax('AND')).toBe(false);
        expect(isValidNameSyntax('OR')).toBe(false);
      });

      it('should reject implemented aggregate function names', () => {
        expect(isValidNameSyntax('SUM')).toBe(false);
        expect(isValidNameSyntax('MIN')).toBe(false);
        expect(isValidNameSyntax('MAX')).toBe(false);
      });

      it('should accept unimplemented function names', () => {
        // These are common spreadsheet functions but not yet implemented
        expect(isValidNameSyntax('AVERAGE')).toBe(true);
        expect(isValidNameSyntax('COUNT')).toBe(true);
      });

      it('should reject other built-in function names', () => {
        expect(isValidNameSyntax('PROCEED')).toBe(false);
        expect(isValidNameSyntax('ARRAY')).toBe(false);
        expect(isValidNameSyntax('EXPONENT')).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('should handle names at exactly 255 characters', () => {
        const exactLimit = 'A'.repeat(255);
        expect(isValidNameSyntax(exactLimit)).toBe(true);
      });

      it('should handle names just over 255 characters', () => {
        const overLimit = 'A'.repeat(256);
        expect(isValidNameSyntax(overLimit)).toBe(false);
      });

      it('should handle single underscore', () => {
        expect(isValidNameSyntax('_')).toBe(true);
      });

      it('should handle multiple consecutive underscores', () => {
        expect(isValidNameSyntax('A__B')).toBe(true);
        expect(isValidNameSyntax('___VALUE')).toBe(true);
      });

      it('should handle names ending with numbers', () => {
        expect(isValidNameSyntax('REVENUE2023')).toBe(true);
        expect(isValidNameSyntax('VALUE99')).toBe(true);
      });

      it('should reject short names that look like cell refs', () => {
        // Q4 looks like column Q, row 4
        expect(isValidNameSyntax('Q4')).toBe(false);
        expect(isValidNameSyntax('A5')).toBe(false);
        expect(isValidNameSyntax('Z9')).toBe(false);
      });

      it('should handle all uppercase letters', () => {
        expect(isValidNameSyntax('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true);
      });

      it('should handle all digits (after first char)', () => {
        expect(isValidNameSyntax('A0123456789')).toBe(true);
      });

      it('should reject names that are numbers only', () => {
        expect(isValidNameSyntax('123')).toBe(false);
        expect(isValidNameSyntax('456789')).toBe(false);
      });
    });

    describe('Integration with normalizeName', () => {
      it('should validate normalized names', () => {
        expect(isValidNameSyntax(normalizeName('tax rate'))).toBe(true);
        expect(isValidNameSyntax(normalizeName('Total Revenue'))).toBe(true);
        expect(isValidNameSyntax(normalizeName('  value1  '))).toBe(true);
      });

      it('should reject normalized names that conflict with cell refs', () => {
        // These normalize to cell reference patterns
        expect(isValidNameSyntax(normalizeName('a1'))).toBe(false);
        expect(isValidNameSyntax(normalizeName('AA10'))).toBe(false);
      });

      it('should reject normalized names that conflict with functions', () => {
        expect(isValidNameSyntax(normalizeName('sum'))).toBe(false);
        expect(isValidNameSyntax(normalizeName('if'))).toBe(false);
        expect(isValidNameSyntax(normalizeName('Add'))).toBe(false);
      });

      it('should reject normalized names that are reserved words', () => {
        expect(isValidNameSyntax(normalizeName('true'))).toBe(false);
        expect(isValidNameSyntax(normalizeName('False'))).toBe(false);
      });

      it('should handle edge case: normalize empty/whitespace only', () => {
        expect(isValidNameSyntax(normalizeName(''))).toBe(false);
        expect(isValidNameSyntax(normalizeName('   '))).toBe(false);
      });
    });
  });
});
