import { defineConfig, devices } from '@playwright/test';

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 5000,
    // Clipboard tests need to read/write the system clipboard via
    // navigator.clipboard. Chromium gates this behind a permission;
    // granting it here so tests don't have to per-context.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  expect: {
    timeout: 5000,
  },

  // Default runs use `--project=chromium` (see package.json scripts).
  // Playwright's synthetic keyboard events don't flow through the app's
  // `beforeinput`-preventDefault formula-bar routing in Firefox/WebKit the
  // same way they do in Chromium (manual Firefox works fine). Opt in with
  // `npx playwright test --project=firefox` when debugging cross-browser.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run dev:test',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
