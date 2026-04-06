import { defineConfig } from 'cypress';
import registerCypressGrep from '@cypress/grep/src/plugin.js';

export default defineConfig({
  // Global configuration options
  watchForFileChanges: false, // Disable file watching at the global level
  defaultCommandTimeout: 500, // Fast timeout - UI should be instant

  e2e: {
    baseUrl: 'http://localhost:3456', // Default value, can be overridden via command line
    setupNodeEvents(on, config) {
      // No need to kill ports since we use a dedicated port for testing
      
      // Add a custom task to log browser console logs to terminal
      on('task', {
        log(message) {
          console.log(message);
          return null;
        }
      });
      
      // Register cypress-grep plugin
      registerCypressGrep(config);
      return config;
    },
    specPattern: 'cypress/e2e/**/*.{cy,spec}.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.js',
    // Configure downloads behavior
    downloadsFolder: 'cypress/downloads',
  },
  video: false, // Disable video recording by default, can be enabled with --config
  screenshotOnRunFailure: true,
  videosFolder: 'cypress/videos',
  videoCompression: 32, // Better quality for debugging
});