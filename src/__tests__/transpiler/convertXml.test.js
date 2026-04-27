import { describe, it, expect } from 'vitest';
import { loadAndNormalize, extractColumnNames, stripFrontendMetadata } from '../../transpiler/convertXml.js';

describe('convertXml', () => {
  describe('loadAndNormalize', () => {
    it('parses valid Schema 5 XML', () => {
      const xml = `<?xml version="1.0"?>
<CodeCalculation name="TEST">
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="function" data_type="Number" function_name="ADD"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="RESULT" node_id="2" output_order="0" data_type="Number"/>
  </Outputs>
  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="1" parent_position="0"/>
  </NodeDependencies>
</CodeCalculation>`;

      const doc = loadAndNormalize(xml);
      expect(doc).toBeDefined();
      expect(doc.documentElement.getAttribute('name')).toBe('TEST');
      expect(doc.querySelectorAll('Node').length).toBe(2);
    });

    it('throws on malformed XML', () => {
      expect(() => loadAndNormalize('<not<valid>')).toThrow();
    });

    it('strips CustomFunctions and SpreadsheetMeta', () => {
      const xml = `<?xml version="1.0"?>
<CodeCalculation name="TEST">
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" input_order="0" input_name="X"/>
  </Nodes>
  <NamedNodes/>
  <NodeComments/>
  <Outputs/>
  <NodeDependencies/>
  <CustomFunctions>
    <Function name="ABS" id="abc-123"/>
  </CustomFunctions>
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

      const doc = loadAndNormalize(xml);
      expect(doc.querySelector('CustomFunctions')).toBeNull();
      expect(doc.querySelector('SpreadsheetMeta')).toBeNull();
    });

  });

  describe('extractColumnNames', () => {
    it('extracts column names from SpreadsheetMeta', () => {
      const xml = `<?xml version="1.0"?>
<CodeCalculation name="TEST">
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D">
    <ColumnName column="A" name="balance"/>
    <ColumnName column="B" name="year"/>
  </SpreadsheetMeta>
</CodeCalculation>`;

      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const names = extractColumnNames(doc);
      expect(names).toEqual({ A: 'BALANCE', B: 'YEAR' });
    });

    it('returns empty object when no column names', () => {
      const xml = `<?xml version="1.0"?>
<CodeCalculation name="TEST">
  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>`;

      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      expect(extractColumnNames(doc)).toEqual({});
    });
  });

  describe('stripFrontendMetadata', () => {
    it('removes key and canonical attributes from Node elements', () => {
      const xml = `<?xml version="1.0"?>
<CodeCalculation name="TEST">
  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number" key="X" canonical="5" input_order="0" input_name="X"/>
  </Nodes>
  <NamedNodes/>
  <NodeComments/>
  <Outputs/>
  <NodeDependencies/>
</CodeCalculation>`;

      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      stripFrontendMetadata(doc);

      const node = doc.querySelector('Node');
      expect(node.hasAttribute('key')).toBe(false);
      expect(node.hasAttribute('canonical')).toBe(false);
      expect(node.getAttribute('node_id')).toBe('1');
      expect(node.getAttribute('node_type')).toBe('input');
    });

    it('derives node_id for Output from NamedNodes when missing', () => {
      const xml = `<?xml version="1.0"?>
<CodeCalculation name="TEST">
  <Nodes>
    <Node node_id="5" node_type="function" data_type="Number"/>
  </Nodes>
  <NamedNodes>
    <NamedNode node_name="B1" node_name_type="address" node_id="5"/>
  </NamedNodes>
  <NodeComments/>
  <Outputs>
    <Output output_name="B" output_order="0" data_type="Number" key="B" output_mode="last"/>
  </Outputs>
  <NodeDependencies/>
</CodeCalculation>`;

      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      stripFrontendMetadata(doc);

      const output = doc.querySelector('Output');
      expect(output.getAttribute('node_id')).toBe('5');
      expect(output.hasAttribute('key')).toBe(false);
      expect(output.hasAttribute('output_mode')).toBe(true);
    });
  });
});
