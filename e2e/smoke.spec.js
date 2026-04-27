import { test, expect } from '@playwright/test';
import { cell, formulaBar, setCell } from './helpers/spreadsheet.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('smoke', () => {
  test('app loads with grid and formula bar', async ({ page }) => {
    await expect(page.locator('table.spreadsheet-grid')).toBeVisible();
    await expect(formulaBar(page)).toBeVisible();
    await expect(cell(page, 'A1')).toBeVisible();
  });

  test('can type a value into a cell and see it in the formula bar', async ({ page }) => {
    await setCell(page, 'A1', '42');
    await cell(page, 'A1').click();
    await expect(formulaBar(page)).toHaveText('42');
  });
});
