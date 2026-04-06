import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock console methods to reduce test output
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Simple approach: If running npm test with ANY additional arguments after --,
// show console logs (useful for debugging specific tests)
// Only suppress for plain "npm test" or "npm run test:ci"
const npmArgs = process.env.npm_config_argv ? JSON.parse(process.env.npm_config_argv) : {};
const hasTestArguments = npmArgs.remain && npmArgs.remain.length > 0;

// Suppress logs only for full test runs without arguments
const shouldSuppressLogs = !hasTestArguments &&
  process.env.TEST_VERBOSITY !== 'verbose' ||
  process.env.TEST_VERBOSITY === 'quiet';

// During tests, mute verbose logs but allow errors to surface
if (process.env.NODE_ENV === 'test' && shouldSuppressLogs) {
  console.log = vi.fn();
  console.warn = vi.fn();
  // Leave console.error intact for assertion failures
}

// Make the original methods available if needed
console.originalLog = originalConsoleLog;
console.originalWarn = originalConsoleWarn;
console.originalError = originalConsoleError;