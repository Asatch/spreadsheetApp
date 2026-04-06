/**
 * Minimal test to verify application loads successfully
 * This test is intentionally kept simple to reduce test output
 */

describe('App Load', () => {
  it('loads successfully', () => {
    // Single visit without beforeEach to reduce setup/teardown logs
    cy.visit('/');

    // Single assertion to verify the formula bar is present
    // This confirms the application has loaded properly
    cy.get('input[placeholder="Enter formula or value"]', { timeout: 2000 }).should('exist');
    cy.contains('Spreadsheet').should('be.visible');
    cy.get('.cell-name-display').should('have.value', 'A1');

  });
});