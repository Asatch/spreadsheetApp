/**
 * Shared helpers for spreadsheet e2e tests.
 *
 * Locators (`cell`, `formulaBar`) are cheap — compose them with Playwright's
 * `expect(...)` for assertions. Actions (`selectCell`, `setCell`) drive the
 * app through the same code paths a real user hits (click → beforeinput
 * routes typing into the formula bar → Enter commits).
 *
 * Prefer `navigateTo` (arrow-based) over `selectCell` when you just need
 * the active cell to land somewhere — clicks can trip the grid's 300ms
 * double-click detector when the same cell is clicked twice, which silently
 * focuses the formula bar and eats subsequent keystrokes. Use `selectCell`
 * when you're specifically testing click behavior.
 */

export function cell(page, key) {
  return page.locator(`#${key}`);
}

export function formulaBar(page) {
  return page.locator('.formula-input');
}

export function activeCell(page) {
  return page.locator('.active-cell');
}

// Cell-reference/name input (top-left of formula bar). Shows "A1" for a single
// cell, "A1:C3" for a range, or a named-range name if one matches.
export function cellName(page) {
  return page.locator('.cell-name-display');
}

export async function selectCell(page, key) {
  await cell(page, key).click();
}

// Navigate to a cell via arrow keys from the current active cell. Deterministic
// regardless of prior focus state; no double-click quirks. Assumes single-letter
// columns (A–O) — the default grid bounds.
export async function navigateTo(page, key) {
  const current = await activeCell(page).getAttribute('id');
  const [, curCol, curRow] = current.match(/^([A-Z])(\d+)$/);
  const [, tgtCol, tgtRow] = key.match(/^([A-Z])(\d+)$/);

  const colDelta = tgtCol.charCodeAt(0) - curCol.charCodeAt(0);
  const rowDelta = parseInt(tgtRow, 10) - parseInt(curRow, 10);

  const colDir = colDelta > 0 ? 'ArrowRight' : 'ArrowLeft';
  for (let i = 0; i < Math.abs(colDelta); i++) await page.keyboard.press(colDir);
  const rowDir = rowDelta > 0 ? 'ArrowDown' : 'ArrowUp';
  for (let i = 0; i < Math.abs(rowDelta); i++) await page.keyboard.press(rowDir);
}

// A small per-key delay keeps chars from racing the grid→formula-bar focus
// transition when the first char is `=`. Without it, chars typed during the
// transition fall into `handleInputFromGrid`'s fallback path, which replaces
// the text node and invalidates the caret — so subsequent native inserts get
// dropped. Real users never type fast enough to hit this.
const KEY_DELAY_MS = 15;

export async function setCell(page, key, value) {
  // Arrow-navigate rather than click, so lastClickCell isn't left pointing
  // at this cell — otherwise a subsequent click on the same cell within
  // 300ms trips the grid's double-click detector (which clears state and
  // forces commit-and-open).
  await navigateTo(page, key);
  await page.keyboard.type(value, { delay: KEY_DELAY_MS });
  await page.keyboard.press('Enter');
}

export async function fillDown(page, startKey, values) {
  await navigateTo(page, startKey);
  for (const value of values) {
    await page.keyboard.type(String(value), { delay: KEY_DELAY_MS });
    await page.keyboard.press('Enter');
  }
}

// Select a rectangular range by clicking the anchor cell, then shift-clicking
// the opposite corner. The cell-name display will reflect the range.
export async function selectRange(page, startKey, endKey) {
  await cell(page, startKey).click();
  await cell(page, endKey).click({ modifiers: ['Shift'] });
}

// Write plain text to the system clipboard from a page context. Used to
// simulate an external paste (e.g., TSV from another spreadsheet app).
export async function writeSystemClipboard(page, text) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

export async function readSystemClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

export async function readCell(page, key) {
  // Cells render their display value via a `::before` pseudo-element fed by
  // the `--cell-value` CSS custom property. The TD's own textContent is kept
  // empty because typing routes through `beforeinput` into the formula bar.
  return cell(page, key).evaluate((el) => {
    const raw = el.style.getPropertyValue('--cell-value').trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return raw;
  });
}
