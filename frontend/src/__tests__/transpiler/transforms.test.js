import { describe, it, expect } from 'vitest';
import { transpile } from '../../transpiler/index.js';

/**
 * Tests for DAG transform rules.
 *
 * Each test builds a minimal spreadsheet containing the from-pattern,
 * transpiles it, executes the result, and verifies correctness.
 * We also check the generated JS doesn't contain the eliminated operations
 * to confirm the transform actually fired.
 */

function transpileAndCall(xml, args) {
  const result = transpile(xml, {});
  if (result.error) throw new Error(`Transpile error: ${result.error}`);
  const funcName = xml.match(/name="([^"]+)"/)?.[1]?.toUpperCase();
  const fn = new Function(result.javascript + `\nreturn ${funcName};`)();
  return { value: fn(...args), js: result.javascript };
}

// Helper to build a simple single-input, single-output XML for testing transforms.
// The body node is a function node with the given structure.
function makeXml(name, inputType, nodes, deps, outputNodeId, outputType) {
  const nodesXml = nodes.map(n => {
    const attrs = Object.entries(n)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    return `    <Node ${attrs}/>`;
  }).join('\n');

  const depsXml = deps.map(d =>
    `    <NodeDependency child_node_id="${d.child}" parent_node_id="${d.parent}" parent_position="${d.pos}"/>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="${name}">
  <LangSpecs/>
  <TestCases/>
  <Nodes>
${nodesXml}
  </Nodes>
  <NamedNodes/>
  <NodeComments/>
  <Outputs>
    <Output output_name="RESULT" node_id="${outputNodeId}" output_order="0" data_type="${outputType}"/>
  </Outputs>
  <NodeDependencies>
${depsXml}
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;
}

// ── NEGATE(NEGATE(x)) → x ────────────────────────────────────────────────────

describe('transform: NEGATE(NEGATE(x)) → x', () => {
  const xml = makeXml(
    'TEST_DOUBLE_NEGATE',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 2, node_type: 'function', data_type: 'Number', function_name: 'NEGATE' },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'NEGATE' },
    ],
    [
      { child: 2, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 0 },
    ],
    3, 'Number',
  );

  it('returns the input unchanged', () => {
    expect(transpileAndCall(xml, [5]).value).toBe(5);
    expect(transpileAndCall(xml, [-3]).value).toBe(-3);
  });

});

// ── NOT(NOT(x)) → x ──────────────────────────────────────────────────────────

describe('transform: NOT(NOT(x)) → x', () => {
  const xml = makeXml(
    'TEST_DOUBLE_NOT',
    'Boolean',
    [
      { node_id: 1, node_type: 'input', data_type: 'Boolean', input_order: 0, input_name: 'x' },
      { node_id: 2, node_type: 'function', data_type: 'Boolean', function_name: 'NOT' },
      { node_id: 3, node_type: 'function', data_type: 'Boolean', function_name: 'NOT' },
    ],
    [
      { child: 2, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 0 },
    ],
    3, 'Boolean',
  );

  it('returns the input unchanged', () => {
    expect(transpileAndCall(xml, [true]).value).toBe(true);
    expect(transpileAndCall(xml, [false]).value).toBe(false);
  });

  it('eliminates double NOT from generated JS', () => {
    const { js } = transpileAndCall(xml, [true]);
    expect(js).not.toContain('sc_not');
  });
});

// ── IF(cond, TRUE, FALSE) → cond ─────────────────────────────────────────────

describe('transform: IF(cond, TRUE, FALSE) → cond', () => {
  const xml = makeXml(
    'TEST_IF_TRUE_FALSE',
    'Boolean',
    [
      { node_id: 1, node_type: 'input', data_type: 'Boolean', input_order: 0, input_name: 'cond' },
      { node_id: 2, node_type: 'constant', data_type: 'Boolean', value: 'true' },
      { node_id: 3, node_type: 'constant', data_type: 'Boolean', value: 'false' },
      { node_id: 4, node_type: 'function', data_type: 'Boolean', function_name: 'IF' },
    ],
    [
      { child: 4, parent: 1, pos: 0 },
      { child: 4, parent: 2, pos: 1 },
      { child: 4, parent: 3, pos: 2 },
    ],
    4, 'Boolean',
  );

  it('returns the condition directly', () => {
    expect(transpileAndCall(xml, [true]).value).toBe(true);
    expect(transpileAndCall(xml, [false]).value).toBe(false);
  });

  it('eliminates the IF from generated JS', () => {
    const { js } = transpileAndCall(xml, [true]);
    expect(js).not.toContain('sc_if');
  });
});

// ── IF(cond, FALSE, TRUE) → NOT(cond) ────────────────────────────────────────

describe('transform: IF(cond, FALSE, TRUE) → NOT(cond)', () => {
  const xml = makeXml(
    'TEST_IF_FALSE_TRUE',
    'Boolean',
    [
      { node_id: 1, node_type: 'input', data_type: 'Boolean', input_order: 0, input_name: 'cond' },
      { node_id: 2, node_type: 'constant', data_type: 'Boolean', value: 'false' },
      { node_id: 3, node_type: 'constant', data_type: 'Boolean', value: 'true' },
      { node_id: 4, node_type: 'function', data_type: 'Boolean', function_name: 'IF' },
    ],
    [
      { child: 4, parent: 1, pos: 0 },
      { child: 4, parent: 2, pos: 1 },
      { child: 4, parent: 3, pos: 2 },
    ],
    4, 'Boolean',
  );

  it('returns NOT(cond)', () => {
    expect(transpileAndCall(xml, [true]).value).toBe(false);
    expect(transpileAndCall(xml, [false]).value).toBe(true);
  });

  it('introduces NOT in generated JS', () => {
    const { js } = transpileAndCall(xml, [true]);
    expect(js).toContain('sc_not(');
  });
});

// ── IF(TRUE, a, b) → a ───────────────────────────────────────────────────────

describe('transform: IF(TRUE, a, b) → a', () => {
  const xml = makeXml(
    'TEST_IF_CONST_TRUE',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'a' },
      { node_id: 2, node_type: 'input', data_type: 'Number', input_order: 1, input_name: 'b' },
      { node_id: 3, node_type: 'constant', data_type: 'Boolean', value: 'true' },
      { node_id: 4, node_type: 'function', data_type: 'Number', function_name: 'IF' },
    ],
    [
      { child: 4, parent: 3, pos: 0 },
      { child: 4, parent: 1, pos: 1 },
      { child: 4, parent: 2, pos: 2 },
    ],
    4, 'Number',
  );

  it('returns the true branch (a)', () => {
    expect(transpileAndCall(xml, [10, 20]).value).toBe(10);
    expect(transpileAndCall(xml, [99, 0]).value).toBe(99);
  });

  it('eliminates the IF from generated JS', () => {
    const { js } = transpileAndCall(xml, [1, 2]);
    expect(js).not.toContain('sc_if');
  });
});

// ── IF(FALSE, a, b) → b ──────────────────────────────────────────────────────

describe('transform: IF(FALSE, a, b) → b', () => {
  const xml = makeXml(
    'TEST_IF_CONST_FALSE',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'a' },
      { node_id: 2, node_type: 'input', data_type: 'Number', input_order: 1, input_name: 'b' },
      { node_id: 3, node_type: 'constant', data_type: 'Boolean', value: 'false' },
      { node_id: 4, node_type: 'function', data_type: 'Number', function_name: 'IF' },
    ],
    [
      { child: 4, parent: 3, pos: 0 },
      { child: 4, parent: 1, pos: 1 },
      { child: 4, parent: 2, pos: 2 },
    ],
    4, 'Number',
  );

  it('returns the false branch (b)', () => {
    expect(transpileAndCall(xml, [10, 20]).value).toBe(20);
    expect(transpileAndCall(xml, [99, 0]).value).toBe(0);
  });

  it('eliminates the IF from generated JS', () => {
    const { js } = transpileAndCall(xml, [1, 2]);
    expect(js).not.toContain('sc_if');
  });
});

// ── ADD(x, 0) → x ────────────────────────────────────────────────────────────

describe('transform: ADD(x, 0) → x', () => {
  const xml = makeXml(
    'TEST_ADD_X_ZERO',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 2, node_type: 'constant', data_type: 'Number', value: 0 },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'ADD' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns x unchanged', () => {
    expect(transpileAndCall(xml, [7]).value).toBe(7);
    expect(transpileAndCall(xml, [0]).value).toBe(0);
  });
});

// ── ADD(0, x) → x ────────────────────────────────────────────────────────────

describe('transform: ADD(0, x) → x', () => {
  const xml = makeXml(
    'TEST_ADD_ZERO_X',
    'Number',
    [
      { node_id: 1, node_type: 'constant', data_type: 'Number', value: 0 },
      { node_id: 2, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'ADD' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns x unchanged', () => {
    expect(transpileAndCall(xml, [7]).value).toBe(7);
  });
});

// ── MULTIPLY(x, 1) → x ───────────────────────────────────────────────────────

describe('transform: MULTIPLY(x, 1) → x', () => {
  const xml = makeXml(
    'TEST_MULTIPLY_X_ONE',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 2, node_type: 'constant', data_type: 'Number', value: 1 },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'MULTIPLY' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns x unchanged', () => {
    expect(transpileAndCall(xml, [9]).value).toBe(9);
  });
});

// ── MULTIPLY(1, x) → x ───────────────────────────────────────────────────────

describe('transform: MULTIPLY(1, x) → x', () => {
  const xml = makeXml(
    'TEST_MULTIPLY_ONE_X',
    'Number',
    [
      { node_id: 1, node_type: 'constant', data_type: 'Number', value: 1 },
      { node_id: 2, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'MULTIPLY' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns x unchanged', () => {
    expect(transpileAndCall(xml, [9]).value).toBe(9);
  });
});

// ── MULTIPLY(x, 0) → 0 ───────────────────────────────────────────────────────

describe('transform: MULTIPLY(x, 0) → 0', () => {
  const xml = makeXml(
    'TEST_MULTIPLY_X_ZERO',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 2, node_type: 'constant', data_type: 'Number', value: 0 },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'MULTIPLY' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns 0 regardless of x', () => {
    expect(transpileAndCall(xml, [42]).value).toBe(0);
    expect(transpileAndCall(xml, [0]).value).toBe(0);
  });
});

// ── MULTIPLY(0, x) → 0 ───────────────────────────────────────────────────────

describe('transform: MULTIPLY(0, x) → 0', () => {
  const xml = makeXml(
    'TEST_MULTIPLY_ZERO_X',
    'Number',
    [
      { node_id: 1, node_type: 'constant', data_type: 'Number', value: 0 },
      { node_id: 2, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'MULTIPLY' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns 0 regardless of x', () => {
    expect(transpileAndCall(xml, [42]).value).toBe(0);
  });
});

// ── EXPONENT(x, 1) → x ───────────────────────────────────────────────────────

describe('transform: EXPONENT(x, 1) → x', () => {
  const xml = makeXml(
    'TEST_EXPONENT_X_ONE',
    'Number',
    [
      { node_id: 1, node_type: 'input', data_type: 'Number', input_order: 0, input_name: 'x' },
      { node_id: 2, node_type: 'constant', data_type: 'Number', value: 1 },
      { node_id: 3, node_type: 'function', data_type: 'Number', function_name: 'EXPONENT' },
    ],
    [
      { child: 3, parent: 1, pos: 0 },
      { child: 3, parent: 2, pos: 1 },
    ],
    3, 'Number',
  );

  it('returns x unchanged', () => {
    expect(transpileAndCall(xml, [8]).value).toBe(8);
    expect(transpileAndCall(xml, [1]).value).toBe(1);
  });
});
