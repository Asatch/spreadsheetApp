/**
 * @file Type Service
 * @description Central service for all type-related operations in the spreadsheet.
 *
 * Provides a single source of truth for:
 * - Type detection (following strict detection sequence: TEXT marker → DATETIME → DATE → NUMBER → TEXT)
 * - Type validation
 * - Canonical format conversion (for formula bar display)
 * - Operation compatibility checking
 */

import {
  parseStringToSerial,
  DATE_INPUT_FORMAT
} from './serialDate.js';
import {
  formatDate,
  formatDateTime,
  DATE_FORMATS,
  DATETIME_FORMATS
} from './dateFormatter.js';

/**
 * @typedef {Object} DetectTypeResult
 * @property {string} type - The detected type ('Number', 'Text', 'Date', 'Datetime', 'Error', 'Boolean')
 * @property {*} value - The parsed native value (number for numbers/dates, string for text, null for errors)
 * @property {string} canonicalValue - The canonical formatted value (for formula bar display)
 * @property {string} [error] - Error code if type is 'error'
 */

/**
 * Global tolerance threshold for determining if a number has a fractional component
 * Used for type detection to decide if a value represents whole days (DATE) or has fractional parts (DATETIME)
 */
export const FRACTIONAL_TOLERANCE = 1e-10;

/**
 * Check if a number is effectively an integer (has no significant fractional component)
 * @param {number} value - Number to check
 * @returns {boolean} True if the number has no significant fractional component
 */
export const isEffectivelyInteger = (value) => {
  return Math.abs(Math.round(value) - value) < FRACTIONAL_TOLERANCE;
};

/**
 * Error codes for spreadsheet errors.
 * Defined directly to avoid dependency issues.
 *
 * @constant {Object}
 * @property {string} TYPE_MISMATCH - Type mismatch error (#TYPE!)
 * @property {string} DIVISION_BY_ZERO - Division by zero error (#DIV/0!)
 * @property {string} CALCULATION_ERROR - General calculation error (#ERROR!)
 * @property {string} UNKNOWN_ERROR - Unknown error (#ERROR!)
 */
const ERROR_CODES = {
  Type: '#TYPE!',
  Domain: '#DOMAIN!',
  Name: '#NAME!',
  Ref: '#REF!',
  Syntax: '#SYNTAX!',
  Circular: '#CIRCULAR!',
  Function: '#FUNCTION!',
  UNKNOWN_ERROR: '#ERROR!'
};

/**
 * Type hierarchy constants defining all supported data types.
 *
 * @constant {Object}
 * @property {string} NUMBER - Number type (integer or float)
 * @property {string} TEXT - Text/string type
 * @property {string} DATE - Date type (serial number, integer >= 1)
 * @property {string} DATETIME - DateTime type (serial number with fractional component, >= 1)
 * @property {string} ERROR - Error type
 * @property {string} BOOLEAN - Boolean type
 */
export const TYPE_HIERARCHY = {
  NUMBER: 'Number',
  TEXT: 'Text',
  DATE: 'Date',
  DATETIME: 'Datetime',
  ERROR: 'Error',
  BOOLEAN: 'Boolean',
  ARRAY: 'Array',
  OBJECT: 'Object'
};

/**
 * Check if a type string is a parameterized array type (e.g., 'ARRAY[Number]').
 * @param {string} type - Type string to check
 * @returns {boolean} True if this is an ARRAY[...] type
 */
export function isArrayType(type) {
  return typeof type === 'string' && type.startsWith('ARRAY[');
}

/**
 * Get the element type from a parameterized array type.
 * @param {string} type - Array type string (e.g., 'ARRAY[Number]')
 * @returns {string|null} Element type (e.g., 'Number') or null if not an array type
 */
export function getArrayElementType(type) {
  if (!isArrayType(type)) return null;
  return type.slice(6, -1); // 'ARRAY[Number]' → 'Number'
}

/**
 * Check if a type string is a parameterized object type (e.g., 'Object[Number, Text]').
 * @param {string} type - Type string to check
 * @returns {boolean} True if this is an Object[...] type
 */
export function isObjectType(type) {
  return typeof type === 'string' && type.startsWith('Object[');
}

/**
 * Get the field types from a parameterized object type.
 * Uses bracket-aware parsing so nested types like Object[ARRAY[Number], Text] work.
 * @param {string} type - Object type string (e.g., 'Object[Number, Text]')
 * @returns {string[]|null} Field types (e.g., ['Number', 'Text']) or null if not an object type
 */
export function getObjectFieldTypes(type) {
  if (!isObjectType(type)) return null;
  const inner = type.slice(7, -1); // 'Object[Number, Text]' → 'Number, Text'
  const types = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '[') depth++;
    else if (inner[i] === ']') depth--;
    else if (inner[i] === ',' && depth === 0) {
      types.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  types.push(inner.slice(start).trim());
  return types;
}


/**
 * Type-specific validation functions.
 *
 * Maps each TYPE_HIERARCHY type to a validation function that checks if a value
 * matches the expected type constraints.
 *
 * @constant {Object<string, function(*): boolean>}
 */
const validators = {
  [TYPE_HIERARCHY.NUMBER]: (value) => {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
  },
  
  [TYPE_HIERARCHY.TEXT]: (value) => {
    return typeof value === 'string';
  },
  
  [TYPE_HIERARCHY.DATE]: (value) => {
    // DATE type must be a number and an integer
    return typeof value === 'number' && !isNaN(value) && isFinite(value) && 
           value >= 1 && isEffectivelyInteger(value);
  },
  
  [TYPE_HIERARCHY.DATETIME]: (value) => {
    // DATETIME type must be a number (can have fractional component)
    return typeof value === 'number' && !isNaN(value) && isFinite(value) && value >= 1;
  },
  
  [TYPE_HIERARCHY.ERROR]: (value) => {
    return Object.values(ERROR_CODES).includes(value);
  },
  
  [TYPE_HIERARCHY.BOOLEAN]: (value) => {
    return typeof value === 'boolean';
  },

  [TYPE_HIERARCHY.ARRAY]: (value) => {
    // ARRAY type must be a flat array of raw values [val, val, ...]
    return Array.isArray(value);
  },

  [TYPE_HIERARCHY.OBJECT]: (value) => {
    return typeof value === 'object' && !Array.isArray(value) && value !== null;
  }
};

// ============================================================================
// ARRAY LITERAL PARSING
// ============================================================================

/**
 * Parses an array literal string into a flat array of raw values.
 *
 * Syntax: {val1,val2;val3,val4} where:
 * - Commas separate columns within a row
 * - Semicolons separate rows
 * - Values are detected via detectType (numbers, dates, booleans, text, etc.)
 * - Use double quotes for values containing delimiters: {"hello, world",42}
 *
 * @param {string} str - The array literal string (e.g., "{1,2;3,4}")
 * @returns {{success: boolean, value?: Array, elementType?: string, error?: string}} Parse result
 */
function parseArrayLiteral(str) {
  const trimmed = str.trim();

  // Must start with { and end with }
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { success: false, error: 'Array literal must be enclosed in {}' };
  }

  // Extract content between braces
  const content = trimmed.slice(1, -1).trim();

  // Handle empty array
  if (content === '') {
    return { success: false, error: 'Empty array literal' };
  }

  // Split into rows by semicolon (but not inside quotes)
  const rowStrings = splitOutsideQuotes(content, ';');
  let cols = null;
  const values = [];
  const types = [];

  for (let r = 0; r < rowStrings.length; r++) {
    const rowStr = rowStrings[r].trim();

    // Parse individual values in this row (handling quoted strings)
    const rowValues = splitOutsideQuotes(rowStr, ',');

    // Check column count consistency
    if (cols === null) {
      cols = rowValues.length;
      if (cols === 0) {
        return { success: false, error: 'Row cannot be empty' };
      }
    } else if (rowValues.length !== cols) {
      return {
        success: false,
        error: `Row ${r + 1} has ${rowValues.length} columns, expected ${cols}`
      };
    }

    // Parse each value to its native type
    for (const valStr of rowValues) {
      const parsed = parseArrayElement(valStr.trim());
      if (parsed.error) {
        return { success: false, error: `Row ${r + 1}: ${parsed.error}` };
      }
      values.push(parsed.value);
      types.push(parsed.type);
    }
  }

  // Validate all elements have the same type
  const elementType = types[0];
  for (let i = 1; i < types.length; i++) {
    if (types[i] !== elementType) {
      return {
        success: false,
        error: `Mixed types: element 1 is ${elementType} but element ${i + 1} is ${types[i]}`
      };
    }
  }

  // Return flat array of raw values
  return { success: true, value: values, elementType };
}

/**
 * Split a string by delimiter, but ignore delimiters inside quoted strings.
 * @param {string} str - The string to split
 * @param {string} delimiter - The delimiter character
 * @returns {string[]} Array of parts
 */
function splitOutsideQuotes(str, delimiter) {
  const parts = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (char === '"') {
      // Check for escaped quote ""
      if (inQuotes && i + 1 < str.length && str[i + 1] === '"') {
        current += '""';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if (char === delimiter && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last part
  parts.push(current);

  return parts;
}

/**
 * Parse a single array element string to its native value and type.
 * Handles quoted strings (for values containing delimiters), then
 * delegates to detectType for full type detection including dates.
 *
 * @param {string} valStr - The value string
 * @returns {{value?: *, type?: string, error?: string}}
 */
function parseArrayElement(valStr) {
  const trimmed = valStr.trim();

  // Empty value
  if (trimmed === '') {
    return { error: 'Empty value not allowed' };
  }

  // Quoted string: "text" or "text with ""escaped"" quotes"
  // Quotes are needed for values containing commas, semicolons, or braces
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1).replace(/""/g, '"');
    return { value: inner, type: 'Text' };
  }

  // Use detectType for everything else (numbers, booleans, dates, datetimes, text)
  const detected = TypeService.detectType(trimmed);
  return { value: detected.value, type: detected.type };
}

/**
 * Converts an internal array value back to canonical string format.
 * Arrays are flat [val, val, ...] — formatted as a single row.
 * @param {Array} arr - Flat array of raw values [val, val, ...]
 * @returns {string} Canonical format "{val1,val2,...}"
 */
function formatArrayCanonical(arr, elementType) {
  if (!Array.isArray(arr) || arr.length === 0) return '';

  const formatted = arr.map(val => formatArrayElementCanonical(val, elementType));
  return '{' + formatted.join(',') + '}';
}

/**
 * Format a single raw value for display (used in object expansion and nested contexts).
 * Unlike formatArrayElementCanonical, this doesn't quote strings — it's for human-readable display.
 * @param {*} val - The raw value to format
 * @returns {string} Formatted value
 */
function formatDisplayValue(val) {
  if (Array.isArray(val)) return formatArrayCanonical(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object' && val !== null) return '{...}';
  return String(val);
}

/**
 * Format a single raw value for array canonical representation.
 * @param {*} val - The raw value to format
 * @param {string} [elementType] - Optional element type for type-aware formatting (e.g., 'Date', 'Datetime')
 * @returns {string} Formatted value
 */
function formatArrayElementCanonical(val, elementType) {
  if (typeof val === 'string') {
    // Escape quotes and wrap in quotes
    return '"' + val.replace(/"/g, '""') + '"';
  }
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }
  if (typeof val === 'number') {
    // Format dates/datetimes as ISO strings instead of raw serial numbers
    if (elementType === TYPE_HIERARCHY.DATE) {
      return formatDate(val, DATE_FORMATS.ISO);
    }
    if (elementType === TYPE_HIERARCHY.DATETIME) {
      return formatDateTime(val, DATETIME_FORMATS.ISO);
    }
    return String(val);
  }
  return String(val);
}

/**
 * The TypeService provides centralized type functionality.
 *
 * @namespace TypeService
 */
export const TypeService = {
  /**
   * Formats a value in its canonical format for display in the formula bar.
   *
   * **Canonical formats:**
   * - TEXT: Preceded by single quote ('value)
   * - NUMBER: Space-separated digits with period decimal (123 456.789), scientific notation if >12 digits
   * - DATE: ISO 8601 format (YYYY-MM-DD)
   * - DATETIME: ISO 8601 with time (YYYY-MM-DD HH:MM:SS)
   * - ERROR: Error code string (e.g., #TYPE!, #DIV/0!)
   *
   * @memberof TypeService
   * @param {*} value - The value to format
   * @param {string} type - The type from TYPE_HIERARCHY
   * @returns {string} The canonical formatted value
   */
  formatCanonical(value, type) {
    if (value === null || value === undefined) {
      return '';
    }
    
    switch (type) {
      case TYPE_HIERARCHY.TEXT:
        // TEXT: Any string preceded by a single quote [SC-DATA-361]
        return `'${value}`;

      case TYPE_HIERARCHY.NUMBER: {
        // NUMBER: Space-separated digits with period decimal [SC-DATA-366, 368]
        if (typeof value !== 'number') return '';

        /**
         * Converts a number to decimal notation (no scientific notation).
         *
         * Handles numbers in scientific notation by manually expanding them to
         * full decimal format. Needed because very large/small numbers default
         * to scientific notation.
         *
         * @param {number} num - The number to format
         * @returns {string} The number in decimal notation
         * @inner
         */
        const formatDecimal = (num) => {
          // Handle zero specially
          if (num === 0) return "0";
          
          // Convert to string (may be in scientific notation)
          const strValue = num.toString();
          
          // If not in scientific notation, we can use as is
          if (!strValue.includes('e')) {
            return strValue;
          }
          
          // If in scientific notation, convert to decimal
          const [mantissa, exponent] = strValue.split('e');
          const exp = parseInt(exponent, 10);
          
          if (exp > 0) {
            // For positive exponents: move decimal point right
            const mantissaParts = mantissa.split('.');
            const wholePart = mantissaParts[0];
            const fracPart = mantissaParts[1] || '';
            
            if (exp >= fracPart.length) {
              // Add zeros if needed
              return wholePart + fracPart + '0'.repeat(exp - fracPart.length);
            } else {
              // Insert decimal at the right place
              return wholePart + fracPart.substring(0, exp) + '.' + fracPart.substring(exp);
            }
          } else {
            // For negative exponents: move decimal point left
            const absExp = Math.abs(exp);
            const mantissaParts = mantissa.split('.');
            const wholePart = mantissaParts[0];
            const fracPart = mantissaParts[1] || '';
            
            // Handle negative mantissa by removing the sign
            const isNegative = wholePart.startsWith('-');
            const cleanWholePart = isNegative ? wholePart.substring(1) : wholePart;
            
            return (isNegative ? '-' : '') + '0.' + '0'.repeat(absExp - 1) + cleanWholePart + fracPart;
          }
        };
        
        // Handle special cases first
        if (!isFinite(value) || isNaN(value)) {
          return '#NUM!'; // Use #NUM! error for Infinity, -Infinity, NaN
        }
        
        // Force decimal notation and check significant digits
        const decimalStr = formatDecimal(Math.abs(value));
        const sign = value < 0 ? '-' : '';
        let formattedNumber;

        /**
         * Counts significant digits in a decimal string.
         *
         * Implements the "fewer than 12 digits" rule for canonical number formatting.
         * Excludes leading zero for numbers < 1 and the decimal point itself.
         *
         * @param {string} str - The decimal string to count (e.g., "0.123" or "123.456")
         * @returns {number} The count of significant digits
         * @inner
         */
        const countSignificantDigits = (str) => {
          // If the number is less than 1, it starts with "0."
          const isLessThanOne = str.startsWith('0.');
          
          // Remove decimal point
          const withoutDecimal = str.replace('.', '');
          
          // For numbers < 1, exclude the leading zero
          const digitsToCount = isLessThanOne ? withoutDecimal.substring(1) : withoutDecimal;
          
          return digitsToCount.length;
        };
        
        const digitCount = countSignificantDigits(decimalStr);
        
        // Use decimal notation if 12 or fewer significant digits
        if (digitCount <= 12) {
          // Use decimal notation with space separators
          formattedNumber = sign + decimalStr;
          
          // Add space separators every 3 digits, including after decimal [SC-DATA-368]
          const parts = formattedNumber.split('.');
          
          // Add spaces to integer part
          parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
          
          // Add spaces to decimal part (if any)
          if (parts.length > 1) {
            // Group the decimal digits by 3
            let decimalPart = '';
            const digits = parts[1];
            
            for (let i = 0; i < digits.length; i++) {
              decimalPart += digits[i];
              // Add space after every 3rd digit, but not at the end
              if ((i + 1) % 3 === 0 && i < digits.length - 1) {
                decimalPart += ' ';
              }
            }
            
            parts[1] = decimalPart;
          }
          
          formattedNumber = parts.join('.');
        } else {
          // Use scientific notation [SC-DATA-367]
          // Use default toExponential() which shows just the necessary digits without trailing zeros
          formattedNumber = value.toExponential();
          
          // Format mantissa with spaces (the part before 'e')
          const [mantissa, exponentPart] = formattedNumber.split('e');
          
          // Add space separators to mantissa [SC-DATA-368]
          const mantissaParts = mantissa.split('.');
          
          // Add spaces to integer part of mantissa
          mantissaParts[0] = mantissaParts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
          
          // Add spaces to decimal part of mantissa (if any)
          if (mantissaParts.length > 1) {
            // Group the decimal digits by 3
            let decimalPart = '';
            const digits = mantissaParts[1];
            
            for (let i = 0; i < digits.length; i++) {
              decimalPart += digits[i];
              // Add space after every 3rd digit, but not at the end
              if ((i + 1) % 3 === 0 && i < digits.length - 1) {
                decimalPart += ' ';
              }
            }
            
            mantissaParts[1] = decimalPart;
          }
          
          formattedNumber = mantissaParts.join('.') + 'e' + exponentPart;
        }

        return formattedNumber;
      }

      case TYPE_HIERARCHY.DATE:
        // DATE: ISO 8601 (YYYY-MM-DD) format [SC-DATA-371]
        if (typeof value === 'number') {
          // Value should always be in serial date format
          return formatDate(value, DATE_FORMATS.ISO);
        }
        return '';

      case TYPE_HIERARCHY.DATETIME:
        // DATETIME: YYYY-MM-DD HH:MM:SS format [SC-DATA-374]
        if (typeof value === 'number') {
          // Value should always be in serial date format
          // Pass false to preserve fractional seconds for canonical formula bar display
          return formatDateTime(value, DATETIME_FORMATS.ISO, false);
        }
        return '';
        
      case TYPE_HIERARCHY.BOOLEAN:
        return value ? 'TRUE' : 'FALSE';

      case TYPE_HIERARCHY.ERROR:
        // For null or undefined, return generic error
        if (value === null || value === undefined) {
          return '#ERROR!';
        }

        // For error objects, return the error code
        if (value && typeof value === 'object' && value.error) {
          return value.error;
        }

        // Default error
        return '#ERROR!';

      default:
        // Handle parameterized array types like 'ARRAY[Number]'
        if (isArrayType(type)) {
          return formatArrayCanonical(value, getArrayElementType(type));
        }
        // Handle parameterized object types like 'Object[Number, Text]'
        if (isObjectType(type) || (typeof value === 'object' && !Array.isArray(value) && value !== null)) {
          return '{' + Object.entries(value).map(([k, v]) => `${k}: ${formatDisplayValue(v)}`).join(', ') + '}';
        }
        return '';
    }
  },

  /**
   * Serialize a runtime (value, type) pair to a string that round-trips through detectType.
   *
   * Used when a typed runtime value needs to be fed into setValue/detectType and recover
   * the correct type. Unlike formatCanonical (which is for formula bar display),
   * this produces strings optimized for re-parsing.
   *
   * @memberof TypeService
   * @param {*} value - The runtime value (number, string, boolean, array, object, etc.)
   * @param {string} type - The type annotation (e.g., 'Number', 'Date', 'ARRAY[Number]', 'Object[...]')
   * @returns {string} A string that detectType will parse back to the correct type and value
   */
  serializeForInput(value, type) {
    if (value == null) return '';

    // Booleans: TRUE/FALSE → detectType recognizes these
    if (type === TYPE_HIERARCHY.BOOLEAN) {
      return value ? 'TRUE' : 'FALSE';
    }

    // Dates: serial number → ISO string so detectType parses as Date
    if (type === TYPE_HIERARCHY.DATE && typeof value === 'number') {
      return formatDate(value, DATE_FORMATS.ISO);
    }

    // DateTimes: serial number → ISO datetime string
    if (type === TYPE_HIERARCHY.DATETIME && typeof value === 'number') {
      return formatDateTime(value, DATETIME_FORMATS.ISO);
    }

    // Numbers: plain String() — detectType handles it
    if (type === TYPE_HIERARCHY.NUMBER) {
      return String(value);
    }

    // Text: prefix with quote so detectType doesn't misinterpret as number/date
    if (type === TYPE_HIERARCHY.TEXT) {
      return "'" + value;
    }

    // Arrays: canonical {val1,val2,...} format with typed elements
    if (isArrayType(type)) {
      if (Array.isArray(value)) {
        return formatArrayCanonical(value, getArrayElementType(type));
      }
      return String(value);
    }

    // Objects (multi-output): best-effort readable text (lossy — no object input syntax)
    if (isObjectType(type) || (typeof value === 'object' && !Array.isArray(value))) {
      return '{' + Object.entries(value).map(([k, v]) => `${k}: ${formatDisplayValue(v)}`).join(', ') + '}';
    }

    // Errors: return the error code string
    if (type === TYPE_HIERARCHY.ERROR) {
      return typeof value === 'string' ? value : '#ERROR!';
    }

    // Fallback
    return String(value);
  },

  /**
   * Detects the type of a value following the strict detection sequence.
   *
   * **Detection sequence for strings:**
   * 1. TEXT marker (starts with single quote ')
   * 2. DATETIME (e.g., "2024-01-15 14:30:00")
   * 3. DATE (e.g., "2024-01-15" or "01/15/2024")
   * 4. NUMBER (including percentages and scientific notation)
   * 5. TEXT (default fallback)
   *
   * **Special handling:**
   * - Numbers: Already parsed as numbers
   * - Errors: Object with error property
   * - null/undefined: Returns empty TEXT type
   *
   * @memberof TypeService
   * @param {*} value - The value to detect the type of
   * @param {string} [dateInputFormat='US'] - Format for ambiguous dates ('US': MM/DD/YYYY or 'EU': DD/MM/YYYY)
   * @returns {DetectTypeResult} Object containing type, parsed value, and canonical format
   */
  detectType(value, dateInputFormat = DATE_INPUT_FORMAT.US) {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return { 
        type: TYPE_HIERARCHY.TEXT, 
        value: '',
        canonicalValue: ''
      };
    }
    
    // Handle numbers
    if (typeof value === 'number') {
      // Value is already a number (from formula results, etc.)
      const canonicalValue = this.formatCanonical(value, TYPE_HIERARCHY.NUMBER);
      return { 
        type: TYPE_HIERARCHY.NUMBER, 
        value,
        canonicalValue
      };
    }
    
    // Handle booleans (for future support)
    if (typeof value === 'boolean') {
      return { 
        type: TYPE_HIERARCHY.BOOLEAN, 
        value,
        canonicalValue: value ? 'TRUE' : 'FALSE'
      };
    }
    
    // Handle errors
    if (value && typeof value === 'object' && value.error) {
      return { 
        type: TYPE_HIERARCHY.ERROR, 
        value: null,
        canonicalValue: value.error,
        error: value.error 
      };
    }
    
    // Following the exact detection sequence from requirements [SC-DATA-313]
    // for string inputs: TEXT marker → DATETIME → DATE → NUMBER → TEXT
    if (typeof value === 'string') {
      /** @type {string} */
      const trimmed = value.trim();

      // 1. Check if explicitly marked as text (starts with single quote) [SC-DATA-091]
      if (trimmed.startsWith("'")) {
        /** @type {string} */
        const textValue = trimmed.substring(1); // Remove the leading quote for storage
        return {
          type: TYPE_HIERARCHY.TEXT,
          value: textValue,
          canonicalValue: `'${textValue}` // Keep the leading quote in canonical format
        };
      }

      // 2. Check for array literal syntax: {val1,val2;val3,val4}
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const arrayResult = parseArrayLiteral(trimmed);
        if (arrayResult.success) {
          return {
            type: `ARRAY[${arrayResult.elementType}]`,
            value: arrayResult.value,
            canonicalValue: formatArrayCanonical(arrayResult.value)
          };
        }
        // If parsing fails, fall through to treat as text
        // (user might have intended something else)
      }

      // 3. Try to detect in sequence: DATETIME -> DATE -> NUMBER -> TEXT [SC-DATA-313]
      
      // Try to parse as DATETIME or DATE first, using parseStringToSerial which implements
      // the proper type detection sequence with ambiguous date format handling [SC-DATA-304, 305]
      const dateResult = parseStringToSerial(trimmed, dateInputFormat);
      if (dateResult.success) {
        // Return correct result based on detected type
        if (dateResult.type === TYPE_HIERARCHY.DATETIME) {
          return {
            type: TYPE_HIERARCHY.DATETIME,
            value: dateResult.value,  // Serial datetime number [SC-DATA-307]
            canonicalValue: formatDateTime(dateResult.value, DATETIME_FORMATS.ISO, false)
          };
        } else if (dateResult.type === TYPE_HIERARCHY.DATE) {
          return {
            type: TYPE_HIERARCHY.DATE,
            value: dateResult.value,  // Serial date number [SC-DATA-306]
            canonicalValue: formatDate(dateResult.value, DATE_FORMATS.ISO)
          };
        }
      }
      
      // Try to parse as NUMBER [SC-DATA-088]
      // Strip spaces and commas (common thousands separators) before checking
      // This allows flexible input like "1,234,567" or "123 456.78" regardless of separator placement
      // Examples: "123", "-45.67", "1.23e-4", "+789", "1,234,567", "123 456.78"
      /** @type {string} */
      const strippedValue = trimmed.replace(/[, ]/g, '');

      // Check if the stripped value is a valid number (including scientific notation)
      /** @type {RegExp} */
      const numberRegex = /^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/;
      if (numberRegex.test(strippedValue)) {
        const numValue = parseFloat(strippedValue);
        if (!isNaN(numValue)) {
          return {
            type: TYPE_HIERARCHY.NUMBER,
            value: numValue,
            canonicalValue: this.formatCanonical(numValue, TYPE_HIERARCHY.NUMBER)
          };
        }
      }
      
      // Check for percentage format - converts to decimal (50% → 0.5)
      // Matches: optional sign, digits, optional decimal, ending with %
      // Examples: "50%", "-12.5%", "+100%"
      /** @type {RegExp} */
      const percentRegex = /^[-+]?[0-9]*\.?[0-9]+%$/;
      if (percentRegex.test(trimmed)) {
        // Remove % sign and convert to decimal
        const numericPart = trimmed.slice(0, -1);
        const numValue = parseFloat(numericPart) / 100;
        if (!isNaN(numValue)) {
          return {
            type: TYPE_HIERARCHY.NUMBER,
            value: numValue,
            canonicalValue: this.formatCanonical(numValue, TYPE_HIERARCHY.NUMBER)
          };
        }
      }

      // Check for boolean literals (case-insensitive)
      const upperTrimmed = trimmed.toUpperCase();
      if (upperTrimmed === 'TRUE' || upperTrimmed === 'FALSE') {
        const boolValue = upperTrimmed === 'TRUE';
        return {
          type: TYPE_HIERARCHY.BOOLEAN,
          value: boolValue,
          canonicalValue: upperTrimmed  // Always uppercase: TRUE or FALSE
        };
      }

      // If all above fail, interpret as TEXT [SC-DATA-090]
      return {
        type: TYPE_HIERARCHY.TEXT,
        value: trimmed,
        canonicalValue: `'${trimmed}` // Add the leading quote in canonical format
      };
    }
    
    // Default for other types - convert to text
    /** @type {string} */
    const stringValue = String(value);
    return { 
      type: TYPE_HIERARCHY.TEXT, 
      value: stringValue,
      canonicalValue: `'${stringValue}`
    };
  },
  
  /**
   * Checks if a value is of the expected type.
   *
   * Uses type-specific validators to check if a value matches the expected
   * type constraints (e.g., DATE must be integer >= 1, NUMBER must be finite).
   *
   * @memberof TypeService
   * @param {*} value - The value to check
   * @param {string} expectedType - The expected type from TYPE_HIERARCHY
   * @returns {boolean} True if the value matches the expected type
   */
  isType(value, expectedType) {
    // Parameterized types use their base validator
    const validatorKey = isArrayType(expectedType) ? TYPE_HIERARCHY.ARRAY
      : isObjectType(expectedType) ? TYPE_HIERARCHY.OBJECT
      : expectedType;
    if (!validators[validatorKey]) {
      console.error(`[TypeService] Unknown type: ${expectedType}`);
      return false;
    }

    return validators[validatorKey](value);
  },
  
};

/**
 * Export ERROR_CODES constant for use in other modules.
 * @exports ERROR_CODES
 */
export { ERROR_CODES };

/**
 * Export TypeService as default export.
 * @exports TypeService
 */
export default TypeService;