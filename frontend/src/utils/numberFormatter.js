/**
 * Format types supported by the spreadsheet
 */
export const FORMAT_TYPES = {
    GENERAL: 'general',
    NUMBER: 'number',
    CURRENCY: 'currency',
    PERCENTAGE: 'percentage',
    SCIENTIFIC: 'scientific',
    TIME_DURATION: 'timeDuration'
};

/**
 * Digit separator options for number formatting
 * Defines both thousands separator and decimal separator combinations
 */
export const DIGIT_SEPARATOR_OPTIONS = {
  'period-only': {
    label: 'Period decimal only (e.g., 1234.56)',
    decimal: '.',
    thousands: ''
  },
  'comma-only': {
    label: 'Comma decimal only (e.g., 1234,56)',
    decimal: ',',
    thousands: ''
  },
  'comma-period': {
    label: 'Comma-separated, Period decimal (e.g., 1,234.56)',
    decimal: '.',
    thousands: ','
  },
  'period-comma': {
    label: 'Period-separated, Comma decimal (e.g., 1.234,56)',
    decimal: ',',
    thousands: '.'
  },
  'space-period': {
    label: 'Space-separated, Period decimal (e.g., 1 234.56)',
    decimal: '.',
    thousands: ' '
  }
};

/**
 * NUMBER FORMAT CONFIGURATION
 * Single source of truth for number formatting options, validation, and UI generation
 *
 * Structure:
 * - fields: All possible field definitions (declared once, reused by subcategories)
 * - subcategories: Each format type lists which field IDs it uses
 */
export const NUMBER_FORMAT_CONFIG = {
    type: 'NUMBER',

    // All possible user-configurable fields defined once
    // Note: 'multiplier' is not a configurable field - it's injected by percentage logic in formatNumber()
    fields: {
        useAdaptiveDecimals: {
            id: 'useAdaptiveDecimals',
            type: 'select',
            label: 'Decimal Display',
            default: false,
            options: [
                { value: false, label: 'Fixed' },
                { value: true, label: 'Adaptive' }
            ]
        },
        decimalPlaces: {
            id: 'decimalPlaces',
            type: 'number',
            label: 'Decimal Places',
            default: 2,
            min: 0,
            max: 10,
            visibleWhen: { useAdaptiveDecimals: false }
        },
        digitSeparatorOption: {
            id: 'digitSeparatorOption',
            type: 'select',
            label: 'Number Format',
            default: 'comma-period',
            options: Object.entries(DIGIT_SEPARATOR_OPTIONS).map(([value, config]) => ({
                value,
                label: config.label
            }))
        },
        negativeStyle: {
            id: 'negativeStyle',
            type: 'select',
            label: 'Negative Numbers',
            default: 'minus',
            options: [
                { value: 'minus', label: 'Minus sign' },
                { value: 'parentheses', label: 'Parentheses' }
            ]
        },
        symbol: {
            id: 'symbol',
            type: 'text',
            label: 'Symbol',
            default: '$',
            maxlength: 10
        },
        symbolPosition: {
            id: 'symbolPosition',
            type: 'select',
            label: 'Symbol Position',
            default: 'before',
            options: [
                { value: 'before', label: 'Before' },
                { value: 'after', label: 'After' }
            ]
        },
        durationStyle: {
            id: 'durationStyle',
            type: 'select',
            label: 'Duration Style',
            default: 'abbreviated',
            options: [
                { value: 'abbreviated', label: 'Abbreviated (1d 2h)' },
                { value: 'long', label: 'Long (1 day 2 hours)' }
            ]
        },
        customizeDurationUnits: {
            id: 'customizeDurationUnits',
            type: 'checkbox',
            label: 'Customize Duration Units',
            default: false
        },
        durationUnits: {
            id: 'durationUnits',
            type: 'checkbox-group',
            label: 'Duration Units',
            default: ['days', 'hours'],
            options: [
                { value: 'years', label: 'Years' },
                { value: 'months', label: 'Months' },
                { value: 'weeks', label: 'Weeks' },
                { value: 'days', label: 'Days' },
                { value: 'hours', label: 'Hours' },
                { value: 'minutes', label: 'Minutes' },
                { value: 'seconds', label: 'Seconds' }
            ],
            visibleWhen: { customizeDurationUnits: true }
        }
    },

    // Subcategories with per-subcategory defaults
    // Format: fieldId: value (use this default) | null (use global default) | omitted (field not available)
    subcategories: {
        number: {
            label: 'Number',
            description: 'Standard number formatting with decimals and separators',
            fields: {
                useAdaptiveDecimals: true,     // use adaptive decimals by default for number
                decimalPlaces: null,           // use global default (2)
                digitSeparatorOption: null,    // use global default
                negativeStyle: null            // use global default
            }
        },

        currency: {
            label: 'Currency',
            description: 'Currency formatting with symbol',
            fields: {
                symbol: '$',                   // custom default for currency
                symbolPosition: null,          // use global default (before)
                useAdaptiveDecimals: null,     // use global default (false)
                decimalPlaces: null,
                digitSeparatorOption: null,
                negativeStyle: null
            }
        },

        percentage: {
            label: 'Percentage',
            description: 'Display as percentage (multiplies value by 100, adds % symbol)',
            fields: {
                useAdaptiveDecimals: null,     // use global default (false)
                decimalPlaces: null,
                digitSeparatorOption: null,
                negativeStyle: null
                // Note: multiplier, symbol, symbolPosition are injected by formatNumber() switch
            }
        },

        scientific: {
            label: 'Scientific',
            description: 'Scientific notation (e.g., 1.23E+4)',
            fields: {
                useAdaptiveDecimals: null,     // use global default (false)
                decimalPlaces: null            // use global default (2)
            }
        },

        timeDuration: {
            label: 'Time Duration',
            description: 'Display numeric values as time durations (e.g., 1.5 → "1 day 12 hours")',
            fields: {
                durationStyle: null,           // use global default (abbreviated)
                customizeDurationUnits: null,  // use global default (false)
                durationUnits: null,           // use global default (days-hours)
                decimalPlaces: 0               // custom default: no decimals for durations (integers only)
            }
        }
    }
};

/**
 * Get default format settings for a number subcategory
 * @param {string} subCategory - The subcategory ('general', 'number', 'currency', etc.)
 * @returns {Object} Default format settings
 */
export function getNumberFormatDefaults(subCategory = 'number') {
    const subcategoryConfig = NUMBER_FORMAT_CONFIG.subcategories[subCategory];
    if (!subcategoryConfig) {
        console.warn(`[NumberFormatter] Unknown subcategory: ${subCategory}, defaulting to 'number'`);
        return getNumberFormatDefaults('number');
    }

    // Build defaults from field object
    // Format: { fieldId: value | null, ... }
    // - value: use subcategory-specific default
    // - null: use global default from field definition
    // - omitted: field not available for this subcategory
    const defaults = { subCategory };

    for (const [fieldId, subcategoryDefault] of Object.entries(subcategoryConfig.fields)) {
        if (subcategoryDefault !== null) {
            // Use subcategory-specific default
            defaults[fieldId] = subcategoryDefault;
        } else {
            // Use global default from field definition
            const fieldDef = NUMBER_FORMAT_CONFIG.fields[fieldId];
            if (fieldDef) {
                defaults[fieldId] = fieldDef.default;
            }
        }
    }

    return defaults;
}

/**
 * Validate number format settings
 * @param {Object} settings - Format settings to validate
 * @returns {Object} { valid: boolean, errors?: string[] }
 */
export function validateNumberFormat(settings) {
    const errors = [];

    if (!settings || typeof settings !== 'object') {
        return { valid: false, errors: ['NUMBER format must be an object'] };
    }

    const { subCategory } = settings;

    // Validate subcategory
    if (!subCategory) {
        errors.push('NUMBER format missing subCategory');
        return { valid: false, errors };
    }

    const subcategoryConfig = NUMBER_FORMAT_CONFIG.subcategories[subCategory];
    if (!subcategoryConfig) {
        errors.push(`Invalid NUMBER subCategory: ${subCategory}`);
        return { valid: false, errors };
    }

    // Validate each field for this subcategory
    // subcategoryConfig.fields is now an object: { fieldId: default, ... }
    for (const fieldId of Object.keys(subcategoryConfig.fields)) {
        const field = NUMBER_FORMAT_CONFIG.fields[fieldId];
        if (!field) continue; // Skip if field definition not found

        const value = settings[fieldId];

        // Skip undefined values (will use defaults)
        if (value === undefined) continue;

        // Type validation
        if (field.type === 'number' && typeof value !== 'number') {
            errors.push(`${field.label} must be a number`);
            continue;
        }
        if (field.type === 'text' && typeof value !== 'string') {
            errors.push(`${field.label} must be a string`);
            continue;
        }

        // Range validation for numbers
        if (field.type === 'number') {
            if (field.min !== undefined && value < field.min) {
                errors.push(`${field.label} must be >= ${field.min}`);
            }
            if (field.max !== undefined && value > field.max) {
                errors.push(`${field.label} must be <= ${field.max}`);
            }
        }

        // Length validation for text
        if (field.type === 'text' && field.maxlength !== undefined) {
            if (value.length > field.maxlength) {
                errors.push(`${field.label} must be <= ${field.maxlength} characters`);
            }
        }

        // Enum validation for selects
        if (field.type === 'select' && field.options) {
            const validValues = field.options.map(opt => opt.value);
            if (!validValues.includes(value)) {
                errors.push(`${field.label} must be one of: ${validValues.join(', ')}`);
            }
        }

        // Array validation for checkbox-groups
        if (field.type === 'checkbox-group') {
            if (!Array.isArray(value)) {
                errors.push(`${field.label} must be an array`);
                continue;
            }
            if (field.options) {
                const validValues = field.options.map(opt => opt.value);
                for (const item of value) {
                    if (!validValues.includes(item)) {
                        errors.push(`${field.label} contains invalid value: ${item}`);
                    }
                }
            }
            if (value.length === 0) {
                errors.push(`${field.label} must have at least one selection`);
            }
        }
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
}


/**
 * Get separator characters from a digitSeparatorOption
 * @param {string} digitSeparatorOption - Key from DIGIT_SEPARATOR_OPTIONS
 * @returns {Object} { decimal: string, thousands: string }
 */
export function getSeparators(digitSeparatorOption) {
    const option = DIGIT_SEPARATOR_OPTIONS[digitSeparatorOption];
    if (!option) {
        // Default to comma-period if invalid option
        return DIGIT_SEPARATOR_OPTIONS['comma-period'];
    }
    return {
        decimal: option.decimal,
        thousands: option.thousands
    };
}

/**
 * Format a value according to the specified format settings
 * Handles numeric formatting (numbers, currency, percentages, etc.)
 * Note: Date/time formatting is now handled by dateFormatter.js
 *
 * @param {number} value - The value to format
 * @param {Object} settings - Format settings with subCategory and options
 * @returns {string} Formatted number string
 */
export const formatNumber = (value, settings = {}) => {
    // Handle empty values
    if (value === null || value === undefined || value === '') {
        return '';
    }

    // Handle numeric values
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
        // For non-numeric values, just return as string
        return value.toString();
    }

    // Get subcategory from settings (default to 'number')
    const subCategory = settings.subCategory || 'number';

    // Merge with defaults for this subcategory
    const defaults = getNumberFormatDefaults(subCategory);
    const options = { ...defaults, ...settings };

    switch (subCategory) {
        case FORMAT_TYPES.GENERAL:
            return value.toString();

        case FORMAT_TYPES.NUMBER:
        case FORMAT_TYPES.CURRENCY:
            // Plain numbers and currency use config-driven options
            return formatNumberWithOptions(numValue, options);

        case FORMAT_TYPES.PERCENTAGE:
            // Percentage injects fixed values for multiplier, symbol, symbolPosition
            return formatNumberWithOptions(numValue, {
                ...options,
                multiplier: 100,
                symbol: '%',
                symbolPosition: 'after'
            });

        case FORMAT_TYPES.SCIENTIFIC:
            return formatScientific(numValue, options);

        case FORMAT_TYPES.TIME_DURATION:
            return formatTimeDuration(numValue, options);

        default:
            return value.toString();
    }
};

/**
 * Format a number with specific options
 * Handles all number formatting: plain numbers, currency, percentages
 */
const formatNumberWithOptions = (value, options) => {
    const {
        useAdaptiveDecimals = false,
        decimalPlaces = 2,
        digitSeparatorOption = 'comma-period',
        negativeStyle = 'minus', // minus or parentheses
        multiplier = 1,           // multiply value (e.g., 100 for percentages)
        symbol = '',              // symbol to add (e.g., '$', '%')
        symbolPosition = 'before' // 'before' or 'after'
    } = options;

    // Apply multiplier
    const multipliedValue = value * multiplier;

    // Get separators from the option
    const separators = getSeparators(digitSeparatorOption);

    // Track if negative and work with absolute value
    const isNegative = multipliedValue < 0;
    const absValue = Math.abs(multipliedValue);

    // Format the number - either fixed decimals or adaptive (natural)
    let formatted;
    if (useAdaptiveDecimals) {
        // Use natural decimal places - just convert to string
        formatted = absValue.toString();
    } else {
        // Use fixed decimal places
        formatted = absValue.toFixed(decimalPlaces);
    }

    // Split into integer and decimal parts
    const parts = formatted.split('.');

    // Add thousands separator to integer part (if separator is not empty)
    if (separators.thousands) {
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, separators.thousands);
    }

    // Rejoin with the appropriate decimal separator
    formatted = parts.join(separators.decimal);

    // Add symbol first (before negative styling)
    if (symbol) {
        if (symbolPosition === 'after') {
            formatted = `${formatted}${symbol}`;
        } else {
            formatted = `${symbol}${formatted}`;
        }
    }

    // Apply negative style after symbol
    if (isNegative) {
        if (negativeStyle === 'parentheses') {
            formatted = `(${formatted})`;
        } else {
            formatted = `-${formatted}`;
        }
    }

    return formatted;
};

/**
 * Format a number in scientific notation
 * @param {number} value - The number to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted scientific notation string
 */
const formatScientific = (value, options) => {
    const {
        useAdaptiveDecimals = false,
        decimalPlaces = 2
    } = options;

    if (value === 0) {
        if (useAdaptiveDecimals) {
            return '0E+0';
        }
        const zeros = '0'.repeat(decimalPlaces);
        const formatted = decimalPlaces > 0 ? `0.${zeros}` : '0';
        return `${formatted}E+0`;
    }

    let mantissa;
    let exponent;

    if (useAdaptiveDecimals) {
        // Use natural precision - convert to exponential and keep all significant digits
        const exponential = value.toExponential();
        [mantissa, exponent] = exponential.split('e');
    } else {
        // Use fixed decimal places
        const exponential = value.toExponential(decimalPlaces);
        [mantissa, exponent] = exponential.split('e');
    }

    const exp = parseInt(exponent);

    // Format the exponent with explicit + or - sign
    const expSign = exp >= 0 ? '+' : '';
    const formattedExp = `${expSign}${exp}`;

    return `${mantissa}E${formattedExp}`;
};

/**
 * Format a number as time duration
 * Treats the input number as days and converts to appropriate time units
 * @param {number} value - The number of days
 * @param {Object} options - Formatting options
 * @returns {string} Formatted time duration string
 */
const formatTimeDuration = (value, options) => {
    const {
        durationUnits = ['days', 'hours'],  // array of unit names
        durationStyle = 'abbreviated',      // 'abbreviated' or 'long'
        decimalPlaces = 0                   // decimal places for smallest unit
    } = options;

    const units = durationUnits;

    if (value === 0) {
        const zeroValue = decimalPlaces > 0 ? `0.${'0'.repeat(decimalPlaces)}` : '0';
        return durationStyle === 'long' ? `${zeroValue} hours` : `${zeroValue}h`;
    }

    const totalDays = Math.abs(value);
    const isNegative = value < 0;

    // Define time unit conversions (all in terms of days)
    const timeUnits = {
        years: 365.25,
        months: 30.44, // Average month length
        weeks: 7,
        days: 1,
        hours: 1/24,
        minutes: 1/(24*60),
        seconds: 1/(24*60*60)
    };

    // Define unit abbreviations and names
    const unitNames = {
        years: { abbr: 'y', singular: 'year', plural: 'years' },
        months: { abbr: 'mo', singular: 'month', plural: 'months' },
        weeks: { abbr: 'w', singular: 'week', plural: 'weeks' },
        days: { abbr: 'd', singular: 'day', plural: 'days' },
        hours: { abbr: 'h', singular: 'hour', plural: 'hours' },
        minutes: { abbr: 'm', singular: 'minute', plural: 'minutes' },
        seconds: { abbr: 's', singular: 'second', plural: 'seconds' }
    };

    let remainingDays = totalDays;
    const parts = [];

    // Process each requested unit in order
    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const isLastUnit = i === units.length - 1;

        if (timeUnits[unit] && remainingDays >= timeUnits[unit]) {
            let unitValue;

            if (isLastUnit && decimalPlaces > 0) {
                // For the last unit, use decimal places
                unitValue = parseFloat((remainingDays / timeUnits[unit]).toFixed(decimalPlaces));
                remainingDays = 0; // All remaining value consumed
            } else {
                // For all other units, use integers
                unitValue = Math.floor(remainingDays / timeUnits[unit]);
                remainingDays -= unitValue * timeUnits[unit];
            }

            if (unitValue > 0) {
                if (durationStyle === 'long') {
                    // For long style with decimals, always use plural if decimal
                    const name = (unitValue === 1 && decimalPlaces === 0) ? unitNames[unit].singular : unitNames[unit].plural;
                    parts.push(`${unitValue} ${name}`);
                } else {
                    parts.push(`${unitValue}${unitNames[unit].abbr}`);
                }
            }
        }
    }

    // If no parts were added or we're looking at a very small value,
    // use the smallest requested unit
    if (parts.length === 0 && units.length > 0) {
        const smallestUnit = units[units.length - 1];
        let unitValue;

        if (decimalPlaces > 0) {
            unitValue = parseFloat((totalDays / timeUnits[smallestUnit]).toFixed(decimalPlaces));
        } else {
            unitValue = Math.max(1, Math.round(totalDays / timeUnits[smallestUnit]));
        }

        if (durationStyle === 'long') {
            const name = (unitValue === 1 && decimalPlaces === 0) ? unitNames[smallestUnit].singular : unitNames[smallestUnit].plural;
            parts.push(`${unitValue} ${name}`);
        } else {
            parts.push(`${unitValue}${unitNames[smallestUnit].abbr}`);
        }
    }

    const result = parts.join(durationStyle === 'long' ? ' ' : ' ');
    return isNegative ? `-${result}` : result;
};

