/**
 * @file Serial Date Utilities
 * @description OpenOffice/LibreOffice serial date format implementation for SC Spreadsheet.
 *
 * Implements two date types:
 * - **DATE**: Integer days since Dec 30, 1899 (day 0 = Dec 30, 1899; day 1 = Dec 31, 1899)
 * - **DATETIME**: Floating point days with fractional time component (e.g., 1.5 = Dec 31, 1899 at noon)
 *
 * **Key Features:**
 * - Date/time parsing with multiple format support (ISO, German, Japanese, Korean, etc.)
 * - Ambiguous date handling (MM/DD/YYYY vs DD/MM/YYYY based on user preference)
 * - Serial number conversion to/from date components
 * - Date arithmetic (add days, get difference)
 * - Canonical formatting for formula bar display
 */

import { TYPE_HIERARCHY } from './typeService.js';

/**
 * @typedef {Object} DateComponents
 * @property {number} year - Year (4 digits)
 * @property {number} month - Month (1-12, NOT 0-based)
 * @property {number} day - Day of month (1-31)
 */

/**
 * @typedef {Object} TimeComponents
 * @property {number} hour - Hour (0-23)
 * @property {number} minute - Minute (0-59)
 * @property {number} second - Second (0-59)
 */

/**
 * @typedef {Object} DateTimeComponents
 * @property {number} year - Year (4 digits)
 * @property {number} month - Month (1-12, NOT 0-based)
 * @property {number} day - Day of month (1-31)
 * @property {number} hour - Hour (0-23)
 * @property {number} minute - Minute (0-59)
 * @property {number} second - Second (0-59)
 */

/**
 * @typedef {Object} SerialResult
 * @property {boolean} success - Whether parsing succeeded
 * @property {number} [value] - The serial number (if success=true)
 * @property {string} [type] - The detected type ('date' or 'datetime', if success=true)
 * @property {string} [error] - Error message (if success=false)
 */

/**
 * Serial date epoch constants.
 * Epoch is December 30, 1899 (day 0).
 *
 * @constant {number} SERIAL_EPOCH_YEAR
 * @constant {number} SERIAL_EPOCH_MONTH - 0-based month (11 = December)
 * @constant {number} SERIAL_EPOCH_DAY - Day of month (30)
 */
const SERIAL_EPOCH_YEAR = 1899;
const SERIAL_EPOCH_MONTH = 11; // 0-based, December
const SERIAL_EPOCH_DAY = 30; // Day of month (December 30)

/**
 * Days in each month for non-leap years.
 * @constant {number[]}
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Date input format constants for ambiguous date resolution.
 *
 * Used when parsing dates in formats like MM/DD/YYYY vs DD/MM/YYYY where both
 * interpretations are valid (e.g., "03/04/2024" could be March 4 or April 3).
 *
 * @constant {Object}
 * @property {string} US - US format (MM/DD/YYYY)
 * @property {string} EU - European format (DD/MM/YYYY)
 */
export const DATE_INPUT_FORMAT = {
  US: 'US', // MM/DD/YYYY
  EU: 'EU'  // DD/MM/YYYY
};

/**
 * Checks if a year is a leap year.
 *
 * Uses the Gregorian calendar rule:
 * - Divisible by 4: leap year
 * - EXCEPT divisible by 100: not a leap year
 * - EXCEPT divisible by 400: leap year
 *
 * @param {number} year - The year to check (4-digit year)
 * @returns {boolean} True if the year is a leap year, false otherwise
 *
 * @example
 * isLeapYear(2000)  // true (divisible by 400)
 * isLeapYear(1900)  // false (divisible by 100 but not 400)
 * isLeapYear(2024)  // true (divisible by 4)
 */
export const isLeapYear = (year) => {
  return ((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0);
};

/**
 * Gets the number of days in a month, accounting for leap years.
 *
 * Returns 29 for February in leap years, otherwise uses the standard month lengths.
 *
 * @param {number} year - Year (4-digit year)
 * @param {number} month - Month (0-based: 0=Jan, 1=Feb, ..., 11=Dec)
 * @returns {number} Number of days in the specified month (28-31)
 */
export const getDaysInMonth = (year, month) => {
  // February in leap year
  if (month === 1 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month];
};

/**
 * Convert year/month/day to serial date number (integer).
 *
 * Converts a calendar date to an integer serial date, where day 0 = Dec 30, 1899,
 * day 1 = Dec 31, 1899, etc. This is compatible with OpenOffice/LibreOffice format.
 *
 * @param {number} year - Year (4 digits)
 * @param {number} month - Month (1-12, NOT 0-based like JavaScript Date)
 * @param {number} day - Day (1-31)
 * @returns {number|null} Serial date number (integer), or null if inputs are invalid
 *
 * @example
 * ymdToSerialDate(2024, 1, 15)   // 45306 (January 15, 2024)
 * ymdToSerialDate(1899, 12, 31)  // 1 (December 31, 1899)
 * ymdToSerialDate(2024, 2, 30)   // null (invalid date)
 */
export const ymdToSerialDate = (year, month, day) => {
  // Validate inputs
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  // Adjust month to 0-based
  /** @type {number} */
  const zeroBasedMonth = month - 1;

  // Validate month and day ranges
  if (zeroBasedMonth < 0 || zeroBasedMonth > 11) return null;
  if (day < 1 || day > getDaysInMonth(year, zeroBasedMonth)) return null;

  // Calculate days since epoch (Dec 30, 1899 = day 0)
  /** @type {number} */
  let totalDays = 0;

  // Add days for complete years after epoch year
  for (let y = SERIAL_EPOCH_YEAR + 1; y < year; y++) {
    totalDays += isLeapYear(y) ? 366 : 365;
  }

  // If we're in the epoch year (1899), only count days after Dec 30
  if (year === SERIAL_EPOCH_YEAR) {
    // Count days from Dec 30 to the target date within 1899
    // Only Dec 31 is valid (day 1), anything before Dec 30 is invalid
    if (zeroBasedMonth < SERIAL_EPOCH_MONTH || (zeroBasedMonth === SERIAL_EPOCH_MONTH && day < SERIAL_EPOCH_DAY)) {
      return null; // Before epoch
    }
    if (zeroBasedMonth === SERIAL_EPOCH_MONTH) {
      // December 1899
      totalDays = day - SERIAL_EPOCH_DAY; // Dec 31 - 30 = 1
    } else {
      return null; // Can't have month > December in 1899
    }
  } else {
    // For years after 1899, count remaining days in epoch year (Dec 31 = 1 day)
    totalDays += 1; // The one day left in 1899 after Dec 30

    // Add days for months in the current year
    for (let m = 0; m < zeroBasedMonth; m++) {
      totalDays += getDaysInMonth(year, m);
    }

    // Add days in current month
    totalDays += day;
  }

  return totalDays;
};

/**
 * Convert serial date (integer) to year/month/day.
 *
 * Inverse of ymdToSerialDate. Converts an integer serial date back to calendar components.
 * Epoch: day 0 = Dec 30, 1899, day 1 = Dec 31, 1899, etc.
 *
 * @param {number} serialDate - Serial date number (integer)
 * @returns {DateComponents|null} Date components with 1-based month, or null if invalid
 *
 * @example
 * serialDateToYmd(45306)  // { year: 2024, month: 1, day: 15 }
 * serialDateToYmd(1)      // { year: 1899, month: 12, day: 31 }
 * serialDateToYmd(-5)     // null (invalid serial date)
 */
export const serialDateToYmd = (serialDate) => {
  // Validate input
  if (!Number.isInteger(serialDate) || serialDate < 1) {
    return null;
  }

  // Prevent infinite loops with unreasonably large serial dates
  // Max reasonable serial date roughly corresponds to year 10000
  // (365.25 * (10000 - 1899) = ~2,957,000 days)
  if (serialDate > 3000000) {
    return null;
  }

  // Start from epoch date: Dec 30, 1899 and add serialDate days
  /** @type {number} */
  let year = SERIAL_EPOCH_YEAR;
  /** @type {number} */
  let month = SERIAL_EPOCH_MONTH; // 11 = December (0-based)
  /** @type {number} */
  let day = SERIAL_EPOCH_DAY + serialDate; // 30 + serialDate

  // Handle day overflow (advance through months/years)
  while (true) {
    /** @type {number} */
    const daysInCurrentMonth = getDaysInMonth(year, month);

    if (day <= daysInCurrentMonth) {
      // Day is valid for current month
      break;
    }

    // Day exceeds current month - advance to next month
    day -= daysInCurrentMonth;
    month++;

    if (month > 11) {
      // Advance to next year
      month = 0;
      year++;
    }
  }
  
  // Return with 1-based month
  return {
    year,
    month: month + 1,
    day
  };
};

/**
 * Convert time components to fractional day representation.
 *
 * Converts hours, minutes, and seconds into a fractional day value (0.0 to 0.99999...),
 * where 0.5 represents noon, 0.25 represents 6 AM, 0.75 represents 6 PM, etc.
 *
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @param {number} [second=0] - Second (0-59), defaults to 0
 * @returns {number} Fractional day (0.0 to 0.99999...), or 0 if inputs are invalid
 *
 * @example
 * timeToFractionalDay(12, 0, 0)  // 0.5 (noon)
 * timeToFractionalDay(6, 0, 0)   // 0.25 (6 AM)
 */
export const timeToFractionalDay = (hour, minute, second = 0) => {
  // Validate inputs
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return 0;
  }

  // Calculate seconds since midnight
  /** @type {number} */
  const totalSeconds = hour * 3600 + minute * 60 + second;

  // Convert to fraction of day (86400 seconds in a day)
  return totalSeconds / 86400;
};

/**
 * Convert fractional day to time components.
 *
 * Inverse of timeToFractionalDay. Converts a fractional day value (0.0 to 0.99999...)
 * back to hour, minute, and second components.
 *
 * @param {number} fractionalDay - Fractional day (0.0 to 0.99999...), values outside range are normalized
 * @param {boolean} [roundToSecond=false] - If true, rounds to nearest second; if false, preserves fractional seconds
 * @returns {TimeComponents} Time components with hour (0-23), minute (0-59), second (0-59 or 0-59.999...)
 *
 * @example
 * fractionalDayToTime(0.5)             // { hour: 12, minute: 0, second: 0 } (noon)
 * fractionalDayToTime(0.5, true)       // { hour: 12, minute: 0, second: 0 } (noon, rounded)
 * fractionalDayToTime(0.25)            // { hour: 6, minute: 0, second: 0 } (6 AM)
 */
export const fractionalDayToTime = (fractionalDay, roundToSecond = false) => {
  // Validate input
  if (fractionalDay < 0 || fractionalDay >= 1) {
    fractionalDay = fractionalDay - Math.floor(fractionalDay);
  }

  // Calculate total seconds
  /** @type {number} */
  let totalSeconds;
  if (roundToSecond) {
    // Round to nearest second
    totalSeconds = Math.round(fractionalDay * 86400);
  } else {
    // Round to nearest millisecond (0.001 second) to eliminate floating-point artifacts
    // while preserving sub-second precision
    totalSeconds = Math.round(fractionalDay * 86400 * 1000) / 1000;
  }

  // Extract hours, minutes, seconds
  /** @type {number} */
  const hour = Math.floor(totalSeconds / 3600);
  /** @type {number} */
  const remainingSeconds = totalSeconds - (hour * 3600);
  /** @type {number} */
  const minute = Math.floor(remainingSeconds / 60);
  /** @type {number} */
  const second = remainingSeconds - (minute * 60);

  return { hour, minute, second };
};

/**
 * Convert year/month/day and time to serial datetime
 * @param {number} year - Year (4 digits)
 * @param {number} month - Month (1-12)
 * @param {number} day - Day (1-31)
 * @param {number} [hour=0] - Hour (0-23), defaults to 0
 * @param {number} [minute=0] - Minute (0-59), defaults to 0
 * @param {number} [second=0] - Second (0-59), defaults to 0
 * @returns {number|null} Serial datetime (floating point), or null if inputs are invalid
 */
export const dateTimeToSerial = (year, month, day, hour = 0, minute = 0, second = 0) => {
  // Validate time components
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  // Get date component as integer
  /** @type {number|null} */
  const dateComponent = ymdToSerialDate(year, month, day);
  if (dateComponent === null) return null;

  // If this is a DATE type (time is midnight), return only the integer
  if (hour === 0 && minute === 0 && second === 0) {
    return dateComponent;
  }

  // Get time component as fraction
  /** @type {number} */
  const timeComponent = timeToFractionalDay(hour, minute, second);

  // Combine date and time components
  return dateComponent + timeComponent;
};

/**
 * Check if a date string is in a format that could be ambiguous.
 *
 * A date is ambiguous when both the first and second parts are numbers between 1-12,
 * making it unclear whether the format is MM/DD/YYYY or DD/MM/YYYY.
 *
 * @param {string} dateStr - The date string to check (e.g., "03/04/2024")
 * @returns {boolean} True if both first and second parts are 1-12 (ambiguous format)
 *
 * @example
 * isAmbiguousDateFormat("03/04/2024")  // true (could be March 4 or April 3)
 * isAmbiguousDateFormat("15/03/2024")  // false (must be DD/MM/YYYY, since 15 > 12)
 * isAmbiguousDateFormat("03/25/2024")  // false (must be MM/DD/YYYY, since 25 > 12)
 */
export const isAmbiguousDateFormat = (dateStr) => {
  // Split by common date separators
  /** @type {string[]} */
  const parts = dateStr.split(/[./-]/);
  if (parts.length !== 3) return false;

  // Check if first two parts are numbers between 1-12
  /** @type {number} */
  const first = parseInt(parts[0], 10);
  /** @type {number} */
  const second = parseInt(parts[1], 10);

  return first >= 1 && first <= 12 && second >= 1 && second <= 12;
};

/**
 * Configuration for supported date/datetime formats.
 *
 * **Format Detection Order:**
 * - DATETIME formats are checked first, then DATE formats (per [SC-DATA-313])
 * - This ensures "2024-01-15 12:00" is detected as DATETIME, not DATE
 *
 * **Format Structure:**
 * Each format object contains:
 * - `name`: Descriptive identifier for the format
 * - `regex`: Regular expression with named capture groups (year, month, day, hour, minute, sec)
 * - `type`: Either 'datetime' or 'date' (string literals to avoid initialization order issues)
 *
 * **Named Capture Groups:**
 * Standard groups: year, month, day, hour, minute, sec
 * Special ambiguous groups: first/second (for MM/DD vs DD/MM), sep (separator)
 * Special time groups: hour12/ampm (12-hour), militaryTime (HHMM format)
 *
 * @constant {Array<{name: string, regex: RegExp, type: string}>}
 * @inner
 */
const DATE_TIME_FORMATS = [
  // === DATETIME FORMATS ===

  // ISO datetime (YYYY-MM-DD HH:MM:SS) [SC-DATA-284]
  {
    name: 'ISO_DATETIME',
    regex: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))?$/,
    type: 'Datetime'
  },

  // ISO T datetime (YYYY-MM-DDThh:mm:ssZ) [SC-DATA-285]
  {
    name: 'ISO_T_DATETIME',
    regex: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))?Z?$/,
    type: 'Datetime'
  },

  // German/Scandinavian datetime (DD.MM.YYYY HH:MM:SS) [SC-DATA-538]
  {
    name: 'GERMAN_DATETIME',
    regex: /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4}) (?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))?$/,
    type: 'Datetime'
  },

  // Japanese/Chinese datetime (YYYY年MM月DD日 HH時MM分SS秒) [SC-DATA-539, 555]
  {
    name: 'JP_CN_DATETIME',
    regex: /^(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日 (?<hour>\d{1,2})時(?<minute>\d{1,2})分(?:(?<sec>\d{1,2})秒)?$/,
    type: 'Datetime'
  },

  // Korean datetime (YYYY년 MM월 DD일 HH:MM:SS) [SC-DATA-540]
  {
    name: 'KOREAN_DATETIME',
    regex: /^(?<year>\d{4})년 (?<month>\d{1,2})월 (?<day>\d{1,2})일 (?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))?$/,
    type: 'Datetime'
  },

  // Year-first datetime (YYYY/MM/DD HH:MM:SS) [SC-DATA-541]
  {
    name: 'YEAR_FIRST_DATETIME',
    regex: /^(?<year>\d{4})\/(?<month>\d{1,2})\/(?<day>\d{1,2}) (?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))?$/,
    type: 'Datetime'
  },

  // 12-hour format datetime (MM/DD/YYYY hh:mm AM/PM or DD/MM/YYYY hh:mm AM/PM) [SC-DATA-286, 554]
  {
    name: 'AMPM_DATETIME',
    regex: /^(?<first>\d{1,2})[/-](?<second>\d{1,2})[/-](?<year>\d{4}) (?<hour12>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))? (?<ampm>AM|PM)$/i,
    type: 'Datetime'
  },

  // Military time format (MM/DD/YYYY HHMM or DD/MM/YYYY HHMM) [SC-DATA-556]
  {
    name: 'MILITARY_DATETIME',
    regex: /^(?<first>\d{1,2})[/-](?<second>\d{1,2})[/-](?<year>\d{4}) (?<militaryTime>\d{4})$/,
    type: 'Datetime'
  },

  // Ambiguous datetime (MM/DD/YYYY HH:MM:SS or DD/MM/YYYY HH:MM:SS) [SC-DATA-534, 535]
  {
    name: 'AMBIGUOUS_DATETIME',
    regex: /^(?<first>\d{1,2})(?<sep>\/|-)(?<second>\d{1,2})\k<sep>(?<year>\d{4}) (?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<sec>\d{2}))?$/,
    type: 'Datetime'
  },

  // === DATE FORMATS ===

  // ISO date (YYYY-MM-DD) [SC-DATA-119]
  {
    name: 'ISO_DATE',
    regex: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
    type: 'Date'
  },

  // German/Scandinavian date (DD.MM.YYYY) [SC-DATA-538]
  {
    name: 'GERMAN_DATE',
    regex: /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/,
    type: 'Date'
  },

  // Japanese/Chinese date (YYYY年MM月DD日) [SC-DATA-539]
  {
    name: 'JP_CN_DATE',
    regex: /^(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日$/,
    type: 'Date'
  },

  // Korean date (YYYY년 MM월 DD일) [SC-DATA-540]
  {
    name: 'KOREAN_DATE',
    regex: /^(?<year>\d{4})년 (?<month>\d{1,2})월 (?<day>\d{1,2})일$/,
    type: 'Date'
  },

  // Year-first date (YYYY/MM/DD) [SC-DATA-541]
  {
    name: 'YEAR_FIRST_DATE',
    regex: /^(?<year>\d{4})\/(?<month>\d{1,2})\/(?<day>\d{1,2})$/,
    type: 'Date'
  },

  // Ambiguous date (MM/DD/YYYY or DD/MM/YYYY) [SC-DATA-532, 533]
  {
    name: 'AMBIGUOUS_DATE',
    regex: /^(?<first>\d{1,2})(?<sep>\/|-)(?<second>\d{1,2})\k<sep>(?<year>\d{4})$/,
    type: 'Date'
  }
];

/**
 * Extract date/time components from a regex match
 *
 * Handles various named group formats including ambiguous dates (first/second),
 * 12-hour time (hour12/ampm), and military time (militaryTime).
 *
 * @param {Object} match - Regex match object with named groups
 * @param {string} dateInputFormat - The spreadsheet's date input format setting (US or EU)
 * @returns {DateTimeComponents} Date and time components with 1-based month
 * @inner
 */
const extractComponents = (match, dateInputFormat) => {
  /** @type {Object<string, string>} */
  const g = match.groups;

  // Extract date components
  /** @type {number} */
  let year = parseInt(g.year, 10);
  /** @type {number} */
  let month, day;

  if (g.first && g.second) {
    // Ambiguous format - interpret based on setting [SC-DATA-510, 511]
    /** @type {number} */
    const first = parseInt(g.first, 10);
    /** @type {number} */
    const second = parseInt(g.second, 10);

    if (dateInputFormat === DATE_INPUT_FORMAT.US) {
      month = first;
      day = second;
    } else {
      day = first;
      month = second;
    }
  } else {
    month = parseInt(g.month, 10);
    day = parseInt(g.day, 10);
  }

  // Extract time components
  /** @type {number} */
  let hour = 0;
  /** @type {number} */
  let minute = 0;
  /** @type {number} */
  let second = 0;

  if (g.ampm) {
    // 12-hour format - convert to 24-hour
    hour = parseInt(g.hour12, 10);
    /** @type {string} */
    const ampm = g.ampm.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    minute = parseInt(g.minute, 10);
    second = g.sec ? parseInt(g.sec, 10) : 0;
  } else if (g.militaryTime) {
    // Military time format (HHMM)
    /** @type {number} */
    const timeNum = parseInt(g.militaryTime, 10);
    hour = Math.floor(timeNum / 100);
    minute = timeNum % 100;
  } else if (g.hour !== undefined) {
    // Standard time format
    hour = parseInt(g.hour, 10);
    minute = parseInt(g.minute, 10);
    second = g.sec ? parseInt(g.sec, 10) : 0;
  }

  return { year, month, day, hour, minute, second };
};

/**
 * Validate date/time components extracted from parsed date strings.
 *
 * Checks basic range validation for month (1-12), day (1-31), and time components.
 * Note: Does not validate day against month/year (e.g., Feb 30 would pass this check).
 *
 * @param {DateTimeComponents} components - Date and time components to validate
 * @returns {boolean} True if all components are within valid ranges
 * @inner
 */
const validateComponents = ({ month, day, hour, minute, second }) => {
  // Validate month
  if (month < 1 || month > 12) return false;

  // Validate day
  if (day < 1 || day > 31) return false;

  // Validate time components
  if (hour > 23 || minute > 59 || second > 59) return false;

  return true;
};

/**
 * Parse a string to a serial date/datetime value.
 *
 * Following the type detection sequence and format preferences [SC-DATA-313]:
 * - Tries DATETIME formats first, then DATE formats
 * - Uses dateInputFormat setting to resolve ambiguous dates (MM/DD vs DD/MM)
 * - Supports multiple international formats (ISO, German, Japanese, Korean, etc.)
 *
 * @param {string} value - String value to parse (e.g., "2024-01-15" or "01/15/2024 12:00")
 * @param {string} [dateInputFormat='US'] - The spreadsheet's date input format setting [SC-DATA-534]
 * @returns {SerialResult} Result object with success flag, serial number value, and detected type
 *
 * @example
 * parseStringToSerial("2024-01-15")                    // { success: true, value: 45306, type: 'Date' }
 * parseStringToSerial("2024-01-15 12:00:00")           // { success: true, value: 45306.5, type: 'Datetime' }
 * parseStringToSerial("03/04/2024", DATE_INPUT_FORMAT.US)  // March 4, 2024
 * parseStringToSerial("03/04/2024", DATE_INPUT_FORMAT.EU)  // April 3, 2024
 */
export const parseStringToSerial = (value, dateInputFormat = DATE_INPUT_FORMAT.US) => {
  if (!value || typeof value !== 'string') {
    return { success: false };
  }

  // Clean the input
  /** @type {string} */
  const trimmed = value.trim();

  // Try each format in order (DATETIME first, then DATE per [SC-DATA-313])
  for (const format of DATE_TIME_FORMATS) {
    /** @type {RegExpMatchArray|null} */
    const match = trimmed.match(format.regex);
    if (!match) continue;

    // Extract components using named groups
    /** @type {DateTimeComponents} */
    const components = extractComponents(match, dateInputFormat);

    // Validate components
    if (!validateComponents(components)) {
      return { success: false };
    }

    // Convert to serial number based on type
    const { year, month, day, hour, minute, second } = components;

    if (format.type === 'Datetime') {
      /** @type {number|null} */
      const serialDateTime = dateTimeToSerial(year, month, day, hour, minute, second);
      if (serialDateTime !== null) {
        return {
          success: true,
          value: serialDateTime,
          type: TYPE_HIERARCHY.DATETIME
        };
      }
    } else if (format.type === 'Date') {
      /** @type {number|null} */
      const serialDate = ymdToSerialDate(year, month, day);
      if (serialDate !== null) {
        return {
          success: true,
          value: serialDate,
          type: TYPE_HIERARCHY.DATE
        };
      }
    }
  }

  // No valid DATE or DATETIME detected
  return { success: false };
};
