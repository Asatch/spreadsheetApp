/**
 * Transform logic DAGs.
 *
 * Each transform is a combined MultiDiGraph with two outputs:
 *   output[0] — root of the "from" pattern (what to match)
 *   output[1] — root of the "to" pattern (what to replace it with)
 *
 * Input nodes act as wildcards that match any base-DAG node of a compatible type.
 * Constant nodes match only exact value+type pairs.
 *
 * The returned object is keyed by transform name and fed directly into
 * conversionRules.transforms inside buildSettings.
 */
import { MultiDiGraph } from '../utils/graphModel.js';

function buildTransformDag(name, nodeEntries, edgeEntries, inputNodeIds, outputNodeIds) {
  const G = new MultiDiGraph();
  G.graph.name = name;
  for (const [id, attrs] of nodeEntries) {
    G.addNode(id, attrs);
  }
  for (const [src, tgt, pos] of edgeEntries) {
    G.addEdge(src, tgt, pos);
  }
  G.graph.input_node_ids = inputNodeIds;
  G.graph.output_node_ids = outputNodeIds;
  G.graph.max_node_id = G.nodeIds().reduce((max, id) => (id > max ? id : max), 0);
  // The from-output node must have output_name set so that dictOfMatchingNodeIds can match
  // it against base nodes that are graph outputs (which also have output_name set).
  // The matching check is: if base.output_name !== undefined, then transform.output_name !== undefined.
  G.getNode(outputNodeIds[0]).output_name = 'FROM';
  G.getNode(outputNodeIds[0]).output_order = 0;
  return G;
}

// Shared attribute builders
const num = (extra = {}) => ({ data_type: 'Number', ...extra });
const bool = (extra = {}) => ({ data_type: 'Boolean', ...extra });
const anyType = (extra = {}) => ({ data_type: null, ...extra });
const inp = (order, name, typeAttrs) => ({ node_type: 'input', input_order: order, input_name: name, ...typeAttrs });
const fn = (funcName, typeAttrs) => ({ node_type: 'function', function_name: funcName, ...typeAttrs });
const cnst = (value, typeAttrs) => ({ node_type: 'constant', value, ...typeAttrs });

export function getTransformLogicDags() {
  return {

    // ── Double negation: NEGATE(NEGATE(x)) → x ───────────────────────
    doubleNegate: buildTransformDag(
      'DOUBLE_NEGATE',
      [
        [1, inp(0, 'x', num())],
        [2, fn('NEGATE', num())],
        [3, fn('NEGATE', num())],
      ],
      [[1, 2, 0], [2, 3, 0]],
      [1],
      [3, 1],  // [from, to]
    ),

    // ── Double negation: NOT(NOT(x)) → x ────────────────────────────
    doubleNot: buildTransformDag(
      'DOUBLE_NOT',
      [
        [1, inp(0, 'x', bool())],
        [2, fn('NOT', bool())],
        [3, fn('NOT', bool())],
      ],
      [[1, 2, 0], [2, 3, 0]],
      [1],
      [3, 1],
    ),

    // ── IF(cond, TRUE, FALSE) → cond ─────────────────────────────────
    ifTrueFalse: buildTransformDag(
      'IF_TRUE_FALSE',
      [
        [1, inp(0, 'cond', bool())],
        [2, cnst(true, bool())],
        [3, cnst(false, bool())],
        [4, fn('IF', bool())],
      ],
      [[1, 4, 0], [2, 4, 1], [3, 4, 2]],
      [1],
      [4, 1],
    ),

    // ── IF(cond, FALSE, TRUE) → NOT(cond) ────────────────────────────
    ifFalseTrue: buildTransformDag(
      'IF_FALSE_TRUE',
      [
        [1, inp(0, 'cond', bool())],
        [2, cnst(false, bool())],
        [3, cnst(true, bool())],
        [4, fn('IF', bool())],
        [5, fn('NOT', bool())],
      ],
      [[1, 4, 0], [2, 4, 1], [3, 4, 2], [1, 5, 0]],
      [1],
      [4, 5],
    ),

    // ── IF(TRUE, a, b) → a ───────────────────────────────────────────
    ifConstTrue: buildTransformDag(
      'IF_CONST_TRUE',
      [
        [1, cnst(true, bool())],
        [2, inp(0, 'a', anyType())],
        [3, inp(1, 'b', anyType())],
        [4, fn('IF', anyType())],
      ],
      [[1, 4, 0], [2, 4, 1], [3, 4, 2]],
      [2, 3],
      [4, 2],
    ),

    // ── IF(FALSE, a, b) → b ──────────────────────────────────────────
    ifConstFalse: buildTransformDag(
      'IF_CONST_FALSE',
      [
        [1, cnst(false, bool())],
        [2, inp(0, 'a', anyType())],
        [3, inp(1, 'b', anyType())],
        [4, fn('IF', anyType())],
      ],
      [[1, 4, 0], [2, 4, 1], [3, 4, 2]],
      [2, 3],
      [4, 3],
    ),

    // ── ADD(x, 0) → x ────────────────────────────────────────────────
    addXZero: buildTransformDag(
      'ADD_X_ZERO',
      [
        [1, inp(0, 'x', num())],
        [2, cnst(0, num())],
        [3, fn('ADD', num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [1],
      [3, 1],
    ),

    // ── ADD(0, x) → x ────────────────────────────────────────────────
    addZeroX: buildTransformDag(
      'ADD_ZERO_X',
      [
        [1, cnst(0, num())],
        [2, inp(0, 'x', num())],
        [3, fn('ADD', num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [2],
      [3, 2],
    ),

    // ── MULTIPLY(x, 1) → x ───────────────────────────────────────────
    multiplyXOne: buildTransformDag(
      'MULTIPLY_X_ONE',
      [
        [1, inp(0, 'x', num())],
        [2, cnst(1, num())],
        [3, fn('MULTIPLY', num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [1],
      [3, 1],
    ),

    // ── MULTIPLY(1, x) → x ───────────────────────────────────────────
    multiplyOneX: buildTransformDag(
      'MULTIPLY_ONE_X',
      [
        [1, cnst(1, num())],
        [2, inp(0, 'x', num())],
        [3, fn('MULTIPLY', num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [2],
      [3, 2],
    ),

    // ── MULTIPLY(x, 0) → 0 ───────────────────────────────────────────
    // Node 4 is the "to" constant; toDag has no inputs so nodeIdToReplace
    // ends up with 0 parents before expandNode, matching toDag's 0 inputs.
    multiplyXZero: buildTransformDag(
      'MULTIPLY_X_ZERO',
      [
        [1, inp(0, 'x', num())],
        [2, cnst(0, num())],
        [3, fn('MULTIPLY', num())],
        [4, cnst(0, num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [1],
      [3, 4],
    ),

    // ── MULTIPLY(0, x) → 0 ───────────────────────────────────────────
    multiplyZeroX: buildTransformDag(
      'MULTIPLY_ZERO_X',
      [
        [1, cnst(0, num())],
        [2, inp(0, 'x', num())],
        [3, fn('MULTIPLY', num())],
        [4, cnst(0, num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [2],
      [3, 4],
    ),

    // ── EXPONENT(x, 1) → x ───────────────────────────────────────────
    exponentXOne: buildTransformDag(
      'EXPONENT_X_ONE',
      [
        [1, inp(0, 'x', num())],
        [2, cnst(1, num())],
        [3, fn('EXPONENT', num())],
      ],
      [[1, 3, 0], [2, 3, 1]],
      [1],
      [3, 1],
    ),

  };
}
