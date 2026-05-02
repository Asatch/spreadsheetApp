/**
 * Regression: Text-typed test cases survive the function-workshop runtime
 * path with their declared type (and exact characters) intact.
 *
 * Pre-fix, the runtime path silently parseFloat'd every test-case value:
 *   - "ABC"  → NaN          (visible failure)
 *   - "110"  → 110 (Number) (silent false-pass — engine re-typed input)
 *   - "0042" → 42  (Number) (silent false-pass + dropped leading zero)
 *
 * The visible "ABC" failure made the bug findable; the two false-passes
 * made it dangerous.
 */

import { describe, test, expect } from 'vitest';
import { parseXML } from '../xml-parser.mjs';
import { runTests } from '../eval.mjs';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="TEXT_PASSTHROUGH" sheetType="spreadsheet">
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Text" key="CODE" canonical="'ABC" input_order="0" input_name="CODE"/>
    <Node node_id="2" node_type="function" data_type="Text" key="A1" canonical="=CODE" function_name="PROCEED"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="CODE" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="A1" node_name_type="address" node_id="2"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="result" node_id="2" output_order="0" data_type="Text" key="A1"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
  </NodeDependencies>
  <TestCases>
    <TestCase>
      <Input order="0" value="ABC"/>
      <ExpectedOutput order="0" value="ABC"/>
    </TestCase>
    <TestCase>
      <Input order="0" value="110"/>
      <ExpectedOutput order="0" value="110"/>
    </TestCase>
    <TestCase>
      <Input order="0" value="0042"/>
      <ExpectedOutput order="0" value="0042"/>
    </TestCase>
  </TestCases>
</CodeCalculation>`;

describe('function-workshop: text-typed test cases', () => {
  describe('parseXML', () => {
    const parsed = parseXML(xml);

    test('parses all three test cases', () => {
      expect(parsed.testCases).toHaveLength(3);
    });

    test.each([
      [0, 'ABC'],
      [1, '110'],
      [2, '0042'],
    ])('case %i: input "%s" preserved as string', (i, value) => {
      const tc = parsed.testCases[i];
      expect(typeof tc.inputs[0]).toBe('string');
      expect(tc.inputs[0]).toBe(value);
    });

    test.each([
      [0, 'ABC'],
      [1, '110'],
      [2, '0042'],
    ])('case %i: expected "%s" preserved as string', (i, value) => {
      const tc = parsed.testCases[i];
      expect(typeof tc.expected).toBe('string');
      expect(tc.expected).toBe(value);
    });
  });

  test('runTests: all three text-typed cases pass end-to-end', async () => {
    const result = await runTests(xml);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(3);
  });
});
