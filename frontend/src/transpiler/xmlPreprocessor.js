/**
 * XML preprocessing: schema cleaning + legacy function name conversion.
 *
 * Ported from server/app/services/schema_converter.py and xml_converter.py.
 * All functions operate on a DOM Document in-place (no string round-trips).
 */

// ── Legacy Excel macro symbol → canonical name mapping ────────────────

const SYMBOL_TO_CANONICAL = new Map([
  ['<=', 'LESSEQUAL'],
  ['>=', 'GREATEREQUAL'],
  ['<>', 'NOTEQUAL'],
  ['+', 'ADD'],
  ['-', 'SUBTRACT'],
  ['*', 'MULTIPLY'],
  ['/', 'DIVIDE'],
  ['^', 'EXPONENT'],
  ['%', 'MOD'],
  ['=', 'EQUAL'],
  ['<', 'LESS'],
  ['>', 'GREATER'],
  ['N', 'NEGATE'],
]);

/**
 * Convert legacy Excel macro operator symbols to canonical function names.
 * Operates on DOM: finds elements with function_name (SC5) or Name (SC3) attrs
 * and replaces symbol values with canonical names.
 *
 * @param {Document} doc - mutated in place
 */
export function convertFunctionNames(doc) {
  // SC5: Node elements with function_name attr
  for (const node of doc.querySelectorAll('Node[function_name]')) {
    const name = node.getAttribute('function_name');
    const canonical = SYMBOL_TO_CANONICAL.get(name);
    if (canonical) node.setAttribute('function_name', canonical);
  }
  // SC3: FunctionNode children with Name attr
  for (const node of doc.querySelectorAll('FunctionNodes > *[Name]')) {
    const name = node.getAttribute('Name');
    const canonical = SYMBOL_TO_CANONICAL.get(name);
    if (canonical) node.setAttribute('Name', canonical);
  }
}

// ── Schema 5 attribute allowlist ──────────────────────────────────────

const ALLOWED_ATTRS = {
  CodeCalculation: new Set(['name', 'AppliesTo', 'sheetType', 'maxIterations']),
  LangSpec: new Set(['Language', 'ProcessStub', 'Skip', 'PrefixStub', 'DefineHelperFunction']),
  test_case: new Set(),
  input_value: new Set(['data_type', 'Value']),
  output_value: new Set(['data_type', 'Value']),
  Node: new Set(['input_order', 'input_name', 'function_name', 'node_id', 'node_type', 'data_type', 'value']),
  NamedNode: new Set(['node_name', 'node_name_type', 'node_id']),
  Output: new Set(['output_name', 'node_id', 'output_order', 'data_type', 'key', 'output_mode']),
  NodeDependency: new Set(['child_node_id', 'parent_node_id', 'parent_position']),
};

const REQUIRED_SECTIONS = ['Nodes', 'NamedNodes', 'NodeComments', 'Outputs', 'NodeDependencies'];
const ALLOWED_SECTIONS = new Set([...REQUIRED_SECTIONS, 'LangSpecs', 'TestCases', 'CustomFunctions', 'SpreadsheetMeta']);

/**
 * Clean sc-spreadsheet XML DOM to valid schema 5 format.
 * Removes attributes not in the schema, ensures required sections exist.
 * Mutates the document in place.
 *
 * @param {Document} doc - DOM document to clean
 * @param {string} [functionName] - optional name override
 */
export function cleanSchema(doc, functionName) {
  const root = doc.documentElement;

  if (functionName) {
    root.setAttribute('name', functionName);
  }

  // Migrate Name → name if needed, then remove schema-3 artifacts
  if (root.hasAttribute('Name') && !root.hasAttribute('name')) {
    root.setAttribute('name', root.getAttribute('Name'));
  }
  for (const attr of ['Version', 'HasMultipleOutputs', 'Name']) {
    root.removeAttribute(attr);
  }

  _cleanElement(root);
  _ensureRequiredSections(doc, root);
}

function _cleanElement(element) {
  const allowed = ALLOWED_ATTRS[element.tagName];
  if (allowed) {
    const toRemove = [];
    for (const attr of element.attributes) {
      if (!allowed.has(attr.name)) toRemove.push(attr.name);
    }
    for (const name of toRemove) element.removeAttribute(name);
  }
  for (const child of element.children) {
    _cleanElement(child);
  }
}

function _ensureRequiredSections(doc, root) {
  // Remove elements not in schema 5
  const toRemove = [];
  for (const child of root.children) {
    if (!ALLOWED_SECTIONS.has(child.tagName)) toRemove.push(child);
  }
  for (const child of toRemove) root.removeChild(child);

  // Add missing required sections
  for (const section of REQUIRED_SECTIONS) {
    if (!root.querySelector(`:scope > ${section}`)) {
      root.appendChild(doc.createElement(section));
    }
  }
}
