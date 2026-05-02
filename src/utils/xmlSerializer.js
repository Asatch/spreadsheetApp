/**
 * XML Serialization Utilities
 * ===========================
 * Pure functions for serializing/deserializing spreadsheet state to/from Schema 5 XML.
 *
 * - generateXml: state → XML string (works in browser and Node.js, no DOM)
 * - parseXml: XML string → state object (browser-only, uses DOMParser)
 * - extractXmlMetadata: XML string → { name, type } (lightweight, for routing decisions)
 */

import { isCellReference } from './cellUtils.js';
import { isArrayType, getArrayElementType } from './typeService.js';

// ============================================================================
// XML UTILITIES
// ============================================================================

/**
 * Escapes special XML characters in attribute values.
 * @param {*} str - Value to escape
 * @returns {string} Escaped string safe for XML attributes
 */
export function escapeXmlAttr(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds an XML element string with attributes.
 * @param {string} name - Element name
 * @param {Object} attrs - Attribute key-value pairs
 * @param {string|null} children - Optional inner content
 * @returns {string} XML element string
 */
export function xmlElement(name, attrs, children = null) {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
    .join(' ');

  if (children === null || children === '') {
    return attrStr ? `<${name} ${attrStr}/>` : `<${name}/>`;
  }
  return attrStr ? `<${name} ${attrStr}>${children}</${name}>` : `<${name}>${children}</${name}>`;
}

/**
 * Check if a string is a numeric literal.
 * @param {string} str - String to test
 * @returns {boolean} True if string represents a number
 */
function isNumber(str) {
  return /^-?\d+(\.\d+)?$/.test(str);
}

/**
 * Check if a string is a quoted string literal (e.g., "WITHDRAWAL").
 * @param {string} str - String to test
 * @returns {boolean} True if string is a quoted string
 */
function isQuotedString(str) {
  return str.length >= 2 && str.startsWith('"') && str.endsWith('"');
}

/**
 * Check if a string is a literal value (number, error, boolean, or quoted string).
 * @param {string} str - String to test
 * @returns {boolean} True if string is a literal
 */
export function isLiteral(str) {
  return str.startsWith('#') || isNumber(str) || str === 'TRUE' || str === 'FALSE' || isQuotedString(str);
}

/**
 * Get the data type for a literal string.
 * @param {string} str - Literal string
 * @returns {string} Data type: 'Number', 'Boolean', or 'Text'
 */
export function getLiteralType(str) {
  if (isNumber(str)) return 'Number';
  if (str === 'TRUE' || str === 'FALSE') return 'Boolean';
  return 'Text';
}

/**
 * Unwrap a literal value for storage — strips quotes from quoted strings.
 * Numbers, booleans, and error values are returned as-is.
 * @param {string} str - Literal string (e.g., '"WITHDRAWAL"', '42', 'TRUE')
 * @returns {string} Unwrapped value (e.g., 'WITHDRAWAL', '42', 'TRUE')
 */
function unwrapLiteral(str) {
  if (isQuotedString(str)) return str.slice(1, -1);
  return str;
}


// ============================================================================
// GENERATE XML (state → XML string)
// ============================================================================

/**
 * Generate Schema 5 XML from spreadsheet state.
 *
 * This is a pure function - all state is passed in, no side effects.
 *
 * @param {Object} state - Complete spreadsheet state
 * @param {string} state.sheetName - Name for the CodeCalculation (will be uppercased)
 * @param {Map|Array} state.canonicalValues - Map or [key, canonical] pairs
 * @param {Map} state.nodeCalcData - Map of key → calc node
 * @param {Set|Array} state.namedInputs - Set or array of input names
 * @param {Array} state.namedInputsOrdered - Ordered array of input names (for input_order)
 * @param {Array} state.outputCells - Array of output cell addresses
 * @param {Object} state.outputModes - Map of address → 'last'|'all' (optional)
 * @param {Object} state.gridBounds - { maxRow: number, maxCol: string }
 * @param {Object} state.formatting - { formatRules, cellStyles, spreadsheetDefaults } (optional)
 * @param {Array} state.customFunctions - Array of { name, id, versionId, version } (optional)
 * @param {Array} state.testCases - Array of test case objects (optional)
 * @param {Array} state.inputNames - Array of input names in order (optional)
 * @param {string} state.sheetType - 'standard' | 'loop' (optional)
 * @param {Object} state.columnNames - Map of column letter → display name (optional)
 * @param {Object} options - Versioning options (optional)
 * @param {string} options.versionId - Version UUID to embed in root element
 * @param {string} options.functionId - Function UUID to embed in root element
 * @param {string} options.sourceSpreadsheetId - Source spreadsheet UUID to embed
 * @returns {string} Complete XML string
 */
export function generateXml(state, options = {}) {
  const {
    sheetName: rawSheetName = 'Untitled',
    canonicalValues,
    nodeCalcData,
    namedInputs,
    namedInputsOrdered = [],
    outputCells = [],
    outputModes = {},
    gridBounds = { maxRow: 30, maxCol: 'O' },
    formatting = { formatRules: [], cellStyles: [], spreadsheetDefaults: {} },
    customFunctions = [],
    testCases = [],
    inputNames = [],
    sheetType = null,
    columnNames = {},
    maxIterations = null,
  } = state;

  // Extract versioning options
  const { versionId, functionId, sourceSpreadsheetId } = options;

  // Normalize to uppercase - function names must be ALL CAPS for transpiler
  const sheetName = rawSheetName.toUpperCase();

  // Build canonical lookup: key → canonical string
  const canonicalMap = canonicalValues instanceof Map
    ? canonicalValues
    : new Map(canonicalValues);

  // Normalize namedInputs to Set
  const namedInputsSet = namedInputs instanceof Set
    ? namedInputs
    : new Set(namedInputs);

  // Step 1: Assign node IDs to all spreadsheet nodes (skip function definitions)
  const keyToNodeId = new Map();
  let nextNodeId = 1;

  for (const [key, node] of nodeCalcData) {
    // Skip all function definitions (both built-in and custom - custom tracked in <CustomFunctions>)
    if (node.type === 'function' && !isCellReference(key) && !key.startsWith('=')) {
      continue;
    }
    keyToNodeId.set(key, nextNodeId++);
  }

  // Step 2: Create literal nodes from precedents
  const literalToNodeId = new Map(); // 'Number:10' → nodeId

  for (const [, node] of nodeCalcData) {
    if (!node.precedents) continue;

    // Scan args (skip function name at [0])
    for (const arg of node.precedents.slice(1)) {
      if (isLiteral(arg)) {
        const literalKey = `${getLiteralType(arg)}:${unwrapLiteral(arg)}`;
        if (!literalToNodeId.has(literalKey)) {
          literalToNodeId.set(literalKey, nextNodeId++);
        }
      }
    }
  }

  // Step 2b: Expand array constants to ARRAY function nodes
  const arrayExpansions = new Map(); // key → { parentNodeIds: [...valueIds] }

  for (const [key, node] of nodeCalcData) {
    // Check if this is an array constant (no precedents, type like 'ARRAY[Number]')
    // Named inputs are excluded — they're parameters whose default array value is
    // stored as the canonical string (e.g., "{1,2,3}"). The engine reconstructs the
    // array from that string at load time; no expansion into child constant nodes needed.
    const isArrayConstant = isArrayType(node.type) &&
                            (!node.precedents || node.precedents.length === 0) &&
                            Array.isArray(node.refValue) &&
                            !namedInputsSet.has(key);

    if (isArrayConstant) {
      const values = node.refValue;
      const elementType = getArrayElementType(node.type);
      const parentNodeIds = [];

      // Create constant nodes for each raw value
      for (const val of values) {
        const valLiteralKey = `${elementType}:${val}`;
        if (!literalToNodeId.has(valLiteralKey)) {
          literalToNodeId.set(valLiteralKey, nextNodeId++);
        }
        parentNodeIds.push(literalToNodeId.get(valLiteralKey));
      }

      arrayExpansions.set(key, { parentNodeIds });
    }
  }

  // Step 3: Build Nodes array
  const nodes = [];

  // Add spreadsheet nodes (cells, named inputs, anonymous expressions)
  for (const [key, nodeId] of keyToNodeId) {
    const node = nodeCalcData.get(key);
    const canonicalValue = canonicalMap.get(key);

    // Check if this is an expanded array constant
    const isExpandedArray = arrayExpansions.has(key);

    // Determine node_type
    let nodeType;
    if (namedInputsSet.has(key)) {
      nodeType = 'input';
    } else if (isExpandedArray) {
      nodeType = 'function';
    } else if (node.precedents && node.precedents.length > 0) {
      nodeType = 'function';
    } else {
      nodeType = 'constant';
    }

    const attrs = {
      node_id: nodeId,
      node_type: nodeType,
      data_type: node.type || 'Text',
      key: key,
      canonical: canonicalValue
    };

    // Add type-specific attributes
    if (isExpandedArray) {
      attrs.function_name = 'ARRAY';
    } else if (nodeType === 'constant') {
      attrs.value = String(node.refValue);
    } else if (nodeType === 'input') {
      const inputOrder = namedInputsOrdered.indexOf(key);
      attrs.input_order = inputOrder >= 0 ? inputOrder : 0;
      attrs.input_name = key;
    } else if (nodeType === 'function' && node.precedents) {
      attrs.function_name = node.precedents[0];
    }

    nodes.push(xmlElement('Node', attrs));
  }

  // Add literal nodes
  for (const [literalKey, nodeId] of literalToNodeId) {
    const colonIdx = literalKey.indexOf(':');
    const dataType = literalKey.substring(0, colonIdx);
    const value = literalKey.substring(colonIdx + 1);
    nodes.push(xmlElement('Node', {
      node_id: nodeId,
      node_type: 'constant',
      data_type: dataType,
      value: value
    }));
  }

  // Step 4: Build NamedNodes array
  const namedNodes = [];

  for (const [key, nodeId] of keyToNodeId) {
    // Add address mapping for cell references
    if (isCellReference(key)) {
      namedNodes.push(xmlElement('NamedNode', {
        node_name: key,
        node_name_type: 'address',
        node_id: nodeId
      }));
    }
    // Add alias mapping for named inputs
    else if (namedInputsSet.has(key)) {
      namedNodes.push(xmlElement('NamedNode', {
        node_name: key,
        node_name_type: 'alias',
        node_id: nodeId
      }));
    }
    // Anonymous expressions (=...) don't need NamedNode entries
  }

  // Step 5: Build NodeDependencies array
  const dependencies = [];

  for (const [key, nodeId] of keyToNodeId) {
    // Check if this is an expanded array constant
    const arrayExpansion = arrayExpansions.get(key);
    if (arrayExpansion) {
      // Add dependencies for ARRAY function: each value
      arrayExpansion.parentNodeIds.forEach((parentId, index) => {
        dependencies.push(xmlElement('NodeDependency', {
          child_node_id: nodeId,
          parent_node_id: parentId,
          parent_position: index
        }));
      });
      continue;
    }

    const node = nodeCalcData.get(key);
    if (!node?.precedents) continue;

    // Skip precedents[0] which is the function name
    node.precedents.slice(1).forEach((precKey, index) => {
      let parentId;

      if (isLiteral(precKey)) {
        const literalKey = `${getLiteralType(precKey)}:${unwrapLiteral(precKey)}`;
        parentId = literalToNodeId.get(literalKey);
      } else {
        parentId = keyToNodeId.get(precKey);
      }

      if (parentId !== undefined) {
        dependencies.push(xmlElement('NodeDependency', {
          child_node_id: nodeId,
          parent_node_id: parentId,
          parent_position: index
        }));
      }
    });
  }

  // Step 6: Build Outputs array
  const outputs = [];
  outputCells.forEach((outputCell, index) => {
    const outputNodeId = keyToNodeId.get(outputCell);
    const outputNode = outputNodeId !== undefined ? nodeCalcData.get(outputCell) : null;
    const mode = outputModes[outputCell.toUpperCase()] || 'last';
    outputs.push(xmlElement('Output', {
      output_name: outputCell,
      node_id: outputNodeId,
      output_order: index,
      data_type: outputNode ? (outputNode.type || 'Text') : 'Number',
      key: outputCell,
      output_mode: mode
    }));
  });

  // Step 7: Build SpreadsheetMeta
  const formatRulesXml = formatting.formatRules.map(([cellKey, formatObj]) =>
    xmlElement('FormatRule', {
      cellKey: cellKey,
      formats: JSON.stringify(formatObj)
    })
  ).join('\n      ');

  const cellStylesXml = formatting.cellStyles.map(([cellKey, styleObj]) =>
    xmlElement('CellStyle', {
      cellKey: cellKey,
      bold: styleObj.bold,
      italic: styleObj.italic,
      fontSize: styleObj.fontSize,
      alignment: styleObj.alignment,
      color: styleObj.color,
      backgroundColor: styleObj.backgroundColor,
      highlight: styleObj.highlight
    })
  ).join('\n      ');

  const defaultsXml = Object.entries(formatting.spreadsheetDefaults)
    .filter(([, settings]) => settings && Object.keys(settings).length > 0)
    .map(([type, settings]) =>
      xmlElement('Default', { type, settings: JSON.stringify(settings) })
    ).join('\n      ');

  const columnNamesXml = Object.entries(columnNames)
    .filter(([, name]) => name)
    .map(([col, name]) =>
      xmlElement('ColumnName', { column: col, name })
    ).join('\n      ');

  const spreadsheetMetaXml = xmlElement('SpreadsheetMeta', {
    version: '1.0',
    timestamp: new Date().toISOString(),
    gridRows: gridBounds.maxRow,
    gridCols: gridBounds.maxCol
  }, `
      ${formatRulesXml}
      ${cellStylesXml}
      ${defaultsXml}
      ${columnNamesXml}
    `);

  // Step 8: Build CustomFunctions element
  // Include versionId (primary) and id (fallback) for each custom function reference
  const customFunctionsXml = customFunctions.length > 0
    ? `<CustomFunctions>\n    ${customFunctions.map(f => xmlElement('Function', {
        versionId: f.versionId,  // Primary identifier for loading specific version
        id: f.id,                // Fallback to current version if versionId not found
        name: f.name,
        version: f.version
      })).join('\n    ')}\n  </CustomFunctions>`
    : '<CustomFunctions/>';

  // Step 8b: Build TestCases element
  // Save all test cases that have inputs (outputs may not be recorded yet)
  let testCasesXml = '<TestCases/>';

  if (testCases.length > 0 && inputNames.length > 0) {
    // Only require inputs - outputs can be recorded later
    const validTestCases = testCases.filter(tc => {
      return inputNames.every(name => tc.inputs[name] !== undefined && tc.inputs[name] !== '');
    });

    if (validTestCases.length > 0) {
      const testCaseElements = validTestCases.map(tc => {
        const inputElements = inputNames.map(name => {
          const value = tc.inputs[name];
          return xmlElement('input_value', { Value: value });
        }).join('\n      ');

        // Output values may be empty/undefined if not yet recorded
        const outputElements = outputCells.map(name => {
          const value = tc.outputs?.[name] ?? '';
          return xmlElement('output_value', { Value: value });
        }).join('\n      ');

        return `<test_case>\n      ${inputElements}\n      ${outputElements}\n    </test_case>`;
      }).join('\n    ');

      testCasesXml = `<TestCases>\n    ${testCaseElements}\n  </TestCases>`;
    }
  }

  // Step 9: Assemble full XML
  // Build optional attributes for versioning
  const sheetTypeAttr = sheetType ? ` sheetType="${escapeXmlAttr(sheetType)}"` : '';
  const maxIterationsAttr = maxIterations != null ? ` maxIterations="${maxIterations}"` : '';
  const versionIdAttr = versionId ? ` versionId="${escapeXmlAttr(versionId)}"` : '';
  const functionIdAttr = functionId ? ` functionId="${escapeXmlAttr(functionId)}"` : '';
  const sourceSpreadsheetIdAttr = sourceSpreadsheetId ? ` sourceSpreadsheetId="${escapeXmlAttr(sourceSpreadsheetId)}"` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="${escapeXmlAttr(sheetName)}"${sheetTypeAttr}${maxIterationsAttr}${versionIdAttr}${functionIdAttr}${sourceSpreadsheetIdAttr}>
  <LangSpecs/>
  ${testCasesXml}
  <Nodes>
    ${nodes.join('\n    ')}
  </Nodes>
  <NamedNodes>
    ${namedNodes.join('\n    ')}
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    ${outputs.join('\n    ')}
  </Outputs>
  <NodeDependencies>
    ${dependencies.join('\n    ')}
  </NodeDependencies>
  ${customFunctionsXml}
  ${spreadsheetMetaXml}
</CodeCalculation>`;

  return xml;
}

// ============================================================================
// PARSE XML (XML string → state object)
// ============================================================================

/**
 * Parse Schema 5 XML into a spreadsheet state object.
 *
 * Uses extended attributes (key, canonical) for round-trip fidelity.
 * Browser-only (uses DOMParser).
 *
 * @param {string} xmlString - XML content
 * @returns {Object} Spreadsheet state object with:
 *   - name: string
 *   - version: string
 *   - timestamp: string
 *   - gridBounds: { maxRow: number, maxCol: string }
 *   - canonicalValues: Array<[key, canonical]>
 *   - namedInputs: Array<string>
 *   - formatRules: Array<[cellKey, formatObj]>
 *   - cellStyles: Array<[cellKey, styleObj]>
 *   - spreadsheetDefaults: Object
 *   - outputCells?: Array<string>
 *   - outputModes?: Object<string, 'last'|'all'>
 *   - customFunctionIds?: Array<string>
 *   - testCases?: Array<{inputs, outputs}>
 *   - type?: 'loop' | null
 * @throws {Error} If XML parsing fails
 */
export function parseXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML parse error: ' + parseError.textContent);
  }

  const root = doc.documentElement;

  // Extract spreadsheet name from CodeCalculation element
  const name = root.getAttribute('name') || 'Untitled';

  // Extract canonical values from Node elements (using our extended attributes)
  const canonicalValues = [];
  const namedInputsList = [];
  const nodes = root.querySelectorAll('Nodes > Node');

  for (const node of nodes) {
    const key = node.getAttribute('key');
    const canonical = node.getAttribute('canonical');
    const nodeType = node.getAttribute('node_type');

    // Only include nodes that have our extended key attribute
    if (key && canonical !== null) {
      canonicalValues.push([key, canonical]);
    }

    // Track named inputs
    if (nodeType === 'input') {
      const inputName = node.getAttribute('input_name') || key;
      const inputOrder = parseInt(node.getAttribute('input_order') || '0', 10);
      if (inputName) {
        namedInputsList.push({ name: inputName, order: inputOrder });
      }
    }
  }

  // Sort named inputs by order
  namedInputsList.sort((a, b) => a.order - b.order);

  // Extract output cells from Outputs (supports multiple)
  const outputCells = [];
  const outputModes = {};  // Map of address -> 'last'|'all'
  const outputElements = root.querySelectorAll('Outputs > Output');
  // Sort by output_order if present, then extract keys
  const sortedOutputs = Array.from(outputElements).sort((a, b) => {
    const orderA = parseInt(a.getAttribute('output_order') || '0', 10);
    const orderB = parseInt(b.getAttribute('output_order') || '0', 10);
    return orderA - orderB;
  });
  for (const output of sortedOutputs) {
    const key = output.getAttribute('key') || output.getAttribute('output_name');
    const mode = output.getAttribute('output_mode') || 'last';
    if (key) {
      outputCells.push(key);
      outputModes[key.toUpperCase()] = mode;
    }
  }

  // Extract SpreadsheetMeta (our extended element)
  const meta = root.querySelector('SpreadsheetMeta');
  const gridBounds = meta ? {
    maxRow: parseInt(meta.getAttribute('gridRows') || '30', 10),
    maxCol: meta.getAttribute('gridCols') || 'O'
  } : { maxRow: 30, maxCol: 'O' };

  // Extract sheet type (optional - e.g., 'loop') - stored on root CodeCalculation element
  const sheetType = root.getAttribute('sheetType') || null;

  // Extract max iterations (optional - loop sheets only)
  const rawMaxIterations = root.getAttribute('maxIterations');
  const maxIterations = rawMaxIterations ? parseInt(rawMaxIterations, 10) : null;

  // Extract format rules (as Map entries: [cellKey, {NUMBER?: {...}, DATE?: {...}, DATETIME?: {...}}])
  const formatRules = [];
  const formatRuleElements = root.querySelectorAll('SpreadsheetMeta > FormatRule');
  for (const rule of formatRuleElements) {
    const cellKey = rule.getAttribute('cellKey');
    const formatsJson = rule.getAttribute('formats');
    if (cellKey && formatsJson) {
      try {
        const formatObj = JSON.parse(formatsJson);
        formatRules.push([cellKey, formatObj]);
      } catch (e) {
        console.warn(`[xmlSerializer] Failed to parse format rules for ${cellKey}:`, e);
      }
    }
  }

  // Extract cell styles (as Map entries: [cellKey, { bold?, italic?, ... }])
  const cellStyles = [];
  const cellStyleElements = root.querySelectorAll('SpreadsheetMeta > CellStyle');
  for (const style of cellStyleElements) {
    const cellKey = style.getAttribute('cellKey');
    const styleObj = {};
    if (style.getAttribute('bold') === 'true') styleObj.bold = true;
    if (style.getAttribute('italic') === 'true') styleObj.italic = true;
    if (style.getAttribute('fontSize')) styleObj.fontSize = parseInt(style.getAttribute('fontSize'), 10);
    if (style.getAttribute('alignment')) styleObj.alignment = style.getAttribute('alignment');
    if (style.getAttribute('color')) styleObj.color = style.getAttribute('color');
    if (style.getAttribute('backgroundColor')) styleObj.backgroundColor = style.getAttribute('backgroundColor');
    if (style.getAttribute('highlight')) styleObj.highlight = style.getAttribute('highlight');
    cellStyles.push([cellKey, styleObj]);
  }

  // Extract spreadsheet defaults (NUMBER, DATE, DATETIME format settings)
  const spreadsheetDefaults = {};
  const defaultElements = root.querySelectorAll('SpreadsheetMeta > Default');
  for (const def of defaultElements) {
    const type = def.getAttribute('type');
    const settings = def.getAttribute('settings');
    if (type && settings) {
      try {
        spreadsheetDefaults[type] = JSON.parse(settings);
      } catch (e) {
        console.warn(`[xmlSerializer] Failed to parse default settings for ${type}:`, e);
      }
    }
  }

  // Extract column names
  const columnNames = {};
  const columnNameElements = root.querySelectorAll('SpreadsheetMeta > ColumnName');
  for (const cn of columnNameElements) {
    const column = cn.getAttribute('column');
    const name = cn.getAttribute('name');
    if (column && name) {
      columnNames[column] = name;
    }
  }

  // Extract custom function IDs and consumer name mapping
  const customFunctionIds = [];
  const customFunctionNames = {};
  const customFunctionElements = root.querySelectorAll('CustomFunctions > Function');
  for (const func of customFunctionElements) {
    const id = func.getAttribute('id');
    const name = func.getAttribute('name');
    if (id) {
      customFunctionIds.push(id);
      if (name) customFunctionNames[id] = name;
    }
  }

  // Extract test cases
  const testCases = [];
  const testCaseElements = root.querySelectorAll('TestCases > test_case, TestCases > TestCase');
  for (const tc of testCaseElements) {
    const inputs = {};
    const outputs = {};

    // Get input values (in order, matched to namedInputs)
    const inputValueElements = tc.querySelectorAll('input_value, InputValue');
    inputValueElements.forEach((iv, index) => {
      const value = iv.getAttribute('Value');
      // Match to input name by index
      const inputName = namedInputsList[index]?.name;
      if (inputName && value !== null) {
        inputs[inputName] = value;
      }
    });

    // Get output values (in order, matched to outputCells)
    const outputValueElements = tc.querySelectorAll('output_value, OutputValue');
    outputValueElements.forEach((ov, index) => {
      const value = ov.getAttribute('Value');
      // Match to output name by index
      const outputName = outputCells[index];
      if (outputName && value !== null) {
        outputs[outputName] = value;
      }
    });

    // Only add if we have at least some values
    if (Object.keys(inputs).length > 0 || Object.keys(outputs).length > 0) {
      testCases.push({ inputs, outputs });
    }
  }

  const data = {
    name,
    version: meta?.getAttribute('version') || '1.0',
    timestamp: meta?.getAttribute('timestamp') || new Date().toISOString(),
    gridBounds,
    canonicalValues,
    namedInputs: namedInputsList.map(n => n.name),
    formatRules,
    cellStyles,
    spreadsheetDefaults,
    ...(outputCells.length > 0 ? { outputCells, outputModes } : {}),
    ...(customFunctionIds.length > 0 ? { customFunctionIds, customFunctionNames } : {}),
    ...(testCases.length > 0 ? { testCases } : {}),
    // Sheet type (optional - e.g., 'loop')
    ...(sheetType ? { type: sheetType } : {}),
    // Max iterations (optional - loop sheets only)
    ...(maxIterations != null && !isNaN(maxIterations) ? { maxIterations } : {}),
    // Column names (optional - display metadata for loop sheets)
    ...(Object.keys(columnNames).length > 0 ? { columnNames } : {})
  };

  return data;
}

// ============================================================================
// EXTRACT METADATA (lightweight, for routing decisions)
// ============================================================================

/**
 * Extract just the name and type from XML without full parsing.
 * Used when we only need metadata for routing (e.g., which page to load).
 * Browser-only (uses DOMParser).
 *
 * @param {string} xmlString - XML content
 * @returns {{ name: string, type: string|null }} Metadata from root element
 * @throws {Error} If XML parsing fails
 */
export function extractXmlMetadata(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML parse error: ' + parseError.textContent);
  }

  const root = doc.documentElement;
  return {
    name: root.getAttribute('name') || 'Untitled',
    type: root.getAttribute('sheetType') || null
  };
}

/**
 * Extract function signature (inputs + outputs with types) from XML.
 * Used at publish time to persist signature in the manifest.
 * Browser-only (uses DOMParser).
 *
 * @param {string} xmlString - XML content
 * @returns {{ inputs: Array<{name: string, type: string}>, outputs: Array<{name: string, type: string}> }}
 */
export function extractSignatureFromXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return { inputs: [], outputs: [] };
  }

  const root = doc.documentElement;

  // Extract inputs from Node elements with node_type="input"
  const inputs = [];
  for (const node of root.querySelectorAll('Nodes > Node')) {
    if (node.getAttribute('node_type') === 'input') {
      const name = node.getAttribute('input_name') || node.getAttribute('key');
      const type = node.getAttribute('data_type') || 'Number';
      const order = parseInt(node.getAttribute('input_order') || '0', 10);
      const canonical = node.getAttribute('canonical');
      if (name) inputs.push({ name, type, order, canonical });
    }
  }
  inputs.sort((a, b) => a.order - b.order);

  // Extract unique test case values per input (positional, matching input_order)
  const testCases = root.querySelectorAll('TestCases > test_case');
  if (testCases.length > 0) {
    const inputCount = inputs.length;
    const valueSets = inputs.map(() => new Set());
    for (const tc of testCases) {
      const inputEls = tc.querySelectorAll('input_value');
      for (let i = 0; i < Math.min(inputEls.length, inputCount); i++) {
        const val = inputEls[i].getAttribute('Value');
        if (val != null) valueSets[i].add(val);
      }
    }
    for (let i = 0; i < inputCount; i++) {
      inputs[i].testValues = [...valueSets[i]];
    }
  }

  inputs.forEach(inp => delete inp.order);

  // Build format lookup: cellKey → format object (e.g., { subCategory: 'currency', ... })
  const formatRules = {};
  for (const rule of root.querySelectorAll('SpreadsheetMeta > FormatRule')) {
    const cellKey = rule.getAttribute('cellKey');
    const formatsJson = rule.getAttribute('formats');
    if (cellKey && formatsJson) {
      try {
        const parsed = JSON.parse(formatsJson);
        if (parsed.NUMBER) formatRules[cellKey] = parsed.NUMBER;
      } catch { /* skip malformed */ }
    }
  }

  // Extract spreadsheet-level NUMBER default as fallback
  let numberDefault = null;
  for (const def of root.querySelectorAll('SpreadsheetMeta > Default')) {
    if (def.getAttribute('type') === 'NUMBER') {
      try { numberDefault = JSON.parse(def.getAttribute('settings')); } catch { /* skip */ }
    }
  }

  // Build alias → cell address map by joining NamedNode entries on node_id.
  // Format rules are keyed by cell address, but a named output's key is the alias,
  // so we need to resolve it before looking up the format.
  const nodeIdToAddress = {};
  const aliasToNodeId = {};
  for (const nn of root.querySelectorAll('NamedNodes > NamedNode')) {
    const nodeId = nn.getAttribute('node_id');
    const nameType = nn.getAttribute('node_name_type');
    const nodeName = nn.getAttribute('node_name');
    if (!nodeId || !nodeName) continue;
    if (nameType === 'address') nodeIdToAddress[nodeId] = nodeName;
    else if (nameType === 'alias') aliasToNodeId[nodeName] = nodeId;
  }

  // Build node lookup for PROCEED pass-through resolution. Many outputs are
  // named PROCEED nodes (e.g. BROKE_AGE = =B63) with no NamedNode entry of
  // their own; the format rule lives on the underlying cell.
  const nodeById = {};
  for (const node of root.querySelectorAll('Nodes > Node')) {
    const nid = node.getAttribute('node_id');
    if (nid) nodeById[nid] = {
      key: node.getAttribute('key'),
      function_name: node.getAttribute('function_name'),
      parents: [],
    };
  }
  for (const dep of root.querySelectorAll('NodeDependencies > NodeDependency')) {
    const child = dep.getAttribute('child_node_id');
    const parent = dep.getAttribute('parent_node_id');
    const pos = parseInt(dep.getAttribute('parent_position') || '0', 10);
    if (nodeById[child] && parent) nodeById[child].parents[pos] = parent;
  }
  const isCellAddress = (k) => !!k && /^[A-Z]+\d+$/.test(k);
  const resolveOutputAddress = (name, nodeId) => {
    // Direct alias resolution (named-range output pointing at a cell).
    const aliasNid = aliasToNodeId[name];
    if (aliasNid && nodeIdToAddress[aliasNid]) return nodeIdToAddress[aliasNid];
    // Walk PROCEED pass-throughs from the output node down to a cell address.
    const visited = new Set();
    let curId = nodeId;
    while (curId && !visited.has(curId)) {
      visited.add(curId);
      const n = nodeById[curId];
      if (!n) break;
      if (isCellAddress(n.key)) return n.key;
      if (nodeIdToAddress[curId]) return nodeIdToAddress[curId];
      if (n.function_name === 'PROCEED' && n.parents[0]) {
        curId = n.parents[0];
        continue;
      }
      break;
    }
    return null;
  };

  // Extract outputs from Output elements, attaching format when available
  const outputs = [];
  const outputEls = Array.from(root.querySelectorAll('Outputs > Output')).sort((a, b) => {
    return parseInt(a.getAttribute('output_order') || '0', 10) -
           parseInt(b.getAttribute('output_order') || '0', 10);
  });
  for (const output of outputEls) {
    const name = output.getAttribute('key') || output.getAttribute('output_name');
    const nodeId = output.getAttribute('node_id');
    const type = output.getAttribute('data_type') || 'Number';
    if (name) {
      const entry = { name, type };
      const address = resolveOutputAddress(name, nodeId);
      const format = formatRules[name] || (address && formatRules[address]) || numberDefault;
      if (format) entry.format = format;
      outputs.push(entry);
    }
  }

  return { inputs, outputs };
}

// ============================================================================
// STRIP UNUSED INPUTS FROM PUBLISHED XML
// ============================================================================

/**
 * Remove specified input declarations from a published XML string. Removes the
 * matching input <Node>, its <NamedNode> alias, the corresponding positional
 * <input_value> in every <test_case>, and renumbers remaining input_order
 * attributes to stay contiguous.
 *
 * Used at publish time to align the published XML's declared inputs with the
 * transpiled JS signature (the transpiler drops inputs that don't reach any
 * output, so the JS function only takes the reachable ones — keeping unused
 * inputs in the XML causes positional mismatches when drilldown rehydrates
 * caller args by name).
 *
 * @param {string} xmlString - Published XML
 * @param {string[]} unusedNames - Input names to remove
 * @returns {string} XML with the named inputs stripped
 */
export function stripUnusedInputsFromXml(xmlString, unusedNames) {
  if (!unusedNames || unusedNames.length === 0) return xmlString;

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('XML parse error: ' + parseError.textContent);

  const root = doc.documentElement;
  const unusedSet = new Set(unusedNames);

  // Remove input <Node> elements; record their input_order for test_case stripping
  const removedOrders = [];
  for (const node of [...root.querySelectorAll('Nodes > Node')]) {
    if (node.getAttribute('node_type') !== 'input') continue;
    const name = node.getAttribute('input_name');
    if (unusedSet.has(name)) {
      removedOrders.push(parseInt(node.getAttribute('input_order') || '0', 10));
      node.parentNode.removeChild(node);
    }
  }

  // Remove the alias NamedNode for each stripped input
  for (const nn of [...root.querySelectorAll('NamedNodes > NamedNode')]) {
    if (nn.getAttribute('node_name_type') !== 'alias') continue;
    if (unusedSet.has(nn.getAttribute('node_name'))) {
      nn.parentNode.removeChild(nn);
    }
  }

  // Strip positional <input_value> from each test case (descending so earlier
  // indices stay valid after later removals)
  if (removedOrders.length > 0) {
    const orderedDesc = [...removedOrders].sort((a, b) => b - a);
    for (const tc of root.querySelectorAll('TestCases > test_case')) {
      const ivs = [...tc.querySelectorAll('input_value')];
      for (const idx of orderedDesc) {
        if (ivs[idx]) ivs[idx].parentNode.removeChild(ivs[idx]);
      }
    }
  }

  // Renumber surviving input_order attributes to 0..N-1 (preserving relative order)
  const remaining = [...root.querySelectorAll('Nodes > Node')]
    .filter(n => n.getAttribute('node_type') === 'input')
    .sort((a, b) =>
      parseInt(a.getAttribute('input_order') || '0', 10) -
      parseInt(b.getAttribute('input_order') || '0', 10)
    );
  remaining.forEach((node, i) => node.setAttribute('input_order', String(i)));

  return new XMLSerializer().serializeToString(doc);
}
