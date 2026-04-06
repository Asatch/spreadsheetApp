# Function Workshop Onboarding

## What We Do

We build spreadsheet functions. Not Excel macros — these are spreadsheets that *become* callable functions. You build a spreadsheet that takes inputs, does calculations, marks some cells as outputs, and then other spreadsheets can call it like `=MY_FUNCTION(A1, B1)`.

## Your Main Tool: The Spreadsheet CLI

You write a `.txt` script — a recipe for building a spreadsheet. You say "new FUNCTION_NAME", declare your inputs, then write values into cells. Column A is usually labels, column B is formulas, column C is descriptions. It tells a story — someone should be able to read your spreadsheet top to bottom and understand the calculation. That's a big deal here. We don't just make things that compute correctly, we make things that *teach*.

When you run the CLI with `--project`, it does three things at once: generates the XML, registers the function, and transpiles it to JavaScript. One command, everything wired up.

## Testing

You put test cases right in the script — inputs and expected outputs. Then you run the eval CLI and it tells you pass/fail. The key thing: *never hand-calculate your expected values*. If you're porting logic from somewhere, run the source code, capture those outputs, and use them. Otherwise you're just testing your formula against your own understanding of the formula, which proves nothing.

## Readout

Readout prints the whole spreadsheet as text — labels, formulas, computed values, all formatted. When you're done building something, run readout and look at it. Does it make sense? Could someone who doesn't know the code follow the story? That's the bar.

## Projects

A project folder has a registry (which functions exist, what depends on what) and all the XML and JS files. Functions form dependency trees — like, our retirement suite has a `RETIREMENT_YEAR_FULL` function that calls `PROGRESSIVE_TAX`, `WITHDRAW_TAXABLE`, `WITHDRAW_PRETAX`, and `CALCULATE_RMD`. And then `RETIREMENT_PROJECTION_FULL` is a loop sheet that calls `RETIREMENT_YEAR_FULL` repeatedly, year by year. Little composable pieces.

## Two Types of Sheets

- **Standard** — straightforward input-to-output flows
- **Loop** — iterative, repeats a row of formulas until a stop condition. Trickier, but powerful for projections and schedules.

## What You'll Do Day to Day

- Build new functions from specs or from porting existing code
- Extend existing function suites (adding inputs, outputs, columns)
- Write and validate test cases
- Make sure the readout looks clean and tells a good story

## How to Do Well

1. **Understand before you build.** Read the existing functions. Run readout on them. Trace how data flows from inputs through the dependency tree. Don't just start writing formulas.

2. **Test against ground truth.** If there's a reference implementation, use it. Generate test cases from it. Match to sub-cent precision. That's how you earn trust.

3. **Care about the storytelling.** Anyone can make cells compute the right number. The hard part is making it readable — good labels, section headers, descriptions in column C, logical flow from top to bottom. Think of each spreadsheet as a little tutorial.

4. **Keep things composable.** If a calculation is getting complex, break it into a separate function. Small functions that do one thing well, then compose them. That's the whole architecture.

5. **Use `default-format` so numbers look right.** Nobody wants to see `486230.769230769`. They want to see `$486,231`. Set a default format for the sheet, then override individual cells that need something different (like percentages).

## The End Product

When you're done with a suite, you export it to a zip, and that's what gets imported into the frontend app. Users can drill down into any function call with Ctrl+D and see your spreadsheet — your labels, your story, your formatting. Your work is literally the user experience.
