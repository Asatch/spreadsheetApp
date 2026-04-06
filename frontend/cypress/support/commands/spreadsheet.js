/**
 * Custom Cypress commands for interacting with the SC Spreadsheet
 */

// Dismiss the floating toolbar if visible by dispatching a pointerdown on the
// document, which triggers the app's own dismiss handler.
Cypress.Commands.add('dismissFloatingToolbar', () => {
  cy.document().then(doc => {
    const toolbar = doc.querySelector('.floating-toolbar');
    if (toolbar && toolbar.style.display !== 'none') {
      doc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
  });
});

// Helper to select a cell by its ID (e.g., 'A1', 'B2')
Cypress.Commands.add('selectCell', (cellId) => {
  cy.dismissFloatingToolbar();
  cy.get(`#${cellId}`).click();
  // Allow time for selection to register
  cy.wait(100);
});

// Helper to verify a cell is active (has focus)
Cypress.Commands.add('isCellActive', (cellId) => {
  cy.get(`#${cellId}`).should('have.class', 'active-cell');
});

// Helper to verify a cell is selected (part of a selection range)
Cypress.Commands.add('isCellSelected', (cellId) => {
  cy.get(`#${cellId}`).should('have.class', 'selected-cell');
});

// Helper to verify cell content
Cypress.Commands.add('verifyCellContent', (cellId, content) => {
  // Cell values are displayed via CSS variable --cell-value in ::before pseudo-element
  cy.get(`#${cellId}`).should(($el) => {
    const cellValue = $el.css('--cell-value');
    // CSS variable includes quotes, e.g., '"value"', so we need to strip them
    const actualValue = cellValue ? cellValue.replace(/^"|"$/g, '') : '';
    expect(actualValue).to.include(content);
  });
});

// Helper to enter a value in the formula bar
Cypress.Commands.add('enterFormulaValue', (value) => {
  cy.get('.formula-input').clear().type(value);
});

// Helper to press a key in the formula bar
Cypress.Commands.add('pressKeyInFormulaBar', (key) => {
  cy.get('.formula-input').type(key);
});

// Helper to get the formula bar value
Cypress.Commands.add('getFormulaValue', () => {
  return cy.get('.formula-input').invoke('val');
});

// Helper to enter a value in a cell
Cypress.Commands.add('enterCellValue', (cellId, value) => {
  cy.selectCell(cellId);
  cy.enterFormulaValue(value);
  cy.get('.formula-input').type('{enter}');
});

// Helper to create a range selection
Cypress.Commands.add('selectRange', (startCellId, endCellId) => {
  // First click on the start cell
  cy.selectCell(startCellId);

  // Dismiss toolbar again — clicking the already-active start cell may show it
  cy.dismissFloatingToolbar();

  // Then shift+click on the end cell
  cy.get(`#${endCellId}`).trigger('pointerdown', { shiftKey: true, pointerId: 1, button: 0 });
  cy.get(`#${endCellId}`).trigger('pointerup', { shiftKey: true, pointerId: 1, button: 0 });

  // Allow time for selection to register
  cy.wait(100);
});

// Helper to type a formula with references
Cypress.Commands.add('enterFormulaWithReferences', (startCellId, formula, references) => {
  // Select the cell where we want to enter the formula
  cy.selectCell(startCellId);
  
  // Enter the formula start
  cy.enterFormulaValue(formula);
  
  // Add each reference by clicking the referenced cells
  references.forEach((ref) => {
    cy.selectCell(ref);
  });
});

// Helper to expand a reference to a range using shift+arrows
Cypress.Commands.add('expandReferenceSelection', (direction, count = 1) => {
  // Map direction to the appropriate key
  const keyMap = {
    right: 'right',
    left: 'left',
    up: 'up',
    down: 'down'
  };
  
  // Get the direction
  const dir = keyMap[direction.toLowerCase()];
  
  if (!dir) {
    throw new Error(`Invalid direction: ${direction}. Use 'right', 'left', 'up', or 'down'.`);
  }
  
  // Hold shift and press the arrow key the specified number of times
  for (let i = 0; i < count; i++) {
    cy.get('body').trigger('keydown', { key: dir, shiftKey: true });
    cy.wait(50); // Small wait between key presses
  }
});

// Helper for special key combinations
Cypress.Commands.add('pressKey', (key) => {
  cy.get('body').focus();
  
  switch(key.toLowerCase()) {
    case 'f2':
      cy.get('body').trigger('keydown', { key: 'F2' });
      break;
    case 'tab':
      cy.get('body').trigger('keydown', { key: 'Tab' });
      break;
    case 'shift+tab':
      cy.get('body').trigger('keydown', { key: 'Tab', shiftKey: true });
      break;
    case 'enter':
      cy.get('body').type('{enter}');
      break;
    case 'escape':
      cy.get('body').type('{esc}');
      break;
    case 'delete':
      cy.get('body').type('{del}');
      break;
    case 'right':
    case 'left':
    case 'up':
    case 'down':
      cy.get('body').type(`{${key}arrow}`);
      break;
    case 'shift+right':
    case 'shift+left':
    case 'shift+up':
    case 'shift+down':
      const direction = key.split('+')[1];
      cy.get('body').type(`{shift+${direction}arrow}`);
      break;
    default:
      cy.get('body').type(key);
  }
  
  // Small delay after key press
  cy.wait(100);
});

// Helper for simulating pointer drag properly
Cypress.Commands.add('dragBetweenCells', (startCellId, endCellId) => {
  // First click and hold on start cell
  cy.get(`#${startCellId}`).trigger('pointerdown', { button: 0, pointerId: 1 });

  // Move to end cell
  cy.get(`#${endCellId}`)
    .trigger('pointermove', { button: 0, pointerId: 1 })
    .wait(100) // Give the app time to process the move
    .trigger('pointerup', { button: 0, pointerId: 1 });

  // Allow time for selection to register
  cy.wait(200);
});

// Helper to grant clipboard permissions and handle clipboard operations
Cypress.Commands.add('grantClipboardPermissions', () => {
  cy.window().then(async (win) => {
    try {
      // Try to grant permissions using the Permissions API
      if ('permissions' in win.navigator) {
        const result = await win.navigator.permissions.query({ name: 'clipboard-read' });
        if (result.state === 'denied') {
          // Mock clipboard API if permissions are denied
          win.navigator.clipboard = {
            writeText: () => Promise.resolve(),
            readText: () => Promise.resolve(''),
            write: () => Promise.resolve(),
            read: () => Promise.resolve([])
          };
        }
      }
      
      // Also ensure the clipboard API exists
      if (!win.navigator.clipboard) {
        win.navigator.clipboard = {
          writeText: () => Promise.resolve(),
          readText: () => Promise.resolve(''),
          write: () => Promise.resolve(),
          read: () => Promise.resolve([])
        };
      }
      
      // Mock document.execCommand to always return true for clipboard operations
      const originalExecCommand = win.document.execCommand;
      win.document.execCommand = function(command, showUI, value) {
        if (command === 'copy' || command === 'cut' || command === 'paste') {
          return true;
        }
        return originalExecCommand.call(this, command, showUI, value);
      };
      
    } catch (error) {
      // If permissions API fails, just mock the clipboard
      win.navigator.clipboard = {
        writeText: () => Promise.resolve(),
        readText: () => Promise.resolve(''),
        write: () => Promise.resolve(),
        read: () => Promise.resolve([])
      };
    }
  });
});
