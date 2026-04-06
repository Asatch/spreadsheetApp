/**
 * Jest Tests for Serial Date Utilities
 * Comprehensive tests based on requirements in `11_DATA_TYPES_REQUIREMENTS.md`
 */

import {
  ymdToSerialDate,
  serialDateToYmd,
  timeToFractionalDay,
  fractionalDayToTime,
  dateTimeToSerial,
  parseStringToSerial,
  DATE_INPUT_FORMAT,
  isLeapYear,
  getDaysInMonth
} from '../../utils/serialDate';

import { TYPE_HIERARCHY } from '../../utils/typeService';

describe('OpenOffice Date Utilities - Basic Functions', () => {
  describe('isLeapYear function', () => {
    it('should identify leap years correctly', () => {
      // Test leap years
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(2004)).toBe(true);
      expect(isLeapYear(2020)).toBe(true);
      expect(isLeapYear(2024)).toBe(true);

      // Test non-leap years
      expect(isLeapYear(1900)).toBe(false);
      expect(isLeapYear(2001)).toBe(false);
      expect(isLeapYear(2021)).toBe(false);
      expect(isLeapYear(2023)).toBe(false);
    });
  });

  describe('getDaysInMonth function', () => {
    it('should return correct days for each month', () => {
      // Test non-leap year (2023)
      expect(getDaysInMonth(2023, 0)).toBe(31); // January
      expect(getDaysInMonth(2023, 1)).toBe(28); // February (non-leap)
      expect(getDaysInMonth(2023, 2)).toBe(31); // March
      expect(getDaysInMonth(2023, 3)).toBe(30); // April
      expect(getDaysInMonth(2023, 4)).toBe(31); // May
      expect(getDaysInMonth(2023, 5)).toBe(30); // June
      expect(getDaysInMonth(2023, 6)).toBe(31); // July
      expect(getDaysInMonth(2023, 7)).toBe(31); // August
      expect(getDaysInMonth(2023, 8)).toBe(30); // September
      expect(getDaysInMonth(2023, 9)).toBe(31); // October
      expect(getDaysInMonth(2023, 10)).toBe(30); // November
      expect(getDaysInMonth(2023, 11)).toBe(31); // December

      // Test leap year (2024)
      expect(getDaysInMonth(2024, 1)).toBe(29); // February (leap year)
    });
  });
});

describe('OpenOffice Date Utilities - Date Conversions', () => {
  describe('ymdToSerialDate function', () => {
    it('should convert YMD to correct serial date', () => {
      // Base check - Dec 31, 1899 = serial date 1
      expect(ymdToSerialDate(1899, 12, 31)).toBe(1);
      
      // Modern dates
      expect(ymdToSerialDate(2023, 1, 1)).toBeGreaterThan(1); // Should be > 1
      expect(ymdToSerialDate(2023, 5, 18)).toBeGreaterThan(ymdToSerialDate(2023, 5, 17)); // Later date = higher serial
      
      // Test validation
      expect(ymdToSerialDate(2023, 0, 15)).toBe(null); // Invalid month (0)
      expect(ymdToSerialDate(2023, 13, 15)).toBe(null); // Invalid month (13)
      expect(ymdToSerialDate(2023, 4, 31)).toBe(null); // Invalid day (April has 30 days)
      expect(ymdToSerialDate(2023, "5", 15)).toBe(null); // Non-integer month
    });
    
    it('should handle leap years correctly', () => {
      // Feb 29 exists in leap years
      expect(ymdToSerialDate(2020, 2, 29)).not.toBe(null);
      // Feb 29 doesn't exist in non-leap years
      expect(ymdToSerialDate(2023, 2, 29)).toBe(null);
    });
  });

  describe('serialDateToYmd function', () => {
    it('should convert serial date to correct YMD', () => {
      // Base check - serial date 1 = Dec 31, 1899
      const date1 = serialDateToYmd(1);
      expect(date1.year).toBe(1899);
      expect(date1.month).toBe(12);
      expect(date1.day).toBe(31);
      
      // Random modern date - May 18, 2023
      const serialDate = ymdToSerialDate(2023, 5, 18);
      const date2 = serialDateToYmd(serialDate);
      expect(date2.year).toBe(2023);
      expect(date2.month).toBe(5);
      expect(date2.day).toBe(18);
      
      // Test round-trip conversion
      const ymd = { year: 2023, month: 7, day: 4 };
      const serial = ymdToSerialDate(ymd.year, ymd.month, ymd.day);
      const roundTrip = serialDateToYmd(serial);
      expect(roundTrip).toEqual(ymd);
      
      // Test validation
      expect(serialDateToYmd(0)).toBe(null); // Invalid serial (< 1)
      expect(serialDateToYmd(null)).toBe(null); // Null value
      expect(serialDateToYmd('123')).toBe(null); // Non-integer
    });
  });
});

describe('OpenOffice Date Utilities - Time Conversions', () => {
  describe('timeToFractionalDay function', () => {
    it('should convert time to correct fractional day value', () => {
      // Midnight = 0
      expect(timeToFractionalDay(0, 0, 0)).toBe(0);
      
      // Noon = 0.5 (half day)
      expect(timeToFractionalDay(12, 0, 0)).toBe(0.5);
      
      // End of day (23:59:59) = 0.999...
      const endOfDay = timeToFractionalDay(23, 59, 59);
      expect(endOfDay).toBeGreaterThan(0.99);
      expect(endOfDay).toBeLessThan(1);
      
      // Common times
      expect(timeToFractionalDay(6, 0, 0)).toBe(0.25); // 6 AM = 1/4 day
      expect(timeToFractionalDay(18, 0, 0)).toBe(0.75); // 6 PM = 3/4 day
      
      // Validation tests
      expect(timeToFractionalDay(24, 0, 0)).toBe(0); // Invalid hour
      expect(timeToFractionalDay(12, 60, 0)).toBe(0); // Invalid minute
      expect(timeToFractionalDay(12, 0, 60)).toBe(0); // Invalid second
    });
  });

  describe('fractionalDayToTime function', () => {
    it('should convert fractional day to correct time', () => {
      // Midnight = 0
      const midnight = fractionalDayToTime(0);
      expect(midnight.hour).toBe(0);
      expect(midnight.minute).toBe(0);
      expect(midnight.second).toBe(0);
      
      // Noon = 0.5
      const noon = fractionalDayToTime(0.5);
      expect(noon.hour).toBe(12);
      expect(noon.minute).toBe(0);
      expect(noon.second).toBe(0);
      
      // 6:30 AM = 0.27083333... (6.5/24)
      const morning = fractionalDayToTime(6.5/24);
      expect(morning.hour).toBe(6);
      expect(morning.minute).toBe(30);
      
      // Wrap values >= 1.0 (should discard whole days)
      const nextDay = fractionalDayToTime(1.5);
      expect(nextDay.hour).toBe(12);
      expect(nextDay.minute).toBe(0);
      
      // Handle negative values (should normalize)
      const negative = fractionalDayToTime(-0.25);
      expect(negative.hour).toBe(18); // -0.25 day = 0.75 day after normalization = 18 hours
      expect(negative.minute).toBe(0);
    });
  });
});

describe('OpenOffice Date Utilities - Combined DateTime Conversions', () => {
  describe('dateTimeToSerial function', () => {
    it('should convert date and time to correct serial number', () => {
      // Date only (midnight)
      const dateOnlySerial = dateTimeToSerial(2023, 5, 18);
      expect(Number.isInteger(dateOnlySerial)).toBe(true); // Should be integer for DATE
      
      // DateTime values
      const noonSerial = dateTimeToSerial(2023, 5, 18, 12, 0, 0);
      const midnightSerial = dateTimeToSerial(2023, 5, 18, 0, 0, 0);
      
      // Noon should be 0.5 more than midnight
      expect(noonSerial - midnightSerial).toBeCloseTo(0.5, 5);
      
      // Partial times
      const partialTime = dateTimeToSerial(2023, 5, 18, 6, 30, 15);
      expect(partialTime - midnightSerial).toBeCloseTo(0.27, 2); // ~6.5 hours ≈ 0.27 day
      
      // Validation test
      expect(dateTimeToSerial(2023, 13, 1)).toBe(null); // Invalid month
      expect(dateTimeToSerial(2023, 2, 29)).toBe(null); // Invalid date (2023 not leap year)
      expect(dateTimeToSerial(2023, 5, 18, 24, 0, 0)).toBe(null); // Invalid hour
    });
  });
});

describe('OpenOffice Date Utilities - String Parsing', () => {
  describe('parseStringToSerial with DATETIME detection', () => {
    it('should detect ISO format datetime (YYYY-MM-DD HH:MM:SS)', () => {
      // Test ISO format datetime [SC-DATA-284]
      const result = parseStringToSerial('2023-05-18 14:30:00', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      
      // Should match the direct construction
      const expected = dateTimeToSerial(2023, 5, 18, 14, 30, 0);
      expect(result.value).toBeCloseTo(expected, 10);
    });

    it('should detect ISO format with T separator (YYYY-MM-DDThh:mm:ssZ)', () => {
      // Test ISO standard datetime [SC-DATA-285]
      const result = parseStringToSerial('2023-05-18T14:30:00Z', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      
      // Should match the direct construction
      const expected = dateTimeToSerial(2023, 5, 18, 14, 30, 0);
      expect(result.value).toBeCloseTo(expected, 10);
    });

    it('should detect 12-hour format (MM/DD/YYYY hh:mm AM/PM or DD/MM/YYYY hh:mm AM/PM)', () => {
      // US Format [SC-DATA-286]
      const usResult = parseStringToSerial('05/18/2023 02:30 PM', DATE_INPUT_FORMAT.US);
      expect(usResult.success).toBe(true);
      expect(usResult.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(usResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
      
      // EU Format
      const euResult = parseStringToSerial('18/05/2023 02:30 PM', DATE_INPUT_FORMAT.EU);
      expect(euResult.success).toBe(true);
      expect(euResult.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(euResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);

      // AM Test
      const amResult = parseStringToSerial('05/18/2023 10:30 AM', DATE_INPUT_FORMAT.US);
      expect(amResult.success).toBe(true);
      expect(amResult.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(amResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 10, 30, 0), 10);

      // Noon/Midnight tests (12 AM = 00:00, 12 PM = 12:00)
      const noonResult = parseStringToSerial('05/18/2023 12:00 PM', DATE_INPUT_FORMAT.US);
      expect(noonResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 12, 0, 0), 10);
      
      const midnightResult = parseStringToSerial('05/18/2023 12:00 AM', DATE_INPUT_FORMAT.US);
      expect(midnightResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 0, 0, 0), 10);
    });

    it('should detect Japanese/Chinese datetime format', () => {
      // Japanese/Chinese format [SC-DATA-539, 555]
      const result = parseStringToSerial('2023年05月18日 14時30分00秒', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(result.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
    });

    it('should detect Korean datetime format', () => {
      // Korean format [SC-DATA-540]
      const result = parseStringToSerial('2023년 05월 18일 14:30:00', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(result.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
    });

    it('should detect year-first datetime format (YYYY/MM/DD HH:MM:SS)', () => {
      // Year-first format [SC-DATA-541]
      const result = parseStringToSerial('2023/05/18 14:30:00', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(result.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
    });

    it('should detect military time format (HHMM)', () => {
      // Military time format [SC-DATA-556]
      const usResult = parseStringToSerial('05/18/2023 1430', DATE_INPUT_FORMAT.US);
      expect(usResult.success).toBe(true);
      expect(usResult.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(usResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
      
      const euResult = parseStringToSerial('18/05/2023 1430', DATE_INPUT_FORMAT.EU);
      expect(euResult.success).toBe(true);
      expect(euResult.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(euResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
    });

    it('should support partial datetime with hours only', () => {
      // Partial datetime (hours only) [SC-DATA-558]
      const result = parseStringToSerial('05/18/2023 14:00', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATETIME);
      expect(result.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 0, 0), 10);
    });

    it('should handle ambiguous dates according to input format setting', () => {
      // US format: 05/18/2023 = May 18, 2023
      const usResult = parseStringToSerial('05/18/2023 14:30', DATE_INPUT_FORMAT.US);
      expect(usResult.success).toBe(true);
      expect(usResult.value).toBeCloseTo(dateTimeToSerial(2023, 5, 18, 14, 30, 0), 10);
      
      // EU format: 05/18/2023 should be INVALID - there's no 18th month
      const euResult = parseStringToSerial('05/18/2023 14:30', DATE_INPUT_FORMAT.EU);
      expect(euResult.success).toBe(false); // Invalid date format for EU
      
      // With US format, 13/05/2023 should be INVALID - there's no 13th month
      const nonAmbiguousUS = parseStringToSerial('13/05/2023 14:30', DATE_INPUT_FORMAT.US);
      expect(nonAmbiguousUS.success).toBe(false); // Per SC-DATA-534, US format should be respected
      
      // With EU format, 13/05/2023 is valid as 13th day of May
      const nonAmbiguousEU = parseStringToSerial('13/05/2023 14:30', DATE_INPUT_FORMAT.EU);
      expect(nonAmbiguousEU.success).toBe(true);
      expect(nonAmbiguousEU.value).toBeCloseTo(dateTimeToSerial(2023, 5, 13, 14, 30, 0), 10);
    });

    it('should reject invalid dates and times', () => {
      // Invalid month
      expect(parseStringToSerial('13/32/2023 14:30', DATE_INPUT_FORMAT.US).success).toBe(false);
      expect(parseStringToSerial('00/15/2023 14:30', DATE_INPUT_FORMAT.US).success).toBe(false);
      
      // Invalid day
      expect(parseStringToSerial('05/32/2023 14:30', DATE_INPUT_FORMAT.US).success).toBe(false);
      expect(parseStringToSerial('05/00/2023 14:30', DATE_INPUT_FORMAT.US).success).toBe(false);
      
      // Invalid time
      expect(parseStringToSerial('05/18/2023 24:30', DATE_INPUT_FORMAT.US).success).toBe(false);
      expect(parseStringToSerial('05/18/2023 14:60', DATE_INPUT_FORMAT.US).success).toBe(false);
      
      // Invalid format
      expect(parseStringToSerial('05-18/2023 14:30', DATE_INPUT_FORMAT.US).success).toBe(false);
      expect(parseStringToSerial('05/18/2023T14:30', DATE_INPUT_FORMAT.US).success).toBe(false);
    });
  });

  describe('parseStringToSerial with DATE detection', () => {
    it('should detect ISO format date (YYYY-MM-DD)', () => {
      // ISO format date [SC-DATA-119]
      const result = parseStringToSerial('2023-05-18', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      expect(result.value).toBe(ymdToSerialDate(2023, 5, 18));
    });

    it('should detect German/Scandinavian format (DD.MM.YYYY)', () => {
      // German/Scandinavian format [SC-DATA-538]
      const result = parseStringToSerial('18.05.2023', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      expect(result.value).toBe(ymdToSerialDate(2023, 5, 18));
    });

    it('should detect Japanese/Chinese format (YYYY年MM月DD日)', () => {
      // Japanese/Chinese format [SC-DATA-539]
      const result = parseStringToSerial('2023年05月18日', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      expect(result.value).toBe(ymdToSerialDate(2023, 5, 18));
    });

    it('should detect Korean format (YYYY년 MM월 DD일)', () => {
      // Korean format [SC-DATA-540]
      const result = parseStringToSerial('2023년 05월 18일', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      expect(result.value).toBe(ymdToSerialDate(2023, 5, 18));
    });

    it('should detect year-first format (YYYY/MM/DD)', () => {
      // Year-first format [SC-DATA-541]
      const result = parseStringToSerial('2023/05/18', DATE_INPUT_FORMAT.US);
      expect(result.success).toBe(true);
      expect(result.type).toBe(TYPE_HIERARCHY.DATE);
      expect(result.value).toBe(ymdToSerialDate(2023, 5, 18));
    });

    it('should handle ambiguous dates according to input format setting', () => {
      // US format: MM/DD/YYYY [SC-DATA-510]
      const usResult = parseStringToSerial('05/18/2023', DATE_INPUT_FORMAT.US);
      expect(usResult.success).toBe(true);
      expect(usResult.type).toBe(TYPE_HIERARCHY.DATE);
      expect(usResult.value).toBe(ymdToSerialDate(2023, 5, 18));
      
      // EU format: DD/MM/YYYY [SC-DATA-511]
      // 05/18/2023 should be INVALID in EU format - there's no 18th month
      const euResult = parseStringToSerial('05/18/2023', DATE_INPUT_FORMAT.EU);
      expect(euResult.success).toBe(false);
      
      // EU format with valid date: 05/10/2023 = 5th October 2023
      const validEuDate = parseStringToSerial('05/10/2023', DATE_INPUT_FORMAT.EU);
      expect(validEuDate.success).toBe(true);
      expect(validEuDate.type).toBe(TYPE_HIERARCHY.DATE);
      expect(validEuDate.value).toBe(ymdToSerialDate(2023, 10, 5));
      
      // With EU format setting, dates like MM/DD/YYYY where MM > 12 are rejected
      const invalidEuDate = parseStringToSerial('13/05/2023', DATE_INPUT_FORMAT.EU);
      expect(invalidEuDate.success).toBe(true); // This is actually a valid date in EU format (day/month)
      expect(invalidEuDate.value).toBe(ymdToSerialDate(2023, 5, 13));
      
      // 12/31/2025 is valid with US format as December 31
      const usDateDec = parseStringToSerial('12/31/2025', DATE_INPUT_FORMAT.US);
      expect(usDateDec.success).toBe(true);
      expect(usDateDec.value).toBe(ymdToSerialDate(2025, 12, 31));
      
      // But with EU format, 12/31/2025 is INVALID because there's no 31st month
      const euDateInvalid = parseStringToSerial('12/31/2025', DATE_INPUT_FORMAT.EU);
      expect(euDateInvalid.success).toBe(false);
    });

    it('should handle variants without leading zeros', () => {
      // No leading zeros [SC-DATA-543]
      const noLeadingZeros = parseStringToSerial('5/18/2023', DATE_INPUT_FORMAT.US);
      expect(noLeadingZeros.success).toBe(true);
      expect(noLeadingZeros.type).toBe(TYPE_HIERARCHY.DATE);
      expect(noLeadingZeros.value).toBe(ymdToSerialDate(2023, 5, 18));
    });

    it('should reject 2-digit years and invalid/partial formats', () => {
      // 2-digit years are not supported [SC-DATA-544]
      expect(parseStringToSerial('05/18/23', DATE_INPUT_FORMAT.US).success).toBe(false);
      
      // Partial dates are not supported [SC-DATA-545]
      expect(parseStringToSerial('10.2023', DATE_INPUT_FORMAT.US).success).toBe(false);
      
      // Text month formats are not supported [SC-DATA-546]
      expect(parseStringToSerial('Oct 15, 2023', DATE_INPUT_FORMAT.US).success).toBe(false);
    });
  });
});