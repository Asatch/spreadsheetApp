# Function Workshop

This workspace is for creating spreadsheets. There are two kinds:

- **Functions** — Spreadsheets with outputs. They transpile to JavaScript, can be called from other spreadsheets, and are registered as custom functions. They have XML + JS.
- **Display sheets** — Spreadsheets with no outputs. They're for viewing only — dashboards, scenario comparisons, documentation. They have XML only (no JS, no transpilation).

Both kinds are built as XML, stored in workfolders, and packaged into zips for frontend import. Only functions get transpiled and tested. Display sheets are included in zips as viewable spreadsheets but not as callable functions.

## Script Patterns & Anti-Patterns

See `BEST_PRACTICES.md` for the full reference on script patterns and anti-patterns. Follow these when creating or modifying scripts.

## Fix at the Source

Fix issues at the pipeline/source level, not by manually editing generated output. If the transpiler, CLI, or export produces wrong results, fix the generator — don't patch its output. Manual edits to generated files get overwritten on the next run.

## Philosophy: Ground Truth First

Spreadsheet functions often replicate logic that exists somewhere else — a Python script, an Excel model, a tax form, a financial formula. The spreadsheet doesn't need to mirror the source's internal structure. It should tell its own story in a way that's readable and educational. But it must arrive at the same answer.

**Before writing spreadsheet code:**

1. **Identify the source of truth** — What existing implementation or specification defines correct behavior?
2. **Build end-to-end test cases from the source** — Run the reference implementation with specific inputs and capture its outputs. These become your expected values. Never hand-calculate expected values using your own formulas — that just validates your formula against itself.
3. **Test at the integration level** — You don't need to match every intermediate step. If the final outputs match across a good range of inputs, the internals are working. If they don't match, then dig into which sub-calculation diverges.
4. **Cover the input space** — Include normal cases, edge cases, and boundary conditions. Think about what varies: zero values, large values, threshold crossings (e.g., tax bracket boundaries, age cutoffs).

**When porting logic into spreadsheets:**

- **Restructure freely** — Break the computation into whatever sub-functions tell the clearest story. The spreadsheet's internal decomposition doesn't need to match the source.
- **Name things for the reader** — The source might use terse variable names or inline calculations. The spreadsheet should use clear labels and show intermediate values that help someone understand what's happening.
- **Match inputs and outputs, not internals** — The contract is: given these inputs, produce these outputs. How you get there is your design choice.

This discipline catches subtle differences (like mid-year vs end-of-period growth) that hand-calculated tests miss.

## Philosophy: Telling a Story

A spreadsheet function serves two purposes:

1. **Mathematical correctness** - The function must compute the right answer across its entire valid domain. This is non-negotiable and critically important.

2. **Storytelling** - When users drill into a function, they're asking "how does this work?" The spreadsheet should answer that question clearly.

The math must work for any valid inputs, but the *presentation* is optimized for the likely use case:

- **Formatting communicates meaning** - Show 3.0% instead of 0.03 for a rate. Show $1,629 for a currency value. Use appropriate decimal precision for each context.
- **But context matters** - A rate of 0.0000003 shown as 0.0% hides information. Very small or large values may need different formatting. Choose what makes the value comprehensible.
- **Labels and descriptions guide understanding** - Each row tells part of the story. Column A labels what it is, Column B shows the value, Column C explains the calculation.
- **Design for your audience** - Think about who will use this function and what inputs they'll typically provide. Format for that typical scenario.

If someone uses edge-case inputs, they still get the mathematically correct answer - the presentation just wasn't optimized for that story.

## Philosophy: Package Story

"Telling a Story" (above) is about individual functions. But a package (zip) isn't just a bag of functions — it's a product someone imports and experiences. The package as a whole needs to tell a story too.

**Every package needs a front door.** At least one display sheet that shows off what the functions can do together. This is what a first-time user opens to understand the package. Functions are building blocks; the display sheet is the experience.

**Display sheets are not functions.** They have no inputs and no outputs. They don't transpile. Editable values are literal cell values (blue-highlighted), not function parameters. The user changes a cell value to try different scenarios — they don't call the sheet with arguments.

**Not every function needs its own display sheet.** In the retirement suite, WITHDRAW_TAXABLE, RETIREMENT_YEAR, ACCUMULATION, and RETIREMENT_PROJECTION are internal building blocks. None of them has a dedicated display sheet. RETIREMENT_SCENARIOS is the single front door that shows off the whole suite — calling RETIREMENT_SCENARIO (which composes the others) with different inputs so users can see what the package does and drill down into the details.

**Design the package from the front door backward.** Before building functions, think about the display sheet: what will a user see when they import this zip? What story does it tell? What can they interact with? Then build the functions that support that experience. The functions serve the story, not the other way around.

## Design Principles for Layouts

See `BEST_PRACTICES.md` for the complete reference on layout, styling, formatting, naming, testing, composition, and package patterns (P1-P29) and anti-patterns (AP1-AP10). Key points:

- **Docstring** (P4), **section headers** (P5), **three-column layout** (P6), **result section** (P7)
- **Naming**: UPPER_SNAKE_CASE everywhere (P8), every output gets a semantic name (P9)
- **Formatting**: `default-format` for dominant type, override exceptions (P13-P14)
- **Styling**: title bold + large font (P21), gray highlights on section headers (P22), `← OUTPUT` markers (P23)
- **Testing**: at least 5 cases with comments, independent verification (P15-P17)

**Important correctness rule**: Descriptions in column C are TEXT constants, not formulas. `= INCOME × 10%` MUST use a `'` prefix (e.g., `'= INCOME × 10%`). Without `'`, the engine evaluates it as a formula and produces `#SYNTAX!` errors.

## Workflow

Work is organized into **workfolders** (`workfolders/<name>/`) — self-contained directories holding the functions for a particular effort. Each workfolder has its own `registry.json`. **Packaged zips are the source of truth** — workfolders are disposable working directories. The workbench is the full set of tools (CLI, eval, rebuild, best practices, review process) used to build and validate functions.

### Create new functions

```bash
# Create workfolder
mkdir -p workfolders/my-suite

# Build a function using the spreadsheet CLI
node cli/spreadsheet-cli.js --workfolder workfolders/my-suite scripts/my-func.txt
# → saves XML, transpiles to JS, registers in registry.json (with script path)

# Rebuild everything: regenerate from scripts, test, export, show changes
node rebuild.mjs --workfolder workfolders/my-suite
```

### Build on existing functions

```bash
# Seed workfolder from an existing zip
node import_zip.mjs --workfolder workfolders/my-suite examples/tax.zip
# → unpacks functions, reconstructs registry

# Add new functions that depend on imported ones
# (script includes: use PROGRESSIVE_TAX)
node cli/spreadsheet-cli.js --workfolder workfolders/my-suite scripts/new-func.txt

# Rebuild all — tests everything, exports zip, shows readout of changes
node rebuild.mjs --workfolder workfolders/my-suite
```

### Lifecycle

1. **Start** — create a workfolder (optionally import a zip to seed it)
2. **Work** — create/modify scripts, rebuild to validate
3. **Review** — `rebuild.mjs --review` for a comprehensive once-over before publishing
4. **Done** — zip is the deliverable, workfolder is disposable

## Example Packages

Packaged zips live in `examples/`:

| Zip | Contents |
|-----|----------|
| `basics.zip` | Simple examples (COMPOUND_INTEREST, etc.) |
| `reference.zip` | Educational implementations of built-in functions |
| `foundational.zip` | Core custom functions (FACTORIAL, INT, LOG, etc.) |
| `excel-functions.zip` | Excel-compatible functions (PMT, NPER, NORMSDIST, etc.) |
| `tax.zip` | 2025 US tax functions (progressive tax, EITC, AMT, etc.) |
| `retirement.zip` | Full retirement planning suite — accumulation, projection, withdrawals, RMD, tax integration, scenario comparison. The most complete example of a multi-function workfolder. |

Import any of these into a workfolder to build on them.

## Eval CLI

Headless evaluator for spreadsheet functions. Use `--workfolder` to resolve custom function dependencies from a workfolder.

```bash
# Run all test cases
node eval.mjs --workfolder workfolders/my-suite test MY_FUNC.xml

# Evaluate with specific inputs
node eval.mjs --workfolder workfolders/my-suite evaluate MY_FUNC.xml '[100, 200]'

# Evaluate a single formula
node eval.mjs eval-formula '=A1*B1' '{"A1": 10, "B1": 5}'

# Print a human-readable spreadsheet layout
node eval.mjs --workfolder workfolders/my-suite readout MY_FUNC.xml
node eval.mjs readout path/to/standalone.xml '[75000, 1]'  # with specific inputs
```

The `readout` command shows the full grid with formulas and computed values, formatted per format rules. Uses the first test case inputs by default. For loop sheets, it renders separate "Formulas" and "Schedule" sections, shows column headers (e.g., `A: age`), and propagates row 1 format overrides to generated rows.

## Spreadsheet CLI

A script-based tool for building spreadsheet functions programmatically. Ideal for functions with repetitive patterns like table lookups.

**The CLI is a shorthand for the GUI, not a separate interface.** Its XML output must be identical to what the GUI would produce for the same operation. If the GUI saves a complete format object with all fields populated, the CLI must too. The CLI achieves this by importing shared code from the frontend (e.g., `getNumberFormatDefaults()`) rather than hand-constructing partial objects. This prevents bugs where the CLI produces XML that the formatter or frontend doesn't handle correctly because it's missing fields the GUI would always include.

**Location**: `cli/spreadsheet-cli.js`

**Usage**:
```bash
# Standalone (no workfolder)
node cli/spreadsheet-cli.js scripts/my-function.txt

# With workfolder (enables dependency resolution, auto-transpile)
node cli/spreadsheet-cli.js --workfolder workfolders/my-suite scripts/my-function.txt
```

**Commands**:
| Command | Example | Description |
|---------|---------|-------------|
| `new <name> [loop]` | `new CALCULATE_RMD` | Start a new spreadsheet (add `loop` for loop sheets) |
| `input <name> <default>` | `input AGE 77` | Define an input parameter |
| `write <cell> <value>` | `write B1 =AGE` | Write value or formula |
| `csv <startCell> <file>` | `csv A4 data/table.csv` | Load CSV data |
| `fill <range>` | `fill C5:C53` | Copy first cell's formula down |
| `name <cell> <alias>` | `name B21 WITHDRAWAL` | Name a cell. For outputs: gives semantic name for INDEX access. For any cell: creates a named range usable in formulas. |
| `output <name> [mode]` | `output WITHDRAWAL` | Mark output by named range (standard) or column letter (loops); mode: `last` or `all`. Always `name` the cell first, then `output` the name. |
| `header <col> <name>` | `header B taxable_balance` | Name a loop column (loop sheets only) |
| `default-format <type> [decimals] [separator]` | `default-format currency 0` | Set default format for all cells |
| `format <cell> <type> [decimals] [separator]` | `format B5 number 0 period-only` | Override default format for a cell. Separator options: `period-only` (no grouping, e.g. 2024), `comma-period` (default, e.g. 1,234.56), `comma-only`, `period-comma`, `space-period` |
| `style <cell> <prop> [value]` | `style A1 bold` | Set cell style: `bold`, `italic`, `fontsize <N>`, `align <left\|center\|right>`, `color <val>`, `bg <val>` |
| `highlight <cell> <color>` | `highlight A4 gray` | Highlight cell background: yellow, blue, green, pink, orange, gray |
| `justify <cell> <dir>` | `justify B5 right` | Set alignment (alias for `style <cell> align <dir>`) |
| `test "inputs" "outputs"` | `test "100, 77" "4366.81"` | Add a test case |
| `use <FUNCTION>` | `use PROGRESSIVE_TAX` | Declare dependency on workfolder function (requires `--workfolder`) |
| `save [path]` | `save output/FUNC.xml` | Export to XML (auto-transpiles in workfolder mode) |

**Script format**:
- One command per line
- Lines starting with `#` are comments
- Formulas use `=` prefix (e.g., `=A1+B1`)
- Text literals use `'` prefix (e.g., `'Label`)

**Simple example** (`scripts/simple-add.txt`):
```
new SIMPLE_ADD
input A 10
input B 20

write A1 'First Number
write B1 =A
write A2 'Second Number
write B2 =B
write A3 'Sum
write B3 =A+B

name B3 SUM
output SUM
default-format number 0
test "10, 20" "30"
test "0, 0" "0"
save output/SIMPLE_ADD.xml
```

**Example with dependencies** (requires `--workfolder`):
```
new TAX_WORKSHEET
input INCOME 75000
input FILING_STATUS 1

use PROGRESSIVE_TAX

write A1 'TAX WORKSHEET
write A3 'Income
write B3 =INCOME
write A5 'Federal Tax
write B5 =PROGRESSIVE_TAX(INCOME, FILING_STATUS)

name B5 FEDERAL_TAX
output FEDERAL_TAX
default-format currency 0
test "75000, 1" "11414"
save
```

See `cli/scripts/` for complete working examples.

**Directory structure**:
```
cli/
├── spreadsheet-cli.js    # The CLI tool
├── scripts/              # Script files (.txt)
│   └── calculate-rmd.txt
└── data/                 # CSV data files
    └── rmd-table.csv
```

## Other Tools

### `rebuild.mjs` — Rebuild workfolder from source scripts

The primary build tool. Reads the registry, builds a dependency DAG, topologically sorts, and rebuilds each function from its source script. Then exports the zip, runs all tests, and shows readouts of changed sheets.

```bash
# Rebuild everything (default)
node rebuild.mjs --workfolder workfolders/retirement

# Rebuild one function + its transitive dependencies
node rebuild.mjs --workfolder workfolders/retirement FULL_RETIREMENT_SCENARIO

# Comprehensive review — readout of ALL sheets (for pre-publish review)
node rebuild.mjs --workfolder workfolders/retirement --review
```

**Normal mode (default):** Rebuilds from scripts, exports zip, runs tests, shows readouts only for sheets that actually changed. This is the standard workflow after editing a script — you see what changed and validate it.

**Review mode (`--review`):** Same as normal but shows readouts for ALL sheets, not just changed ones. Use before publishing a package to do a full once-over.

Registry entries track their source script via the `script` field (auto-populated by the CLI on save). Functions without a `script` field (imported from zips, hand-edited) are skipped during rebuild but still included in tests and export.

### `transpile.mjs` — Standalone transpiler

Transpiles XML → JavaScript using the frontend JS transpiler. Manages the workfolder registry. Only transpiles functions (sheets with outputs) — display-only sheets are skipped by `--all`.

```bash
# Transpile a single function
node transpile.mjs --workfolder workfolders/my-suite FUNCTION_NAME

# Transpile all functions in workfolder (in dependency order, skips display sheets)
node transpile.mjs --workfolder workfolders/my-suite --all

# Register a function in the registry (called automatically by CLI on save)
node transpile.mjs --workfolder workfolders/my-suite --register --xml FUNC.xml FUNC_NAME --deps DEP1,DEP2
```

### `export_zip.mjs` — Package workfolder → zip

Exports functions, display sheets, and scenario analyses. Functions get XML + JS in `functions/` and `spreadsheets/`. Display sheets (no outputs) get XML in `spreadsheets/` only — they're viewable but not callable. Scenario files in `<workfolder>/scenarios/*.json` ship as `scenarios/<id>.json` plus a `scenarios` section in `manifest.json`. Output is manifest **v2.1**.

```bash
node export_zip.mjs --workfolder workfolders/my-suite
node export_zip.mjs --workfolder workfolders/my-suite FUNC1 FUNC2  # specific functions only
```

### `import_zip.mjs` — Seed workfolder from zip

```bash
node import_zip.mjs --workfolder workfolders/my-suite path/to/package.zip
```

## Scenario Analyses

A **scenario analysis** is a saved Scenario Analysis configuration — input categorizations (`fixed` / `decision` / `unknown`) and value lists for sweeping a function across a cross-product of inputs. They live alongside the functions they analyze and ship with the package zip, so importing a zip restores the analyses ready to run.

### Authoring as files

Drop a JSON file per scenario into `<workfolder>/scenarios/`. Single-file format — metadata and inputs together:

```json
// workfolders/my-retirement/scenarios/retire-age-sweep.json
{
  "name": "Retire-age × Healthcare-inflation sweep",
  "functionName": "RETIREMENT_SENSITIVITY",
  "inputs": {
    "M_RETIRE_AGE":              { "category": "decision", "values": [54, 56, 58, 60, 62] },
    "HEALTHCARE_INFLATION_DIFF": { "category": "unknown",  "values": [0.02, 0.025, 0.05] },
    "SPENDING":                  { "category": "fixed",    "values": [110000] }
  }
}
```

Required fields: `name`, `functionName`, `inputs`. Optional: `folderId` (default `null`).

The export script assigns the scenario UUID and `createdAt`/`updatedAt` timestamps, and resolves `functionName` → `functionId` from the workfolder registry. The referenced function must be a callable function being exported (not a display sheet, not omitted by an explicit function filter).

Each input entry has:
- `category` — one of `fixed` (single value), `decision` (sweep — values you control), `unknown` (sweep — values outside your control)
- `values` — array of values to use. For `fixed`, exactly one value; for `decision`/`unknown`, the values to sweep over

### Manifest v2.1 shape

```json
{
  "version": "2.1",
  "scenarios": {
    "scenario-{uuid}": {
      "name": "...",
      "functionId": "{function-uuid}",
      "functionName": "RETIREMENT_SENSITIVITY",
      "createdAt": "...",
      "updatedAt": "...",
      "folderId": null
    }
  }
}
```

The corresponding `scenarios/{scenario-uuid}.json` holds `{ inputs, results: null }` — the `inputs` object is copied verbatim from the source file, and `results` is always `null` at export time (analyses are run in the browser).

The `scenarios` section is omitted entirely when the workfolder has no `scenarios/` directory (or it's empty); old (v2.0) importers that don't know about scenarios simply ignore the new section.

## XML Format (Schema 5)

See `docs/xml-schema.md` for full reference. Quick template:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CodeCalculation name="FUNCTION_NAME">
  <LangSpecs/>
  <TestCases>
    <test_case>
      <input_value Value="1000"/>
      <input_value Value="0.03"/>
      <output_value Value="30"/>
    </test_case>
  </TestCases>

  <Nodes>
    <!-- Row 1: First input display (label | PROCEED | description) -->
    <Node node_id="1" node_type="constant" data_type="Text" key="A1" canonical="'Amount" value="Amount"/>
    <Node node_id="2" node_type="function" data_type="Number" key="B1" canonical="=AMOUNT" function_name="PROCEED"/>
    <Node node_id="3" node_type="constant" data_type="Text" key="C1" canonical="'Principal amount" value="Principal amount"/>

    <!-- Row 2: Second input display -->
    <Node node_id="4" node_type="constant" data_type="Text" key="A2" canonical="'Rate" value="Rate"/>
    <Node node_id="5" node_type="function" data_type="Number" key="B2" canonical="=RATE" function_name="PROCEED"/>
    <Node node_id="6" node_type="constant" data_type="Text" key="C2" canonical="'Interest rate" value="Interest rate"/>

    <!-- Row 3: Result -->
    <Node node_id="7" node_type="constant" data_type="Text" key="A3" canonical="'Interest" value="Interest"/>
    <Node node_id="8" node_type="function" data_type="Number" key="B3" canonical="=B1*B2" function_name="MULTIPLY"/>
    <Node node_id="9" node_type="constant" data_type="Text" key="C3" canonical="'Amount * Rate" value="Amount * Rate"/>

    <!-- Named inputs (NOT on grid - these are the function parameters) -->
    <Node node_id="10" node_type="input" data_type="Number" key="AMOUNT" canonical="1000" input_order="0" input_name="AMOUNT"/>
    <Node node_id="11" node_type="input" data_type="Number" key="RATE" canonical="0.03" input_order="1" input_name="RATE"/>
  </Nodes>

  <NamedNodes>
    <!-- Grid cell addresses -->
    <NamedNode node_name="A1" node_name_type="address" node_id="1"/>
    <NamedNode node_name="B1" node_name_type="address" node_id="2"/>
    <NamedNode node_name="C1" node_name_type="address" node_id="3"/>
    <NamedNode node_name="A2" node_name_type="address" node_id="4"/>
    <NamedNode node_name="B2" node_name_type="address" node_id="5"/>
    <NamedNode node_name="C2" node_name_type="address" node_id="6"/>
    <NamedNode node_name="A3" node_name_type="address" node_id="7"/>
    <NamedNode node_name="B3" node_name_type="address" node_id="8"/>
    <NamedNode node_name="C3" node_name_type="address" node_id="9"/>
    <!-- Input aliases (so formulas can reference by name) -->
    <NamedNode node_name="AMOUNT" node_name_type="alias" node_id="10"/>
    <NamedNode node_name="RATE" node_name_type="alias" node_id="11"/>
  </NamedNodes>

  <NodeComments/>

  <Outputs>
    <Output output_name="INTEREST" node_id="8" output_order="0" data_type="Number" key="B3" output_mode="last"/>
  </Outputs>

  <NodeDependencies>
    <NodeDependency child_node_id="2" parent_node_id="10" parent_position="0"/>
    <NodeDependency child_node_id="5" parent_node_id="11" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="2" parent_position="0"/>
    <NodeDependency child_node_id="8" parent_node_id="5" parent_position="1"/>
  </NodeDependencies>

  <CustomFunctions/>

  <SpreadsheetMeta version="1.0" gridRows="5" gridCols="D"/>
</CodeCalculation>
```

## Key Rules

1. **Node IDs must be unique** - Sequential integers starting from 1
2. **Inputs are NAMED, not on grid** - Inputs have semantic keys like `AMOUNT`, `RATE` (not cell addresses)
3. **Display cells use PROCEED** - Grid cells (B1, B2) display inputs via `=AMOUNT`, `=RATE`
4. **Grid cells use cell addresses as keys** - A1, B1, C1, etc. for visual layout
5. **Design a visual layout** - Think in rows/columns:
   - Column A: Labels (text constants, prefix with `'`)
   - Column B: Values (PROCEED for inputs, formulas for calculations)
   - Column C: Descriptions (text constants, prefix with `'`)
6. **Descriptions are TEXT constants** - Any human-readable description cell (like `'= INCOME × 10%`) MUST be `node_type="constant" data_type="Text"` with a `'` prefix on canonical. **Never** use `node_type="function"` for description text — the engine will try to evaluate it and produce errors.
7. **Formulas reference cell addresses** - Use `=B1*B2` for the calculation (not input names)
8. **Test cases use `<test_case>` format** - With `<input_value Value="X"/>` and `<output_value Value="Y"/>`
9. **NamedNodes need both types**:
   - `node_name_type="address"` for grid cells (A1, B1, etc.)
   - `node_name_type="alias"` for named inputs (AMOUNT, RATE, etc.)
10. **Output includes `node_id` and `output_mode="last"`**
11. **Include SpreadsheetMeta** - Defines grid size for display
12. **Anonymous constants** - For literal values in formulas (like `=1+B2`), create a constant node with NO `key` attribute:
    ```xml
    <Node node_id="22" node_type="constant" data_type="Number" value="1"/>
    ```
    The constant is still connected via NodeDependencies but doesn't appear on the grid.
13. **Include FormatRules for storytelling** - Add formatting to make values comprehensible:
    ```xml
    <SpreadsheetMeta version="1.0" gridRows="9" gridCols="E">
      <FormatRule cellKey="B2" formats="{&quot;NUMBER&quot;:{&quot;subCategory&quot;:&quot;percentage&quot;,&quot;decimalPlaces&quot;:1}}"/>
      <FormatRule cellKey="B7" formats="{&quot;NUMBER&quot;:{&quot;subCategory&quot;:&quot;number&quot;,&quot;decimalPlaces&quot;:0}}"/>
    </SpreadsheetMeta>
    ```
    Choose formats based on what the value represents and the likely use case.
14. **Declare ALL custom function dependencies** - If your function uses ANY non-built-in function (like `INT`, `ABS`, `PROGRESSIVE_TAX`), it MUST be listed in `<CustomFunctions>` with its UUID. Missing dependencies cause `#NAME!` errors at evaluation time. When using the spreadsheet CLI with `--workfolder`, the `use` command handles this automatically.

## Loop Sheets

For iterative calculations, use `sheetType="loop"` on the root element:

```xml
<CodeCalculation name="MY_LOOP" sheetType="loop">
```

Loop sheet structure:
- **Row 0**: Initial values (e.g., `D0` = starting balance, `E0` = 0 for counter)
- **Row 1**: Iteration formulas (e.g., `D1` = `=A1+B1+C1`, `E1` = `=E0+1`)
- **`_STOP1`**: Stop condition (e.g., `=E1>=YEARS`)
- **Output key**: Column letter (e.g., `key="D"`) with `output_mode="last"`

**Understanding row references:**
- **Row 1 → Row 0** (e.g., `A1 = D0`): "Get value from last round" - D0 holds the previous iteration's D1 value
- **Row 1 → Row 1** (e.g., `D1 = A1 + B1`): "In this same round" - uses values computed in current iteration

The evaluator generates rows 2, 3, ... by adjusting Row 1 formulas until `_STOP` is true.

**Best practice: Keep loop logic simple.** Push complex calculations into custom functions. For example, RETIREMENT_PROJECTION's loop body is just:
```
D1 = RETIREMENT_YEAR(A1, INCOME, SPENDING, TAX_RATE, RETURN_RATE)
```
All the retirement year math lives in the RETIREMENT_YEAR function, making the loop easy to understand and debug.

### Loop Sheet Transpilation Requirements

**Critical rules for loop sheets to transpile correctly to JavaScript:**

1. **`output_name` must be the column letter** - For loop outputs, use the column letter (e.g., `"B"`, `"D"`), NOT a descriptive name. The transpiler uses `output_name` to find the Row 1 cell:
   ```xml
   <!-- CORRECT -->
   <Output output_name="B" output_order="0" data_type="Number" key="B" output_mode="last"/>

   <!-- WRONG - transpiler won't find the output -->
   <Output output_name="SUM" output_order="0" data_type="Number" key="B" output_mode="last"/>
   ```

2. **`_STOP1` vs `_STOP0`** - Both are supported with different semantics:
   - `_STOP1` = **do-while** (check after iteration) — the common case
   - `_STOP0` = **while-do** (check before first iteration) — for early-exit when inputs already satisfy the stop condition

   Most loops only need `_STOP1`. Use `_STOP0` when the loop should sometimes not execute at all.

3. **HTML-encode special characters in formulas** - The `>` and `<` characters in `canonical` attributes must be encoded:
   ```xml
   <!-- CORRECT -->
   <Node ... canonical="=A1&gt;=N" .../>

   <!-- WRONG - breaks XML parsing -->
   <Node ... canonical="=A1>=N" .../>
   ```

4. **No `node_id` needed on Output for loops** - Unlike regular sheets, loop outputs don't require `node_id` (the transpiler derives it from the column).

## Custom Functions

To use a custom function in your spreadsheet, you must declare it in `<CustomFunctions>`:

```xml
<CustomFunctions>
  <Function name="PROGRESSIVE_TAX" id="e5f6g7h8-..." version="1.0.0"/>
</CustomFunctions>
```

**Every non-built-in function you call must be declared here.** This includes functions like `INT`, `ABS`, `FACTORIAL` — if they're defined as custom functions (in Foundational, Excel_Functions, etc.), they need a declaration. Missing declarations cause `#NAME!` errors.

When using the spreadsheet CLI with `--workfolder`, the `use` command handles this automatically by looking up the UUID from the workfolder registry.

### Custom Function Combinations (All Tested Working)

| Caller Type | Callee Type | Status |
|-------------|-------------|--------|
| Sheet | Normal function | Works |
| Sheet | Loop function | Works |
| Loop | Normal function | Works |
| Loop | Loop function | Works |

## Available Functions

See `docs/built-in-functions.md` for full list. Common ones:

| Function | Example | Description |
|----------|---------|-------------|
| ADD | `=A+B` | Addition |
| SUBTRACT | `=A-B` | Subtraction |
| MULTIPLY | `=A*B` | Multiplication |
| DIVIDE | `=A/B` | Division |
| EXPONENT | `=A^B` | Power |
| IF | `=IF(A>B,X,Y)` | Conditional |
| AND | `=AND(A,B)` | Logical AND |
| OR | `=OR(A,B)` | Logical OR |
| SUM | `=SUM(A:C)` | Sum range |
| LESS | `=A<B` | Comparison |
| GREATER | `=A>B` | Comparison |
| EQUAL | `=A=B` | Equality |

## Formula Syntax Notes

- Operators: `+`, `-`, `*`, `/`, `^`, `<`, `>`, `<=`, `>=`, `=`, `<>`
- Chained operators work: `=A+B+C+D` is fine (parsed as nested ADDs). `=SUM(A,B,C)` also works.
- Boolean literals: Use cell references with boolean values, not `true`/`false` literals
- Ranges: `=SUM(A1:A5)` or `=SUM(B:D)` for column ranges

## Patterns and Learnings

### Table Lookup with Cascade Pattern

For looking up values in a table (like IRS life expectancy by age), use a "first match wins" cascade rather than deeply nested IFs:

```
Column A: Age values (75, 76, 77, ...)
Column B: Lookup values (24.6, 23.7, 22.9, ...)
Column C: Match check - =Ax >= INPUT_AGE
Column D: Cascade result
  D6 = IF(C6, B6, 0)                     -- first row
  D7 = IF(D6>0, D6, IF(C7, B7, 0))       -- pass through or check this row
  D8 = IF(D7>0, D7, IF(C8, B8, 0))       -- and so on...
```

Each row is self-contained: either pass through the previous match, or check this row's condition. This tells a clearer story than nested IFs because you can trace the logic flowing down the table.

### Why CLI is Much Simpler Than Hand-Writing XML

**The CLI handles all the tedious bookkeeping automatically:**

| What you write (CLI) | What CLI generates (XML) |
|---------------------|--------------------------|
| `write B6 =Z` | Node with unique ID, NamedNode for address, NodeDependency to input |
| `write B10 =1/(1+F6*B9)` | 5+ nodes for subexpressions, all dependencies wired correctly |
| `format B10 number 6` | `<FormatRule cellKey="B10" formats="...">` with proper escaping |
| `test "1.5" "0.933..."` | `<test_case><input_value .../><output_value .../></test_case>` |

**What you focus on with CLI:**
```
write A9 'Absolute Z
write B9 =ABS(B6)
write C9 'Always work with positive value
```

**What XML requires (same 3 cells):**
```xml
<Node node_id="14" node_type="constant" data_type="Text" key="A9" canonical="'Absolute Z" value="Absolute Z"/>
<Node node_id="15" node_type="function" data_type="Number" key="B9" canonical="=ABS(B6)" function_name="ABS"/>
<Node node_id="16" node_type="constant" data_type="Text" key="C9" canonical="'Always work with positive value" value="Always work with positive value"/>
<NamedNode node_name="A9" node_name_type="address" node_id="14"/>
<NamedNode node_name="B9" node_name_type="address" node_id="15"/>
<NamedNode node_name="C9" node_name_type="address" node_id="16"/>
<NodeDependency child_node_id="15" parent_node_id="9" parent_position="0"/>
```

### When to Use Each Tool

**Use Spreadsheet CLI with `--workfolder` (preferred for most cases):**
- Table lookups with CSV data (RMD tables, tax brackets, etc.)
- Repetitive patterns that benefit from `fill` command
- Functions that depend on other custom functions (`use` command)
- Any function that needs formatting and test cases (CLI supports both)
- Building functions programmatically with clear structure

**Build in Frontend when:**
- Complex visual layouts you want to verify interactively
- Experimenting with formulas before committing to a structure
- You want to see the spreadsheet render as you build

**Write XML directly when:**
- Making small edits to existing XMLs
- Fixing specific node IDs or dependencies
- You need full control that the CLI doesn't provide

**Recommendation:** Default to the CLI with `--workfolder`. It produces consistent, well-structured output with proper formatting, test cases, and dependency management.

### Multi-Output Functions

Functions can return multiple values. How you access them depends on the function type.

**Standard functions** — use numeric INDEX (1-based output order):
```
# WITHDRAW_TAXABLE returns: withdrawal, tax, remaining_shortfall, basis_reduction
write B21 =INDEX(WITHDRAW_TAXABLE(BALANCE, SHORTFALL, BASIS), 1)
write B22 =INDEX(WITHDRAW_TAXABLE(BALANCE, SHORTFALL, BASIS), 2)
write B23 =INDEX(WITHDRAW_TAXABLE(BALANCE, SHORTFALL, BASIS), 3)
```

**Alternative: string keys via cell reference.** Put output names in cells and reference them — avoids magic numbers:
```
write E21 'WITHDRAWAL
write E22 'TAX
write E23 'REMAINING_SHORTFALL
write B21 =INDEX(WITHDRAW_TAXABLE(BALANCE, SHORTFALL, BASIS), E21)
write B22 =INDEX(WITHDRAW_TAXABLE(BALANCE, SHORTFALL, BASIS), E22)
write B23 =INDEX(WITHDRAW_TAXABLE(BALANCE, SHORTFALL, BASIS), E23)
```
The string must match the output's `output_name` attribute in the callee's XML. Standard functions have names like `WITHDRAWAL`, `TAX`, etc.

**Loop functions** — use string keys matching column headers:
```
# Loop with header B = "ending_balance", header C = "total_taxes"
write B5 =INDEX(MY_LOOP(args), "ending_balance")
write B6 =INDEX(MY_LOOP(args), "total_taxes")
```
Loop outputs use their column header names (set via `header` command). String literals work directly in formulas — no cell reference needed.

### Loop Scripts

Loop scripts use the same CLI but with loop-specific commands:

```
new RETIREMENT_PROJECTION loop
input BALANCE 500000
input YEARS 20

use RETIREMENT_YEAR

# Row 0: initial values
write D0 =BALANCE
write E0 0

# Row 1: iteration body
write A1 =D0
write D1 =RETIREMENT_YEAR(A1)
write E1 =E0+1

# Stop condition
write _STOP1 =E1>=YEARS

# Column headers (for named output access via INDEX)
header D ending_balance

# Output: column letter, not cell address
output D last

test "500000, 3" "expected_value"
save
```

Key differences from standard scripts:
- `new <name> loop` — creates a loop sheet
- `write D0 ...` / `write E0 ...` — Row 0 is initial values
- `write D1 ...` / `write E1 ...` — Row 1 is the iteration body (replayed each round)
- `write _STOP1 =<condition>` — stop condition (do-while: checked after each iteration)
- `write _STOP0 =<condition>` — optional early-exit condition (while-do: checked before first iteration)
- `header <col> <name>` — names a column for output access via INDEX
- `output <col> [mode]` — output by column letter, not cell address; mode is `last` (default) or `all`

### Extending an Existing Function Suite

To add functions that build on an existing package:

```bash
# 1. Import the existing zip into a working workfolder
node import_zip.mjs --workfolder workfolders/retirement examples/retirement.zip

# 2. Build new functions that depend on imported ones
node cli/spreadsheet-cli.js --workfolder workfolders/retirement scripts/new-func.txt
# (script uses: use RETIREMENT_YEAR_FULL, etc.)

# 3. Test
node eval.mjs --workfolder workfolders/retirement test NEW_FUNC.xml

# 4. Re-export the whole suite (existing + new)
node export_zip.mjs --workfolder workfolders/retirement
```

The `use` command resolves UUIDs from the workfolder's `registry.json`, which `import_zip.mjs` reconstructs from the zip.

### Reference Scripts

The retirement suite (`examples/retirement.zip`) is the most complete example of what we're aiming for: a multi-function workfolder where each function tells a clear story, formatting makes values readable, and drill-down reveals how everything works.

**Foundational patterns:**

| Script | Demonstrates |
|--------|-------------|
| `cli/scripts/withdraw-taxable-v2.txt` | Multi-output standard function with clear result section |
| `cli/scripts/calculate-rmd.txt` | Table lookup with CSV data and cascade pattern |

**Advanced composition (the retirement suite):**

| Script | Demonstrates |
|--------|-------------|
| `cli/scripts/retirement-year-full.txt` | Complex function calling other custom functions with INDEX for multi-output access |
| `cli/scripts/accumulation-full.txt` | Loop script: multi-column loop with multiple outputs, formatting, and custom function dependencies |
| `cli/scripts/retirement-projection-full.txt` | Loop script: calls a custom function per iteration, accumulates results across years |
| `cli/scripts/full-retirement-scenario.txt` | Composition: standard sheet that calls two loop functions (accumulation → projection), chains their results, with drill-down hints |
| `cli/scripts/retirement-scenarios-full.txt` | Display sheet: scenario comparison dashboard with no outputs — the only example of this pattern |
