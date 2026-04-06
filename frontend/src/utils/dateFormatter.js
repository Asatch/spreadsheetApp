/**
 * Date utility functions for SC Spreadsheet
 * This module handles date detection, parsing, formatting, and operations
 * 
 * IMPORTANT: This module uses the OpenOffice/LibreOffice serial date format:
 * - DATE type: Integer days since Dec 30, 1899 [SC-DATA-306]
 * - DATETIME type: Floating point days with fraction for time [SC-DATA-307]
 */

import {
  serialDateToYmd,
  fractionalDayToTime
} from './serialDate.js';

/**
 * Convert underscore-separated constant names to human-readable labels
 * Example: "SHORT_YEAR_US" -> "SHORT YEAR US"
 */
function formatLabel(key) {
  return key.split('_').join(' ');
}

// Regex patterns for formatting (pattern replacement in format strings)
const REGEX_PATTERNS = {
  datePatterns: /YYYY|YY|MMMM|MM|DD/g,
  dateTimePatterns: /YYYY|YY|MMMM|MM|DD|HH|H|hh|h|mm|ss|A/g,
  timePatterns: /HH|H|hh|h|mm|ss|A/g
};

// Different date format patterns to detect
export const DATE_FORMATS = {
  ISO: 'YYYY-MM-DD',     // 2023-10-15
  US: 'MM/DD/YYYY',      // 10/15/2023
  EU: 'DD/MM/YYYY',      // 15/10/2023
  SHORT_YEAR_US: 'MM/DD/YY',  // 10/15/23
  SHORT_YEAR_EU: 'DD/MM/YY',   // 15/10/23
  US_LONG: 'MMMM DD, YYYY',    // January 15, 2023
  EU_LONG: 'DD MMMM, YYYY'     // 15 January, 2023
};

// Different datetime format patterns to detect
export const DATETIME_FORMATS = {
  ISO: 'YYYY-MM-DD HH:mm:ss',           // 2023-10-15 14:30:00
  ISO_SHORT: 'YYYY-MM-DD HH:mm',        // 2023-10-15 14:30
  ISO_T: 'YYYY-MM-DDTHH:mm:ss',         // 2023-10-15T14:30:00
  ISO_TZ: 'YYYY-MM-DDTHH:mm:ssZ',       // 2023-10-15T14:30:00Z
  US: 'MM/DD/YYYY HH:mm:ss',            // 10/15/2023 14:30:00
  US_24H: 'MM/DD/YYYY H:mm',            // 10/15/2023 14:30
  EU: 'DD/MM/YYYY HH:mm:ss',            // 15/10/2023 14:30:00
  EU_24H: 'DD/MM/YYYY H:mm',            // 15/10/2023 14:30
  US_12H: 'MM/DD/YYYY hh:mm A',         // 10/15/2023 02:30 PM
  EU_12H: 'DD/MM/YYYY hh:mm A',         // 15/10/2023 02:30 PM
  ISO_12H: 'YYYY-MM-DD h:mm A'          // 2023-10-15 2:30 PM
};

// Time-only format patterns (for displaying just time component of datetime values)
export const TIME_FORMATS = {
  STANDARD: 'HH:mm:ss',                 // 14:30:00 (24-hour with seconds)
  SHORT: 'HH:mm',                       // 14:30 (24-hour without seconds)
  HOUR_12H: 'hh:mm A',                  // 02:30 PM (12-hour without seconds)
  HOUR_12H_WITH_SECONDS: 'hh:mm:ss A'  // 02:30:00 PM (12-hour with seconds)
};

/**
 * DATE FORMAT CONFIGURATION
 * Single source of truth for date formatting options
 */
export const DATE_FORMAT_CONFIG = {
  type: 'DATE',

  fields: {
    displayFormat: {
      id: 'displayFormat',
      type: 'select',
      label: 'Date Format',
      default: 'YYYY-MM-DD',
      options: Object.entries(DATE_FORMATS).map(([key, value]) => ({
        value,
        label: `${value} (${formatLabel(key)})`
      }))
    },
    dateInputFormat: {
      id: 'dateInputFormat',
      type: 'select',
      label: 'Date Entry Format',
      default: 'US',
      options: [
        { value: 'US', label: 'US (MM/DD/YYYY)' },
        { value: 'EU', label: 'European (DD/MM/YYYY)' }
      ]
    }
  }
};

/**
 * DATETIME FORMAT CONFIGURATION
 * Single source of truth for datetime formatting options
 */
export const DATETIME_FORMAT_CONFIG = {
  type: 'DATETIME',

  fields: {
    displayType: {
      id: 'displayType',
      type: 'select',
      label: 'Display Format',
      default: 'datetime',
      options: [
        { value: 'datetime', label: 'Date & Time' },
        { value: 'timeOnly', label: 'Time Only' }
      ]
    },
    displayFormat: {
      id: 'displayFormat',
      type: 'select',
      label: 'Format Pattern',
      default: 'YYYY-MM-DD HH:mm:ss',
      // Options are dynamic based on displayType, handled in getDateTimeFormatDefaults
      options: [] // Placeholder, will be populated dynamically
    }
  }
};

/**
 * Get default format settings for DATE
 * @returns {Object} Default DATE format settings
 */
export function getDateFormatDefaults() {
  const defaults = {};

  for (const [fieldId, fieldDef] of Object.entries(DATE_FORMAT_CONFIG.fields)) {
    defaults[fieldId] = fieldDef.default;
  }

  return defaults;
}

/**
 * Get default format settings for DATETIME
 * @returns {Object} Default DATETIME format settings
 */
export function getDateTimeFormatDefaults() {
  const defaults = {};

  for (const [fieldId, fieldDef] of Object.entries(DATETIME_FORMAT_CONFIG.fields)) {
    defaults[fieldId] = fieldDef.default;
  }

  return defaults;
}

/**
 * Get formatted options for DATETIME formats based on display type
 * @param {string} displayType - 'datetime' or 'timeOnly'
 * @returns {Array} Array of {value, label} option objects
 */
export function getDateTimeFormatOptions(displayType = 'datetime') {
  if (displayType === 'timeOnly') {
    return Object.entries(TIME_FORMATS).map(([key, formatPattern]) => ({
      value: formatPattern,
      label: `${formatPattern} (${formatLabel(key)})`
    }));
  } else {
    return Object.entries(DATETIME_FORMATS).map(([key, formatPattern]) => ({
      value: formatPattern,
      label: `${formatPattern} (${formatLabel(key)})`
    }));
  }
}

/**
 * Validate DATE format settings
 * @param {Object} settings - Format settings to validate
 * @returns {Object} { valid: boolean, errors?: string[] }
 */
export function validateDateFormat(settings) {
  const errors = [];

  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['DATE format must be an object'] };
  }

  const { displayFormat } = settings;

  if (!displayFormat) {
    errors.push('DATE format missing displayFormat');
  } else {
    const validFormats = Object.values(DATE_FORMATS);
    if (!validFormats.includes(displayFormat)) {
      errors.push(`Invalid DATE displayFormat: ${displayFormat}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Validate DATETIME format settings
 * @param {Object} settings - Format settings to validate
 * @returns {Object} { valid: boolean, errors?: string[] }
 */
export function validateDateTimeFormat(settings) {
  const errors = [];

  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['DATETIME format must be an object'] };
  }

  const { displayFormat, displayType } = settings;

  if (!displayFormat) {
    errors.push('DATETIME format missing displayFormat');
  } else {
    const validFormats = Object.values(DATETIME_FORMATS).concat(Object.values(TIME_FORMATS));
    if (!validFormats.includes(displayFormat)) {
      errors.push(`Invalid DATETIME displayFormat: ${displayFormat}`);
    }
  }

  if (!displayType) {
    errors.push('DATETIME format missing displayType');
  } else {
    const validDisplayTypes = ['datetime', 'timeOnly'];
    if (!validDisplayTypes.includes(displayType)) {
      errors.push(`Invalid DATETIME displayType: ${displayType}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Get the full name of a month from its index (0-based)
 * @param {number} monthIndex - Month index (0 = January, 11 = December)
 * @returns {string} Full month name
 */
export const getMonthName = (monthIndex) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[monthIndex] || '';
};

/**
 * Format a serial date number according to the specified format
 * @param {number} serialDate - Serial date number to format
 * @param {string} format - Format pattern
 * @returns {string} Formatted date string
 */
export const formatDate = (serialDate, format = DATE_FORMATS.ISO) => {
  if (typeof serialDate !== 'number' || serialDate < 1) {
    return '';
  }

  try {
    const dateComponents = serialDateToYmd(Math.floor(serialDate));
    if (!dateComponents) return '';

    const { year, month, day } = dateComponents;

    // Format according to pattern using regex replacement
    const result = format.replace(REGEX_PATTERNS.datePatterns, (match) => {
      switch (match) {
        case 'YYYY': return String(year);
        case 'YY': return String(year).slice(-2);
        case 'MMMM': return getMonthName(month - 1);
        case 'MM': return String(month).padStart(2, '0');
        case 'DD': return String(day).padStart(2, '0');
        default: return match;
      }
    });

    return result;
  } catch (error) {
    console.error('[DateUtils] Error formatting date:', error);
    return '';
  }
};

/**
 * Format a serial datetime (with fractional time component) according to the specified format
 * @param {number} serialDateTime - The serial datetime to format (days since Dec 30, 1899)
 * @param {string} format - The format pattern (e.g., 'YYYY-MM-DD HH:mm:ss')
 * @param {boolean} [roundToSecond=true] - Whether to round to nearest second (true for display, false for canonical)
 * @returns {string} The formatted datetime string
 */
export const formatDateTime = (serialDateTime, format = DATETIME_FORMATS.ISO, roundToSecond = true) => {
  if (typeof serialDateTime !== 'number' || serialDateTime < 1) {
    return '';
  }

  try {
    // Get date components from integer part
    const dateComponents = serialDateToYmd(Math.floor(serialDateTime));
    if (!dateComponents) return '';

    const { year, month, day } = dateComponents;

    // Extract time components from fractional part
    // Round to nearest second for display, preserve fractional seconds for canonical formatting
    const fractionalPart = serialDateTime - Math.floor(serialDateTime);
    const { hour: hours, minute: minutes, second: seconds } = fractionalDayToTime(fractionalPart, roundToSecond);

    // Calculate 12-hour format values
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);

    // Format according to pattern using regex replacement
    // Regex matches patterns in order: longest first
    const result = format.replace(REGEX_PATTERNS.dateTimePatterns, (match) => {
      switch (match) {
        case 'YYYY': return String(year);
        case 'YY': return String(year).slice(-2);
        case 'MMMM': return getMonthName(month - 1);  // month is 1-based, getMonthName is 0-based
        case 'MM': return String(month).padStart(2, '0');
        case 'DD': return String(day).padStart(2, '0');
        case 'HH': return String(hours).padStart(2, '0');  // 24-hour padded
        case 'H': return String(hours);  // 24-hour no padding
        case 'hh': return String(hours12).padStart(2, '0');  // 12-hour padded
        case 'h': return String(hours12);  // 12-hour no padding
        case 'mm': return String(minutes).padStart(2, '0');
        case 'ss': {
          // Format seconds with proper handling of fractional parts
          const integerPart = Math.floor(seconds);
          const fractionalPart = seconds - integerPart;

          if (fractionalPart === 0) {
            // No fractional seconds, just pad integer
            return String(integerPart).padStart(2, '0');
          } else {
            // Has fractional seconds - format and remove trailing zeros
            const formatted = seconds.toFixed(3); // 3 decimal places (milliseconds)
            const trimmed = formatted.replace(/\.?0+$/, ''); // Remove trailing zeros
            // Ensure at least 2 digits before decimal
            const parts = trimmed.split('.');
            parts[0] = parts[0].padStart(2, '0');
            return parts.join('.');
          }
        }
        case 'A': return ampm;
        default: return match;
      }
    });

    return result;
  } catch (error) {
    console.error('[DateUtils] Error formatting datetime:', error);
    return ''; // Return empty string on error
  }
};

/**
 * Format just the time component of a serial datetime value
 * This extracts and formats only the time portion, ignoring the date
 * @param {number} serialDateTime - The serial datetime to format (days since Dec 30, 1899)
 * @param {string} format - The time format pattern (e.g., 'HH:mm:ss', 'hh:mm A')
 * @returns {string} The formatted time string
 */
export const formatTime = (serialDateTime, format = TIME_FORMATS.STANDARD) => {
  if (typeof serialDateTime !== 'number' || serialDateTime < 0) {
    return '';
  }

  try {
    // Extract time components from fractional part (rounded to nearest second for display)
    const fractionalPart = serialDateTime - Math.floor(serialDateTime);
    const { hour: hours, minute: minutes, second: seconds } = fractionalDayToTime(fractionalPart, true);

    // Calculate 12-hour format values
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);

    // Format according to pattern using regex replacement
    const result = format.replace(REGEX_PATTERNS.timePatterns, (match) => {
      switch (match) {
        case 'HH': return String(hours).padStart(2, '0');  // 24-hour padded
        case 'H': return String(hours);  // 24-hour no padding
        case 'hh': return String(hours12).padStart(2, '0');  // 12-hour padded
        case 'h': return String(hours12);  // 12-hour no padding
        case 'mm': return String(minutes).padStart(2, '0');
        case 'ss': return String(seconds).padStart(2, '0');
        case 'A': return ampm;
        default: return match;
      }
    });

    return result;
  } catch (error) {
    console.error('[DateUtils] Error formatting time:', error);
    return ''; // Return empty string on error
  }
};