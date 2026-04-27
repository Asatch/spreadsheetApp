import { TypeService, TYPE_HIERARCHY } from '../../utils/typeService';
import { DATE_INPUT_FORMAT } from '../../utils/serialDate';

describe('TypeService.detectType', () => {
  // These tests verify that TypeService.detectType correctly follows the type detection sequence
  // DATETIME -> DATE -> NUMBER -> TEXT [SC-DATA-313]

  describe('formula-like strings', () => {
    test('should treat formulas as text (formulas handled by canonicalValuesEngine)', () => {
      // detectType is for VALUES only, not formulas
      // Formulas are handled by canonicalValuesEngine.interpretInput()
      const result = TypeService.detectType('=A1+B2');
      expect(result.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result.canonicalValue).toBe("'=A1+B2"); // Treated as explicit text

      // Complex formula also treated as text
      const result2 = TypeService.detectType('=SUM(A1:B10)/2');
      expect(result2.type).toBe(TYPE_HIERARCHY.TEXT);
    });

    test('should handle formula-like strings with whitespace', () => {
      const result = TypeService.detectType('  =A1+B2  ');
      expect(result.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result.value).toBe('=A1+B2'); // Trimmed
    });
  });
  
  describe('explicit text detection', () => {
    test('should detect explicit text (starts with single quote)', () => {
      const result = TypeService.detectType("'123");
      expect(result.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result.value).toBe('123'); // Stores without the quote
      expect(result.canonicalValue).toBe("'123"); // Displays with the quote
      
      // Text that looks like a date
      const result2 = TypeService.detectType("'2023-01-01");
      expect(result2.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result2.value).toBe('2023-01-01');
    });
    
    test('should handle text with whitespace', () => {
      const result = TypeService.detectType("  '123  ");
      expect(result.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result.value).toBe('123');
    });
  });
  
  describe('date/datetime detection', () => {
    // These tests depend on integration with serialDate.js
    
    test('should detect datetime values before date values', () => {
      // A string with both date and time components should be detected as DATETIME
      const result = TypeService.detectType('2023-01-01 12:30:00');
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(typeof result.value).toBe('number'); // Serial datetime number
      // Match YYYY-MM-DD HH:MM:SS with optional fractional seconds
      expect(result.canonicalValue).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d*)?$/); 
    });
    
    test('should detect date values (no time component)', () => {
      // A string with only date component should be detected as DATE
      const result = TypeService.detectType('2023-01-01');
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      expect(typeof result.value).toBe('number'); // Serial date number
      expect(result.canonicalValue).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD
    });
    
    test('should handle date format preference', () => {
      // This is ambiguous between US (January 2) and EU (February 1)
      
      // With US format preference (MM/DD/YYYY)
      const resultUS = TypeService.detectType('01/02/2023', DATE_INPUT_FORMAT.US);
      expect(resultUS.type).toBe(TYPE_HIERARCHY.DATE);
      expect(resultUS.canonicalValue).toBe('2023-01-02'); // January 2
      
      // With EU format preference (DD/MM/YYYY)
      const resultEU = TypeService.detectType('01/02/2023', DATE_INPUT_FORMAT.EU);
      expect(resultEU.type).toBe(TYPE_HIERARCHY.DATE);
      expect(resultEU.canonicalValue).toBe('2023-02-01'); // February 1
    });
    
    test('should recognize unambiguous date formats regardless of preference', () => {
      // ISO format: YYYY-MM-DD (always recognized)
      const resultISO = TypeService.detectType('2023-01-02', DATE_INPUT_FORMAT.EU);
      expect(resultISO.type).toBe(TYPE_HIERARCHY.DATE);
      expect(resultISO.canonicalValue).toBe('2023-01-02'); // January 2
      
      // Year-first format: YYYY/MM/DD (always recognized)
      const resultYearFirst = TypeService.detectType('2023/01/02', DATE_INPUT_FORMAT.EU);
      expect(resultYearFirst.type).toBe(TYPE_HIERARCHY.DATE);
      expect(resultYearFirst.canonicalValue).toBe('2023-01-02'); // January 2
    });
  });
  
  describe('number detection', () => {
    test('should detect simple numbers', () => {
      // Integer
      const result1 = TypeService.detectType('123');
      expect(result1.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result1.value).toBe(123);
      
      // Decimal
      const result2 = TypeService.detectType('123.45');
      expect(result2.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result2.value).toBe(123.45);
      
      // Negative
      const result3 = TypeService.detectType('-123.45');
      expect(result3.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result3.value).toBe(-123.45);
    });
    
    test('should detect scientific notation', () => {
      const result = TypeService.detectType('1.23e5');
      expect(result.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result.value).toBe(123000);
    });
    
    test('should detect percentages', () => {
      const result = TypeService.detectType('50%');
      expect(result.type).toBe(TYPE_HIERARCHY.NUMBER);
      expect(result.value).toBe(0.5); // 50% = 0.5
    });
  });
  
  describe('fallback to text', () => {
    test('should detect as text when other types fail', () => {
      // Not a valid date, datetime, or number
      const result = TypeService.detectType('Hello world');
      expect(result.type).toBe(TYPE_HIERARCHY.TEXT);
      expect(result.value).toBe('Hello world');
      expect(result.canonicalValue).toBe("'Hello world");
      
      // Looks like a date but isn't valid
      const result2 = TypeService.detectType('2023-13-32'); // Invalid month/day
      expect(result2.type).toBe(TYPE_HIERARCHY.TEXT);
      
      // Two-digit year dates are not supported
      const result3 = TypeService.detectType('01/02/23'); // With 2-digit year
      expect(result3.type).toBe(TYPE_HIERARCHY.TEXT);
    });
  });
  
  // Note: We no longer support handling JavaScript Date objects directly
  // All dates are represented using serial date numbers:
  // - DATE: Integer days since Dec 30, 1899 [SC-DATA-306]
  // - DATETIME: Floating point days with fraction for time [SC-DATA-307]
  // See serialDate.js and the integration tests for detailed tests of date handling
  
  describe('handling other special values', () => {
    test('should handle null and undefined', () => {
      // Null and undefined should be detected as empty text
      expect(TypeService.detectType(null).type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType(null).value).toBe('');
      
      expect(TypeService.detectType(undefined).type).toBe(TYPE_HIERARCHY.TEXT);
      expect(TypeService.detectType(undefined).value).toBe('');
    });
    
    test('should handle error objects', () => {
      // Error objects should retain their error type
      const errorObj = { error: '#DIV/0!' };
      const result = TypeService.detectType(errorObj);
      expect(result.type).toBe(TYPE_HIERARCHY.ERROR);
      expect(result.error).toBe('#DIV/0!');
    });
  });
});