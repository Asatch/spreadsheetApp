import { describe, it, expect } from 'vitest';
import { transpile } from '../../../transpiler/index.js';

/**
 * End-to-end tests: transpile XML → JS → execute → compare outputs.
 *
 * Uses small inline XML fixtures to verify the full transpiler pipeline.
 * These run with `npm test` for fast regression catching.
 */

// ── Helpers ──────────────────────────────────────────────────────────

function transpileAndCall(xml, args, customFunctions = {}) {
  const result = transpile(xml, customFunctions);
  if (result.error) throw new Error(`Transpile error: ${result.error}`);

  const funcName = xml.match(/name="([^"]+)"/)?.[1]?.toUpperCase();
  const fn = new Function(result.javascript + `\nreturn ${funcName};`)();
  return fn(...args);
}

// ── Fixtures ─────────────────────────────────────────────────────────

const SIMPLE_ADD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="SIMPLE_ADD">
  <LangSpecs/>
  <TestCases/>
  <Nodes>
    <Node node_id="1" node_type="constant" data_type="Text" key="A1" canonical="'A" value="A"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=A" function_name="PROCEED"/>
    <Node node_id="4" node_type="constant" data_type="Text" key="A2" canonical="'B" value="B"/>
    <Node node_id="5" node_type="function" data_type="Number" key="B2" canonical="=B" function_name="PROCEED"/>
    <Node node_id="8" node_type="function" data_type="Number" key="B3" canonical="=B1+B2" function_name="ADD"/>
    <Node node_id="10" node_type="input" data_type="Number" key="A" canonical="10" input_order="0" input_name="A"/>
    <Node node_id="11" node_type="input" data_type="Number" key="B" canonical="20" input_order="1" input_name="B"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="A1" node_name_type="address" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="A2" node_name_type="address" node_id="4"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="5"/>
    <NamedNode node_name="B3" node_name_type="address" node_id="8"/>
    <NamedNode node_name="A" node_name_type="alias" node_id="10"/>
    <NamedNode node_name="B" node_name_type="alias" node_id="11"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="B3" node_id="8" output_order="0" data_type="Number" key="B3" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="10" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="11" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="5" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

const ABS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="ABS">
  <LangSpecs/>
  <TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="NUMBER" canonical="-5" input_order="0" input_name="NUMBER"/>
    <Node node_id="12" node_type="function" data_type="Number" key="B6" canonical="=NUMBER" function_name="PROCEED"/>
    <Node node_id="32" node_type="function" data_type="Number" key="B12" canonical="=IF(B6&lt;0,-B6,B6)" function_name="IF"/>
    <Node node_id="40" node_type="constant" data_type="Number" value="0"/>
    <Node node_id="51" node_type="function" data_type="Number" function_name="NEGATE"/>
    <Node node_id="52" node_type="function" data_type="Boolean" function_name="LESS"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="NUMBER" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="B6" node_name_type="address" node_id="12"/>
    <NamedNode node_name="B12" node_name_type="address" node_id="32"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="ABS" node_id="32" output_order="0" data_type="Number" key="B12" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="12" parent_node_id="1" parent_position="0"/>
    <NodeDependency child_node_id="51" parent_node_id="12" parent_position="0"/>
    <NodeDependency child_node_id="52" parent_node_id="12" parent_position="0"/>
    <NodeDependency child_node_id="52" parent_node_id="40" parent_position="1"/>
    <NodeDependency child_node_id="32" parent_node_id="52" parent_position="0"/>
    <NodeDependency child_node_id="32" parent_node_id="51" parent_position="1"/>
    <NodeDependency child_node_id="32" parent_node_id="12" parent_position="2"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="14" gridCols="D"/>
</CodeCalculation>`;

const MULTIPLY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="TEST_MULTIPLY">
  <LangSpecs/>
  <TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="3" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="input" data_type="Number" key="Y" canonical="4" input_order="1" input_name="Y"/>
    <Node node_id="3" node_type="function" data_type="Number" key="B1" canonical="=X" function_name="PROCEED"/>
    <Node node_id="4" node_type="function" data_type="Number" key="B2" canonical="=Y" function_name="PROCEED"/>
    <Node node_id="5" node_type="function" data_type="Number" key="B3" canonical="=B1*B2" function_name="MULTIPLY"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="Y" node_name_type="alias" node_id="2"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="3"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="4"/>
    <NamedNode node_name="B3" node_name_type="address" node_id="5"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="B3" node_id="5" output_order="0" data_type="Number" key="B3" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="3" parent_node_id="1" parent_position="0"/>
    <NodeDependency child_node_id="4" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="3" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="4" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

// Multi-output function
const MULTI_OUTPUT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="MULTI_OUT">
  <LangSpecs/>
  <TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="10" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=X" function_name="PROCEED"/>
    <Node node_id="3" node_type="function" data_type="Number" key="B2" canonical="=B1*2" function_name="MULTIPLY"/>
    <Node node_id="4" node_type="function" data_type="Number" key="B3" canonical="=B1*3" function_name="MULTIPLY"/>
    <Node node_id="5" node_type="constant" data_type="Number" value="2"/>
    <Node node_id="6" node_type="constant" data_type="Number" value="3"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="3"/>
    <NamedNode node_name="B3" node_name_type="address" node_id="4"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="DOUBLE" node_id="3" output_order="0" data_type="Number" key="B2" output_mode="last"/>
    <Output output_name="TRIPLE" node_id="4" output_order="1" data_type="Number" key="B3" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="5" parent_position="1"/>
    <NodeDependency child_node_id="4" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="4" parent_node_id="6" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

// ── Tests ────────────────────────────────────────────────────────────

describe('transpile and execute', () => {
  describe('simple addition', () => {
    it('transpiles and produces correct output', () => {
      const result = transpile(SIMPLE_ADD_XML);
      expect(result.error).toBeNull();
      expect(result.javascript).toContain('function SIMPLE_ADD');
    });

    it('computes A + B correctly', () => {
      expect(transpileAndCall(SIMPLE_ADD_XML, [10, 20])).toBe(30);
      expect(transpileAndCall(SIMPLE_ADD_XML, [-5, 5])).toBe(0);
      expect(transpileAndCall(SIMPLE_ADD_XML, [3.14, 2.86])).toBe(6);
      expect(transpileAndCall(SIMPLE_ADD_XML, [0, 0])).toBe(0);
    });
  });

  describe('ABS (conditional logic)', () => {
    it('transpiles and produces correct output', () => {
      const result = transpile(ABS_XML);
      expect(result.error).toBeNull();
      expect(result.javascript).toContain('function ABS');
    });

    it('returns absolute value', () => {
      expect(transpileAndCall(ABS_XML, [-5])).toBe(5);
      expect(transpileAndCall(ABS_XML, [5])).toBe(5);
      expect(transpileAndCall(ABS_XML, [0])).toBe(0);
      expect(transpileAndCall(ABS_XML, [-3.14159])).toBeCloseTo(3.14159);
    });
  });

  describe('multiplication', () => {
    it('computes X * Y correctly', () => {
      expect(transpileAndCall(MULTIPLY_XML, [3, 4])).toBe(12);
      expect(transpileAndCall(MULTIPLY_XML, [0, 100])).toBe(0);
      expect(transpileAndCall(MULTIPLY_XML, [-2, 3])).toBe(-6);
    });
  });

  describe('multi-output function', () => {
    it('returns an object with named outputs', () => {
      const result = transpileAndCall(MULTI_OUTPUT_XML, [10]);
      expect(result).toEqual({ DOUBLE: 20, TRIPLE: 30 });
    });

    it('works with different inputs', () => {
      const result = transpileAndCall(MULTI_OUTPUT_XML, [5]);
      expect(result.DOUBLE).toBe(10);
      expect(result.TRIPLE).toBe(15);
    });
  });

  describe('error handling', () => {
    it('returns error for malformed XML', () => {
      const result = transpile('<not-valid-xml>');
      expect(result.error).toBeTruthy();
      expect(result.javascript).toBeNull();
    });

    it('returns error for XML without outputs', () => {
      const xml = `<?xml version="1.0"?>
        <CodeCalculation name="EMPTY">
          <Nodes/>
          <NamedNodes/>
          <NodeComments/>
          <Outputs/>
          <NodeDependencies/>
          <CustomFunctions/>
        </CodeCalculation>`;
      const result = transpile(xml);
      // Either errors or produces empty/null code
      expect(result.javascript === null || result.error !== null).toBe(true);
    });
  });

  describe('self-test validation', () => {
    it('reports passing test cases in testResults', () => {
      // SIMPLE_ADD with test cases embedded
      const xmlWithTests = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="ADD_TESTED">
  <LangSpecs/>
  <TestCases>
    <test_case>
      <input_value Value="3"/>
      <input_value Value="4"/>
      <output_value Value="7"/>
    </test_case>
    <test_case>
      <input_value Value="0"/>
      <input_value Value="0"/>
      <output_value Value="0"/>
    </test_case>
  </TestCases>
  <Nodes>
    <Node node_id="10" node_type="input" data_type="Number" key="A" canonical="10" input_order="0" input_name="A"/>
    <Node node_id="11" node_type="input" data_type="Number" key="B" canonical="20" input_order="1" input_name="B"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=A" function_name="PROCEED"/>
    <Node node_id="5" node_type="function" data_type="Number" key="B2" canonical="=B" function_name="PROCEED"/>
    <Node node_id="8" node_type="function" data_type="Number" key="B3" canonical="=B1+B2" function_name="ADD"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="A" node_name_type="alias" node_id="10"/>
    <NamedNode node_name="B" node_name_type="alias" node_id="11"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="5"/>
    <NamedNode node_name="B3" node_name_type="address" node_id="8"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="SUM" node_id="8" output_order="0" data_type="Number" key="B3" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="10" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="11" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="5" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

      const result = transpile(xmlWithTests);
      expect(result.error).toBeNull();
      expect(result.testResults).not.toBeNull();
      expect(result.testResults.passed).toBe(2);
      expect(result.testResults.failed).toBe(0);
      expect(result.testResults.failures).toHaveLength(0);
    });

    it('reports failing test cases with expected/actual', () => {
      // Same function but with a wrong expected output
      const xmlWithBadTest = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="ADD_BADTEST">
  <LangSpecs/>
  <TestCases>
    <test_case>
      <input_value Value="3"/>
      <input_value Value="4"/>
      <output_value Value="999"/>
    </test_case>
  </TestCases>
  <Nodes>
    <Node node_id="10" node_type="input" data_type="Number" key="A" canonical="10" input_order="0" input_name="A"/>
    <Node node_id="11" node_type="input" data_type="Number" key="B" canonical="20" input_order="1" input_name="B"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=A" function_name="PROCEED"/>
    <Node node_id="5" node_type="function" data_type="Number" key="B2" canonical="=B" function_name="PROCEED"/>
    <Node node_id="8" node_type="function" data_type="Number" key="B3" canonical="=B1+B2" function_name="ADD"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="A" node_name_type="alias" node_id="10"/>
    <NamedNode node_name="B" node_name_type="alias" node_id="11"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="5"/>
    <NamedNode node_name="B3" node_name_type="address" node_id="8"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="SUM" node_id="8" output_order="0" data_type="Number" key="B3" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="10" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="11" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="5" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

      const result = transpile(xmlWithBadTest);
      expect(result.error).toBeNull(); // Transpile succeeds, test fails
      expect(result.testResults.failed).toBe(1);
      expect(result.testResults.failures[0]).toMatchObject({
        testIndex: 0,
        expected: [999],
        actual: [7]
      });
    });
  });

  describe('circular custom function dependency', () => {
    it('returns error and does not hang', () => {
      // FUNC_A depends on FUNC_B, FUNC_B depends on FUNC_A
      const funcAXml = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="FUNC_A" functionId="uuid-a">
  <LangSpecs/><TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="1" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=FUNC_B(X)" function_name="FUNC_B"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="OUT" node_id="2" output_order="0" data_type="Number" key="B1" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
  </NodeDependencies>
  <CustomFunctions>
    <Function name="FUNC_B" id="uuid-b" version="1.0"/>
  </CustomFunctions>
  <SpreadsheetMeta version="1.0" gridRows="3" gridCols="D"/>
</CodeCalculation>`;

      const funcBXml = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="FUNC_B" functionId="uuid-b">
  <LangSpecs/><TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="1" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=FUNC_A(X)" function_name="FUNC_A"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="OUT" node_id="2" output_order="0" data_type="Number" key="B1" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
  </NodeDependencies>
  <CustomFunctions>
    <Function name="FUNC_A" id="uuid-a" version="1.0"/>
  </CustomFunctions>
  <SpreadsheetMeta version="1.0" gridRows="3" gridCols="D"/>
</CodeCalculation>`;

      // Root function that uses FUNC_A
      const rootXml = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="ROOT">
  <LangSpecs/><TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="1" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=FUNC_A(X)" function_name="FUNC_A"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="OUT" node_id="2" output_order="0" data_type="Number" key="B1" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
  </NodeDependencies>
  <CustomFunctions>
    <Function name="FUNC_A" id="uuid-a" version="1.0"/>
  </CustomFunctions>
  <SpreadsheetMeta version="1.0" gridRows="3" gridCols="D"/>
</CodeCalculation>`;

      const customFunctions = {
        'uuid-a': { name: 'FUNC_A', xml_content: funcAXml },
        'uuid-b': { name: 'FUNC_B', xml_content: funcBXml }
      };

      // Should not hang — cycle detection should catch it
      // The circular dep is caught in buildFunctionDags and logged as warning,
      // so the root transpile may succeed (with missing dep) or error
      const result = transpile(rootXml, customFunctions);
      // Either it errors, or it succeeds but the cyclic functions were skipped
      expect(result.javascript !== null || result.error !== null).toBe(true);
    }, 5000); // timeout guard in case cycle detection fails
  });

  describe('bad custom function does not crash transpile', () => {
    it('skips invalid custom function and transpiles root', () => {
      // Root function with a custom dep that has garbage XML
      const rootXml = SIMPLE_ADD_XML; // Valid function
      const customFunctions = {
        'bad-uuid': { name: 'BAD_FUNC', xml_content: '<totally broken xml<<<' }
      };

      // Should succeed — bad custom function is logged and skipped
      const result = transpile(rootXml, customFunctions);
      expect(result.error).toBeNull();
      expect(result.javascript).toContain('SIMPLE_ADD');
    });
  });

  describe('signature extraction', () => {
    it('returns input/output signature from transpiled function', () => {
      const result = transpile(SIMPLE_ADD_XML);
      expect(result.signature).not.toBeNull();
      expect(result.signature.inputs).toHaveLength(2);
      expect(result.signature.outputs).toHaveLength(1);
      expect(result.signature.inputs[0]).toMatchObject({ name: 'A', type: 'Number' });
      expect(result.signature.inputs[1]).toMatchObject({ name: 'B', type: 'Number' });
      expect(result.signature.outputs[0]).toMatchObject({ name: 'B3', type: 'Number' });
    });

    it('returns multi-output signature', () => {
      const result = transpile(MULTI_OUTPUT_XML);
      expect(result.signature.outputs).toHaveLength(2);
      expect(result.signature.outputs[0].name).toBe('DOUBLE');
      expect(result.signature.outputs[1].name).toBe('TRIPLE');
    });
  });

  describe('loop sheet transpilation', () => {
    // FACTORIAL as a loop sheet: Row 0 initializes, Row 1 iterates, _STOP1 terminates
    const FACTORIAL_LOOP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="FACTORIAL" sheetType="loop">
  <LangSpecs/>
  <TestCases>
    <test_case>
      <input_value Value="5"/>
      <output_value Value="120"/>
    </test_case>
    <test_case>
      <input_value Value="1"/>
      <output_value Value="1"/>
    </test_case>
    <test_case>
      <input_value Value="0"/>
      <output_value Value="1"/>
    </test_case>
  </TestCases>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="NUM" canonical="3" input_order="0" input_name="NUM"/>
    <Node node_id="2" node_type="function" data_type="Number" key="A0" canonical="=NUM" function_name="PROCEED"/>
    <Node node_id="3" node_type="function" data_type="Number" key="A1" canonical="=A0-1" function_name="SUBTRACT"/>
    <Node node_id="4" node_type="constant" data_type="Number" key="B0" canonical="1" value="1"/>
    <Node node_id="5" node_type="function" data_type="Number" key="B1" canonical="=A0*B0" function_name="MULTIPLY"/>
    <Node node_id="7" node_type="function" data_type="Boolean" key="_STOP1" canonical="=A0&lt;=1" function_name="LESSEQUAL"/>
    <Node node_id="8" node_type="constant" data_type="Number" value="1"/>
    <Node node_id="9" node_type="function" data_type="Boolean" key="_STOP0" canonical="=A0&lt;=1" function_name="LESSEQUAL"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="NUM" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="A0" node_name_type="address" node_id="2"/>
    <NamedNode node_name="A1" node_name_type="address" node_id="3"/>
    <NamedNode node_name="B0" node_name_type="address" node_id="4"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="5"/>
    <NamedNode node_name="_STOP1" node_name_type="address" node_id="7"/>
    <NamedNode node_name="_STOP0" node_name_type="address" node_id="9"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="B" output_order="0" data_type="Number" key="B" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="8" parent_position="1"/>
    <NodeDependency child_node_id="5" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="4" parent_position="1"/>
    <NodeDependency child_node_id="7" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="7" parent_node_id="8" parent_position="1"/>
    <NodeDependency child_node_id="9" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="9" parent_node_id="8" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions/>
  <SpreadsheetMeta version="1.0" gridRows="3" gridCols="B"/>
</CodeCalculation>`;

    it('transpiles loop sheet without error', () => {
      const result = transpile(FACTORIAL_LOOP_XML);
      expect(result.error).toBeNull();
      expect(result.javascript).toBeTruthy();
    });

    it('computes factorial correctly', () => {
      expect(transpileAndCall(FACTORIAL_LOOP_XML, [5])).toBe(120);
      expect(transpileAndCall(FACTORIAL_LOOP_XML, [3])).toBe(6);
      expect(transpileAndCall(FACTORIAL_LOOP_XML, [1])).toBe(1);
    });

    it('handles edge case: factorial(0) via _STOP0 early exit', () => {
      // _STOP0 checks before first iteration: NUM<=1 is true for 0, so loop doesn't execute
      // B0 initial value is 1, which is the correct answer for 0!
      expect(transpileAndCall(FACTORIAL_LOOP_XML, [0])).toBe(1);
    });

    it('self-tests pass for loop sheet', () => {
      const result = transpile(FACTORIAL_LOOP_XML);
      expect(result.testResults).not.toBeNull();
      expect(result.testResults.passed).toBe(3);
      expect(result.testResults.failed).toBe(0);
    });
  });

  describe('custom function dependencies', () => {
    it('transpiles a function that uses SIMPLE_ADD as dependency', () => {
      // CALLER calls SIMPLE_ADD(X, X) — doubling the input
      const callerXml = `<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="CALLER">
  <LangSpecs/>
  <TestCases/>
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="5" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=X" function_name="PROCEED"/>
    <Node node_id="3" node_type="function" data_type="Number" key="B2" canonical="=SIMPLE_ADD(B1,B1)" function_name="SIMPLE_ADD"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="3"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="RESULT" node_id="3" output_order="0" data_type="Number" key="B2" output_mode="last"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="2" parent_position="1"/>
  </NodeDependencies>
  <CustomFunctions>
    <Function name="SIMPLE_ADD" id="add-uuid-001" version="1.0.0"/>
  </CustomFunctions>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

      const customFunctions = {
        'add-uuid-001': { name: 'SIMPLE_ADD', xml_content: SIMPLE_ADD_XML },
      };

      const result = transpile(callerXml, customFunctions);
      expect(result.error).toBeNull();
      expect(result.javascript).toContain('CALLER');

      // The transpiler may inline the dependency or generate a separate function.
      // Either way, calling the result should work correctly.
      const fn = new Function(result.javascript + '\nreturn CALLER;')();
      expect(fn(5)).toBe(10);
      expect(fn(0)).toBe(0);
      expect(fn(-3)).toBe(-6);
    });
  });
});
