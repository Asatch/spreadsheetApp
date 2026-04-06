/**
 * Undo/Redo Tests
 *
 * Verifies Ctrl+Z (undo) and Ctrl+Y (redo) across different operation types:
 * - Value edits
 * - Formatting changes (bold)
 * - Multi-step undo/redo cycles
 * - Redo cleared by new action
 * - Toolbar buttons
 */

describe('undo/redo', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('#A1').should('exist');
  });

  describe('value edits', () => {
    it('should undo a single value entry', () => {
      cy.enterCellValue('A1', '42');
      cy.verifyCellContent('A1', '42');

      cy.selectCell('A1');
      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('A1', '');
    });

    it('should redo an undone value entry', () => {
      cy.enterCellValue('A1', '42');
      cy.verifyCellContent('A1', '42');

      cy.selectCell('A1');
      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('A1', '');

      cy.focused().type('{ctrl+y}');
      cy.verifyCellContent('A1', '42');
    });

    it('should undo multiple value entries in reverse order', () => {
      cy.enterCellValue('A1', '10');
      cy.enterCellValue('A2', '20');
      cy.enterCellValue('A3', '30');

      cy.selectCell('A1');
      cy.focused().type('{ctrl+z}'); // undo A3=30
      cy.verifyCellContent('A3', '');
      cy.verifyCellContent('A2', '20');

      cy.focused().type('{ctrl+z}'); // undo A2=20
      cy.verifyCellContent('A2', '');
      cy.verifyCellContent('A1', '10');

      cy.focused().type('{ctrl+z}'); // undo A1=10
      cy.verifyCellContent('A1', '');
    });

    it('should undo overwriting an existing value', () => {
      cy.enterCellValue('A1', 'first');
      cy.enterCellValue('A1', 'second');
      cy.verifyCellContent('A1', 'second');

      cy.selectCell('A1');
      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('A1', 'first');
    });
  });

  describe('formula edits', () => {
    it('should undo a formula and restore previous value', () => {
      cy.enterCellValue('A1', '10');
      cy.enterCellValue('B1', '=A1+5');
      cy.verifyCellContent('B1', '15');

      cy.selectCell('B1');
      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('B1', '');

      // A1 should still have its value
      cy.verifyCellContent('A1', '10');
    });
  });

  describe('redo cleared by new action', () => {
    it('should clear redo stack when a new edit is made after undo', () => {
      cy.enterCellValue('A1', 'original');
      cy.selectCell('A1');
      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('A1', '');

      // New action should clear redo
      cy.enterCellValue('A2', 'new');

      // Redo should do nothing (A1 stays empty)
      cy.selectCell('A1');
      cy.focused().type('{ctrl+y}');
      cy.verifyCellContent('A1', '');
    });
  });

  describe('multi-step undo/redo cycles', () => {
    it('should handle multiple undo then redo steps', () => {
      cy.enterCellValue('A1', '1');
      cy.enterCellValue('A2', '2');
      cy.enterCellValue('A3', '3');

      cy.selectCell('A1');

      // Undo all three
      cy.focused().type('{ctrl+z}');
      cy.focused().type('{ctrl+z}');
      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('A1', '');
      cy.verifyCellContent('A2', '');
      cy.verifyCellContent('A3', '');

      // Redo two of them
      cy.focused().type('{ctrl+y}');
      cy.focused().type('{ctrl+y}');
      cy.verifyCellContent('A1', '1');
      cy.verifyCellContent('A2', '2');
      cy.verifyCellContent('A3', '');
    });
  });

  describe('toolbar buttons', () => {
    it('should undo via toolbar button', () => {
      cy.enterCellValue('A1', '42');
      cy.verifyCellContent('A1', '42');

      cy.get('.btn-undo').click();
      cy.verifyCellContent('A1', '');
    });

    it('should redo via toolbar button', () => {
      cy.enterCellValue('A1', '42');
      cy.get('.btn-undo').click();
      cy.verifyCellContent('A1', '');

      cy.get('.btn-redo').click();
      cy.verifyCellContent('A1', '42');
    });
  });

  describe('formatting operations', () => {
    it('should undo bold formatting', () => {
      cy.enterCellValue('A1', 'hello');
      cy.selectCell('A1');

      // Apply bold
      cy.get('.btn-bold').click();
      cy.get('#A1').should('have.css', 'font-weight').and('match', /^(bold|700)$/);

      // Undo bold
      cy.focused().type('{ctrl+z}');
      cy.get('#A1').should('have.css', 'font-weight').and('match', /^(normal|400)$/);
    });

    it('should redo bold formatting', () => {
      cy.enterCellValue('A1', 'hello');
      cy.selectCell('A1');

      cy.get('.btn-bold').click();
      cy.focused().type('{ctrl+z}'); // undo bold
      cy.get('#A1').should('have.css', 'font-weight').and('match', /^(normal|400)$/);

      cy.focused().type('{ctrl+y}'); // redo bold
      cy.get('#A1').should('have.css', 'font-weight').and('match', /^(bold|700)$/);
    });
  });

  describe('delete operations', () => {
    it('should undo cell deletion', () => {
      cy.enterCellValue('A1', '42');
      cy.selectCell('A1');
      cy.pressKey('delete');
      cy.verifyCellContent('A1', '');

      cy.focused().type('{ctrl+z}');
      cy.verifyCellContent('A1', '42');
    });
  });
});
