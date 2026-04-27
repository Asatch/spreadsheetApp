/**
 * Error helpers for the transpiler.
 *
 * The Python version saved DAGs/code to disk before raising.
 * Client-side we just throw — the caller can inspect the error message.
 */

export function throwNodeError(G, nodeId, message) {
  throw new Error(`${message} [node ${nodeId}]`);
}

export function throwConversionRulesError(G, nodeId, message) {
  throw new Error(`${message} [node ${nodeId}]`);
}

export function throwDagError(G, message) {
  throw new Error(message);
}

export function throwTwoDagError(message) {
  throw new Error(message);
}

export function requireInt(v) {
  if (typeof v !== 'number') throw new Error(`Expected number, got ${typeof v}: ${v}`);
  return v;
}

