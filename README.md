# SC-Spreadsheet

A spreadsheet app for approachable, interactive code development. Spreadsheets transpile into callable functions, letting you view values flow through operations.

## Key Concepts

### Spreadsheets as Functions
The core idea: a spreadsheet isn't just a grid of calculations—it's a **function** that can be called from other spreadsheets. You define inputs, build calculations that reference them, and mark outputs. The spreadsheet becomes a reusable, inspectable computation.

### Standard vs Loop Sheets
Two spreadsheet types with different entry points:

- **Standard sheets** - Traditional spreadsheet model. Values flow through cells based on formulas. Good for straightforward input→calculation→output flows.
- **Loop sheets** - For iterative/recursive computations. Supports extracting iteration patterns into a DAG structure for transpilation. Used when the calculation needs to loop over data.

### Inputs and Outputs
The Inputs/Outputs panels turn a spreadsheet into a callable interface:
- **Inputs** - Named values that feed into the spreadsheet. Referenced in formulas by name.
- **Outputs** - Cells marked as outputs become the function's return values.

This allows treating the spreadsheet as `outputs = f(inputs)`.

### Drilldown
**Ctrl+D** on a cell containing a custom function call opens that function's spreadsheet in a new tab. This lets you inspect how a function works—see the inputs flow through, understand the calculation, debug issues. The computation becomes transparent rather than a black box.

