/**
 * Tests for XML Serializer — literal detection, unwrapping, and signature extraction
 *
 * Tests the isLiteral, getLiteralType, quoted string handling,
 * and extractSignatureFromXml used when serializing/deserializing XML.
 */

import { isLiteral, getLiteralType, extractSignatureFromXml, stripUnusedInputsFromXml } from '../../utils/xmlSerializer';

describe('xmlSerializer', () => {
  describe('isLiteral', () => {
    it('should recognize positive integers', () => {
      expect(isLiteral('42')).toBe(true);
      expect(isLiteral('0')).toBe(true);
    });

    it('should recognize negative numbers', () => {
      expect(isLiteral('-5')).toBe(true);
      expect(isLiteral('-3.14')).toBe(true);
    });

    it('should recognize decimal numbers', () => {
      expect(isLiteral('3.14')).toBe(true);
      expect(isLiteral('0.001')).toBe(true);
    });

    it('should recognize booleans', () => {
      expect(isLiteral('TRUE')).toBe(true);
      expect(isLiteral('FALSE')).toBe(true);
    });

    it('should recognize error values', () => {
      expect(isLiteral('#DIV/0!')).toBe(true);
      expect(isLiteral('#NAME!')).toBe(true);
      expect(isLiteral('#VALUE!')).toBe(true);
    });

    it('should recognize quoted string literals', () => {
      expect(isLiteral('"WITHDRAWAL"')).toBe(true);
      expect(isLiteral('"HALF"')).toBe(true);
      expect(isLiteral('"ending_balance"')).toBe(true);
    });

    it('should reject cell references', () => {
      expect(isLiteral('A1')).toBe(false);
      expect(isLiteral('B25')).toBe(false);
    });

    it('should reject named ranges', () => {
      expect(isLiteral('INCOME')).toBe(false);
      expect(isLiteral('TAX_RATE')).toBe(false);
    });

    it('should reject incomplete quoted strings', () => {
      expect(isLiteral('"OPEN')).toBe(false);
      expect(isLiteral('CLOSE"')).toBe(false);
    });

    it('should reject empty quoted string', () => {
      // A single " is length 1, not >= 2
      expect(isLiteral('"')).toBe(false);
    });

    it('should accept minimal quoted string (two quotes)', () => {
      // "" is length 2, starts and ends with " — empty string literal
      expect(isLiteral('""')).toBe(true);
    });
  });

  describe('getLiteralType', () => {
    it('should return Number for numeric literals', () => {
      expect(getLiteralType('42')).toBe('Number');
      expect(getLiteralType('-3.14')).toBe('Number');
      expect(getLiteralType('0')).toBe('Number');
    });

    it('should return Boolean for boolean literals', () => {
      expect(getLiteralType('TRUE')).toBe('Boolean');
      expect(getLiteralType('FALSE')).toBe('Boolean');
    });

    it('should return Text for quoted strings', () => {
      expect(getLiteralType('"WITHDRAWAL"')).toBe('Text');
      expect(getLiteralType('"ending_balance"')).toBe('Text');
    });

    it('should return Text for error values', () => {
      expect(getLiteralType('#DIV/0!')).toBe('Text');
      expect(getLiteralType('#NAME!')).toBe('Text');
    });
  });

  describe('extractSignatureFromXml', () => {
    function makeXml({ nodes = '', outputs = '', meta = '', namedNodes = '', deps = '' } = {}) {
      return `<?xml version="1.0"?>
        <CodeCalculation>
          <Nodes>${nodes}</Nodes>
          <NamedNodes>${namedNodes}</NamedNodes>
          <NodeDependencies>${deps}</NodeDependencies>
          <Outputs>${outputs}</Outputs>
          <SpreadsheetMeta version="1.0">${meta}</SpreadsheetMeta>
        </CodeCalculation>`;
    }

    it('should extract basic inputs and outputs', () => {
      const xml = makeXml({
        nodes: `
          <Node key="A1" node_type="input" input_name="RATE" data_type="Number" input_order="0"/>
          <Node key="A2" node_type="input" input_name="YEARS" data_type="Number" input_order="1"/>
        `,
        outputs: `
          <Output key="B1" output_name="B1" data_type="Number" output_order="0"/>
        `,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.inputs).toEqual([
        { name: 'RATE', type: 'Number', canonical: null },
        { name: 'YEARS', type: 'Number', canonical: null },
      ]);
      expect(sig.outputs).toEqual([
        { name: 'B1', type: 'Number' },
      ]);
    });

    it('should attach cell-specific format to outputs', () => {
      const format = { subCategory: 'currency', symbol: '$', decimalPlaces: 2 };
      const xml = makeXml({
        nodes: `<Node key="A1" node_type="input" input_name="X" data_type="Number" input_order="0"/>`,
        outputs: `<Output key="B1" output_name="B1" data_type="Number" output_order="0"/>`,
        meta: `<FormatRule cellKey="B1" formats='${JSON.stringify({ NUMBER: format })}'/>`,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.outputs[0].format).toEqual(format);
    });

    it('should fall back to spreadsheet NUMBER default when no cell format', () => {
      const defaultFmt = { subCategory: 'number', decimalPlaces: 4 };
      const xml = makeXml({
        outputs: `<Output key="C1" output_name="C1" data_type="Number" output_order="0"/>`,
        meta: `<Default type="NUMBER" settings='${JSON.stringify(defaultFmt)}'/>`,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.outputs[0].format).toEqual(defaultFmt);
    });

    it('should resolve PROCEED pass-through outputs to source cell format', () => {
      // Mirrors the BROKE_AGE pattern: a named PROCEED node whose canonical
      // is =B63, with no NamedNode entry of its own.
      const cellFmt = { subCategory: 'number', decimalPlaces: 0 };
      const defaultFmt = { subCategory: 'currency', symbol: '$', decimalPlaces: 0 };
      const xml = makeXml({
        nodes: `
          <Node node_id="100" node_type="function" data_type="Number" key="B63" function_name="SOMEFUNC"/>
          <Node node_id="101" node_type="function" data_type="Number" key="BROKE_AGE" function_name="PROCEED"/>
        `,
        deps: `<NodeDependency child_node_id="101" parent_node_id="100" parent_position="0"/>`,
        namedNodes: `<NamedNode node_name="B63" node_name_type="address" node_id="100"/>`,
        outputs: `<Output key="BROKE_AGE" output_name="BROKE_AGE" node_id="101" data_type="Number" output_order="0"/>`,
        meta: `
          <FormatRule cellKey="B63" formats='${JSON.stringify({ NUMBER: cellFmt })}'/>
          <Default type="NUMBER" settings='${JSON.stringify(defaultFmt)}'/>
        `,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.outputs[0].format).toEqual(cellFmt);
    });

    it('should resolve named-range output to its cell address for format lookup', () => {
      const cellFmt = { subCategory: 'number', decimalPlaces: 0 };
      const defaultFmt = { subCategory: 'currency', symbol: '$', decimalPlaces: 2 };
      const xml = makeXml({
        outputs: `<Output key="MIN_BALANCE_AGE" output_name="MIN_BALANCE_AGE" data_type="Number" output_order="0"/>`,
        namedNodes: `
          <NamedNode node_name="B7" node_name_type="address" node_id="42"/>
          <NamedNode node_name="MIN_BALANCE_AGE" node_name_type="alias" node_id="42"/>
        `,
        meta: `
          <FormatRule cellKey="B7" formats='${JSON.stringify({ NUMBER: cellFmt })}'/>
          <Default type="NUMBER" settings='${JSON.stringify(defaultFmt)}'/>
        `,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.outputs[0].format).toEqual(cellFmt);
    });

    it('should prefer cell format over spreadsheet default', () => {
      const cellFmt = { subCategory: 'percentage', decimalPlaces: 1 };
      const defaultFmt = { subCategory: 'number', decimalPlaces: 4 };
      const xml = makeXml({
        outputs: `<Output key="B1" output_name="B1" data_type="Number" output_order="0"/>`,
        meta: `
          <FormatRule cellKey="B1" formats='${JSON.stringify({ NUMBER: cellFmt })}'/>
          <Default type="NUMBER" settings='${JSON.stringify(defaultFmt)}'/>
        `,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.outputs[0].format).toEqual(cellFmt);
    });

    it('should omit format when none specified', () => {
      const xml = makeXml({
        outputs: `<Output key="B1" output_name="B1" data_type="Number" output_order="0"/>`,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.outputs[0]).toEqual({ name: 'B1', type: 'Number' });
      expect(sig.outputs[0]).not.toHaveProperty('format');
    });

    it('should extract canonical values from input nodes', () => {
      const xml = makeXml({
        nodes: `
          <Node key="AGE" node_type="input" input_name="AGE" data_type="Number" input_order="0" canonical="77"/>
          <Node key="RATE" node_type="input" input_name="RATE" data_type="Number" input_order="1" canonical="0.05"/>
        `,
        outputs: `<Output key="B1" output_name="B1" data_type="Number" output_order="0"/>`,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.inputs[0].canonical).toBe('77');
      expect(sig.inputs[1].canonical).toBe('0.05');
    });

    it('should extract unique test case values per input', () => {
      const xml = `<?xml version="1.0"?>
        <CodeCalculation>
          <TestCases>
            <test_case>
              <input_value Value="77"/>
              <input_value Value="100000"/>
              <output_value Value="999"/>
            </test_case>
            <test_case>
              <input_value Value="80"/>
              <input_value Value="100000"/>
              <output_value Value="888"/>
            </test_case>
            <test_case>
              <input_value Value="77"/>
              <input_value Value="50000"/>
              <output_value Value="777"/>
            </test_case>
          </TestCases>
          <Nodes>
            <Node key="AGE" node_type="input" input_name="AGE" data_type="Number" input_order="0" canonical="77"/>
            <Node key="BAL" node_type="input" input_name="BALANCE" data_type="Number" input_order="1" canonical="100000"/>
          </Nodes>
          <Outputs>
            <Output key="B1" output_name="B1" data_type="Number" output_order="0"/>
          </Outputs>
          <SpreadsheetMeta version="1.0"/>
        </CodeCalculation>`;
      const sig = extractSignatureFromXml(xml);
      expect(sig.inputs[0].testValues).toEqual(['77', '80']);
      expect(sig.inputs[1].testValues).toEqual(['100000', '50000']);
    });

    it('should not include testValues when no test cases exist', () => {
      const xml = makeXml({
        nodes: `<Node key="X" node_type="input" input_name="X" data_type="Number" input_order="0" canonical="5"/>`,
        outputs: `<Output key="B1" output_name="B1" data_type="Number" output_order="0"/>`,
      });
      const sig = extractSignatureFromXml(xml);
      expect(sig.inputs[0]).not.toHaveProperty('testValues');
    });
  });

  describe('stripUnusedInputsFromXml', () => {
    function makeXml({ nodes = '', namedNodes = '', testCases = '' } = {}) {
      return `<?xml version="1.0"?>
        <CodeCalculation>
          <Nodes>${nodes}</Nodes>
          <NamedNodes>${namedNodes}</NamedNodes>
          <NodeDependencies></NodeDependencies>
          <Outputs></Outputs>
          <TestCases>${testCases}</TestCases>
          <SpreadsheetMeta version="1.0"></SpreadsheetMeta>
        </CodeCalculation>`;
    }

    it('returns the input unchanged when no names are passed', () => {
      const xml = makeXml({
        nodes: `<Node key="A" node_type="input" input_name="A" data_type="Number" input_order="0"/>`,
      });
      expect(stripUnusedInputsFromXml(xml, [])).toBe(xml);
      expect(stripUnusedInputsFromXml(xml, null)).toBe(xml);
    });

    it('removes the input Node, alias NamedNode, and matching test_case input_value', () => {
      const xml = makeXml({
        nodes: `
          <Node node_id="1" key="A" node_type="input" input_name="A" data_type="Number" input_order="0"/>
          <Node node_id="2" key="B" node_type="input" input_name="B" data_type="Number" input_order="1"/>
          <Node node_id="3" key="C" node_type="input" input_name="C" data_type="Number" input_order="2"/>
        `,
        namedNodes: `
          <NamedNode node_name="A" node_name_type="alias" node_id="1"/>
          <NamedNode node_name="B" node_name_type="alias" node_id="2"/>
          <NamedNode node_name="C" node_name_type="alias" node_id="3"/>
        `,
        testCases: `
          <test_case>
            <input_value Value="1"/>
            <input_value Value="2"/>
            <input_value Value="3"/>
          </test_case>
          <test_case>
            <input_value Value="10"/>
            <input_value Value="20"/>
            <input_value Value="30"/>
          </test_case>
        `,
      });

      const stripped = stripUnusedInputsFromXml(xml, ['B']);
      const sig = extractSignatureFromXml(stripped);

      expect(sig.inputs.map(i => i.name)).toEqual(['A', 'C']);
      // Confirm test_case input_values are stripped positionally for B (index 1)
      expect(sig.inputs[0].testValues.sort()).toEqual(['1', '10']);
      expect(sig.inputs[1].testValues.sort()).toEqual(['3', '30']);

      // The alias NamedNode for B should be gone
      const parser = new DOMParser();
      const doc = parser.parseFromString(stripped, 'application/xml');
      const aliases = [...doc.querySelectorAll('NamedNodes > NamedNode')]
        .filter(n => n.getAttribute('node_name_type') === 'alias')
        .map(n => n.getAttribute('node_name'));
      expect(aliases.sort()).toEqual(['A', 'C']);
    });

    it('renumbers input_order on remaining inputs to be contiguous', () => {
      const xml = makeXml({
        nodes: `
          <Node node_id="1" key="A" node_type="input" input_name="A" data_type="Number" input_order="0"/>
          <Node node_id="2" key="B" node_type="input" input_name="B" data_type="Number" input_order="1"/>
          <Node node_id="3" key="C" node_type="input" input_name="C" data_type="Number" input_order="2"/>
        `,
      });

      const stripped = stripUnusedInputsFromXml(xml, ['A']);
      const parser = new DOMParser();
      const doc = parser.parseFromString(stripped, 'application/xml');
      const orders = [...doc.querySelectorAll('Nodes > Node')]
        .filter(n => n.getAttribute('node_type') === 'input')
        .map(n => ({
          name: n.getAttribute('input_name'),
          order: parseInt(n.getAttribute('input_order'), 10),
        }));

      expect(orders).toEqual([
        { name: 'B', order: 0 },
        { name: 'C', order: 1 },
      ]);
    });

    it('strips multiple inputs at once, preserving positional alignment', () => {
      const xml = makeXml({
        nodes: `
          <Node node_id="1" key="A" node_type="input" input_name="A" data_type="Number" input_order="0"/>
          <Node node_id="2" key="B" node_type="input" input_name="B" data_type="Number" input_order="1"/>
          <Node node_id="3" key="C" node_type="input" input_name="C" data_type="Number" input_order="2"/>
          <Node node_id="4" key="D" node_type="input" input_name="D" data_type="Number" input_order="3"/>
        `,
        testCases: `
          <test_case>
            <input_value Value="a"/>
            <input_value Value="b"/>
            <input_value Value="c"/>
            <input_value Value="d"/>
          </test_case>
        `,
      });

      const stripped = stripUnusedInputsFromXml(xml, ['A', 'C']);
      const sig = extractSignatureFromXml(stripped);

      expect(sig.inputs.map(i => i.name)).toEqual(['B', 'D']);
      expect(sig.inputs[0].testValues).toEqual(['b']);
      expect(sig.inputs[1].testValues).toEqual(['d']);
    });
  });
});
