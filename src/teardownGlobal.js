// src/teardownGlobal.js

/**
 * Jest Global Teardown
 *
 * This function runs once after all test suites have completed.
 * It ensures that any remaining handles are properly cleaned up
 * to prevent the "Force exiting Jest" warning.
 */
export default async () => {
  // Clean up any global mocks
  if (console.originalLog) {
    console.log = console.originalLog;
  }
  if (console.originalWarn) {
    console.warn = console.originalWarn;
  }
  if (console.originalError) {
    console.error = console.originalError;
  }

  // Give the event loop a chance to clear any pending tasks
  await new Promise(resolve => setTimeout(resolve, 100));
};