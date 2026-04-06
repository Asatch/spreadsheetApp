/**
 * Tests for Date Formatter
 *
 * Tests date/datetime formatting functions that convert serial dates
 * to formatted strings in various patterns.
 */

import {
  formatDate,
  formatDateTime,
  formatTime,
  getMonthName,
  getDateFormatDefaults,
  getDateTimeFormatDefaults,
  validateDateFormat,
  validateDateTimeFormat,
  DATE_FORMATS,
  DATETIME_FORMATS,
  TIME_FORMATS
} from '../../utils/dateFormatter';
import { ymdToSerialDate, dateTimeToSerial } from '../../utils/serialDate';

describe('dateFormatter', () => {
  describe('getMonthName', () => {
    it('should return correct month names', () => {
      expect(getMonthName(0)).toBe('January');
      expect(getMonthName(1)).toBe('February');
      expect(getMonthName(5)).toBe('June');
      expect(getMonthName(11)).toBe('December');
    });

    it('should return empty string for invalid indices', () => {
      expect(getMonthName(-1)).toBe('');
      expect(getMonthName(12)).toBe('');
      expect(getMonthName(100)).toBe('');
    });
  });

  describe('formatDate', () => {
    // Oct 15, 2023
    const testSerial = ymdToSerialDate(2023, 10, 15);

    it('should format in ISO format (YYYY-MM-DD)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.ISO)).toBe('2023-10-15');
    });

    it('should format in US format (MM/DD/YYYY)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.US)).toBe('10/15/2023');
    });

    it('should format in EU format (DD/MM/YYYY)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.EU)).toBe('15/10/2023');
    });

    it('should format in short year US format (MM/DD/YY)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.SHORT_YEAR_US)).toBe('10/15/23');
    });

    it('should format in short year EU format (DD/MM/YY)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.SHORT_YEAR_EU)).toBe('15/10/23');
    });

    it('should format in long US format (MMMM DD, YYYY)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.US_LONG)).toBe('October 15, 2023');
    });

    it('should format in long EU format (DD MMMM, YYYY)', () => {
      expect(formatDate(testSerial, DATE_FORMATS.EU_LONG)).toBe('15 October, 2023');
    });

    it('should use ISO format as default', () => {
      expect(formatDate(testSerial)).toBe('2023-10-15');
    });

    it('should handle edge case dates', () => {
      // Jan 1, 2000
      const y2k = ymdToSerialDate(2000, 1, 1);
      expect(formatDate(y2k, DATE_FORMATS.ISO)).toBe('2000-01-01');

      // Dec 31, 1899 (serial date 1)
      expect(formatDate(1, DATE_FORMATS.ISO)).toBe('1899-12-31');
    });

    it('should return empty string for invalid serial dates', () => {
      expect(formatDate(0)).toBe('');
      expect(formatDate(-1)).toBe('');
      expect(formatDate(null)).toBe('');
      expect(formatDate(undefined)).toBe('');
    });

    it('should handle fractional serial dates (floor to integer)', () => {
      const serialWithFraction = testSerial + 0.5; // Oct 15, 2023 at noon
      expect(formatDate(serialWithFraction, DATE_FORMATS.ISO)).toBe('2023-10-15');
    });
  });

  describe('formatDateTime', () => {
    // Oct 15, 2023 at 2:30:45 PM
    const testSerial = dateTimeToSerial(2023, 10, 15, 14, 30, 45);

    it('should format in ISO format (YYYY-MM-DD HH:mm:ss)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.ISO)).toBe('2023-10-15 14:30:45');
    });

    it('should format in ISO short format (YYYY-MM-DD HH:mm)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.ISO_SHORT)).toBe('2023-10-15 14:30');
    });

    it('should format in ISO T format (YYYY-MM-DDTHH:mm:ss)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.ISO_T)).toBe('2023-10-15T14:30:45');
    });

    it('should format in US 24-hour format (MM/DD/YYYY HH:mm:ss)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.US)).toBe('10/15/2023 14:30:45');
    });

    it('should format in EU 24-hour format (DD/MM/YYYY HH:mm:ss)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.EU)).toBe('15/10/2023 14:30:45');
    });

    it('should format in US 12-hour format (MM/DD/YYYY hh:mm A)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.US_12H)).toBe('10/15/2023 02:30 PM');
    });

    it('should format in EU 12-hour format (DD/MM/YYYY hh:mm A)', () => {
      expect(formatDateTime(testSerial, DATETIME_FORMATS.EU_12H)).toBe('15/10/2023 02:30 PM');
    });

    it('should handle AM times correctly', () => {
      // Oct 15, 2023 at 9:15:30 AM
      const amSerial = dateTimeToSerial(2023, 10, 15, 9, 15, 30);
      expect(formatDateTime(amSerial, DATETIME_FORMATS.US_12H)).toBe('10/15/2023 09:15 AM');
    });

    it('should handle midnight correctly', () => {
      // Oct 15, 2023 at 00:00:00
      const midnight = dateTimeToSerial(2023, 10, 15, 0, 0, 0);
      expect(formatDateTime(midnight, DATETIME_FORMATS.US_12H)).toBe('10/15/2023 12:00 AM');
      expect(formatDateTime(midnight, DATETIME_FORMATS.ISO)).toBe('2023-10-15 00:00:00');
    });

    it('should handle noon correctly', () => {
      // Oct 15, 2023 at 12:00:00
      const noon = dateTimeToSerial(2023, 10, 15, 12, 0, 0);
      expect(formatDateTime(noon, DATETIME_FORMATS.US_12H)).toBe('10/15/2023 12:00 PM');
      expect(formatDateTime(noon, DATETIME_FORMATS.ISO)).toBe('2023-10-15 12:00:00');
    });

    it('should use ISO format as default', () => {
      expect(formatDateTime(testSerial)).toBe('2023-10-15 14:30:45');
    });

    it('should return empty string for invalid serial dates', () => {
      expect(formatDateTime(0)).toBe('');
      expect(formatDateTime(-1)).toBe('');
      expect(formatDateTime(null)).toBe('');
      expect(formatDateTime(undefined)).toBe('');
    });

    it('should handle H (no padding) vs HH (padded) for hours', () => {
      // 9:15 AM (single digit hour)
      const serial = dateTimeToSerial(2023, 10, 15, 9, 15, 0);
      expect(formatDateTime(serial, 'HH:mm')).toBe('09:15');
      expect(formatDateTime(serial, 'H:mm')).toBe('9:15');
    });

    it('should handle h (no padding) vs hh (padded) for 12-hour', () => {
      // 9:15 AM (single digit hour in 12h format)
      const serial = dateTimeToSerial(2023, 10, 15, 9, 15, 0);
      expect(formatDateTime(serial, 'hh:mm A')).toBe('09:15 AM');
      expect(formatDateTime(serial, 'h:mm A')).toBe('9:15 AM');
    });
  });

  describe('formatTime', () => {
    it('should format time in 24-hour standard format (HH:mm:ss)', () => {
      // 2:30:45 PM = 14:30:45
      const serial = dateTimeToSerial(2023, 10, 15, 14, 30, 45);
      expect(formatTime(serial, TIME_FORMATS.STANDARD)).toBe('14:30:45');
    });

    it('should format time in 24-hour short format (HH:mm)', () => {
      const serial = dateTimeToSerial(2023, 10, 15, 14, 30, 45);
      expect(formatTime(serial, TIME_FORMATS.SHORT)).toBe('14:30');
    });

    it('should format time in 12-hour format (hh:mm A)', () => {
      const serial = dateTimeToSerial(2023, 10, 15, 14, 30, 45);
      expect(formatTime(serial, TIME_FORMATS.HOUR_12H)).toBe('02:30 PM');
    });

    it('should format time in 12-hour with seconds (hh:mm:ss A)', () => {
      const serial = dateTimeToSerial(2023, 10, 15, 14, 30, 45);
      expect(formatTime(serial, TIME_FORMATS.HOUR_12H_WITH_SECONDS)).toBe('02:30:45 PM');
    });

    it('should handle midnight', () => {
      const serial = dateTimeToSerial(2023, 10, 15, 0, 0, 0);
      expect(formatTime(serial, TIME_FORMATS.HOUR_12H)).toBe('12:00 AM');
      expect(formatTime(serial, TIME_FORMATS.STANDARD)).toBe('00:00:00');
    });

    it('should handle noon', () => {
      const serial = dateTimeToSerial(2023, 10, 15, 12, 0, 0);
      expect(formatTime(serial, TIME_FORMATS.HOUR_12H)).toBe('12:00 PM');
      expect(formatTime(serial, TIME_FORMATS.STANDARD)).toBe('12:00:00');
    });

    it('should use standard format as default', () => {
      const serial = dateTimeToSerial(2023, 10, 15, 14, 30, 45);
      expect(formatTime(serial)).toBe('14:30:45');
    });

    it('should ignore date portion and format only time', () => {
      const serial1 = dateTimeToSerial(2023, 10, 15, 14, 30, 45);
      const serial2 = dateTimeToSerial(2020, 1, 1, 14, 30, 45);
      // Same time, different dates should produce same result
      expect(formatTime(serial1)).toBe(formatTime(serial2));
    });

    it('should return empty string for negative values', () => {
      expect(formatTime(-1)).toBe('');
    });

    it('should handle zero (special case)', () => {
      // Zero represents the epoch date with no time component
      expect(formatTime(0, TIME_FORMATS.STANDARD)).toBe('00:00:00');
    });
  });

  describe('getDateFormatDefaults', () => {
    it('should return defaults with displayFormat', () => {
      const defaults = getDateFormatDefaults();
      expect(defaults).toHaveProperty('displayFormat');
      expect(defaults.displayFormat).toBe('YYYY-MM-DD');
    });
  });

  describe('getDateTimeFormatDefaults', () => {
    it('should return defaults with displayFormat and displayType', () => {
      const defaults = getDateTimeFormatDefaults();
      expect(defaults).toHaveProperty('displayFormat');
      expect(defaults).toHaveProperty('displayType');
      expect(defaults.displayFormat).toBe('YYYY-MM-DD HH:mm:ss');
      expect(defaults.displayType).toBe('datetime');
    });
  });

  describe('validateDateFormat', () => {
    it('should validate correct date format settings', () => {
      const result = validateDateFormat({ displayFormat: 'YYYY-MM-DD' });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should accept all valid DATE_FORMATS', () => {
      Object.values(DATE_FORMATS).forEach(format => {
        const result = validateDateFormat({ displayFormat: format });
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid format', () => {
      const result = validateDateFormat({ displayFormat: 'INVALID' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid DATE displayFormat: INVALID');
    });

    it('should reject missing displayFormat', () => {
      const result = validateDateFormat({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DATE format missing displayFormat');
    });

    it('should reject non-object input', () => {
      const result = validateDateFormat(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DATE format must be an object');
    });
  });

  describe('validateDateTimeFormat', () => {
    it('should validate correct datetime format settings', () => {
      const result = validateDateTimeFormat({
        displayFormat: 'YYYY-MM-DD HH:mm:ss',
        displayType: 'datetime'
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should accept all valid DATETIME_FORMATS', () => {
      Object.values(DATETIME_FORMATS).forEach(format => {
        const result = validateDateTimeFormat({
          displayFormat: format,
          displayType: 'datetime'
        });
        expect(result.valid).toBe(true);
      });
    });

    it('should accept all valid TIME_FORMATS', () => {
      Object.values(TIME_FORMATS).forEach(format => {
        const result = validateDateTimeFormat({
          displayFormat: format,
          displayType: 'timeOnly'
        });
        expect(result.valid).toBe(true);
      });
    });

    it('should accept displayType timeOnly', () => {
      const result = validateDateTimeFormat({
        displayFormat: 'HH:mm:ss',
        displayType: 'timeOnly'
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid displayFormat', () => {
      const result = validateDateTimeFormat({
        displayFormat: 'INVALID',
        displayType: 'datetime'
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid DATETIME displayFormat: INVALID');
    });

    it('should reject invalid displayType', () => {
      const result = validateDateTimeFormat({
        displayFormat: 'YYYY-MM-DD HH:mm:ss',
        displayType: 'invalid'
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid DATETIME displayType: invalid');
    });

    it('should reject missing displayFormat', () => {
      const result = validateDateTimeFormat({ displayType: 'datetime' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DATETIME format missing displayFormat');
    });

    it('should reject missing displayType', () => {
      const result = validateDateTimeFormat({ displayFormat: 'YYYY-MM-DD HH:mm:ss' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DATETIME format missing displayType');
    });

    it('should reject non-object input', () => {
      const result = validateDateTimeFormat(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DATETIME format must be an object');
    });
  });

  describe('Edge Cases', () => {
    it('should handle leap year dates', () => {
      // Feb 29, 2024 (leap year)
      const leapDay = ymdToSerialDate(2024, 2, 29);
      expect(formatDate(leapDay, DATE_FORMATS.ISO)).toBe('2024-02-29');
    });

    it('should handle end of year', () => {
      const newYearsEve = ymdToSerialDate(2023, 12, 31);
      expect(formatDate(newYearsEve, DATE_FORMATS.ISO)).toBe('2023-12-31');
    });

    it('should handle beginning of year', () => {
      const newYearsDay = ymdToSerialDate(2024, 1, 1);
      expect(formatDate(newYearsDay, DATE_FORMATS.ISO)).toBe('2024-01-01');
    });

    it('should handle times near midnight boundary', () => {
      // 23:59:59
      const almostMidnight = dateTimeToSerial(2023, 10, 15, 23, 59, 59);
      expect(formatDateTime(almostMidnight, DATETIME_FORMATS.ISO)).toBe('2023-10-15 23:59:59');
    });
  });
});
