import { TypeService, TYPE_HIERARCHY } from '../../utils/typeService';
import {
  ymdToSerialDate,
  dateTimeToSerial,
  serialDateToYmd,
  DATE_INPUT_FORMAT
} from '../../utils/serialDate';

/**
 * Integration tests between TypeService and serialDate.js
 * Verifies that the TypeService correctly handles serial date values
 * according to the requirements in SC-DATA-306 and SC-DATA-307
 */
describe('TypeService and serialDate.js integration', () => {
  
  describe('type validation', () => {
    test('should correctly validate DATE type (integer serial numbers)', () => {
      // Valid DATE values
      const dateSerial = ymdToSerialDate(2023, 1, 1); // January 1, 2023
      expect(TypeService.isType(dateSerial, TYPE_HIERARCHY.DATE)).toBe(true);
      
      // Invalid DATE values (non-integer)
      const datetimeSerial = dateTimeToSerial(2023, 1, 1, 12, 30, 0); // Has time component
      expect(TypeService.isType(datetimeSerial, TYPE_HIERARCHY.DATE)).toBe(false);
      
      // Invalid DATE values (not a number)
      expect(TypeService.isType('2023-01-01', TYPE_HIERARCHY.DATE)).toBe(false);
      
      // Invalid DATE values (less than 1)
      expect(TypeService.isType(0, TYPE_HIERARCHY.DATE)).toBe(false);
      expect(TypeService.isType(-10, TYPE_HIERARCHY.DATE)).toBe(false);
    });
    
    test('should correctly validate DATETIME type (numeric serial numbers)', () => {
      // Valid DATETIME values (integer or float)
      const dateSerial = ymdToSerialDate(2023, 1, 1); // January 1, 2023
      expect(TypeService.isType(dateSerial, TYPE_HIERARCHY.DATETIME)).toBe(true);
      
      const datetimeSerial = dateTimeToSerial(2023, 1, 1, 12, 30, 0); // With time
      expect(TypeService.isType(datetimeSerial, TYPE_HIERARCHY.DATETIME)).toBe(true);
      
      // Invalid DATETIME values (not a number)
      expect(TypeService.isType('2023-01-01 12:30:00', TYPE_HIERARCHY.DATETIME)).toBe(false);
      
      // Invalid DATETIME values (less than 1)
      expect(TypeService.isType(0, TYPE_HIERARCHY.DATETIME)).toBe(false);
      expect(TypeService.isType(-10, TYPE_HIERARCHY.DATETIME)).toBe(false);
    });
  });
  
  describe('date string detection', () => {
    test('should correctly parse ISO date strings', () => {
      const result = TypeService.detectType('2023-01-01');
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      
      // Verify the parsed value is correct by converting back to YMD
      const { year, month, day } = serialDateToYmd(result.value);
      expect(year).toBe(2023);
      expect(month).toBe(1); // January
      expect(day).toBe(1);
    });
    
    test('should correctly parse ISO datetime strings', () => {
      const result = TypeService.detectType('2023-01-01 12:30:45');
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);

      // Verify by formatting back to canonical (serialToDateTime doesn't exist)
      const formatted = TypeService.formatCanonical(result.value, TYPE_HIERARCHY.DATETIME);
      expect(formatted).toBe('2023-01-01 12:30:45');
    });
    
    test('should handle ambiguous date formats according to preferences', () => {
      // US format: MM/DD/YYYY
      const resultUS = TypeService.detectType('02/03/2023', DATE_INPUT_FORMAT.US);
      expect(resultUS.type).toBe(TYPE_HIERARCHY.DATE);
      
      const dateUS = serialDateToYmd(resultUS.value);
      expect(dateUS.month).toBe(2); // February
      expect(dateUS.day).toBe(3);
      
      // EU format: DD/MM/YYYY
      const resultEU = TypeService.detectType('02/03/2023', DATE_INPUT_FORMAT.EU);
      expect(resultEU.type).toBe(TYPE_HIERARCHY.DATE);
      
      const dateEU = serialDateToYmd(resultEU.value);
      expect(dateEU.month).toBe(3); // March
      expect(dateEU.day).toBe(2);
    });
  });
  
  describe('canonicalValue formatting', () => {
    test('should format DATE values in ISO format (YYYY-MM-DD)', () => {
      const dateSerial = ymdToSerialDate(2023, 1, 1); // January 1, 2023
      const formatted = TypeService.formatCanonical(dateSerial, TYPE_HIERARCHY.DATE);
      expect(formatted).toBe('2023-01-01');
    });
    
    test('should format DATETIME values in ISO format with time (YYYY-MM-DD HH:MM:SS)', () => {
      const datetimeSerial = dateTimeToSerial(2023, 1, 1, 12, 30, 45);
      const formatted = TypeService.formatCanonical(datetimeSerial, TYPE_HIERARCHY.DATETIME);
      expect(formatted).toBe('2023-01-01 12:30:45');
    });
    
    test('should preserve fractional seconds with millisecond rounding', () => {
      // System rounds to millisecond precision to avoid floating-point artifacts

      // Half-second precision
      const halfSecond = dateTimeToSerial(2023, 1, 1, 12, 30, 45.5);
      const formattedHalf = TypeService.formatCanonical(halfSecond, TYPE_HIERARCHY.DATETIME);
      expect(formattedHalf).toBe('2023-01-01 12:30:45.5');

      // Quarter-second precision
      const quarterSecond = dateTimeToSerial(2023, 1, 1, 12, 30, 45.25);
      const formattedQuarter = TypeService.formatCanonical(quarterSecond, TYPE_HIERARCHY.DATETIME);
      expect(formattedQuarter).toBe('2023-01-01 12:30:45.25');

      // Millisecond precision - rounded due to floating-point
      const milliseconds = dateTimeToSerial(2023, 1, 1, 12, 30, 45.123);
      const formattedMs = TypeService.formatCanonical(milliseconds, TYPE_HIERARCHY.DATETIME);
      // Expect millisecond rounding applied
      expect(formattedMs).toMatch(/^2023-01-01 12:30:45\.123/);
    });
  });
});