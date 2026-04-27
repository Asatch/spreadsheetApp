/**
 * XML normalization — strip frontend metadata from SC 5 XML.
 *
 * Ported from server/transpiler/convert_xml.py.
 * Drops XSD validation and file I/O — works entirely in-memory with DOM API.
 */

// ── Public API ────────────────────────────────────────────────────────

/**
 * Normalize a DOM Document: strip frontend metadata.
 * Mutates the document in place.
 *
 * @param {Document} doc
 */
export function normalizeDoc(doc) {
  stripFrontendMetadata(doc);
}

/**
 * Convenience wrapper: parse an XML string and normalize it.
 *
 * @param {string} xmlContent
 * @returns {Document}
 */
export function loadAndNormalize(xmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent}`);
  }

  normalizeDoc(doc);
  return doc;
}

/**
 * Extract column display names from SpreadsheetMeta ColumnName elements.
 * Must be called BEFORE stripFrontendMetadata.
 *
 * @param {Document} doc
 * @returns {Object} e.g. { A: "BALANCE", B: "YEAR" }
 */
export function extractColumnNames(doc) {
  const columnNames = {};
  for (const cn of doc.querySelectorAll('SpreadsheetMeta > ColumnName')) {
    const col = cn.getAttribute('column');
    const name = cn.getAttribute('name');
    if (col && name) columnNames[col] = name.toUpperCase();
  }
  return columnNames;
}

/**
 * Strip frontend-only elements and attributes not needed for transpilation.
 *
 * @param {Document} doc - mutated in place
 */
export function stripFrontendMetadata(doc) {
  const root = doc.documentElement;

  // Remove frontend-only top-level elements
  for (const tag of ['CustomFunctions', 'SpreadsheetMeta']) {
    for (const el of [...root.querySelectorAll(`:scope > ${tag}`)]) {
      root.removeChild(el);
    }
  }

  // Remove extra attributes from Node elements
  for (const node of root.querySelectorAll('Node')) {
    for (const attr of ['key', 'canonical']) {
      node.removeAttribute(attr);
    }
  }

  // Remove extra attributes from Output elements; derive node_id from NamedNodes if missing
  const namedNodes = {};
  for (const nn of root.querySelectorAll('NamedNode')) {
    const name = nn.getAttribute('node_name');
    const id = nn.getAttribute('node_id');
    if (name && id) namedNodes[name] = id;
  }

  for (const output of root.querySelectorAll('Output')) {
    for (const attr of ['key']) {
      output.removeAttribute(attr);
    }
    if (!output.hasAttribute('node_id')) {
      const outputName = output.getAttribute('output_name');
      const cellName = `${outputName}1`;
      if (namedNodes[cellName]) {
        output.setAttribute('node_id', namedNodes[cellName]);
      }
    }
  }
}
