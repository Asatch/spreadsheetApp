/**
 * Function Compiler
 * =================
 * Transpiles XML→JS and compiles JS into callable functions.
 *
 * Local-first architecture:
 * - Functions are stored locally in OPFS
 * - Transpilation runs client-side (no server needed)
 *
 * Uses factory pattern with explicit dependency injection.
 */

import { transpile as clientTranspile } from '../transpiler/index.js';

/**
 * Create a function compiler instance.
 *
 * @param {Object} config
 * @param {Function} config.loadFunctionFromOpfs - async (functionId) => { code, definition, metadata } | null
 * @returns {Object} Function compiler instance
 */
export function createFunctionCompiler({
  loadFunctionFromOpfs = null,
} = {}) {

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Parse JavaScript function code to extract parameter names.
   * @param {string} jsCode - Transpiled JavaScript code
   * @param {string} targetName - Function name to find
   * @returns {{functionName: string, paramNames: string[]}}
   */
  function parseJsFunction(jsCode, targetName) {
    const regex = new RegExp(`function\\s+${targetName}\\s*\\(([^)]*)\\)`);
    const match = jsCode.match(regex);
    if (!match) {
      throw new Error(`Could not find function ${targetName} in transpiled code`);
    }

    const paramStr = match[1].trim();
    const paramNames = paramStr ? paramStr.split(/\s*,\s*/) : [];

    return { functionName: targetName, paramNames };
  }

  /**
   * Create an executable implementation from transpiled JS code.
   * Both the calc engine and transpiled functions use flat arrays [val, val, ...],
   * so no boundary conversion is needed for array-typed inputs/outputs.
   * @param {string} jsCode - Transpiled JavaScript code
   * @param {string} targetName - Main function name to execute
   * @returns {{impl: Function, paramNames: string[]}}
   */
  function createExecutableImpl(jsCode, targetName) {
    const { functionName, paramNames } = parseJsFunction(jsCode, targetName);

    const compiledFn = new Function(`
      ${jsCode}
      return ${functionName};
    `)();

    const impl = (values) => {
      const args = values.map(v => v.refValue);
      const result = compiledFn(...args);
      return { value: result };
    };

    return { impl, paramNames };
  }

  /**
   * Build a funcDef object from raw data.
   * @param {string} functionId - Function UUID
   * @param {string} versionId - Version UUID
   * @param {Object} metadata - Function metadata
   * @param {string} jsCode - Transpiled JavaScript
   * @param {string} xmlContent - Raw XML for drill-down
   * @returns {Object} The funcDef object
   */
  function buildFuncDef(functionId, versionId, metadata, jsCode, xmlContent) {
    // Use publishedName for JS parsing — the transpiled JS embeds the name at publish time
    const publishedName = (metadata.publishedName || metadata.name).toUpperCase();

    const signature = metadata.signature || null;
    let argTypes;
    let returnType = 'Number';

    if (signature?.inputs?.length) {
      argTypes = signature.inputs.map(inp => inp.type || 'Number');
    } else {
      // Fall back to parsing param names from JS (all assumed 'Number')
      const { paramNames } = parseJsFunction(jsCode, publishedName);
      argTypes = paramNames.map(() => 'Number');
    }

    if (signature?.outputs?.length > 1) {
      returnType = `Object[${signature.outputs.map(o => o.type || 'Number').join(', ')}]`;
    } else if (signature?.outputs?.length === 1) {
      returnType = signature.outputs[0].type || 'Number';
    }

    // Now create the executable with type info for boundary conversion
    const { impl } = createExecutableImpl(jsCode, publishedName);

    return {
      id: functionId,
      versionId: versionId || null,
      name: publishedName,
      version: metadata.version || '1.0',
      description: metadata.description,
      author: metadata.author,
      signature,
      xmlContent,
      sheetType: metadata.sheetType || 'standard',
      sourceSpreadsheetId: metadata.sourceSpreadsheetId || null,
      variants: [
        {
          argTypes,
          returnType,
          impl
        }
      ]
    };
  }

  // ============================================================================
  // FUNCTION LOADING
  // ============================================================================

  /**
   * Load a function by ID from local OPFS storage.
   *
   * @param {string} functionId - Function ID (UUID)
   * @returns {Promise<Object>} The function definition
   * @throws {Error} If function not found locally
   */
  async function loadFunction(functionId) {
    const stored = await loadFunctionFromOpfs?.(functionId);
    if (!stored) {
      throw new Error(`Function not found locally: ${functionId}. You may need to load it first.`);
    }

    console.log(`[FunctionCompiler] Loaded ${functionId} from OPFS`);
    return buildFuncDef(
      functionId,
      stored.metadata?.versionId,
      stored.metadata,
      stored.code,
      stored.definition
    );
  }

  /**
   * Load multiple functions by ID.
   *
   * @param {string[]} functionIds - Array of function IDs to load
   * @returns {Promise<Map<string, Object|{error: Error}>>}
   */
  async function loadFunctions(functionIds) {
    const results = new Map();

    const promises = functionIds.map(async (id) => {
      try {
        const result = await loadFunction(id);
        results.set(id, result);
      } catch (error) {
        results.set(id, { error });
      }
    });

    await Promise.all(promises);
    return results;
  }

  // ============================================================================
  // TRANSPILATION
  // ============================================================================

  /**
   * Transpile XML to JavaScript without storing on server.
   * This is the core of the local-first architecture.
   *
   * @param {string} xmlContent - The XML content to transpile
   * @param {string} targetLanguage - Target language (default: 'javascript')
   * @returns {Promise<{javascript?: string, python?: string, sql?: string, error?: string}>}
   */
  async function transpile(xmlContent, targetLanguage = 'javascript', customFunctions = {}) {
    if (!xmlContent) {
      return { error: 'No XML content provided' };
    }

    const result = clientTranspile(xmlContent, customFunctions);

    if (result.error) {
      console.error('[FunctionCompiler] Transpile failed:', result.error);
      return { error: result.error };
    }

    console.log(`[FunctionCompiler] Transpiled to ${targetLanguage} (client-side)`);
    return { [targetLanguage]: result.javascript, signature: result.signature };
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    // Function loading (from local OPFS)
    loadFunction,
    loadFunctions,

    // Transpilation (client-side)
    transpile,
  };
}
