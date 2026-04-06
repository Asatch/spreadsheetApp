# XML Schema Reference (Schema 5)

## Root Element

```xml
<CodeCalculation name="FUNCTION_NAME" sheetType="spreadsheet|loop">
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Function name (UPPERCASE recommended) |
| `sheetType` | No | `spreadsheet` (default) or `loop` for iterative calculations |

## Nodes

The `<Nodes>` section contains all cells in the spreadsheet.

### Input Node

```xml
<Node node_id="1" node_type="input" data_type="Number"
      key="PRINCIPAL" canonical="1000000"
      input_order="0" input_name="PRINCIPAL"/>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `node_id` | Yes | Unique integer ID |
| `node_type` | Yes | `input` |
| `data_type` | Yes | `Number`, `Text`, `Boolean`, `Date` |
| `key` | Yes | Cell reference or name |
| `canonical` | No | Default value (for display) |
| `input_order` | Yes | 0-indexed position in function signature |
| `input_name` | Yes | Parameter name |

### Constant Node

```xml
<Node node_id="2" node_type="constant" data_type="Number"
      key="RATE" value="0.03"/>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `node_id` | Yes | Unique integer ID |
| `node_type` | Yes | `constant` |
| `data_type` | Yes | `Number`, `Text`, `Boolean` |
| `key` | Yes | Cell reference or name |
| `value` | Yes | The constant value |

### Function Node

```xml
<Node node_id="3" node_type="function" data_type="Number"
      key="INTEREST" canonical="=PRINCIPAL*RATE" function_name="MULTIPLY"/>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `node_id` | Yes | Unique integer ID |
| `node_type` | Yes | `function` |
| `data_type` | Yes | Result type: `Number`, `Text`, `Boolean` |
| `key` | Yes | Cell reference or name |
| `canonical` | Yes | Formula starting with `=` |
| `function_name` | Yes | Primary function used (for metadata) |

## NamedNodes

Maps names to node IDs so formulas can reference cells by name.

```xml
<NamedNodes>
  <NamedNode node_name="PRINCIPAL" node_name_type="alias" node_id="1"/>
  <NamedNode node_name="A1" node_name_type="address" node_id="1"/>
</NamedNodes>
```

| Attribute | Description |
|-----------|-------------|
| `node_name` | The name used in formulas |
| `node_name_type` | `alias` (custom name) or `address` (cell reference) |
| `node_id` | ID of the node this name refers to |

**Important:** For formulas to reference a node by name, it must have a NamedNode entry.

## Outputs

Declares which nodes are function outputs.

```xml
<Outputs>
  <Output output_name="RESULT" output_order="0" data_type="Number" key="RESULT"/>
</Outputs>
```

| Attribute | Description |
|-----------|-------------|
| `output_name` | Name of the output |
| `output_order` | 0-indexed position (for multiple outputs) |
| `data_type` | Output type |
| `key` | Key of the node that provides this output |

## TestCases

Define test cases for validation.

```xml
<TestCases>
  <TestCase>
    <Input order="0" value="1000000"/>
    <Input order="1" value="0.05"/>
    <ExpectedOutput order="0" value="50000"/>
  </TestCase>
</TestCases>
```

- `<Input order="N" value="V"/>` - Input value for `input_order=N`
- `<ExpectedOutput order="N" value="V"/>` - Expected output value

## NodeDependencies (Optional)

Explicit dependency graph. Usually not needed - the evaluator infers dependencies from formulas.

```xml
<NodeDependencies>
  <NodeDependency child_node_id="3" parent_node_id="1" parent_position="0"/>
  <NodeDependency child_node_id="3" parent_node_id="2" parent_position="1"/>
</NodeDependencies>
```

## Other Sections

These are typically empty but required:

```xml
<NodeComments/>
<CustomFunctions/>
<LangSpecs/>
```

## Complete Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="COMPOUND_INTEREST" sheetType="spreadsheet">
  <LangSpecs/>

  <TestCases>
    <TestCase>
      <Input order="0" value="1000"/>
      <Input order="1" value="0.05"/>
      <Input order="2" value="10"/>
      <ExpectedOutput order="0" value="1628.894626777442"/>
    </TestCase>
    <TestCase>
      <Input order="0" value="5000"/>
      <Input order="1" value="0.03"/>
      <Input order="2" value="5"/>
      <ExpectedOutput order="0" value="5796.370239608801"/>
    </TestCase>
  </TestCases>

  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number"
          key="PRINCIPAL" canonical="1000" input_order="0" input_name="PRINCIPAL"/>
    <Node node_id="2" node_type="input" data_type="Number"
          key="RATE" canonical="0.05" input_order="1" input_name="RATE"/>
    <Node node_id="3" node_type="input" data_type="Number"
          key="YEARS" canonical="10" input_order="2" input_name="YEARS"/>

    <Node node_id="4" node_type="constant" data_type="Number" key="ONE" value="1"/>

    <Node node_id="5" node_type="function" data_type="Number"
          key="GROWTH_FACTOR" canonical="=ONE+RATE" function_name="ADD"/>
    <Node node_id="6" node_type="function" data_type="Number"
          key="COMPOUND" canonical="=GROWTH_FACTOR^YEARS" function_name="EXPONENT"/>
    <Node node_id="7" node_type="function" data_type="Number"
          key="RESULT" canonical="=PRINCIPAL*COMPOUND" function_name="MULTIPLY"/>
  </Nodes>

  <NamedNodes>
    <NamedNode node_name="PRINCIPAL" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="RATE" node_name_type="alias" node_id="2"/>
    <NamedNode node_name="YEARS" node_name_type="alias" node_id="3"/>
    <NamedNode node_name="ONE" node_name_type="alias" node_id="4"/>
    <NamedNode node_name="GROWTH_FACTOR" node_name_type="alias" node_id="5"/>
    <NamedNode node_name="COMPOUND" node_name_type="alias" node_id="6"/>
    <NamedNode node_name="RESULT" node_name_type="alias" node_id="7"/>
  </NamedNodes>

  <NodeComments/>

  <Outputs>
    <Output output_name="RESULT" output_order="0" data_type="Number" key="RESULT"/>
  </Outputs>

  <NodeDependencies/>
  <CustomFunctions/>
</CodeCalculation>
```

This calculates: `PRINCIPAL * (1 + RATE)^YEARS`
