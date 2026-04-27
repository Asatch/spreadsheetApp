import { TypeService, TYPE_HIERARCHY, OPERATION_COMPATIBILITY, isArrayType, getArrayElementType } from '../../utils/typeService';
import { ymdToSerialDate, dateTimeToSerial } from '../../utils/serialDate';

describe('TypeService', () => {
  describe('detectType', () => {
    test('should detect number types', () => {
      expect(TypeService.detectType(42).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType(3.14).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType(-100).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType('42').type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType('3.14').type).toBe(TYPE_HIERARCHY.NUMBER);
    });

    test('should detect very large numbers', () => {
      expect(TypeService.detectType(999999999999).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType(1e15).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType(Number.MAX_SAFE_INTEGER).type).toBe(TYPE_HIERARCHY.NUMBER);
    });

    test('should detect very small numbers', () => {
      expect(TypeService.detectType(0.000001).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType(1e-15).type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType(Number.MIN_VALUE).type).toBe(TYPE_HIERARCHY.NUMBER);
    });

    test('should detect scientific notation strings', () => {
      const result1 = TypeService.detectType('1.23e-4');
      expect(result1.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result1.value).toBeCloseTo(0.000123);

      const result2 = TypeService.detectType('1e10');
      expect(result2.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result2.value).toBe(10000000000);

      const result3 = TypeService.detectType('-5.67E+3');
      expect(result3.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result3.value).toBe(-5670);
    });

    test('should detect canonical number format with spaces', () => {
      const result1 = TypeService.detectType('123 456');
      expect(result1.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result1.value).toBe(123456);

      const result2 = TypeService.detectType('1 234.567 89');
      expect(result2.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result2.value).toBeCloseTo(1234.56789);

      const result3 = TypeService.detectType('-987 654.321');
      expect(result3.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result3.value).toBeCloseTo(-987654.321);
    });

    test('should detect percentage format', () => {
      const result1 = TypeService.detectType('50%');
      expect(result1.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result1.value).toBe(0.5);

      const result2 = TypeService.detectType('-12.5%');
      expect(result2.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result2.value).toBe(-0.125);

      const result3 = TypeService.detectType('100%');
      expect(result3.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result3.value).toBe(1);
    });

    test('should handle special number values', () => {
      // Infinity should be detected as number but formatted specially
      const infResult = TypeService.detectType(Infinity);
      expect(infResult.type).toBe(TYPE_HIERARCHY.NUMBER);

      const negInfResult = TypeService.detectType(-Infinity);
      expect(negInfResult.type).toBe(TYPE_HIERARCHY.NUMBER);

      // NaN should be detected as number
      const nanResult = TypeService.detectType(NaN);
      expect(nanResult.type).toBe(TYPE_HIERARCHY.NUMBER);
    });

    test('should handle edge case number strings', () => {
      // Leading/trailing zeros
      expect(TypeService.detectType('0042').type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType('3.140000').type).toBe(TYPE_HIERARCHY.NUMBER);

      // Leading plus sign
      expect(TypeService.detectType('+42').type).toBe(TYPE_HIERARCHY.NUMBER);

      // Just decimal point
      expect(TypeService.detectType('.5').type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(TypeService.detectType('-.5').type).toBe(TYPE_HIERARCHY.NUMBER);
    });

    test('should detect text with leading quote marker', () => {
      const result1 = TypeService.detectType("'42");
      expect(result1.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result1.value).toBe('42');
      expect(result1.canonicalValue).toBe("'42");

      const result2 = TypeService.detectType("'3.14");
      expect(result2.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result2.value).toBe('3.14');

      const result3 = TypeService.detectType("'Hello");
      expect(result3.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result3.value).toBe('Hello');
    });

    test('should detect text types', () => {
      expect(TypeService.detectType('Hello world').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType("'42").type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType("'3.14").type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('').type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should handle whitespace strings', () => {
      // Empty string
      const empty = TypeService.detectType('');
      expect(empty.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(empty.value).toBe('');

      // Whitespace only
      const spaces = TypeService.detectType('   ');
      expect(spaces.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(spaces.value).toBe('');

      // Tab and newline
      expect(TypeService.detectType('\t\n').type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should handle strings with special characters', () => {
      expect(TypeService.detectType('hello@world.com').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('$100').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('test-value').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('foo_bar').type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should handle unicode strings', () => {
      expect(TypeService.detectType('Hello 世界').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('café').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('😀').type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      expect(TypeService.detectType(longString).type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should not detect invalid number strings as numbers', () => {
      expect(TypeService.detectType('12.34.56').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('1e2e3').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('12-34').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('abc123').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('123abc').type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should detect date types', () => {
      // Using string literals for date detection
      expect(TypeService.detectType('2023-10-15').type).toBe(TYPE_HIERARCHY.DATE);
      expect(TypeService.detectType('10/15/2023').type).toBe(TYPE_HIERARCHY.DATE);
    });

    test('should detect various date formats', () => {
      // ISO format
      expect(TypeService.detectType('2023-10-15').type).toBe(TYPE_HIERARCHY.DATE);

      // US format (MM/DD/YYYY)
      expect(TypeService.detectType('10/15/2023').type).toBe(TYPE_HIERARCHY.DATE);

      // German/Scandinavian format (DD.MM.YYYY)
      expect(TypeService.detectType('15.10.2023').type).toBe(TYPE_HIERARCHY.DATE);
    });

    test('should detect datetime types', () => {
      // Using string literals for datetime detection
      expect(TypeService.detectType('2023-10-15 14:30:00').type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(TypeService.detectType('10/15/2023 2:30 PM').type).toBe(TYPE_HIERARCHY.DATETIME);
    });

    test('should detect various datetime formats', () => {
      // ISO format with time
      expect(TypeService.detectType('2023-10-15 14:30:00').type).toBe(TYPE_HIERARCHY.DATETIME);

      // ISO T format
      expect(TypeService.detectType('2023-10-15T14:30:00Z').type).toBe(TYPE_HIERARCHY.DATETIME);

      // 12-hour format
      expect(TypeService.detectType('10/15/2023 2:30 PM').type).toBe(TYPE_HIERARCHY.DATETIME);

      // Military time
      expect(TypeService.detectType('10/15/2023 1430').type).toBe(TYPE_HIERARCHY.DATETIME);
    });

    test('should not detect invalid date strings as dates', () => {
      expect(TypeService.detectType('13/32/2023').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('2023-13-01').type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType('2023-02-30').type).toBe(TYPE_HIERARCHY.TEXT); // Invalid day
      expect(TypeService.detectType('not-a-date').type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should handle boolean values', () => {
      const trueResult = TypeService.detectType(true);
      expect(trueResult.type).toBe(TYPE_HIERARCHY.BOOLEAN);
      expect(trueResult.value).toBe(true);
      expect(trueResult.canonicalValue).toBe('TRUE');

      const falseResult = TypeService.detectType(false);
      expect(falseResult.type).toBe(TYPE_HIERARCHY.BOOLEAN);
      expect(falseResult.value).toBe(false);
      expect(falseResult.canonicalValue).toBe('FALSE');
    });

    test('should handle error objects', () => {
      const errorObj = { error: '#DIV/0!' };
      const result = TypeService.detectType(errorObj);
      expect(result.type).toBe(TYPE_HIERARCHY.ERROR);
      expect(result.value).toBe(null);
      expect(result.canonicalValue).toBe('#DIV/0!');
      expect(result.error).toBe('#DIV/0!');
    });

    test('should handle null and undefined', () => {
      const nullResult = TypeService.detectType(null);
      expect(nullResult.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(nullResult.value).toBe('');
      expect(nullResult.canonicalValue).toBe('');

      const undefinedResult = TypeService.detectType(undefined);
      expect(undefinedResult.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(undefinedResult.value).toBe('');
      expect(undefinedResult.canonicalValue).toBe('');
    });
  });
  
  describe('isType', () => {
    test('should validate number types', () => {
      expect(TypeService.isType(42, TYPE_HIERARCHY.NUMBER)).toBe(true);
      expect(TypeService.isType('42', TYPE_HIERARCHY.NUMBER)).toBe(false);
      expect(TypeService.isType(null, TYPE_HIERARCHY.NUMBER)).toBe(false);
    });

    test('should validate number edge cases', () => {
      // Valid numbers
      expect(TypeService.isType(0, TYPE_HIERARCHY.NUMBER)).toBe(true);
      expect(TypeService.isType(-1000, TYPE_HIERARCHY.NUMBER)).toBe(true);
      expect(TypeService.isType(3.14159, TYPE_HIERARCHY.NUMBER)).toBe(true);
      expect(TypeService.isType(1e15, TYPE_HIERARCHY.NUMBER)).toBe(true);

      // Infinity and NaN are technically numbers but might need special handling
      expect(TypeService.isType(Infinity, TYPE_HIERARCHY.NUMBER)).toBe(false);
      expect(TypeService.isType(-Infinity, TYPE_HIERARCHY.NUMBER)).toBe(false);
      expect(TypeService.isType(NaN, TYPE_HIERARCHY.NUMBER)).toBe(false);

      // Not numbers
      expect(TypeService.isType('123', TYPE_HIERARCHY.NUMBER)).toBe(false);
      expect(TypeService.isType(true, TYPE_HIERARCHY.NUMBER)).toBe(false);
      expect(TypeService.isType({}, TYPE_HIERARCHY.NUMBER)).toBe(false);
    });

    test('should validate text types', () => {
      expect(TypeService.isType('Hello', TYPE_HIERARCHY.TEXT)).toBe(true);
      expect(TypeService.isType(42, TYPE_HIERARCHY.TEXT)).toBe(false);
      expect(TypeService.isType(null, TYPE_HIERARCHY.TEXT)).toBe(false);
    });

    test('should validate text edge cases', () => {
      // Valid text
      expect(TypeService.isType('', TYPE_HIERARCHY.TEXT)).toBe(true);
      expect(TypeService.isType('   ', TYPE_HIERARCHY.TEXT)).toBe(true);
      expect(TypeService.isType('123', TYPE_HIERARCHY.TEXT)).toBe(true);
      expect(TypeService.isType('Hello 世界', TYPE_HIERARCHY.TEXT)).toBe(true);

      // Not text
      expect(TypeService.isType(123, TYPE_HIERARCHY.TEXT)).toBe(false);
      expect(TypeService.isType(true, TYPE_HIERARCHY.TEXT)).toBe(false);
      expect(TypeService.isType(undefined, TYPE_HIERARCHY.TEXT)).toBe(false);
    });

    test('should validate date types', () => {
      // DATE types are integer serial numbers >= 1
      const serialDate = ymdToSerialDate(2023, 10, 15); // October 15, 2023
      expect(TypeService.isType(serialDate, TYPE_HIERARCHY.DATE)).toBe(true);

      // Numbers with fractional parts are not DATE types
      const serialDateTime = dateTimeToSerial(2023, 10, 15, 14, 30, 0);
      expect(TypeService.isType(serialDateTime, TYPE_HIERARCHY.DATE)).toBe(false);
    });

    test('should validate date edge cases', () => {
      // Valid dates (integer >= 1)
      expect(TypeService.isType(1, TYPE_HIERARCHY.DATE)).toBe(true); // Dec 31, 1899
      expect(TypeService.isType(45000, TYPE_HIERARCHY.DATE)).toBe(true); // Some date in 2023

      // Invalid dates
      expect(TypeService.isType(0, TYPE_HIERARCHY.DATE)).toBe(false); // Below minimum
      expect(TypeService.isType(-1, TYPE_HIERARCHY.DATE)).toBe(false); // Negative
      expect(TypeService.isType(1.5, TYPE_HIERARCHY.DATE)).toBe(false); // Has fractional part
      expect(TypeService.isType(45000.000001, TYPE_HIERARCHY.DATE)).toBe(false); // Has fractional part
      expect(TypeService.isType('45000', TYPE_HIERARCHY.DATE)).toBe(false); // String, not number
      expect(TypeService.isType(NaN, TYPE_HIERARCHY.DATE)).toBe(false);
    });

    test('should validate datetime types', () => {
      // DATETIME types are numbers >= 1 (can be integer or floating point)
      const serialDateTime = dateTimeToSerial(2023, 10, 15, 14, 30, 0);
      expect(TypeService.isType(serialDateTime, TYPE_HIERARCHY.DATETIME)).toBe(true);

      // Integer serial numbers are also valid DATETIME values
      const serialDate = ymdToSerialDate(2023, 10, 15);
      expect(TypeService.isType(serialDate, TYPE_HIERARCHY.DATETIME)).toBe(true);
    });

    test('should validate datetime edge cases', () => {
      // Valid datetimes (number >= 1, can have fractional part)
      expect(TypeService.isType(1, TYPE_HIERARCHY.DATETIME)).toBe(true); // Integer is OK
      expect(TypeService.isType(1.5, TYPE_HIERARCHY.DATETIME)).toBe(true); // Fractional is OK
      expect(TypeService.isType(45000.75, TYPE_HIERARCHY.DATETIME)).toBe(true); // With time component

      // Invalid datetimes
      expect(TypeService.isType(0, TYPE_HIERARCHY.DATETIME)).toBe(false); // Below minimum
      expect(TypeService.isType(0.5, TYPE_HIERARCHY.DATETIME)).toBe(false); // Below minimum
      expect(TypeService.isType(-1, TYPE_HIERARCHY.DATETIME)).toBe(false); // Negative
      expect(TypeService.isType('45000.5', TYPE_HIERARCHY.DATETIME)).toBe(false); // String
      expect(TypeService.isType(NaN, TYPE_HIERARCHY.DATETIME)).toBe(false);
    });

    test('should validate boolean types', () => {
      expect(TypeService.isType(true, TYPE_HIERARCHY.BOOLEAN)).toBe(true);
      expect(TypeService.isType(false, TYPE_HIERARCHY.BOOLEAN)).toBe(true);

      // Not booleans
      expect(TypeService.isType(1, TYPE_HIERARCHY.BOOLEAN)).toBe(false);
      expect(TypeService.isType(0, TYPE_HIERARCHY.BOOLEAN)).toBe(false);
      expect(TypeService.isType('true', TYPE_HIERARCHY.BOOLEAN)).toBe(false);
      expect(TypeService.isType(null, TYPE_HIERARCHY.BOOLEAN)).toBe(false);
    });

    test('should validate error types', () => {
      // Valid error strings (refValue format)
      expect(TypeService.isType('#TYPE!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#REF!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#NAME!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#DOMAIN!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#SYNTAX!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#CIRCULAR!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#FUNCTION!', TYPE_HIERARCHY.ERROR)).toBe(true);
      expect(TypeService.isType('#ERROR!', TYPE_HIERARCHY.ERROR)).toBe(true);

      // Invalid error values
      expect(TypeService.isType('#DIV/0!', TYPE_HIERARCHY.ERROR)).toBe(false); // Not in our error codes
      expect(TypeService.isType('#INVALID!', TYPE_HIERARCHY.ERROR)).toBe(false); // Not a valid error code
      expect(TypeService.isType('not an error', TYPE_HIERARCHY.ERROR)).toBe(false);
      expect(TypeService.isType(123, TYPE_HIERARCHY.ERROR)).toBe(false);
      expect(TypeService.isType(null, TYPE_HIERARCHY.ERROR)).toBe(false);
      expect(TypeService.isType({}, TYPE_HIERARCHY.ERROR)).toBe(false);
    });
  });

  describe('formatCanonical', () => {
    test('should format numbers in canonical format', () => {
      // Simple numbers
      expect(TypeService.formatCanonical(42, TYPE_HIERARCHY.NUMBER)).toBe('42');
      expect(TypeService.formatCanonical(123456, TYPE_HIERARCHY.NUMBER)).toBe('123 456');
      expect(TypeService.formatCanonical(-987654.321, TYPE_HIERARCHY.NUMBER)).toContain('-987 654.321');
    });

    test('should format very large numbers with scientific notation', () => {
      // Numbers with more than 12 significant digits should use scientific notation
      const largeNumber = 1234567890123;
      const formatted = TypeService.formatCanonical(largeNumber, TYPE_HIERARCHY.NUMBER);
      expect(formatted).toMatch(/e\+/);
    });

    test('should format special number values', () => {
      expect(TypeService.formatCanonical(Infinity, TYPE_HIERARCHY.NUMBER)).toBe('#NUM!');
      expect(TypeService.formatCanonical(-Infinity, TYPE_HIERARCHY.NUMBER)).toBe('#NUM!');
      expect(TypeService.formatCanonical(NaN, TYPE_HIERARCHY.NUMBER)).toBe('#NUM!');
    });

    test('should format text with leading quote', () => {
      expect(TypeService.formatCanonical('Hello', TYPE_HIERARCHY.TEXT)).toBe("'Hello");
      expect(TypeService.formatCanonical('42', TYPE_HIERARCHY.TEXT)).toBe("'42");
      expect(TypeService.formatCanonical('', TYPE_HIERARCHY.TEXT)).toBe("'");
    });

    test('should format dates in ISO format', () => {
      const serialDate = ymdToSerialDate(2023, 10, 15);
      expect(TypeService.formatCanonical(serialDate, TYPE_HIERARCHY.DATE)).toBe('2023-10-15');
    });

    test('should format datetimes in ISO format', () => {
      const serialDateTime = dateTimeToSerial(2023, 10, 15, 14, 30, 0);
      const formatted = TypeService.formatCanonical(serialDateTime, TYPE_HIERARCHY.DATETIME);
      expect(formatted).toBe('2023-10-15 14:30:00');
    });

    test('should format error values', () => {
      expect(TypeService.formatCanonical({ error: '#DIV/0!' }, TYPE_HIERARCHY.ERROR)).toBe('#DIV/0!');
      expect(TypeService.formatCanonical({ error: '#TYPE!' }, TYPE_HIERARCHY.ERROR)).toBe('#TYPE!');
      // null/undefined return empty string due to early return in formatCanonical
      expect(TypeService.formatCanonical(null, TYPE_HIERARCHY.ERROR)).toBe('');
      expect(TypeService.formatCanonical(undefined, TYPE_HIERARCHY.ERROR)).toBe('');
    });

    test('should handle null/undefined values', () => {
      expect(TypeService.formatCanonical(null, TYPE_HIERARCHY.TEXT)).toBe('');
      expect(TypeService.formatCanonical(undefined, TYPE_HIERARCHY.NUMBER)).toBe('');
    });
  });
});

describe('isArrayType', () => {
  test('should return true for parameterized array types', () => {
    expect(isArrayType('ARRAY[Number]')).toBe(true);
    expect(isArrayType('ARRAY[Text]')).toBe(true);
    expect(isArrayType('ARRAY[Boolean]')).toBe(true);
    expect(isArrayType('ARRAY[Date]')).toBe(true);
    expect(isArrayType('ARRAY[Datetime]')).toBe(true);
  });

  test('should return false for non-array types', () => {
    expect(isArrayType('number')).toBe(false);
    expect(isArrayType('array')).toBe(false);
    expect(isArrayType('text')).toBe(false);
    expect(isArrayType(null)).toBe(false);
    expect(isArrayType(undefined)).toBe(false);
    expect(isArrayType(42)).toBe(false);
  });
});

describe('getArrayElementType', () => {
  test('should extract element type from parameterized array types', () => {
    expect(getArrayElementType('ARRAY[Number]')).toBe('Number');
    expect(getArrayElementType('ARRAY[Text]')).toBe('Text');
    expect(getArrayElementType('ARRAY[Boolean]')).toBe('Boolean');
  });

  test('should return null for non-array types', () => {
    expect(getArrayElementType('number')).toBeNull();
    expect(getArrayElementType('array')).toBeNull();
  });
});

// REMOVED: The following tests were for functions removed in refactor:
// - createTypedValue: No longer exists; use detectType instead
// - validateOperation: Operation validation now in CalculationEngine
// - performOperation: Operation execution now in CalculationEngine
