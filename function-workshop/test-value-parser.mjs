/**
 * Coerce a raw test-case value (from XML attribute or CLI script token) to
 * a JS-native value of the declared type. Shared by `xml-parser.mjs` and
 * `cli/spreadsheet-cli.js` so both paths agree on what a test value means.
 *
 * Without this dispatch, every value gets parseFloat'd: a Text input given
 * `"110"` becomes the Number 110 (silently re-typing it and making tests
 * pass against a wrongly-typed actual), and `"0042"` loses its leading zero.
 *
 * @param {string} str - Raw value
 * @param {string} [dataType] - Declared type ('Number', 'Text', 'Boolean',
 *   'Date', 'Datetime', or 'ARRAY[...]'). Defaults to 'Number' for
 *   backward-compatibility with the Number-heavy historical data.
 */
export function coerceTestValue(str, dataType) {
  const trimmed = String(str).trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const type = dataType || 'Number';

  if (type.startsWith('ARRAY[')) {
    return trimmed;
  }

  if (type === 'Text') {
    return trimmed;
  }

  if (type === 'Boolean') {
    const lower = trimmed.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return trimmed;
  }

  if (type === 'Date' || type === 'Datetime') {
    return trimmed;
  }

  const num = parseFloat(trimmed.replace(/\s/g, ''));
  return isNaN(num) ? trimmed : num;
}
