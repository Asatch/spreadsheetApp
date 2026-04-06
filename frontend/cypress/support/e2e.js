// ***********************************************************
// This support file is processed and loaded automatically before your test files.
//
// This support file does things like:
// - Setting up global behavior for Cypress
// - Adding custom commands to Cypress
// ***********************************************************

// Import custom commands
import './commands/spreadsheet';

// Import cypress-grep support
import '@cypress/grep';

// Array to store console logs
let consoleLogs = [];

// Configure global behavior
Cypress.on('uncaught:exception', (err, runnable) => {
  // Returning false here prevents Cypress from failing the test on uncaught exceptions
  // This is useful for applications that might have some non-critical errors
  return false;
});

// Capture console logs and grant clipboard permissions
Cypress.on('window:before:load', (win) => {
  // Clear logs for each new test
  consoleLogs = [];
  
  // Grant clipboard permissions when window loads
  try {
    // Mock clipboard API and execCommand to always work
    win.navigator.clipboard = {
      writeText: () => Promise.resolve(),
      readText: () => Promise.resolve(''),
      write: () => Promise.resolve(),
      read: () => Promise.resolve([])
    };
    
    const originalExecCommand = win.document.execCommand;
    win.document.execCommand = function(command, showUI, value) {
      if (command === 'copy' || command === 'cut' || command === 'paste') {
        return true;
      }
      return originalExecCommand.call(this, command, showUI, value);
    };
  } catch (error) {
    // Ignore errors
  }
  
  // Capture console.log
  const originalLog = win.console.log;
  win.console.log = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    consoleLogs.push(`LOG: ${message}`);
    
    // Don't use cy.task directly in console method overrides
    // Instead, log to console for debugging
    originalLog.apply(win.console, [`[CAPTURED]: ${message}`]);
    
    // Queue the message for later processing
    Cypress.queueConsoleLog(`BROWSER CONSOLE: ${message}`);
    
    originalLog.apply(win.console, args);
  };
  
  // Capture console.warn
  const originalWarn = win.console.warn;
  win.console.warn = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    consoleLogs.push(`WARN: ${message}`);
    
    // Queue the warning for later processing
    Cypress.queueConsoleLog(`BROWSER WARN: ${message}`);
    
    originalWarn.apply(win.console, args);
  };
  
  // Capture console.error
  const originalError = win.console.error;
  win.console.error = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    consoleLogs.push(`ERROR: ${message}`);
    
    // Queue the error for later processing
    Cypress.queueConsoleLog(`BROWSER ERROR: ${message}`);
    
    originalError.apply(win.console, args);
  };
  
  // Capture console.info
  const originalInfo = win.console.info;
  win.console.info = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    consoleLogs.push(`INFO: ${message}`);
    
    originalInfo.apply(win.console, args);
  };
});

// Create a queue for console logs
Cypress.queuedConsoleLogs = [];
Cypress.queueConsoleLog = (message) => {
  Cypress.queuedConsoleLogs.push(message);
};

// Process queued logs after each command
Cypress.on('command:end', () => {
  // Get logging mode from Cypress env variables
  const loggingMode = Cypress.env('LOGGING_MODE') || 'silent';
  
  if (Cypress.queuedConsoleLogs.length > 0) {
    const logs = [...Cypress.queuedConsoleLogs];
    Cypress.queuedConsoleLogs = [];
    
    // Process logs in batches to avoid too many cy.task calls
    if (logs.length > 0) {
      // Check logging mode to determine what to output
      switch (loggingMode) {
        case 'quiet':
        case 'tests-only':
        case 'silent':
          // In quiet, tests-only, and silent modes, just clear logs without outputting anything
          // They'll still be saved to log files on failure
          break;
        
        case 'verbose':
          // In verbose mode, log everything
          cy.task('log', `Processing ${logs.length} queued console logs`);
          logs.forEach(message => {
            cy.task('log', message);
          });
          break;
        default:
          // Do nothing in other modes
      }
    }
  }
});

// Save console logs on test failure
Cypress.on('test:after:run', (test, runnable) => {
  if (test.state === 'failed') {
    const testName = `${runnable.parent.title} -- ${test.title}`;
    const fileName = testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    // Create a log entry with test details and console logs
    const logContent = `Test: ${testName}\nFailure: ${test.err.message}\n\nConsole Logs:\n${consoleLogs.join('\n')}`;
    
    // Write logs to file
    cy.writeFile(`cypress/logs/${fileName}.log`, logContent);
    
    // Log to Cypress output
    cy.log(`Console logs saved to cypress/logs/${fileName}.log`);
  }
});

// Add custom assertion logic if needed
// Example: Custom assertion for checking if an element has a specific class
Cypress.Commands.add('shouldHaveClass', { prevSubject: 'element' }, (subject, className) => {
  expect(subject).to.have.class(className);
  return subject;
});

// We're removing the global beforeEach to avoid conflicts with test-specific beforeEach hooks
// Individual test files should handle their own setup
// This prevents duplicate cy.visit() calls that could cause issues

Cypress.on('before:browser:launch', (browser, launchOptions) => {
  launchOptions.args.push('--disable-web-security');
  
  // Add comprehensive clipboard permissions for cut/paste operations
  if (browser.family === 'chromium' && browser.name !== 'electron') {
    // Disable clipboard security features that block automation
    launchOptions.args.push('--disable-features=VizDisplayCompositor');
    launchOptions.args.push('--disable-background-timer-throttling');
    launchOptions.args.push('--disable-backgrounding-occluded-windows');
    launchOptions.args.push('--disable-renderer-backgrounding');
    
    // Enable clipboard features
    launchOptions.args.push('--enable-blink-features=Clipboard');
    launchOptions.args.push('--enable-experimental-web-platform-features');
    
    // Grant clipboard permissions by default for localhost
    launchOptions.args.push('--auto-grant-clipboard-permissions');
    launchOptions.args.push('--allow-running-insecure-content');
    
    // Disable permission prompts
    launchOptions.args.push('--disable-permissions-api');
    launchOptions.args.push('--disable-prompt-on-repost');
  }
  
  return launchOptions;
});
