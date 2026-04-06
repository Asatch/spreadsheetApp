describe('Formula Canonicalization and SUM Function', () => {
  beforeEach(() => {
    cy.visit('/');
    // Ensure grid is visible
    cy.get('#A1').should('exist');
  });

  it('should canonicalize formula functions to uppercase', () => {
    // Enter values in cells using the proper command
    cy.enterCellValue('A1', '1');
    cy.enterCellValue('A2', '2');
    cy.enterCellValue('A3', '3');
    
    // Enter formula in lowercase
    cy.selectCell('A4');
    cy.enterFormulaValue('=sum(a1:a3)');
    cy.pressKey('enter');
    
    // Verify the cell shows the correct result
    cy.verifyCellContent('A4', '6');
    
    // Click on the cell again to check formula bar
    cy.selectCell('A4');
    
    // Verify formula bar shows canonicalized formula (uppercase)
    cy.getFormulaValue().should('eq', '=SUM(A1:A3)');
  });

  it('should maintain canonical format when entering edit mode', () => {
    // Set up cells with values
    cy.enterCellValue('B1', '10');
    cy.enterCellValue('B2', '20');
    
    // Enter formula in mixed case
    cy.selectCell('B3');
    cy.enterFormulaValue('=SuM(b1:B2)');
    cy.pressKey('enter');
    
    // Verify calculation
    cy.verifyCellContent('B3', '30');
    
    // Click on the formula cell
    cy.selectCell('B3');
    cy.getFormulaValue().should('eq', '=SUM(B1:B2)');
    
    // Click in formula bar to enter edit mode
    cy.get('input[placeholder="Enter formula or value"]').click();
    
    // Verify it still shows canonical format in edit mode
    cy.getFormulaValue().should('eq', '=SUM(B1:B2)');
    
    // Make a small edit (add a space and remove it) to ensure we can edit
    cy.get('input[placeholder="Enter formula or value"]').type('{end} ');
    cy.getFormulaValue().should('eq', '=SUM(B1:B2) ');
    cy.get('input[placeholder="Enter formula or value"]').type('{backspace}');
    cy.getFormulaValue().should('eq', '=SUM(B1:B2)');
    
    // Press Enter to confirm edit
    cy.pressKey('enter');
    
    // Verify calculation still works
    cy.verifyCellContent('B3', '30');
  });

  it('should handle SUM with individual cell references', () => {
    // Enter values
    cy.enterCellValue('C1', '5');
    cy.enterCellValue('C2', '15');
    cy.enterCellValue('C3', '25');
    
    // Enter SUM with individual cells (not range)
    cy.selectCell('C4');
    cy.enterFormulaValue('=sum(c1,c2,c3)');
    cy.pressKey('enter');
    
    // Verify calculation
    cy.verifyCellContent('C4', '45');
    
    // Verify canonical format
    cy.selectCell('C4');
    cy.getFormulaValue().should('eq', '=SUM(C1,C2,C3)');
  });

  it('should handle nested functions with canonicalization', () => {
    // Set up test data
    cy.enterCellValue('D1', '100');
    cy.enterCellValue('D2', '50');
    cy.enterCellValue('D3', '25');
    
    // Enter nested formula in lowercase
    cy.selectCell('D4');
    cy.enterFormulaValue('=sum(d1:d2)+sum(d2:d3)');
    cy.pressKey('enter');
    
    // Verify calculation: SUM(100,50) + SUM(50,25) = 150 + 75 = 225
    cy.verifyCellContent('D4', '225');
    
    // Verify canonical format
    cy.selectCell('D4');
    cy.getFormulaValue().should('eq', '=SUM(D1:D2)+SUM(D2:D3)');
  });

  it('should show #TYPE! error for non-numeric values in SUM', () => {
    // Enter a text value
    cy.enterCellValue('E1', "'hello");
    
    // Enter a number
    cy.enterCellValue('E2', '10');
    
    // Try to sum text and number
    cy.selectCell('E3');
    cy.enterFormulaValue('=sum(e1:e2)');
    cy.pressKey('enter');
    
    // Should show type error
    cy.verifyCellContent('E3', '#TYPE!');
    
    // Verify formula is still canonicalized in formula bar
    cy.selectCell('E3');
    cy.getFormulaValue().should('eq', '=SUM(E1:E2)');
  });

  it('should handle copy/paste of formulas with canonicalization', () => {
    // Setup: Place value in A1 and formula referencing it in A2
    cy.get('#A1').dblclick();
    cy.get('.formula-input').type('10{enter}');
    
    cy.get('#A2').dblclick();
    cy.get('.formula-input').type('15{enter}');

    cy.get('#A3').dblclick();
    cy.get('.formula-input').type('20{enter}');

    cy.selectCell('A4');
    cy.enterFormulaValue('=sum(a1:a3)');
    cy.pressKey('enter');
    
    // Verify the formula works correctly in original position
    cy.verifyCellContent('A4', '45');
    
    // Select both cells (A1:A4) using the proven selectRange command
    cy.selectRange('A1', 'A4');
    
    // Copy the selection
    cy.get('button[title="Copy"]').click();
    
    // Paste to B1:B4
    cy.get('#B1').click();
    // Ensure B1 is properly selected before pasting
    cy.get('button[title="Paste"]').click();
    
    // Verify values were copied correctly
    cy.verifyCellContent('B1', '10');
    cy.verifyCellContent('B2', '15');
    cy.verifyCellContent('B3', '20');
    
    // Check if the formula in B2 correctly references B1 (not still pointing to A1)
    cy.get('#B4').click();
    //cy.wait(200);
    cy.get('.formula-input').should('have.value', '=SUM(B1:B3)');
    
    // Double-check that the formula works by changing B1 and seeing B2 update
    cy.get('#B1').dblclick();
    cy.get('.formula-input').clear().type('5{enter}');
    cy.verifyCellContent('B4', '40');
  });

});