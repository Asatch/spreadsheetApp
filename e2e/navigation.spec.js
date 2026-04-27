import { test, expect } from '@playwright/test';
import { activeCell, cell, cellName, fillDown, formulaBar, navigateTo, readCell, selectCell, setCell } from './helpers/spreadsheet.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('navigation', () => {
  test('keyboard, click, and formula-bar sync', async ({ page }) => {
    // fillDown starts at A1 and presses Enter after each value, so active
    // should land on A4 after three values. That implicitly verifies
    // "Enter after commit moves down".
    await fillDown(page, 'A1', ['hello', '42', '=A2*2']);
    await expect(activeCell(page)).toHaveAttribute('id', 'A4');

    // Arrow-up walks back through populated cells; formula bar should sync
    // to each cell's stored content (formula, not computed value).
    await page.keyboard.press('ArrowUp');
    await expect(activeCell(page)).toHaveAttribute('id', 'A3');
    await expect(formulaBar(page)).toHaveText('=A2*2');

    await page.keyboard.press('ArrowUp');
    await expect(activeCell(page)).toHaveAttribute('id', 'A2');
    await expect(formulaBar(page)).toHaveText('42');

    await page.keyboard.press('ArrowUp');
    await expect(activeCell(page)).toHaveAttribute('id', 'A1');
    // String literals render in the formula bar with a leading apostrophe
    // (canonical form), even though the cell itself displays just "hello".
    await expect(formulaBar(page)).toHaveText("'hello");
    await expect.poll(() => readCell(page, 'A1')).toBe('hello');

    // Top-left boundaries — ArrowUp/ArrowLeft at A1 are no-ops.
    await page.keyboard.press('ArrowUp');
    await expect(activeCell(page)).toHaveAttribute('id', 'A1');
    await page.keyboard.press('ArrowLeft');
    await expect(activeCell(page)).toHaveAttribute('id', 'A1');

    // Arrow right / left.
    await page.keyboard.press('ArrowRight');
    await expect(activeCell(page)).toHaveAttribute('id', 'B1');
    await page.keyboard.press('ArrowLeft');
    await expect(activeCell(page)).toHaveAttribute('id', 'A1');

    // Click to jump to an empty cell — formula bar clears.
    await selectCell(page, 'D5');
    await expect(activeCell(page)).toHaveAttribute('id', 'D5');
    await expect(formulaBar(page)).toHaveText('');

    // Click back to a populated cell.
    await selectCell(page, 'A2');
    await expect(formulaBar(page)).toHaveText('42');

    // Tab / Shift+Tab move right / left.
    await page.keyboard.press('Tab');
    await expect(activeCell(page)).toHaveAttribute('id', 'B2');
    await page.keyboard.press('Shift+Tab');
    await expect(activeCell(page)).toHaveAttribute('id', 'A2');

    // Home: jump to column A of current row (from a non-A column).
    await selectCell(page, 'D5');
    await page.keyboard.press('Home');
    await expect(activeCell(page)).toHaveAttribute('id', 'A5');

    // Ctrl+Home: jump to A1 from anywhere. We deliberately don't re-click
    // D5 here — the grid's double-click detector (300ms same-cell window)
    // would fire off of the earlier selectCell(D5), focus the formula bar,
    // and mark the pointer as handled, which would eat this Ctrl+Home.
    await page.keyboard.press('Control+Home');
    await expect(activeCell(page)).toHaveAttribute('id', 'A1');

    // Right boundary — default grid maxCol is 'O'. ArrowRight at O1 is a no-op.
    await selectCell(page, 'O1');
    await page.keyboard.press('ArrowRight');
    await expect(activeCell(page)).toHaveAttribute('id', 'O1');

    // Bottom boundary — default grid maxRow is 30. ArrowDown at A30 is a no-op.
    await selectCell(page, 'A30');
    await page.keyboard.press('ArrowDown');
    await expect(activeCell(page)).toHaveAttribute('id', 'A30');

    // Sanity: computed value of the formula cell is visible in the grid.
    await expect.poll(() => readCell(page, 'A3')).toBe('84');
  });

  test('shift-arrow and shift-home range selection', async ({ page }) => {
    // Single click shows notation as the lone cell key.
    await selectCell(page, 'B2');
    await expect(cellName(page)).toHaveValue('B2');

    // Shift+Arrow extends the selection; cell-name display reflects range.
    await page.keyboard.press('Shift+ArrowRight');
    await expect(cellName(page)).toHaveValue('B2:C2');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(cellName(page)).toHaveValue('B2:C3');

    // All four cells in B2:C3 carry the selected-cell class.
    await expect(page.locator('.selected-cell')).toHaveCount(4);

    // Contract the selection back up — end moves from C3 to C2.
    await page.keyboard.press('Shift+ArrowUp');
    await expect(cellName(page)).toHaveValue('B2:C2');

    // Shift+Home extends to column A of the selection's rows.
    await page.keyboard.press('Shift+Home');
    await expect(cellName(page)).toHaveValue('A2:B2');

    // Clicking a single cell collapses selection back to one.
    await selectCell(page, 'D5');
    await expect(cellName(page)).toHaveValue('D5');
    await expect(page.locator('.selected-cell')).toHaveCount(1);

    // Shift+click extends selection from the current active cell to the
    // clicked cell. D5 is active → shift-click F7 selects D5:F7.
    await cell(page, 'F7').click({ modifiers: ['Shift'] });
    await expect(cellName(page)).toHaveValue('D5:F7');
    await expect(page.locator('.selected-cell')).toHaveCount(9);

    // Drag-select: press on a fresh cell and drag to another. The grid's
    // pointermove crosses the 5px threshold and switches into drag mode,
    // extending selection to every cell the pointer enters.
    // Note: don't use the most-recently-clicked cell as the drag origin —
    // a pointerdown on that cell within 300ms is treated as a double-click
    // and focuses the formula bar instead of starting a drag.
    const startBox = await cell(page, 'A8').boundingBox();
    const endBox = await cell(page, 'C10').boundingBox();
    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(cellName(page)).toHaveValue('A8:C10');
    await expect(page.locator('.selected-cell')).toHaveCount(9);
  });

  test('focus transitions via Enter, F2, double-click, Escape', async ({ page }) => {
    // Seed a cell so F2 has something to reveal.
    await setCell(page, 'B2', '123');

    // Enter on an empty cell focuses the formula bar (select-all mode — no
    // visible change for an empty cell, but focus moves).
    await selectCell(page, 'A1');
    await expect(cell(page, 'A1')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(formulaBar(page)).toBeFocused();

    // Escape returns focus to the grid cell without committing anything.
    await page.keyboard.press('Escape');
    await expect(cell(page, 'A1')).toBeFocused();
    await expect.poll(() => readCell(page, 'A1')).toBe('');

    // F2 on a populated cell loads it into the formula bar for editing.
    await selectCell(page, 'B2');
    await page.keyboard.press('F2');
    await expect(formulaBar(page)).toBeFocused();
    await expect(formulaBar(page)).toHaveText('123');

    // Escape reverts to original value and returns focus to the grid.
    await page.keyboard.press('Escape');
    await expect(cell(page, 'B2')).toBeFocused();
    await expect.poll(() => readCell(page, 'B2')).toBe('123');

    // Double-click picks the cell AND focuses the formula bar in one gesture.
    await cell(page, 'C3').dblclick();
    await expect(activeCell(page)).toHaveAttribute('id', 'C3');
    await expect(formulaBar(page)).toBeFocused();
  });

  test('commit-and-navigate directions (Enter, Shift+Enter, Tab, Shift+Tab)', async ({ page }) => {
    // Plain Enter after typing commits and moves DOWN. setCell already does
    // type+Enter, so we reuse it and verify the landing cell.
    await setCell(page, 'A1', '10');
    await expect(activeCell(page)).toHaveAttribute('id', 'A2');
    await expect.poll(() => readCell(page, 'A1')).toBe('10');

    // Shift+Enter commits and moves UP.
    await navigateTo(page, 'B3');
    await page.keyboard.type('20', { delay: 15 });
    await page.keyboard.press('Shift+Enter');
    await expect(activeCell(page)).toHaveAttribute('id', 'B2');
    await expect.poll(() => readCell(page, 'B3')).toBe('20');

    // Tab commits and moves RIGHT.
    await navigateTo(page, 'C5');
    await page.keyboard.type('30', { delay: 15 });
    await page.keyboard.press('Tab');
    await expect(activeCell(page)).toHaveAttribute('id', 'D5');
    await expect.poll(() => readCell(page, 'C5')).toBe('30');

    // Shift+Tab commits and moves LEFT (use a fresh area so prior values
    // don't interfere).
    await navigateTo(page, 'F7');
    await page.keyboard.type('40', { delay: 15 });
    await page.keyboard.press('Shift+Tab');
    await expect(activeCell(page)).toHaveAttribute('id', 'E7');
    await expect.poll(() => readCell(page, 'F7')).toBe('40');
  });

  test('reference picking — click picks cells, Escape reverts', async ({ page }) => {
    await setCell(page, 'A1', '5');
    await setCell(page, 'A2', '10');

    // Enter formula mode in B1 by typing `=`.
    await selectCell(page, 'B1');
    await page.keyboard.type('=', { delay: 15 });
    await expect(formulaBar(page)).toHaveText('=');
    await expect(formulaBar(page)).toBeFocused();

    // Click A1 — grid pointerup sees formulaEditingMode=true and inserts
    // `A1` as a reference. Focus moves from formula bar to the grid
    // (reference picking state).
    await cell(page, 'A1').click();
    await expect(formulaBar(page)).toHaveText('=A1');
    await expect(cell(page, 'A1')).toBeFocused();

    // Typing during picking routes through the grid's beforeinput and
    // inserts at referenceEnd. The `+` appends after A1.
    await page.keyboard.type('+', { delay: 15 });
    await expect(formulaBar(page)).toHaveText('=A1+');

    // Click a second cell — second reference inserted after the operator.
    await cell(page, 'A2').click();
    await expect(formulaBar(page)).toHaveText('=A1+A2');

    // Committing from picking takes TWO Enters: the first kicks focus back
    // to the formula bar, the second runs exitEditingAndMove('down') which
    // commits and moves.
    await page.keyboard.press('Enter');
    await expect(formulaBar(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(activeCell(page)).toHaveAttribute('id', 'B2');
    await expect.poll(() => readCell(page, 'B1')).toBe('15');

    // Escape reverts a picking session to its saved pre-pick formula text.
    // Start a fresh formula in C1 and pick A1, then Escape back to just `=`.
    await selectCell(page, 'C1');
    await page.keyboard.type('=', { delay: 15 });
    await cell(page, 'A1').click();
    await expect(formulaBar(page)).toHaveText('=A1');

    await page.keyboard.press('Escape');
    await expect(formulaBar(page)).toHaveText('=');
    await expect(formulaBar(page)).toBeFocused();
  });

  test('reference picking — arrow-based picking and shift+arrow range extension', async ({ page }) => {
    // Seed A2 and A3 so SUM has something to add.
    await fillDown(page, 'A2', ['5', '10']);
    await navigateTo(page, 'A1');

    // Type the start of a function call. Caret lands after `(`, a picking-
    // valid boundary.
    await page.keyboard.type('=SUM(', { delay: 15 });
    await expect(formulaBar(page)).toHaveText('=SUM(');

    // ArrowDown from the formula bar exits to picking mode and steps the
    // selection anchor down from A1 → A2. insertReference writes A2 at
    // referenceEnd.
    await page.keyboard.press('ArrowDown');
    await expect(formulaBar(page)).toHaveText('=SUM(A2');
    // Focus moves to the just-picked cell (A2), even though .active-cell
    // class stays on A1 (the cell whose formula is being composed).
    await expect(cell(page, 'A2')).toBeFocused();

    // Shift+ArrowDown in picking mode extends selection to a range, and
    // insertReference writes it in range notation.
    await page.keyboard.press('Shift+ArrowDown');
    await expect(formulaBar(page)).toHaveText('=SUM(A2:A3');

    // Close the paren and commit via two Enters (§9.3 pattern).
    await page.keyboard.type(')', { delay: 15 });
    await expect(formulaBar(page)).toHaveText('=SUM(A2:A3)');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await expect.poll(() => readCell(page, 'A1')).toBe('15');
  });

  test('double-click during picking commits revert-value to original cell and opens new cell', async ({ page }) => {
    await setCell(page, 'A2', '10');
    await navigateTo(page, 'A1');
    await page.keyboard.type('=', { delay: 15 });

    // Click A2 to enter picking. savedValueBeforePicking = '=' is stashed
    // at blur; after the pick formula bar shows '=A2'.
    await cell(page, 'A2').click();
    await expect(formulaBar(page)).toHaveText('=A2');

    // Double-click an unrelated cell (C3). Per §9.5: the grid's double-click
    // branch calls revertReferencePicking (→ formula bar '='), then
    // commitFormulaBarCell (commits '=' to A1, the cell we were editing),
    // then setActiveCell(C3) + focusFormulaBar to open C3.
    await cell(page, 'C3').dblclick();
    await expect(activeCell(page)).toHaveAttribute('id', 'C3');
    await expect(formulaBar(page)).toBeFocused();
    await expect(formulaBar(page)).toHaveText('');

    // Verify the committed value on A1 is the reverted pre-pick text (`=`),
    // not the `=A2` that was in the bar right before the double-click.
    // Escape the open C3 edit session back to the grid, then navigate + F2.
    await page.keyboard.press('Escape');
    await navigateTo(page, 'A1');
    await page.keyboard.press('F2');
    await expect(formulaBar(page)).toHaveText('=');
  });

  test('commit via blur on non-grid target', async ({ page }) => {
    // Type a value WITHOUT pressing Enter — the formula bar still holds it
    // uncommitted.
    await selectCell(page, 'A1');
    await page.keyboard.type('hello', { delay: 15 });
    await expect(formulaBar(page)).toHaveText('hello');

    // Clicking a toolbar button (relatedTarget is not a gridcell) falls
    // through to the commit branch of handleBlur — §8.3.
    await page.getByRole('button', { name: 'Align center' }).click();

    await expect.poll(() => readCell(page, 'A1')).toBe('hello');
  });

  test('clicking a cell with the caret inside a ref token replaces that token', async ({ page }) => {
    // Put a two-ref formula into C1.
    await setCell(page, 'C1', '=A1+B2');

    // Re-open the formula for editing; F2 places the caret at the end.
    await navigateTo(page, 'C1');
    await page.keyboard.press('F2');
    await expect(formulaBar(page)).toHaveText('=A1+B2');

    // ArrowLeft once — caret now sits between 'B' and '2', strictly inside
    // the B2 token. Per §6.2 bullet 2, the picking bounds expand to the
    // whole token so the next pick REPLACES rather than inserts.
    await page.keyboard.press('ArrowLeft');

    await cell(page, 'D4').click();
    await expect(formulaBar(page)).toHaveText('=A1+D4');
  });

  test('Escape in formula-bar editing reverts to original value', async ({ page }) => {
    await setCell(page, 'A1', 'original');

    // Re-open for editing.
    await navigateTo(page, 'A1');
    await page.keyboard.press('F2');
    // Canonical form shown in the bar is leading-apostrophe for strings.
    await expect(formulaBar(page)).toHaveText("'original");

    // Append some chars.
    await page.keyboard.type(' edit', { delay: 15 });
    await expect(formulaBar(page)).toHaveText("'original edit");

    // Escape calls revertValue: restores originalValue snapshot, exits
    // formula mode, returns focus to the grid. The cell's stored value
    // is unchanged.
    await page.keyboard.press('Escape');
    await expect(cell(page, 'A1')).toBeFocused();
    await expect.poll(() => readCell(page, 'A1')).toBe('original');
  });
});
