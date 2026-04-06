describe('Spreadsheet Default Formats', () => {
  beforeEach(() => {
    cy.visit('/');
    // Ensure grid is visible
    cy.get('#A1').should('exist');
  });

  it('should set and apply spreadsheet-wide default number format', () => {
    // Step 1: Set default currency format for numbers
    cy.log('Step 1: Set default currency format');
    cy.selectCell('A1'); // Select any cell to open format dialog
    cy.get('button[title="Number format"]').click();
    
    // Switch to Default Format tab
    cy.contains('Default Format').click();
    cy.contains('Default Format').should('have.class', 'active');
    
    // Configure default currency format
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('currency');
    cy.get('#symbol').clear().type('$');
    cy.get('#decimalPlaces').clear().type('2');
    
    // Apply as default
    cy.contains('Set as Default').click();
    cy.get('[role="dialog"]').should('not.exist');
    
    // Step 2: Enter numbers in different cells - should use default format
    cy.log('Step 2: Test default format application');
    cy.enterCellValue('B1', '123.456');
    cy.verifyCellContent('B1', '$123.46'); // Should use default currency format
    
    cy.enterCellValue('C2', '999');
    cy.verifyCellContent('C2', '$999.00'); // Should use default currency format
    
    cy.enterCellValue('D3', '1234.5');
    cy.verifyCellContent('D3', '$1,234.50'); // Should use default currency format with thousands separator
  });

  it('should set and apply spreadsheet-wide default date format', () => {
    // Set default EU date format
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    // Configure default date format
    cy.get('#format-type-select').select('DATE');
    cy.get('#displayFormat').select('DD/MM/YYYY');
    
    // Apply as default
    cy.contains('Set as Default').click();
    
    // Enter dates in different cells - should use default format
    cy.enterCellValue('E1', '2023-12-25');
    cy.verifyCellContent('E1', '25/12/2023'); // Should use default EU format
    
    cy.enterCellValue('F2', '2023-01-15');
    cy.verifyCellContent('F2', '15/01/2023'); // Should use default EU format
  });

  it('should set and apply spreadsheet-wide default datetime format', () => {
    // Set default 12-hour datetime format
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    // Configure default datetime format
    cy.get('#format-type-select').select('DATETIME');
    cy.get('#displayType').select('datetime');
    cy.get('#displayFormat').select('MM/DD/YYYY hh:mm A');
    
    // Apply as default
    cy.contains('Set as Default').click();
    
    // Enter datetimes - should use default format
    cy.enterCellValue('G1', '2023-12-25 14:30:00');
    cy.verifyCellContent('G1', '12/25/2023 02:30 PM'); // Should use default 12-hour format
    
    cy.enterCellValue('H2', '2023-01-15 09:15:30');
    cy.verifyCellContent('H2', '01/15/2023 09:15 AM'); // Should use default 12-hour format
  });

  it('should handle date input interpretation setting in default format', () => {
    // Test US vs EU date input interpretation
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    // Set to DATE type and configure input interpretation
    cy.get('#format-type-select').select('DATE');
    
    // Should see Date Input Interpretation setting only in Default tab
    cy.contains('Date Entry Format').should('be.visible');
    
    // Set to EU interpretation (DD/MM/YYYY)
    cy.get('#dateInputFormat').select('European (DD/MM/YYYY)');
    cy.contains('Set as Default').click();
    
    // Test ambiguous date input
    cy.enterCellValue('D1', '15/01/2023'); // Unambiguous in EU format
    cy.verifyCellContent('D1', '2023-01-15'); // Should display in canonical format by default
    
    // Test ambiguous date that could be interpreted differently
    cy.enterCellValue('E1', '02/03/2023'); // Could be Feb 3 or Mar 2
    // With EU interpretation, this should be March 2, 2023
    cy.selectCell('E1');
    cy.getFormulaValue().should('eq', '2023-03-02'); // Should be interpreted as Mar 2 in EU format
  });

  it('should not affect cells with existing cell-specific formats', () => {
    // Step 1: Apply cell-specific format first
    cy.log('Step 1: Apply cell-specific percentage format');
    cy.enterCellValue('D1', '0.75');
    cy.selectCell('D1');
    cy.get('button[title="Number format"]').click();
    
    // Apply percentage format to this specific cell
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('percentage');
    cy.contains('Apply to Cell').click();
    cy.verifyCellContent('D1', '75.00%');
    
    // Step 2: Set different default format
    cy.log('Step 2: Set default currency format');
    cy.selectCell('E1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    // Set currency as default
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('currency');
    cy.contains('Set as Default').click();
    
    // Step 3: Verify existing cell keeps its format
    cy.log('Step 3: Verify existing cell format preserved');
    cy.verifyCellContent('D1', '75.00%'); // Should still be percentage
    
    // Step 4: New cells should use default format
    cy.log('Step 4: Verify new cells use default format');
    cy.enterCellValue('F1', '100');
    cy.verifyCellContent('F1', '$100.00'); // Should use new default currency format
  });

  it('scientific default format works', () => {
    // Set default scientific notation format
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('scientific');
    cy.get('#decimalPlaces').clear().type('3');
    cy.contains('Set as Default').click();
    
    // Enter a number to verify format
    cy.enterCellValue('D1', '12345');
    cy.verifyCellContent('D1', '1.235E+4');
    
  });

  it('should handle multiple data type defaults correctly', () => {
    // Set default formats for different data types
    
    // 1. Set default NUMBER format to currency
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('currency');
    cy.contains('Set as Default').click();
    
    // 2. Set default DATE format to EU
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('DATE');
    cy.get('#displayFormat').select('DD/MM/YYYY');
    cy.contains('Set as Default').click();
    
    // 3. Set default DATETIME format to 12-hour
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('DATETIME');
    cy.get('#displayType').select('datetime');
    cy.get('#displayFormat').select('DD/MM/YYYY hh:mm A');
    cy.contains('Set as Default').click();
    
    // Test each data type uses its respective default
    cy.enterCellValue('D1', '123.45');
    cy.verifyCellContent('D1', '$123.45'); // NUMBER -> currency
    
    cy.enterCellValue('D2', '2023-12-25');
    cy.verifyCellContent('D2', '25/12/2023'); // DATE -> EU format
    
    cy.enterCellValue('D3', '2023-12-25 14:30:00');
    cy.verifyCellContent('D3', '25/12/2023 02:30 PM'); // DATETIME -> 12-hour EU
  });

  it('should show current default format settings when dialog opens', () => {
    // Set a default format first
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('percentage');
    cy.get('#decimalPlaces').clear().type('1');
    cy.contains('Set as Default').click();
    
    // Reopen dialog and check if settings are preserved
    cy.selectCell('B1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();

    // Should show the previously set values
    cy.get('#format-type-select').should('have.value', 'NUMBER');
    cy.get('#number-subcategory').should('have.value', 'percentage');
    cy.get('#decimalPlaces').should('have.value', '1');
    
    cy.get('dialog[open] .btn-outlined').click();
  });
});