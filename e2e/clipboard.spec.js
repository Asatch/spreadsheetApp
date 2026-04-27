import { test, expect } from '@playwright/test';
import {
  cell,
  fillDown,
  formulaBar,
  navigateTo,
  readCell,
  readSystemClipboard,
  selectCell,
  selectRange,
  setCell,
  writeSystemClipboard,
} from './helpers/spreadsheet.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// Run serially: the system clipboard is shared across Playwright workers, so a
// parallel test's Ctrl+C can corrupt this test's expected paste payload. The
// engine compares the external (system) clipboard's hash to its internal
// clipboard; on mismatch it falls through to pasteExternalData with whatever
// the system clipboard happens to hold at that instant.
test.describe.configure({ mode: 'serial' });

test.describe('clipboard', () => {
  test('copy/paste single value leaves source intact', async ({ page }) => {
    await setCell(page, 'A1', '42');

    await selectCell(page, 'A1');
    await page.keyboard.press('Control+C');

    await navigateTo(page, 'C3');
    await page.keyboard.press('Control+V');

    await expect.poll(() => readCell(page, 'C3')).toBe('42');
    // Copy is non-destructive — A1 still holds 42.
    await expect.poll(() => readCell(page, 'A1')).toBe('42');

    // System clipboard got written too — formatCellsForClipboard turns the
    // single cell into its raw value with no surrounding tabs/newlines.
    await expect(await readSystemClipboard(page)).toBe('42');
  });

  test('copy: omnibus formula shifts each token per its $ markers', async ({ page }) => {
    // One formula exercising every ref-adjustment branch in a single paste:
    //   A1     — fully relative: both row and col shift
    //   B$1    — col relative, row absolute (row stays at 1)
    //   $A2    — col absolute (col stays at A), row relative
    //   $B$1   — both absolute (unchanged)
    //   C3:D4  — range endpoints both shift
    //
    // Source at B5, paste at D8 → offset (+2 cols, +3 rows). Expected:
    //   A1     → C4
    //   B$1    → D$1
    //   $A2    → $A5
    //   $B$1   → $B$1
    //   C3:D4  → E6:F7
    await setCell(page, 'B5', '=A1+B$1+$A2+$B$1+SUM(C3:D4)');

    await selectCell(page, 'B5');
    await page.keyboard.press('Control+C');

    await navigateTo(page, 'D8');
    await page.keyboard.press('Control+V');

    await navigateTo(page, 'D8');
    await expect(formulaBar(page)).toHaveText('=C4+D$1+$A5+$B$1+SUM(E6:F7)');

    // Source unchanged.
    await navigateTo(page, 'B5');
    await expect(formulaBar(page)).toHaveText('=A1+B$1+$A2+$B$1+SUM(C3:D4)');
  });

  test('cut: refs preserved, source cleared, .cell-marked-for-cut visible, Escape cancels', async ({ page }) => {
    // Same omnibus formula. Cut moves rather than shifts: external refs stay
    // pointing at the same cells they did pre-cut.
    await setCell(page, 'B5', '=A1+B$1+$A2+$B$1+SUM(C3:D4)');

    // --- Sub-case 1: cut + paste ------------------------------------------
    await selectCell(page, 'B5');
    await page.keyboard.press('Control+X');

    // Cut marker appears on the source.
    await expect(cell(page, 'B5')).toHaveClass(/cell-marked-for-cut/);

    await navigateTo(page, 'D8');
    await page.keyboard.press('Control+V');

    // Marker cleared after paste.
    await expect(cell(page, 'B5')).not.toHaveClass(/cell-marked-for-cut/);

    // Refs unchanged — none of them point inside the cut range, so nothing shifts.
    await navigateTo(page, 'D8');
    await expect(formulaBar(page)).toHaveText('=A1+B$1+$A2+$B$1+SUM(C3:D4)');

    // Source emptied.
    await expect.poll(() => readCell(page, 'B5')).toBe('');

    // --- Sub-case 2: cut + Escape cancels ---------------------------------
    await setCell(page, 'A10', 'keep me');
    await selectCell(page, 'A10');
    await page.keyboard.press('Control+X');
    await expect(cell(page, 'A10')).toHaveClass(/cell-marked-for-cut/);

    await page.keyboard.press('Escape');
    await expect(cell(page, 'A10')).not.toHaveClass(/cell-marked-for-cut/);

    // Source still has its value (Escape cancels cut without clearing).
    await expect.poll(() => readCell(page, 'A10')).toBe('keep me');
  });

  test('cut updates external formulas and overwritten refs become #REF!', async ({ page }) => {
    // Setup:
    //   B1=10, B2=20      (cut source)
    //   D1=99             (will be pure-overwritten by paste destination)
    //   M1 = =B1+B2       (external formula — refs the source range)
    //   N1 = =D1          (external formula — refs the about-to-be-overwritten cell)
    await fillDown(page, 'B1', ['10', '20']);
    await setCell(page, 'D1', '99');
    await setCell(page, 'M1', '=B1+B2');
    await setCell(page, 'N1', '=D1');

    // Sanity baselines.
    await expect.poll(() => readCell(page, 'M1')).toBe('30');
    await expect.poll(() => readCell(page, 'N1')).toBe('99');

    // Cut B1:B2 → paste at D1 (overwrites D1=99, fills D2).
    await selectRange(page, 'B1', 'B2');
    await page.keyboard.press('Control+X');
    await navigateTo(page, 'D1');
    await page.keyboard.press('Control+V');

    // Source cleared.
    await expect.poll(() => readCell(page, 'B1')).toBe('');
    await expect.poll(() => readCell(page, 'B2')).toBe('');

    // Destination got the moved values.
    await expect.poll(() => readCell(page, 'D1')).toBe('10');
    await expect.poll(() => readCell(page, 'D2')).toBe('20');

    // External formula referencing source got rewritten to point at dest:
    //   =B1+B2 → =D1+D2, recomputes to 30.
    await navigateTo(page, 'M1');
    await expect(formulaBar(page)).toHaveText('=D1+D2');
    await expect.poll(() => readCell(page, 'M1')).toBe('30');

    // External formula referencing the pure-overwritten cell got promoted to
    // #REF! (D1 was overwritten and was not in the source range).
    await expect.poll(() => readCell(page, 'N1')).toBe('#REF!');
  });

  test('fill mode: single-cell copy tiles across a larger selection', async ({ page }) => {
    await setCell(page, 'A1', '7');

    await selectCell(page, 'A1');
    await page.keyboard.press('Control+C');

    // Select a 1×4 range — strictly larger than the 1×1 clipboard, so
    // paste enters fill mode and tiles.
    await selectRange(page, 'B1', 'B4');
    await page.keyboard.press('Control+V');

    for (const key of ['B1', 'B2', 'B3', 'B4']) {
      await expect.poll(() => readCell(page, key)).toBe('7');
    }
  });

  test('paste-values (Ctrl+Shift+V) writes computed values, not formulas', async ({ page }) => {
    await setCell(page, 'A1', '5');
    await setCell(page, 'B1', '=A1+1');
    await expect.poll(() => readCell(page, 'B1')).toBe('6');

    await selectCell(page, 'B1');
    await page.keyboard.press('Control+C');

    await navigateTo(page, 'D1');
    await page.keyboard.press('Control+Shift+V');

    // Display value matches.
    await expect.poll(() => readCell(page, 'D1')).toBe('6');

    // Stored value is the literal 6, not =A1+1 (which would have shifted to
    // =C1+1 on a normal paste — and broken if A1 changed).
    await navigateTo(page, 'D1');
    await expect(formulaBar(page)).toHaveText('6');

    // Independence check: changing A1 should NOT cascade into D1.
    await setCell(page, 'A1', '99');
    await expect.poll(() => readCell(page, 'B1')).toBe('100');
    await expect.poll(() => readCell(page, 'D1')).toBe('6');
  });

  test('range copy: every cell shifts independently, $ refs stay anchored', async ({ page }) => {
    // 2×2 source at B5:C6 with mixed content. Each cell verifies a different
    // shifting branch when the range moves to a new offset.
    //   B5: literal              (no shifting work)
    //   C5: =B5*2                (relative ref INSIDE source — relocates with the move)
    //   B6: =$A$1+1              (absolute ref OUTSIDE source — stays put)
    //   C6: =B5+B6               (two relative refs INSIDE source — both relocate)
    //
    // A1 carries a value so the absolute-ref formula has a real number to read back.
    await setCell(page, 'A1', '100');
    await setCell(page, 'B5', '10');
    await setCell(page, 'C5', '=B5*2');
    await setCell(page, 'B6', '=$A$1+1');
    await setCell(page, 'C6', '=B5+B6');

    await selectRange(page, 'B5', 'C6');
    await page.keyboard.press('Control+C');

    // Paste at E10 → offset (+3 cols, +5 rows). In-source refs slide to the
    // new home; the $A$1 absolute external ref doesn't budge.
    await navigateTo(page, 'E10');
    await page.keyboard.press('Control+V');

    await navigateTo(page, 'E10');
    await expect(formulaBar(page)).toHaveText('10');

    await navigateTo(page, 'F10');
    await expect(formulaBar(page)).toHaveText('=E10*2');

    await navigateTo(page, 'E11');
    await expect(formulaBar(page)).toHaveText('=$A$1+1');

    await navigateTo(page, 'F11');
    await expect(formulaBar(page)).toHaveText('=E10+E11');

    // Computed values follow:
    //   E10 = 10
    //   F10 = E10*2 = 20
    //   E11 = $A$1+1 = 101
    //   F11 = E10+E11 = 111
    await expect.poll(() => readCell(page, 'E10')).toBe('10');
    await expect.poll(() => readCell(page, 'F10')).toBe('20');
    await expect.poll(() => readCell(page, 'E11')).toBe('101');
    await expect.poll(() => readCell(page, 'F11')).toBe('111');
  });

  test('fill mode: 2×2 pattern tiles via modulo across a 2×4 selection', async ({ page }) => {
    // Pattern source at A1:B2 — distinct values per cell so we can see the
    // tile boundaries in the result.
    await setCell(page, 'A1', '1');
    await setCell(page, 'B1', '2');
    await setCell(page, 'A2', '3');
    await setCell(page, 'B2', '4');

    await selectRange(page, 'A1', 'B2');
    await page.keyboard.press('Control+C');

    // 2×4 destination — exactly twice as tall as the source. prepareFillModePaste
    // tiles via (offsetRow % clipRows, offsetCol % clipCols), so D1:E4 should
    // come out as two stacked copies of the pattern.
    await selectRange(page, 'D1', 'E4');
    await page.keyboard.press('Control+V');

    const expected = {
      D1: '1', E1: '2',
      D2: '3', E2: '4',
      D3: '1', E3: '2',
      D4: '3', E4: '4',
    };
    for (const [key, value] of Object.entries(expected)) {
      await expect.poll(() => readCell(page, key)).toBe(value);
    }
  });

  test('cut + paste with overlapping destination slides values down without #REF!', async ({ page }) => {
    // Cut B1:B3, paste at B2. Destination B2:B4 overlaps source on B2 and B3.
    //   - B1 is source-only → gets cleared.
    //   - B2 and B3 are in BOTH source and destination → overwritten by the
    //     moved values, NOT cleared (clearCutSourceCells skips overlap cells).
    //   - B4 is dest-only and was empty → just gets the trailing moved value.
    // Net effect: the column slides down by one row.
    await fillDown(page, 'B1', ['10', '20', '30']);

    await selectRange(page, 'B1', 'B3');
    // Sanity: shift-click selected the full B1:B3 range, anchor stays at B1.
    await expect(page.locator('.cell-name-display')).toHaveValue('B1:B3');
    await page.keyboard.press('Control+X');
    await navigateTo(page, 'B2');
    await expect(page.locator('.active-cell')).toHaveAttribute('id', 'B2');
    await page.keyboard.press('Control+V');

    await expect.poll(() => readCell(page, 'B1')).toBe('');
    await expect.poll(() => readCell(page, 'B2')).toBe('10');
    await expect.poll(() => readCell(page, 'B3')).toBe('20');
    await expect.poll(() => readCell(page, 'B4')).toBe('30');
  });

  // Cut+paste with overlap, where a moving formula's reference target is itself
  // a cell in the cut block. adjustTokenReferences runs its overwritten-cells
  // pass (which promotes refs to #REF!) BEFORE its relocation pass — so when
  // source ∩ destination contains the ref target, the ref is nuked instead of
  // being relocated with the block. Scenario A is the baseline (ref target
  // stays outside the destination range, so the bug doesn't fire); B and C
  // both put the ref target inside the destination range and currently fail.
  //
  // Shared setup: A2=3, A3==A2*3. The intra-block reference is A3→A2.

  test('cut overlap A: ref target outside dest, formula relocates correctly', async ({ page }) => {
    // A2:A3 cut → paste at A3. Dest = A3:A4. Ref target A2 is dest-external.
    await setCell(page, 'A2', '3');
    await setCell(page, 'A3', '=A2*3');

    await selectRange(page, 'A2', 'A3');
    await page.keyboard.press('Control+X');
    await navigateTo(page, 'A3');
    await page.keyboard.press('Control+V');

    await expect.poll(() => readCell(page, 'A3')).toBe('3');
    await expect.poll(() => readCell(page, 'A4')).toBe('9');
    await navigateTo(page, 'A4');
    await expect(formulaBar(page)).toHaveText('=A3*3');
  });

  test('cut overlap B: ref target inside dest, formula must relocate not #REF!', async ({ page }) => {
    // A2:A3 cut → paste at A1. Dest = A1:A2. Ref target A2 is in BOTH source
    // and destination — formula should relocate A2→A1, not become #REF!.
    await setCell(page, 'A2', '3');
    await setCell(page, 'A3', '=A2*3');

    await selectRange(page, 'A2', 'A3');
    await page.keyboard.press('Control+X');
    await navigateTo(page, 'A1');
    await page.keyboard.press('Control+V');

    await expect.poll(() => readCell(page, 'A1')).toBe('3');
    await expect.poll(() => readCell(page, 'A2')).toBe('9');
    await navigateTo(page, 'A2');
    await expect(formulaBar(page)).toHaveText('=A1*3');
  });

  test('cut overlap C: blank head + ref target inside dest, formula must relocate', async ({ page }) => {
    // A1 left blank, A2=3, A3==A2*3. Cut A1:A3 → paste at A2. Dest = A2:A4.
    // Ref target A2 is again in source ∩ destination; formula should relocate
    // A2→A3 (offset +1), so A4 ends up `=A3*3` evaluating to 9.
    await setCell(page, 'A2', '3');
    await setCell(page, 'A3', '=A2*3');

    await selectRange(page, 'A1', 'A3');
    await page.keyboard.press('Control+X');
    await navigateTo(page, 'A2');
    await page.keyboard.press('Control+V');

    await expect.poll(() => readCell(page, 'A2')).toBe('');
    await expect.poll(() => readCell(page, 'A3')).toBe('3');
    await expect.poll(() => readCell(page, 'A4')).toBe('9');
    await navigateTo(page, 'A4');
    await expect(formulaBar(page)).toHaveText('=A3*3');
  });

  test('external TSV paste expands across cells', async ({ page }) => {
    // Simulate a paste from another spreadsheet app: tab-separated columns,
    // newline-separated rows. Internal clipboard is empty (fresh page), so
    // paste falls through to pasteExternalData.
    await writeSystemClipboard(page, '1\t2\n3\t4');

    await selectCell(page, 'A1');
    await page.keyboard.press('Control+V');

    await expect.poll(() => readCell(page, 'A1')).toBe('1');
    await expect.poll(() => readCell(page, 'B1')).toBe('2');
    await expect.poll(() => readCell(page, 'A2')).toBe('3');
    await expect.poll(() => readCell(page, 'B2')).toBe('4');
  });
});
