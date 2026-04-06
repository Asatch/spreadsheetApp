/**
 * Minimal XML parser for spreadsheet function definitions.
 * Extracts nodes and outputs from Schema 5 format XML.
 */

/**
 * Parse XML string and extract nodes and outputs.
 * @param {string} xmlString - The XML content
 * @returns {{ nodes: Array, outputs: Array, inputs: Array, name: string, sheetType: string }}
 */
export function parseXML(xmlString) {
  // Simple regex-based parsing (no external dependencies)
  const nodes = [];
  const outputs = [];
  const inputs = [];

  // Extract root element attributes
  const rootMatch = xmlString.match(/<CodeCalculation[^>]*>/);
  const name = rootMatch?.[0].match(/name="([^"]+)"/i)?.[1] || 'UNKNOWN';
  const sheetType = rootMatch?.[0].match(/sheetType="([^"]+)"/)?.[1] || 'spreadsheet';

  // Extract all <Node> elements (Schema 5)
  const nodeRegex = /<Node\s+([^>]+)\/>/g;
  let match;

  while ((match = nodeRegex.exec(xmlString)) !== null) {
    const attrs = parseAttributes(match[1]);
    nodes.push({
      node_id: attrs.node_id,
      node_type: attrs.node_type,
      data_type: normalizeDataType(attrs.data_type) || 'Number',
      key: attrs.key,
      canonical: attrs.canonical,
      value: attrs.value,
      input_order: attrs.input_order ? parseInt(attrs.input_order) : undefined,
      input_name: attrs.input_name
    });

    if (attrs.node_type === 'input') {
      inputs.push({
        name: attrs.input_name || attrs.key,
        order: parseInt(attrs.input_order || '0'),
        key: attrs.key,
        data_type: normalizeDataType(attrs.data_type) || 'Number',
        default: parseDefaultValue(attrs.canonical, attrs.data_type)
      });
    }
  }

  // Sort inputs by order
  inputs.sort((a, b) => a.order - b.order);

  // Extract <Output> elements
  const outputRegex = /<Output\s+([^>]+)\/>/g;
  while ((match = outputRegex.exec(xmlString)) !== null) {
    const attrs = parseAttributes(match[1]);
    outputs.push({
      name: attrs.output_name || attrs.Name || attrs.name,
      key: attrs.key || attrs.NodeId,
      order: parseInt(attrs.output_order || attrs.Id || '0'),
      data_type: normalizeDataType(attrs.data_type || attrs.Type) || 'Number',
      output_mode: attrs.output_mode || 'last'
    });
  }

  // Sort outputs by order
  outputs.sort((a, b) => a.order - b.order);

  // Extract TestCases if present
  const testCases = parseTestCases(xmlString);

  // Extract CustomFunctions dependencies
  const customFunctions = parseCustomFunctions(xmlString);

  return { nodes, outputs, inputs, name, sheetType, testCases, customFunctions };
}

/**
 * Parse CustomFunctions dependencies from XML.
 * @param {string} xmlString
 * @returns {Array<{name: string, id?: string, version?: string}>}
 */
function parseCustomFunctions(xmlString) {
  const functions = [];
  const funcRegex = /<Function\s+([^>]+)\/>/g;
  let match;

  while ((match = funcRegex.exec(xmlString)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs.name) {
      functions.push({
        name: attrs.name,
        id: attrs.id,
        version: attrs.version
      });
    }
  }

  return functions;
}

/**
 * Normalize a data_type string to canonical casing (e.g. "number" → "Number").
 * Handles base types, ARRAY[...], and Object[...].
 */
function normalizeDataType(raw) {
  if (!raw) return undefined;
  const CANONICAL = { number: 'Number', text: 'Text', boolean: 'Boolean', date: 'Date', datetime: 'Datetime' };
  // Base type
  const lower = raw.toLowerCase();
  if (CANONICAL[lower]) return CANONICAL[lower];
  // ARRAY[type]
  if (raw.startsWith('ARRAY[') || raw.startsWith('array[')) {
    const inner = raw.slice(6, -1);
    const normInner = CANONICAL[inner.toLowerCase()] || inner;
    return `ARRAY[${normInner}]`;
  }
  // Object[type, ...]
  if (raw.startsWith('Object[') || raw.startsWith('object[')) {
    const inner = raw.slice(7, -1);
    const parts = inner.split(',').map(s => {
      const trimmed = s.trim();
      return CANONICAL[trimmed.toLowerCase()] || trimmed;
    });
    return `Object[${parts.join(', ')}]`;
  }
  return raw;
}

/**
 * Parse HTML-encoded attribute string into object.
 * @param {string} attrString
 * @returns {Object}
 */
function parseAttributes(attrString) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(attrString)) !== null) {
    // Decode HTML entities
    attrs[match[1]] = match[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  return attrs;
}

/**
 * Parse default value from canonical string.
 * @param {string} canonical
 * @param {string} dataType
 * @returns {number|string|boolean}
 */
function parseDefaultValue(canonical, dataType) {
  if (!canonical) return 0;

  // Remove = prefix if present
  const value = canonical.startsWith('=') ? canonical.substring(1) : canonical;

  // Remove spaces (number formatting)
  const cleaned = value.replace(/\s/g, '');

  const num = parseFloat(cleaned);
  if (!isNaN(num)) return num;

  return value;
}

/**
 * Parse TestCases from XML.
 * Supports both formats:
 *   - <TestCase><Input order="0" value="X"/><ExpectedOutput value="Y"/></TestCase>
 *   - <test_case><input_value Value="X"/><output_value Value="Y"/></test_case>
 * @param {string} xmlString
 * @returns {Array<{inputs: number[], expected: number}>}
 */
function parseTestValue(str) {
  const trimmed = str.trim();
  // Array literal — preserve as string (engine parses it via TypeService)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  return parseFloat(trimmed.replace(/\s/g, ''));
}

function parseTestCases(xmlString) {
  const testCases = [];

  // Try format 1: <TestCase>
  const testCaseRegex1 = /<TestCase[^>]*>[\s\S]*?<\/TestCase>/gi;
  let match;

  while ((match = testCaseRegex1.exec(xmlString)) !== null) {
    const testXml = match[0];

    const inputs = [];
    const inputRegex = /<Input[^>]*value="([^"]*)"[^>]*\/>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(testXml)) !== null) {
      inputs.push(parseTestValue(inputMatch[1]));
    }

    const expectedMatch = testXml.match(/<ExpectedOutput[^>]*value="([^"]*)"[^>]*\/>/i);
    const expected = expectedMatch ? parseTestValue(expectedMatch[1]) : null;

    if (inputs.length > 0 && expected !== null) {
      testCases.push({ inputs, expected });
    }
  }

  // Try format 2: <test_case>
  const testCaseRegex2 = /<test_case[^>]*>[\s\S]*?<\/test_case>/gi;

  while ((match = testCaseRegex2.exec(xmlString)) !== null) {
    const testXml = match[0];

    const inputs = [];
    const inputRegex = /<input_value[^>]*Value="([^"]*)"[^>]*\/>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(testXml)) !== null) {
      inputs.push(parseTestValue(inputMatch[1]));
    }

    const expected = [];
    const outputRegex = /<output_value[^>]*Value="([^"]*)"[^>]*\/>/gi;
    let outputMatch;
    while ((outputMatch = outputRegex.exec(testXml)) !== null) {
      expected.push(parseTestValue(outputMatch[1]));
    }

    if (inputs.length > 0 && expected.length > 0) {
      testCases.push({ inputs, expected: expected.length === 1 ? expected[0] : expected });
    }
  }

  return testCases;
}
