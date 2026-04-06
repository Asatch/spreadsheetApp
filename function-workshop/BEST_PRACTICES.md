# Spreadsheet Function Patterns & Anti-Patterns

## Patterns (Do This)

### Script Structure

**P1. Header comment block** — Start every script with `# FUNCTION_NAME - brief description`, followed by context (return values, output names, what it matches).
```
# WITHDRAW_TAXABLE - Withdraw from taxable account
# Returns: withdrawal_amount, new_tax, remaining_shortfall, basis_reduction
# Output names: WITHDRAWAL, TAX, REMAINING_SHORTFALL, BASIS_REDUCTION
```

**P2. Section comment blocks** — Use `═══` bordered comment blocks above each section for readability in the script source.
```
# ═══════════════════════════════════════════════════════════════════
# ROW 4-6: YOUR SITUATION (inputs)
# ═══════════════════════════════════════════════════════════════════
```

**P3. Declaration order** — Always: `new` → `use` (dependencies) → `input` → body → `name`/`output` → formatting → tests → `save`.

**P4. Docstring first** — Rows 1-2 explain what the function does in plain language.

**P5. Section headers in cells** — Use `'─── SECTION NAME ───` with consistent vocabulary:
- `YOUR SITUATION` — input display
- `THE CALCULATION` — main logic
- `RESULT` — output summary
- `WORKING (...)` — complex calculations separated from narrative

**P6. Three-column layout** — A=labels, B=values, C=descriptions. Reference data on the right side (columns E+).

**P6a. Display inputs with context** — Show each input on its own row with a label (A), the input value (B), and an explanation (C). The reader should understand what each input means without looking at the function signature.

**P6b. Use named inputs in formulas** — Write `=BALANCE-BASIS` not `=B3-B5`. Named inputs are more readable and self-documenting. Cell addresses are fine for nearby references within a calculation section, but inputs should always be referenced by name.

**P7. Result section** — Always include a dedicated `─── RESULT ───` section that summarizes outputs with simple pass-through formulas, separate from the working calculations. Use `'← OUTPUT` descriptions to mark them.

### Naming

**P8. UPPER_SNAKE_CASE everywhere** — Inputs, outputs, loop column headers, named ranges. No mixed case, no lowercase.
```
# Good
input TAXABLE_BALANCE 100000
header C TAXABLE_BALANCE_ENDING
name B21 WITHDRAWAL

# Bad
header C ending_taxable
```

**P9. Every output gets a semantic name** — Use the `name` command for all outputs, especially multi-output functions. Names should describe what the value is (`WITHDRAWAL`, `TAX`, `REMAINING_SHORTFALL`), not where it lives (`B21`).

**P10. Named ranges for distant references** — If a cell is referenced far from where it's defined (30+ rows away, or across column groups), give it a named range so formulas stay readable. If the reference is nearby and used once, a cell address is fine.
```
# Good: named range for distant reference
name H55 DIVISOR_LOOKUP
write B9 =DIVISOR_LOOKUP

# Bad: opaque cell address 46 rows away
write B9 =H55
```

### Multi-Output Functions

**P11. Call once, INDEX from result cell** — Call a multi-output function once into a result cell, then INDEX from that cell for each output you need.
```
# Good: one call, multiple INDEX reads
write B29 =PAY_FOR_EXPENSES(TAXABLE_BALANCE, TAXABLE_BASIS, B15, TAX_FREE_BALANCE, B24, B16, STRATEGY)
write B31 =INDEX(B29, "WITHDRAWAL")
write B32 =INDEX(B29, "TAX")
write B33 =INDEX(B29, "REMAINING_SHORTFALL")
```

**P12. Use string literals for INDEX keys** — Reference outputs by name directly in the INDEX call. Don't put the key string in a separate cell and reference that.
```
# Good: direct string literal
write B37 =INDEX(B34, "ENDING_CUSTOM")

# Bad: indirect via cell reference (legacy pattern, no longer necessary)
write G4 'ENDING_CUSTOM
write B37 =INDEX(B34, G4)
```

### Formatting

**P13. `default-format` for the dominant type** — Set the most common format (usually `currency 0`) as default, then only override exceptions. Never format every cell individually.

**P14. Format by semantic type** — Consistent rules:
- Money → `currency 0`
- Rates → `percent` (1-2 decimal places as appropriate)
- Ages, years, counts → `number 0`
- Proportions → `percent 1` or `percent 2`

### Testing

**P15. Test case comments** — Every test case has a comment explaining the scenario, not just raw numbers.
```
# Zero balance: can't withdraw anything
test "0, 10000, 0" "0, 0, 10000, 0"
```

**P16. Test coverage patterns** — Include:
- Normal/baseline case
- Zero values (zero balance, zero shortfall, zero return)
- Boundary conditions (bracket crossings, age cutoffs, first/last year)
- Insufficient/exhaustion scenarios
- Multiple strategies/modes if applicable

**P17. Independent test verification** — Expected values should come from an independent source: a reference implementation (Python, Excel), a hand calculation using a different method, or a published specification. The key is independence — the test must verify the spreadsheet against something other than itself. A reference implementation is ideal but not always available; an independent hand calculation is acceptable if it uses a different approach than the spreadsheet's formulas.

### Input Defaults

**P18. Realistic defaults** — Input defaults should be representative of a typical use case. `AGE 77`, `BALANCE 100000`, `SHORTFALL 10000` — these tell a plausible story and make readouts meaningful.

### Composition

**P19. Keep loop bodies simple** — Push complex per-iteration logic into custom functions. The loop should be purely mechanical: one function call per row, INDEX extraction, counter increment.

**P20. Display sheets are not functions** — Display sheets have no inputs and no outputs. Editable values are literal cell values in the grid (blue-highlighted), not function parameters. Users change cell values to try different scenarios. Use `highlight` for cell backgrounds (blue=editable inputs, yellow=key results, gray=headers), `style` for bold/font size. See RETIREMENT_SCENARIOS for the reference implementation.

### Visual Styling

**P21. Title styling on every sheet** — Row 1 title should use `style A1 bold` and `style A1 fontsize 24` (or appropriate large size). This applies to all sheets, not just display sheets. Follow the pattern established in RETIREMENT_SCENARIOS.

**P22. Heading backgrounds extend across columns** — Major section headings (gray) should highlight from A through G (e.g., `highlight A5 gray` through `highlight G5 gray`). Sub-headings (e.g., scenario labels) should extend from A through D. This creates visual hierarchy — major sections span the full width, minor sections are narrower.

**P23. Output callouts on all functions** — Mark output cells with `'← OUTPUT` (or `'← Amount you must withdraw this year`) in the description column. The pattern from WITHDRAW_TAXABLE should be used consistently across all functions, not just some. Makes it immediately clear which cells are the function's outputs.

### Layout Consistency

**P25. Blank row before every section header** — Every `─── SECTION NAME ───` header must have a blank row above it (except when it's the first content after the title/docstring). If five sections have blank rows and one doesn't, the missing one looks wrong — you don't need to check a rule to see it.

### Interface Design

**P26. Inputs match the caller's mental model** — Function inputs should use values that make sense to the person reading the spreadsheet, not values that are convenient for the implementation. If a parameter means "first year of retirement," the value should be 1, not 0. If the caller has to mentally translate (e.g., "0 means the first year"), the interface is leaking implementation details.

### Loop Sheets

**P27. Header all loop columns** — Give every loop column a descriptive header, not just output columns. Non-output columns (age, year counter, intermediate results) are visible in readouts and drilldowns. Unlabeled columns are opaque to the reader.

### 2D Layout

**P24. Side-by-side variants with shared labels** — When a sheet computes the same thing multiple ways (e.g., different withdrawal orderings, different strategies), put the variants side by side sharing one set of row labels. Don't stack them vertically with repeated labels.
```
# Good: shared labels, side-by-side values with spacer columns
#        A (labels)    B (Order 1)   C (spacer)   D (Order 2)   E (spacer)   F (Order 3)
write A14 'Taxable Withdrawal
write B14 =INDEX(B_ORDER1_RESULT, "WITHDRAWAL")
write D14 =INDEX(D_ORDER2_RESULT, "WITHDRAWAL")
write F14 =INDEX(F_ORDER3_RESULT, "WITHDRAWAL")

# Bad: repeated labels for each variant
write A14 'Taxable Withdrawal
write B14 =...
write D14 'Taxable Withdrawal    # ← repeated
write E14 =...
write A30 'Taxable Withdrawal    # ← repeated again, stacked below
write B30 =...
```
Use blank spacer columns between variants for visual separation.

### Package Composition

**P28. Every package needs a front door** — A package (zip) must include at least one display sheet that shows off the functions together. This is the first thing a user sees after importing. Functions are building blocks; the display sheet is the experience. The retirement suite's RETIREMENT_SCENARIOS is the reference: it calls the top-level function with different inputs, lets users edit values and compare results, and supports drill-down into the details.

**P29. Design from the front door backward** — Before building functions, think about the display sheet: what will a user see when they import this zip? What story does it tell? What can they interact with? Then build the functions that support that experience.

### Readability at the Call Site

**P30. No logic in function call arguments** — Function call arguments should be cell references, named inputs, or literal values. Never embed arithmetic expressions or hardcoded constants in the argument list. If you need `(B7+1)/2`, compute it in a labeled row first (`Average Die Roll = (B7+1)/2`), then pass the cell reference. This matters because function calls with multiple comma-separated arguments are already hard to parse — embedding logic in them forces the reader to simultaneously understand the function's interface and the inline computation.
```
# Good: each argument is a simple reference, reader sees what's being passed
write B13 =(B7+1)/2
write C13 'Average die roll: (die size + 1) / 2
write B14 =DPR_CALCULATOR(B5, B6, B13, B8, B10, B9, B11)

# Bad: expression and hardcoded constant buried in argument list
write B13 =DPR_CALCULATOR(B5, B6, (B7+1)/2, B8, 1, B9, B10)
```

**P31. Labels must distinguish scope** — When the same quantity appears at different scopes (per-attack vs per-round, monthly vs annual, single vs total), labels must make the scope explicit. "Expected Damage" is ambiguous when the sheet shows both single-attack and multi-attack results. "Expected Damage (Single Attack)" vs "Expected Damage (3 Attacks)" eliminates confusion.

### Comparison Sections

**P32. Comparisons must culminate in the difference** — When a section compares two quantities (actual vs expected, before vs after, plan vs reality), include a row that computes and highlights the difference. That's the payoff — it's what the reader is building toward. Don't highlight the individual quantities; highlight their comparison. The individual values are context; the difference is the conclusion.
```
# Good: comparison culminates in highlighted difference
write A31 'Actual Damage
write B31 =B28+D28+F28
write A32 'Expected Damage
write B32 =B18*3
write A33 'Difference
write B33 =B31-B32
write C33 'Positive = you rolled well, negative = below average
highlight B33 yellow
```

---

## Anti-Patterns (Don't Do This)

**AP1. Repeated function calls for different outputs** — Calling the same function with the same arguments multiple times just to extract different outputs.
```
# Bad: 4 identical calls
write B14 =INDEX(WITHDRAW_TAXABLE(BAL, SHORT, BASIS), "WITHDRAWAL")
write B15 =INDEX(WITHDRAW_TAXABLE(BAL, SHORT, BASIS), "TAX")
write B16 =INDEX(WITHDRAW_TAXABLE(BAL, SHORT, BASIS), "REMAINING_SHORTFALL")
write B17 =INDEX(WITHDRAW_TAXABLE(BAL, SHORT, BASIS), "BASIS_REDUCTION")
```
See P11 for the correct pattern.

**AP2. INDEX keys via cell reference** — Putting output name strings in cells and referencing those cells in INDEX. This was necessary before the engine supported string literals in INDEX, but is no longer needed.
```
# Bad: unnecessary indirection
write G4 'WITHDRAWAL
write B14 =INDEX(result, G4)
```
See P12 for the correct pattern.

**AP3. Mixed case naming** — Using lowercase or mixed case for inputs, outputs, or loop headers.
```
# Bad
header B ending_custom
header C ending_taxable
```

**AP4. Unnamed outputs** — Outputs identified only by cell address (`output B41`). Callers end up using opaque numeric indices or cell-address strings.

**AP5. No `default-format`** — Formatting every cell individually instead of setting a default and overriding exceptions. Results in 50+ format lines instead of 3-4.

**AP6. No docstring** — Starting directly with calculations or input display without explaining what the function does.

**AP7. No section headers** — A wall of writes without visual structure. Makes the script and the resulting spreadsheet hard to follow.

**AP8. No test case comments** — Raw test cases with no explanation of what scenario each one covers.

**AP9. Version indicators in function names** — Names like `PAY_FOR_EXPENSES_V2`, `ACCUMULATION_FULL`, `RETIREMENT_YEAR_FULL`. The published package is a finished product for a first-time audience. It should tell a cohesive story, not expose internal development history. Version history is what git is for. Use clean final names: `PAY_FOR_EXPENSES`, `ACCUMULATION`, `RETIREMENT_YEAR`. Script filenames can use whatever naming helps during development, but the function name (the `new` declaration) is what users see.

**AP10. Stacked variants with repeated labels** — When comparing multiple variants (orderings, strategies), stacking them vertically and repeating the row labels for each one wastes space and makes comparison harder. See P24 for the correct pattern.

**AP11. Logic embedded in function call arguments** — Arithmetic expressions or hardcoded constants inside function call parameter lists. Function calls are already complex to read with multiple comma-separated arguments. Embedding computation makes them opaque. See P30 for the correct pattern.

**AP12. Highlighting context instead of conclusions** — In a comparison section, highlighting the individual quantities (actual damage, expected damage) instead of their difference. The individual values are inputs to the comparison; the difference is the result. Highlight conclusions, not context. See P32 for the correct pattern.

---

## Review Process

Review each function in four passes. The order matters — earlier passes catch problems that would waste time in later passes.

### Pass 1: Structure

Outline the skeleton of the readout without looking at content. Map sections, row counts, and spacing:

```
Section 1 (rows 1-2): title + docstring
[blank]
Section 2 (rows 4-9): header + 5 data rows
[blank]
Section 3 (rows 11-16): header + 5 data rows
Section 4 (rows 18-...): header + ...     ← missing blank row
```

Check for consistency: same spacing pattern between all sections, balanced groupings, no orphaned rows. This catches rhythm/layout issues that are invisible when you're reading content.

### Pass 2: Narrate

**Story paragraph.** Summarize the function in one paragraph, as if explaining to someone unfamiliar (a 9th grader). If you can't fit it in one paragraph, the function is probably doing too much and should be decomposed into sub-functions.

**Section walkthrough.** Walk through each section's calculations in plain language. "The input YEAR is the year of retirement. We check if YEAR is less than 10..." If any explanation requires caveats, apologies, or programmer jargon ("...where 0 means the first year"), the implementation needs work.

**Docstring check.** Compare your story paragraph to the function's docstring (rows 1-2). If your narration is clearer or more accurate, the docstring should be updated to match.

Save the narration to `workfolders/<name>/review-notes.md`. This isn't a permanent artifact — delete it when the review work is complete and the user confirms they're done. But keeping it in the meantime means if a problem is spotted later, you can go back and see what you were thinking during review.

### Pass 3: Fresh Eyes

Read the readout like a user seeing it for the first time. No checklist, no rules — just look at it. Does the layout make sense? Does anything feel off? Is the story clear? Write down anything that seems wrong before moving to the checklist, so the checklist doesn't override your instincts.

### Pass 4: Reader Simulation

Walk through the sheet cell by cell as a learner — someone who doesn't already know the math and is drilling in to understand it. At each row ask:

- **Can I understand this formula from the value + description alone?** If the description says "Adjusted for advantage" but the formula is `1-(1-p)^2`, the reader learns *what* but not *how*. A description like `'Adv: 1 minus (both miss) = 1-(1-p)²` teaches the actual math.
- **Are function call arguments understandable?** Can I see what each argument represents, or do I need to look up the function signature and count parameters? Any embedded expressions or hardcoded constants?
- **Do comparison sections compare equivalent things?** Trace back from any summary/comparison row to its sources. Are they measuring the same thing at the same scope (same number of attacks, same time period, same units)?

This pass catches a different class of problems than the checklist — it catches places where the *math is correct* but the *teaching fails*.

### Pass 5: Checklist

Run through the patterns (P1-P32) and anti-patterns (AP1-AP12) systematically. This is the mechanical pass — it catches specific violations that the earlier passes might miss.

Also check that formatted values in the readout actually look right — the same way a person would glance at a spreadsheet and notice something off. A value showing `13.049999999999999` instead of `13.05`, or `7.5` where you'd expect `7.50`, means formatting isn't being applied correctly regardless of whether the format command is present in the script.

---

## Known Violations

### Retirement suite (all fixed)

All retirement suite scripts now conform to best practices.

### Excel functions (all fixed)

All Excel function scripts now conform to best practices (audit completed 2026-03-03).
