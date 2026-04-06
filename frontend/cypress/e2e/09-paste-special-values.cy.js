/**
 * Paste Special: Values Only
 *
 * Tests for Ctrl+Shift+V / toolbar "Paste values" functionality:
 * - Formulas are resolved to their computed values
 * - Formatting is not transferred
 * - Works for both copy and cut sources
 * - Undo reverses the operation
 * - Toolbar dropdown is present and functional
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enterValue(cellId, value) {
  cy.get(`#${cellId}`).dblclick();
  cy.get('.formula-input').type(`${value}{enter}`);
}

function selectCell(cellId) {
  cy.get(`#${cellId}`).click();
}

function verifyContent(cellId, expected) {
  cy.verifyCellContent(cellId, expected);
}

function verifyFormula(cellId, expected) {
  selectCell(cellId);
  cy.get('.formula-input').should('have.value', expected);
}

function clickCopy() {
  cy.get('button[title="Copy"]').click();
}

function clickCut() {
  cy.get('button[title="Cut"]').click();
}

function clickPaste() {
  cy.get('button[title="Paste"]').click();
}

function clickPasteValues() {
  // Open paste dropdown, then click "Paste values"
  cy.get('.btn-paste-dropdown').click();
  cy.get('.btn-paste-values').click();
}

function applyBold() {
  cy.get('.btn-bold').click();
}

function applyHighlight() {
  cy.get('.btn-highlight-apply').click();
}

// ===========================================================================
// PASTE VALUES – FORMULA STRIPPING
// ===========================================================================

describe('Paste Special: Values Only', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('#A1').should('exist');
  });

  it('should paste computed value instead of formula', () => {
    // A1: 10, A2: =A1+5 (displays 15)
    // Copy A2, paste-values into B1 → should get "15", not "=B1+5"
    enterValue('A1', '10');
    enterValue('A2', '=A1+5');
    verifyContent('A2', '15');

    selectCell('A2');
    clickCopy();
    selectCell('B1');
    clickPasteValues();

    verifyContent('B1', '15');
    verifyFormula('B1', '15');
  });

  it('should paste plain values unchanged', () => {
    // A1: "hello" (not a formula)
    // Copy A1, paste-values into B1 → should get "hello"
    enterValue('A1', 'hello');

    selectCell('A1');
    clickCopy();
    selectCell('B1');
    clickPasteValues();

    verifyContent('B1', 'hello');
    // Text values get canonical quote prefix in formula bar
    verifyFormula('B1', "'hello");
  });

  it('should not transfer formatting when pasting values', () => {
    // A1: bold "10"
    // Copy A1, paste-values into B1 → B1 should NOT be bold
    enterValue('A1', '10');
    selectCell('A1');
    applyBold();

    selectCell('A1');
    clickCopy();
    selectCell('B1');
    clickPasteValues();

    verifyContent('B1', '10');
    // Verify B1 is not bold (fontWeight should be empty/normal, not bold/700)
    cy.get('#B1').should(($el) => {
      const fontWeight = $el.css('font-weight');
      expect(fontWeight).to.not.match(/^(bold|700)$/);
    });
  });

  it('should paste values from a multi-cell range', () => {
    // A1: 5, A2: =A1*2 (10), A3: =A2+3 (13)
    // Copy A1:A3, paste-values into C1:C3
    enterValue('A1', '5');
    enterValue('A2', '=A1*2');
    enterValue('A3', '=A2+3');
    verifyContent('A2', '10');
    verifyContent('A3', '13');

    selectCell('A1');
    cy.get('#A3').click({ shiftKey: true });
    clickCopy();

    selectCell('C1');
    clickPasteValues();

    verifyFormula('C1', '5');
    verifyFormula('C2', '10');
    verifyFormula('C3', '13');
  });

  it('should work with cut + paste values', () => {
    // A1: 10, A2: =A1+5 (displays 15)
    // Cut A2, paste-values into B1 → B1 gets "15", A2 is cleared
    enterValue('A1', '10');
    enterValue('A2', '=A1+5');
    verifyContent('A2', '15');

    selectCell('A2');
    clickCut();
    selectCell('B1');
    clickPasteValues();

    verifyContent('B1', '15');
    verifyFormula('B1', '15');
    // Source cell should be cleared after cut
    verifyContent('A2', '');
  });

  it('should undo paste-values operation', () => {
    enterValue('A1', '10');
    enterValue('A2', '=A1+5');
    verifyContent('A2', '15');

    selectCell('A2');
    clickCopy();
    selectCell('B1');
    clickPasteValues();

    verifyContent('B1', '15');

    // Undo via toolbar button
    selectCell('B1');
    cy.get('.btn-undo').click();

    // B1 should be empty again
    verifyContent('B1', '');
  });
});

// ===========================================================================
// TOOLBAR DROPDOWN UI
// ===========================================================================

describe('Paste Dropdown UI', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('#A1').should('exist');
  });

  it('should show paste dropdown with "Paste values" option', () => {
    // Ensure grid is ready before interacting with toolbar
    cy.get('#A1').click();

    // Open the paste dropdown
    cy.get('.btn-paste-dropdown').click();
    cy.get('.paste-popover').should('not.have.attr', 'hidden');
    cy.get('.btn-paste-values').should('contain.text', 'Paste values');
  });

  it('should show keyboard shortcut hint in dropdown', () => {
    cy.get('.btn-paste-dropdown').click();
    cy.get('.paste-option-shortcut').should('not.be.empty');
  });

  it('should close dropdown when clicking outside', () => {
    cy.get('.btn-paste-dropdown').click();
    cy.get('.paste-popover').should('not.have.attr', 'hidden');

    // Click outside the popover
    cy.get('#A1').click();
    cy.get('.paste-popover').should('have.attr', 'hidden');
  });
});
