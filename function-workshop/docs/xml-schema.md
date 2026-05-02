# XML Schema Reference (Schema 5)

The CLI (`cli/spreadsheet-cli.js`) generates this XML for you. Read this only when you need to understand the schema directly — for debugging readouts, inspecting shipped zips, or exceptional cases the CLI doesn't cover. Per "Fix at the Source" in `CLAUDE.md`, fix the script and rebuild rather than patching generated XML.

All schema details here have been verified against the actual XML shipped in `examples/retirement.zip`.

---

## Root Element

```xml
<CodeCalculation name="FUNCTION_NAME">                    <!-- standard sheet -->
<CodeCalculation name="MY_LOOP" sheetType="loop">          <!-- loop sheet -->
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Function name. UPPER_SNAKE_CASE per BEST_PRACTICES.md P8. |
| `sheetType` | No | Omit for standard sheets. Use `"loop"` for iterative sheets. |

The required child sections, in order:

```
<LangSpecs/>
<TestCases>...</TestCases>
<Nodes>...</Nodes>
<NamedNodes>...</NamedNodes>
<NodeComments/>
<Outputs>...</Outputs>
<NodeDependencies>...</NodeDependencies>
<CustomFunctions/> or <CustomFunctions>...</CustomFunctions>
<SpreadsheetMeta ...>...</SpreadsheetMeta>
```

`<LangSpecs/>` and `<NodeComments/>` are typically empty but must be present.

---

## Nodes

The `<Nodes>` section contains every cell. Three node types: `input`, `constant`, `function`.

### Input nodes

Function parameters. Not on the visual grid — they have semantic keys (e.g., `INCOME`, `BALANCE`), and Row 1+ display cells reference them via `=INCOME` through the `PROCEED` function.

```xml
<Node node_id="1" node_type="input" data_type="Number"
      key="INCOME" canonical="75 000"
      input_order="0" input_name="INCOME"/>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `node_id` | Yes | Unique integer, sequential from 1 |
| `node_type` | Yes | `input` |
| `data_type` | Yes | `Number`, `Text`, `Boolean`, `Date` |
| `key` | Yes | Semantic name (matches `input_name`) |
| `canonical` | No | Default value shown in readouts |
| `input_order` | Yes | 0-indexed position in the function signature |
| `input_name` | Yes | Parameter name (matches `key`) |

### Constant nodes

Two flavors:

**Grid constants** — text labels and literal values placed in cells. `key` is a cell address.

```xml
<Node node_id="5" node_type="constant" data_type="Text"
      key="A5" canonical="&apos;Taxable Income" value="Taxable Income"/>

<Node node_id="14" node_type="constant" data_type="Number"
      key="B9" canonical="0.1" value="0.1"/>
```

Text constants prefix `canonical` with `&apos;` (the encoded `'`). The `value` attribute carries the unprefixed string.

**Anonymous constants** — literal values that appear inside a formula (e.g., the `1` in `=1+B2`). No `key` attribute.

```xml
<Node node_id="22" node_type="constant" data_type="Number" value="1"/>
```

Anonymous constants are wired in via `NodeDependencies` but don't appear on the grid.

### Function nodes

Cells whose value comes from a formula.

```xml
<Node node_id="6" node_type="function" data_type="Number"
      key="B5" canonical="=INCOME" function_name="PROCEED"/>

<Node node_id="17" node_type="function" data_type="Number"
      key="D9" canonical="=C9*B9" function_name="MULTIPLY"/>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `node_id` | Yes | Unique integer |
| `node_type` | Yes | `function` |
| `data_type` | Yes | Result type |
| `key` | Yes | Cell address, named range, or sub-expression marker |
| `canonical` | Yes | Formula starting with `=`. Encode `<` as `&lt;` and `>` as `&gt;`. |
| `function_name` | Yes | Top-level function being applied (e.g., `MULTIPLY`, `IF`, `PROCEED`) |

Display cells that show an input use `function_name="PROCEED"` with `canonical="=INPUT_NAME"`.

Sub-expressions inside compound formulas can appear as their own function nodes with `key` set to the sub-expression itself (e.g., `key="=MIN({B5,23850})"` for an inner `MIN` call inside a larger formula). The CLI handles this decomposition.

---

## NamedNodes

Maps names to node IDs so formulas can reference cells. Two `node_name_type` values:

- **`address`** — grid cell coordinates (`A1`, `B5`, `_STOP1`, etc.)
- **`alias`** — named ranges and input parameters (`INCOME`, `WITHDRAWAL`, etc.)

```xml
<NamedNodes>
  <NamedNode node_name="INCOME" node_name_type="alias" node_id="1"/>
  <NamedNode node_name="A5" node_name_type="address" node_id="5"/>
  <NamedNode node_name="B5" node_name_type="address" node_id="6"/>
</NamedNodes>
```

Every grid cell needs an `address` NamedNode. Every input gets an `alias` NamedNode. Named ranges declared via the CLI's `name` command produce `alias` NamedNodes.

---

## Outputs

### Standard sheets

Output one or more named results.

```xml
<Outputs>
  <Output output_name="TAX" node_id="69" output_order="0"
          data_type="Number" key="TAX" output_mode="last"/>
</Outputs>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `output_name` | Yes | Semantic name (used by callers' `INDEX(result, "OUTPUT_NAME")`) |
| `node_id` | Yes | ID of the node providing this output |
| `output_order` | Yes | 0-indexed |
| `data_type` | Yes | Output type |
| `key` | Yes | The node's key — typically matches `output_name` (semantic key, not a cell address) |
| `output_mode` | Yes | `last` (single value) or `all` (collect every iteration — loop only) |

Per BEST_PRACTICES.md AP4, outputs must be named — `output B41` (cell address) is not acceptable. Use the CLI's `name <cell> <NAME>` followed by `output <NAME>`, which produces an alias NamedNode and an Output keyed on the alias.

### Loop sheets

Outputs are declared by **column letter**, not by named cell. The transpiler uses `output_name` to find the Row 1 cell in that column.

```xml
<Outputs>
  <Output output_name="C" output_order="0" data_type="Number" key="C" output_mode="last"/>
  <Output output_name="I" output_order="1" data_type="Number" key="I" output_mode="last"/>
</Outputs>
```

`node_id` is **not** required on loop outputs — the transpiler derives it from the column.

The human-readable name for a loop output (used by callers' `INDEX(result, "TOTAL_TAXES")`) is the matching `<ColumnName>` entry in `SpreadsheetMeta` (see below).

---

## TestCases

```xml
<TestCases>
  <test_case>
    <input_value Value="10000"/>
    <input_value Value="0.05"/>
    <output_value Value="500"/>
  </test_case>
  <test_case>
    <input_value Value="0"/>
    <output_value Value="0"/>
  </test_case>
</TestCases>
```

Note the casing: outer wrapper is `<TestCases>` (PascalCase), each case is `<test_case>` (snake_case), inputs/outputs are `<input_value>`/`<output_value>` with capital-V `Value=` attributes. Inputs are in declaration order (matching `input_order`); outputs are in `output_order`.

---

## NodeDependencies

Explicit child→parent dependency graph.

```xml
<NodeDependencies>
  <NodeDependency child_node_id="6" parent_node_id="1" parent_position="0"/>
  <NodeDependency child_node_id="17" parent_node_id="15" parent_position="0"/>
  <NodeDependency child_node_id="17" parent_node_id="14" parent_position="1"/>
</NodeDependencies>
```

`parent_position` is the argument index for multi-arg functions (so the order of arguments to `=A*B` is preserved). The CLI generates these from formula ASTs; you should not have to hand-write them.

The evaluator does not consult `NodeDependencies` directly — it walks the formula AST. However, the CLI and frontend always emit them, and shipped XML in `examples/` always has them populated. Treat them as required for any XML the toolchain produces.

---

## CustomFunctions

Declares dependencies on non-built-in functions. Empty when the sheet only uses built-ins:

```xml
<CustomFunctions/>
```

When dependencies exist:

```xml
<CustomFunctions>
  <Function id="5647bb88-76db-444f-ae5d-d1f7bd974077"
            name="RETIREMENT_YEAR" version="1.0.0"/>
</CustomFunctions>
```

| Attribute | Description |
|-----------|-------------|
| `id` | UUID from the workfolder's `registry.json` |
| `name` | Function name |
| `version` | Currently always `1.0.0` |

Every non-built-in function used in the sheet must appear here, including utility functions like `INT`, `ABS`, `FACTORIAL` if they're defined as custom functions in `Foundational.zip` / `Excel_Functions.zip`. Missing entries cause `#NAME!` errors at evaluation time.

When using the CLI with `--workfolder`, the `use <FUNCTION>` command writes this for you by looking up the UUID from `registry.json`.

---

## SpreadsheetMeta

Defines grid size, format rules, and (for loops) column names.

```xml
<SpreadsheetMeta version="1.0" timestamp="2026-04-25T12:49:59.202Z"
                 gridRows="18" gridCols="D">
  <FormatRule cellKey="B9" formats="{&quot;NUMBER&quot;:{&quot;subCategory&quot;:&quot;percentage&quot;,&quot;decimalPlaces&quot;:0,&quot;digitSeparatorOption&quot;:&quot;comma-period&quot;}}"/>
  <FormatRule cellKey="B10" formats="..."/>
</SpreadsheetMeta>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `version` | Yes | `1.0` |
| `timestamp` | No | ISO 8601 of last save |
| `gridRows` | Yes | Visible row count |
| `gridCols` | Yes | Last column letter (e.g., `D`, `M`) |

### FormatRule

JSON-encoded format spec, attribute-escaped (`&quot;` for `"`). Top-level keys are `NUMBER` (for numeric formats) and `TEXT` (for text formats).

A typical NUMBER format object:

```json
{
  "subCategory": "currency" | "percentage" | "number" | "scientific",
  "useAdaptiveDecimals": false,
  "decimalPlaces": 0,
  "digitSeparatorOption": "comma-period" | "period-only" | "comma-only" | "period-comma" | "space-period",
  "negativeStyle": "minus" | "parens"
}
```

The CLI's `format` and `default-format` commands generate these. Hand-writing is rare and error-prone — use the CLI.

### ColumnName (loop sheets only)

Names a column for caller access via `INDEX(loop_result, "COLUMN_NAME")`. Must be UPPER_SNAKE_CASE per BEST_PRACTICES.md P8.

```xml
<SpreadsheetMeta ...>
  <ColumnName column="A" name="AGE"/>
  <ColumnName column="C" name="TAXABLE_BALANCE_ENDING"/>
  <ColumnName column="I" name="TOTAL_TAXES"/>
</SpreadsheetMeta>
```

The CLI's `header <col> <NAME>` command produces these.

---

## Loop Sheets

Loop sheets compute iteratively. Row 0 holds initial values; Row 1 is the iteration body, replayed each round; `_STOP1` (or `_STOP0`) is the terminating condition.

```xml
<CodeCalculation name="MY_LOOP" sheetType="loop">
```

### Stop conditions

`_STOP1` and `_STOP0` are ordinary function nodes whose `key` is the literal string `_STOP1` or `_STOP0`:

```xml
<Node node_id="46" node_type="function" data_type="Boolean"
      key="_STOP1" canonical="=H1&gt;YEARS" function_name="GREATER"/>
<Node node_id="45" node_type="function" data_type="Boolean"
      key="_STOP0" canonical="=YEARS&lt;=0" function_name="LESSEQUAL"/>
```

- `_STOP1` — **do-while** (checked after each iteration). The common case.
- `_STOP0` — **while-do** (checked before the first iteration). Optional; use when the loop should sometimes not execute at all.

Both must be paired with corresponding `address` NamedNodes:

```xml
<NamedNode node_name="_STOP1" node_name_type="address" node_id="46"/>
```

### Formula encoding

Comparison operators in `canonical` attributes must be HTML-encoded — the XML parser would otherwise treat `>` and `<` as tag delimiters:

```xml
<!-- correct -->
canonical="=H1&gt;YEARS"
canonical="=YEARS&lt;=0"

<!-- broken -->
canonical="=H1>YEARS"
```

### Outputs and column names

Loop outputs use column letters as both `output_name` and `key` (see "Outputs > Loop sheets" above). Caller-facing names come from `<ColumnName>` entries in `SpreadsheetMeta`.

---

## Complete Example: Standard Sheet

A trivial single-output function:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="DOUBLE">
  <LangSpecs/>
  <TestCases>
    <test_case>
      <input_value Value="5"/>
      <output_value Value="10"/>
    </test_case>
    <test_case>
      <input_value Value="0"/>
      <output_value Value="0"/>
    </test_case>
  </TestCases>

  <Nodes>
    <Node node_id="1" node_type="input" data_type="Number"
          key="X" canonical="5" input_order="0" input_name="X"/>
    <Node node_id="2" node_type="constant" data_type="Number"
          key="A1" canonical="2" value="2"/>
    <Node node_id="3" node_type="function" data_type="Number"
          key="RESULT" canonical="=X*A1" function_name="MULTIPLY"/>
  </Nodes>

  <NamedNodes>
    <NamedNode node_name="X" node_name_type="alias" node_id="1"/>
    <NamedNode node_name="A1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="RESULT" node_name_type="alias" node_id="3"/>
  </NamedNodes>

  <NodeComments/>

  <Outputs>
    <Output output_name="RESULT" node_id="3" output_order="0"
            data_type="Number" key="RESULT" output_mode="last"/>
  </Outputs>

  <NodeDependencies>
    <NodeDependency child_node_id="3" parent_node_id="1" parent_position="0"/>
    <NodeDependency child_node_id="3" parent_node_id="2" parent_position="1"/>
  </NodeDependencies>

  <CustomFunctions/>

  <SpreadsheetMeta version="1.0" gridRows="1" gridCols="A"/>
</CodeCalculation>
```

For a real, full-featured example (multi-output, formatted, with custom function dependencies), inspect `sheets/local-acb30a89-ec52-4ca5-a958-40c7a44829d5.xml` inside `examples/retirement.zip` (PROGRESSIVE_TAX).

---

## Complete Example: Loop Sheet

For a real loop example, inspect `sheets/local-4e321160-34af-4624-9cba-3c24a3ae7954.xml` inside `examples/retirement.zip` (RETIREMENT_PROJECTION).
