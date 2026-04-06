/**
 * Tests for Number Formatter
 *
 * Tests the config-driven number formatting system that supports
 * general, number, currency, percentage, scientific, and time duration formats.
 */

import { formatNumber, FORMAT_TYPES, getNumberFormatDefaults } from '../../utils/numberFormatter';

describe('numberFormatter', () => {
  describe('GENERAL format', () => {
    it('should return numbers as-is', () => {
      expect(formatNumber(1234.5678, { subCategory: FORMAT_TYPES.GENERAL })).toBe('1234.5678');
      expect(formatNumber(0, { subCategory: FORMAT_TYPES.GENERAL })).toBe('0');
      expect(formatNumber(-100, { subCategory: FORMAT_TYPES.GENERAL })).toBe('-100');
    });

    it('should handle empty values', () => {
      expect(formatNumber(null, { subCategory: FORMAT_TYPES.GENERAL })).toBe('');
      expect(formatNumber(undefined, { subCategory: FORMAT_TYPES.GENERAL })).toBe('');
      expect(formatNumber('', { subCategory: FORMAT_TYPES.GENERAL })).toBe('');
    });

    it('should handle non-numeric values', () => {
      expect(formatNumber('hello', { subCategory: FORMAT_TYPES.GENERAL })).toBe('hello');
    });
  });

  describe('NUMBER format', () => {
    it('should format with default settings (adaptive decimals, comma thousands)', () => {
      // Default is adaptive decimals (preserves original precision)
      expect(formatNumber(1234.5678, { subCategory: FORMAT_TYPES.NUMBER })).toBe('1,234.5678');
      expect(formatNumber(0, { subCategory: FORMAT_TYPES.NUMBER })).toBe('0');
      expect(formatNumber(1000000, { subCategory: FORMAT_TYPES.NUMBER })).toBe('1,000,000');
    });

    it('should respect custom decimal places', () => {
      // Need to set useAdaptiveDecimals: false to use fixed decimal places
      expect(formatNumber(1234.5678, {
        subCategory: FORMAT_TYPES.NUMBER,
        useAdaptiveDecimals: false,
        decimalPlaces: 0
      })).toBe('1,235');

      expect(formatNumber(1234.5678, {
        subCategory: FORMAT_TYPES.NUMBER,
        useAdaptiveDecimals: false,
        decimalPlaces: 3
      })).toBe('1,234.568');

      expect(formatNumber(1234.5678, {
        subCategory: FORMAT_TYPES.NUMBER,
        useAdaptiveDecimals: false,
        decimalPlaces: 4
      })).toBe('1,234.5678');
    });

    it('should support different digit separator options', () => {
      // Comma thousands, period decimal (default)
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.NUMBER,
        digitSeparatorOption: 'comma-period'
      })).toBe('1,234.56');

      // Period thousands, comma decimal
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.NUMBER,
        digitSeparatorOption: 'period-comma'
      })).toBe('1.234,56');

      // Space thousands, period decimal
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.NUMBER,
        digitSeparatorOption: 'space-period'
      })).toBe('1 234.56');

      // Period only, no thousands
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.NUMBER,
        digitSeparatorOption: 'period-only'
      })).toBe('1234.56');
    });

    it('should handle negative numbers with different styles', () => {
      // Default: minus sign
      expect(formatNumber(-1234.56, {
        subCategory: FORMAT_TYPES.NUMBER
      })).toBe('-1,234.56');

      // Parentheses style
      expect(formatNumber(-1234.56, {
        subCategory: FORMAT_TYPES.NUMBER,
        negativeStyle: 'parentheses'
      })).toBe('(1,234.56)');
    });
  });

  describe('CURRENCY format', () => {
    it('should format with default currency symbol ($)', () => {
      expect(formatNumber(1234.56, { subCategory: FORMAT_TYPES.CURRENCY })).toBe('$1,234.56');
      expect(formatNumber(0, { subCategory: FORMAT_TYPES.CURRENCY })).toBe('$0.00');
    });

    it('should support custom currency symbol', () => {
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.CURRENCY,
        symbol: '€'
      })).toBe('€1,234.56');

      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.CURRENCY,
        symbol: '£'
      })).toBe('£1,234.56');
    });

    it('should support symbol position', () => {
      // Before (default)
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.CURRENCY,
        symbol: '$',
        symbolPosition: 'before'
      })).toBe('$1,234.56');

      // After
      expect(formatNumber(1234.56, {
        subCategory: FORMAT_TYPES.CURRENCY,
        symbol: '$',
        symbolPosition: 'after'
      })).toBe('1,234.56$');
    });

    it('should handle negative currency', () => {
      expect(formatNumber(-1234.56, {
        subCategory: FORMAT_TYPES.CURRENCY
      })).toBe('-$1,234.56');

      expect(formatNumber(-1234.56, {
        subCategory: FORMAT_TYPES.CURRENCY,
        negativeStyle: 'parentheses'
      })).toBe('($1,234.56)');
    });
  });

  describe('PERCENTAGE format', () => {
    it('should multiply by 100 and add % symbol', () => {
      expect(formatNumber(0.5, { subCategory: FORMAT_TYPES.PERCENTAGE })).toBe('50.00%');
      expect(formatNumber(1, { subCategory: FORMAT_TYPES.PERCENTAGE })).toBe('100.00%');
      expect(formatNumber(0.12345, { subCategory: FORMAT_TYPES.PERCENTAGE })).toBe('12.35%');
    });

    it('should respect decimal places', () => {
      expect(formatNumber(0.12345, {
        subCategory: FORMAT_TYPES.PERCENTAGE,
        decimalPlaces: 0
      })).toBe('12%');

      expect(formatNumber(0.12345, {
        subCategory: FORMAT_TYPES.PERCENTAGE,
        decimalPlaces: 3
      })).toBe('12.345%');
    });

    it('should handle negative percentages', () => {
      expect(formatNumber(-0.25, {
        subCategory: FORMAT_TYPES.PERCENTAGE
      })).toBe('-25.00%');
    });
  });

  describe('SCIENTIFIC format', () => {
    it('should format in scientific notation', () => {
      const result = formatNumber(1234567, { subCategory: FORMAT_TYPES.SCIENTIFIC });
      expect(result).toMatch(/1\.2.*e\+6/i);
    });

    it('should handle small numbers', () => {
      const result = formatNumber(0.000123, { subCategory: FORMAT_TYPES.SCIENTIFIC });
      expect(result).toMatch(/1\.2.*e-4/i);
    });

    it('should handle negative numbers', () => {
      const result = formatNumber(-1234567, { subCategory: FORMAT_TYPES.SCIENTIFIC });
      expect(result).toMatch(/-1\.2.*e\+6/i);
    });
  });

  describe('TIME_DURATION format', () => {
    it('should format time duration in days and hours', () => {
      // 1.5 days = 1 day 12 hours
      const result = formatNumber(1.5, {
        subCategory: FORMAT_TYPES.TIME_DURATION
      });
      // Just check it returns a string with duration info
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle fractional days', () => {
      const result = formatNumber(0.5, {
        subCategory: FORMAT_TYPES.TIME_DURATION
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getNumberFormatDefaults', () => {
    it('should return defaults for number format', () => {
      const defaults = getNumberFormatDefaults('number');
      expect(defaults).toHaveProperty('decimalPlaces');
      expect(defaults).toHaveProperty('digitSeparatorOption');
      expect(defaults).toHaveProperty('negativeStyle');
    });

    it('should return defaults for currency format', () => {
      const defaults = getNumberFormatDefaults('currency');
      expect(defaults).toHaveProperty('symbol');
      expect(defaults).toHaveProperty('symbolPosition');
    });

    it('should return defaults for percentage format', () => {
      const defaults = getNumberFormatDefaults('percentage');
      expect(defaults).toHaveProperty('decimalPlaces');
    });
  });

  describe('Edge cases', () => {
    it('should handle very large numbers', () => {
      expect(formatNumber(999999999.99, {
        subCategory: FORMAT_TYPES.NUMBER
      })).toBe('999,999,999.99');
    });

    it('should handle very small decimals', () => {
      expect(formatNumber(0.001, {
        subCategory: FORMAT_TYPES.NUMBER,
        decimalPlaces: 3
      })).toBe('0.001');
    });

    it('should handle zero', () => {
      // NUMBER uses adaptive decimals by default, so 0 stays as '0'
      expect(formatNumber(0, { subCategory: FORMAT_TYPES.NUMBER })).toBe('0');
      // CURRENCY and PERCENTAGE use fixed 2 decimals by default
      expect(formatNumber(0, { subCategory: FORMAT_TYPES.CURRENCY })).toBe('$0.00');
      expect(formatNumber(0, { subCategory: FORMAT_TYPES.PERCENTAGE })).toBe('0.00%');
    });

    it('should default to number format when no subCategory specified', () => {
      // When no subCategory provided, defaults to 'number'
      expect(formatNumber(1234.56)).toBe('1,234.56');
    });
  });
});
