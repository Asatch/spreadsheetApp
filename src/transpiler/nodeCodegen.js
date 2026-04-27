/**
 * Centralized code generation for function and node coding.
 *
 * Ported from server/transpiler/coding_centralized.py.
 * Python's partial() → JS closures.
 */

import { throwNodeError, throwDagError } from './errors.js';

/**
 * Generate code for a standard function node.
 */
export function codeStdFunctionNode(
  G, nodeId, conversionRules,
  codeNodeFn, replaceKeyFn, specialProcessFn, getOrderedParentIds, cr,
  isPersisted = false,
) {
  const signature = cr.matchFirstSignatureForNode(G, nodeId, conversionRules);
  if (!signature) {
    const functionName = G.getNode(nodeId).function_name;
    const inputTypes = cr.getParentDataTypes(G, nodeId);
    throwNodeError(G, nodeId,
      `Unsupported function: ${functionName} with input data types ${inputTypes.join(', ')}`);
    return '';
  }

  return codeSupportedFunction(
    G, nodeId, signature, conversionRules,
    codeNodeFn, replaceKeyFn, specialProcessFn, getOrderedParentIds,
    isPersisted,
  );
}

/**
 * Generate code for a supported function given a matched signature.
 */
function codeSupportedFunction(
  G, nodeId, functionSignature, conversionRules,
  codeNodeFn, replaceKeyFn, specialProcessFn, getOrderedParentIds,
  isPersisted = false,
) {
  const functionName = G.getNode(nodeId).function_name;

  if (functionSignature.outputs.length > 1 && !functionSignature.is_helper_function) {
    throw new Error(`Add support for more than one output. Function ${functionName} requires >1 output`);
  }

  if (functionSignature.no_code) {
    throwDagError(G,
      `Signature exists for ${functionName} but has no mechanism to code it. ` +
      `Add ${functionName} with inputs ${functionSignature.inputs.join(', ')} to conversion rules.`);
  }

  const parents = getOrderedParentIds(G, nodeId);

  let code;
  if (functionSignature.template) {
    const templateName = functionSignature.template;
    const templateObj = conversionRules.templates[templateName];
    const template = (isPersisted && templateObj['force-persist-template'])
      ? templateObj['force-persist-template']
      : templateObj['no-persist-template'];
    code = replacePlaceholders(template, replaceKeyFn);
  } else {
    code = functionSignature.code_before || '';
    if (functionSignature.operator) {
      if (parents.length > 2) {
        throwNodeError(G, nodeId, 'Operator functions allowed 2 inputs only.');
        return '';
      }
      code += codeNodeFn(parents[0]);
      code += ` ${functionSignature.operator} `;
      if (parents.length === 2) code += codeNodeFn(parents[1]);
    } else {
      code += parents.map(p => codeNodeFn(p)).join(', ');
    }
    code += functionSignature.code_after || '';
  }

  specialProcessFn(G, nodeId, functionSignature);

  return code;
}

// ── Placeholder replacement ───────────────────────────────────────────

/**
 * Replace <placeholder> tokens in a template string.
 * @param {string|Object|Array} template
 * @param {Function} getPlaceholderValue - (code) => string|null
 * @returns {string|Object|Array}
 */
function replacePlaceholders(template, getPlaceholderValue) {
  if (typeof template === 'string') {
    return _replacePlaceholdersStr(template, getPlaceholderValue);
  }
  if (Array.isArray(template)) {
    return template.map(item => replacePlaceholders(item, getPlaceholderValue));
  }
  if (typeof template === 'object' && template !== null) {
    const result = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = replacePlaceholders(value, getPlaceholderValue);
    }
    return result;
  }
  throw new TypeError('Template must be a string, object, or array');
}

function _replacePlaceholdersStr(template, getPlaceholderValue) {
  const missing = new Set();

  const result = template.replace(/<([^<>]*)>/g, (match, code) => {
    const value = getPlaceholderValue(code);
    if (value == null) {
      missing.add(code);
      return match;
    }
    return value;
  });

  if (missing.size > 0) {
    throw new Error(`Missing placeholder variables: ${[...missing].join(', ')}`);
  }
  return result;
}
