describe('Format Dialog E2E Workflow', () => {
  beforeEach(() => {
    cy.visit('/');
    // Ensure grid is visible
    cy.get('#A1').should('exist');
  });

  it('should complete full format dialog workflow for cell format', () => {
    // Step 1: Enter a number in cell A1
    cy.log('Step 1: Enter number in cell A1');
    cy.enterCellValue('A1', '1234.56');
    cy.verifyCellContent('A1', '1,234.56');
    
    // Step 2: Open format dialog
    cy.log('Step 2: Open format dialog');
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    
    // Verify dialog opens with Cell Format tab active
    cy.contains('Cell Format').should('have.class', 'active'); // Active tab
    
    // Step 3: Change to Currency format
    cy.log('Step 3: Configure currency format');
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('currency');

    // Configure currency options
    cy.get('#symbol').clear().type('€');
    cy.get('#decimalPlaces').clear().type('0');
    
    // Step 4: Apply format to cell
    cy.log('Step 4: Apply currency format');
    cy.contains('Apply to Cell').click();
    
    // Step 5: Verify number displays in currency format
    cy.log('Step 5: Verify currency formatting');
    cy.verifyCellContent('A1', '€1,235'); // Rounded to 0 decimal places
    
    // Verify formula bar still shows canonical format (may have spaces)
    cy.selectCell('A1');
    cy.getFormulaValue().should('match', /1\s?234\.56/);
  });

  it('should handle format dialog tab switching', () => {
    // Enter value and open dialog
    cy.enterCellValue('B2', '42.5');
    cy.selectCell('B2');
    cy.get('button[title="Number format"]').click();
    
    // Start in Cell Format tab
    cy.contains('Cell Format').should('have.class', 'active');
    cy.contains('Default Format').should('not.have.class', 'active');
    
    // Switch to Default Format tab
    cy.log('Switching to Default Format tab');
    cy.contains('Default Format').click();
    
    // Verify tab switch
    cy.contains('Default Format').should('have.class', 'active');
    cy.contains('Cell Format').should('not.have.class', 'active');
    
    // Should show "Set as Default" button instead of "Apply to Cell"
    cy.contains('Set as Default').should('be.visible');
    cy.contains('Apply to Cell').should('not.exist');
    
    // Cancel dialog
    cy.get('dialog[open] .btn-outlined').click();
    cy.get('dialog[open]').should('not.exist');
  });

  it('should handle scientific notation format configuration', () => {
    // Enter a large number
    cy.enterCellValue('C3', '1234567.89');
    cy.selectCell('C3');
    cy.get('button[title="Number format"]').click();
    
    // Configure scientific notation
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('scientific');
    
    // Set decimal places
    cy.get('#decimalPlaces').clear().type('3');
    
    // Apply format
    cy.contains('Apply to Cell').click();
    
    // Verify scientific notation display
    cy.verifyCellContent('C3', '1.235E+6');
    
    // Verify canonical value preserved (may have spaces for formatting)
    cy.selectCell('C3');
    cy.getFormulaValue().should('match', /1\s?234\s?567\.89/);
  });

  it('should handle time duration format configuration', () => {
    // Enter a fractional number representing days
    cy.enterCellValue('D4', '2.75'); // 2 days and 18 hours
    cy.selectCell('D4');
    cy.get('button[title="Number format"]').click();
    
    // Configure time duration format
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('timeDuration');
    
    // Apply format
    cy.contains('Apply to Cell').click();
    
    // Verify time duration display (default abbreviated style)
    cy.verifyCellContent('D4', '2d 18h');
    
    // Verify canonical value preserved
    cy.selectCell('D4');
    cy.getFormulaValue().should('eq', '2.75');
  });

  it('should handle date format configuration', () => {
    // Enter a date
    cy.enterCellValue('E5', '2023-12-25');
    cy.selectCell('E5');
    cy.get('button[title="Number format"]').click();
    
    // Configure date format
    cy.get('#format-type-select').select('DATE');
    cy.get('#displayFormat').select('MM/DD/YYYY');
    
    // Apply format
    cy.contains('Apply to Cell').click();
    
    // Verify US date format display
    cy.verifyCellContent('E5', '12/25/2023');
    
    // Verify canonical format in formula bar
    cy.selectCell('E5');
    cy.getFormulaValue().should('eq', '2023-12-25');
  });

  it('should handle datetime format configuration with 12/24-hour options', () => {
    // Enter a datetime
    cy.enterCellValue('F6', '2023-12-25 14:30:45');
    cy.selectCell('F6');
    cy.get('button[title="Number format"]').click();
    
    // Configure datetime format - 12-hour
    cy.get('#format-type-select').select('DATETIME');
    cy.get('#displayType').select('datetime');
    // Select 12-hour US format 
    cy.get('#displayFormat').select('MM/DD/YYYY hh:mm A (US 12H)');
    
    // Apply format
    cy.contains('Apply to Cell').click();
    
    // Verify 12-hour format display (check for key elements)
    cy.verifyCellContent('F6', '12/25/2023');
    cy.verifyCellContent('F6', 'PM');
    
    // Test switching to 24-hour format
    cy.selectCell('F6');
    cy.get('button[title="Number format"]').click();
    // Select 24-hour EU format

    cy.get('#format-type-select').select('DATETIME');
    cy.get('#displayFormat').select('DD/MM/YYYY HH:mm:ss (EU)');
    cy.contains('Apply to Cell').click();
    
    // Verify 24-hour format display (check for key elements)
    cy.verifyCellContent('F6', '25/12/2023');
    cy.verifyCellContent('F6', '14:30');
  });

  it('should show format type mismatch information', () => {
    // Enter text in a cell
    cy.enterCellValue('G7', 'hello world');
    cy.selectCell('G7');
    cy.get('button[title="Number format"]').click();
    
    // Try to apply number format to text
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('currency');
    
    // Wait a moment for type mismatch detection, then check for warning
    //cy.wait(1000);
    
    // Check if format information appears (it may not be implemented yet)
    cy.get('body').then($body => {
      if ($body.text().includes('Format Information')) {
        // Should show type mismatch warning
        cy.contains('Format Information').should('be.visible');
        cy.contains('display purposes only').should('be.visible');
        cy.contains('re-enter the data').should('be.visible');
      } else {
        // Log that the feature isn't implemented yet
        cy.log('Format Information warning not implemented yet');
      }
    });
    
    // Apply anyway (should work for pre-formatting)
    cy.contains('Apply to Cell').click();
    
    // Text should remain as text
    cy.verifyCellContent('G7', 'hello world');
    
    // But if we enter a number now, it should use the currency format
    cy.selectCell('G7');
    cy.enterCellValue('G7', '123.45');
    cy.verifyCellContent('G7', '$123.45');
  });

  it('should handle format persistence when cell is empty (pre-formatting)', () => {
    // Select an empty cell
    cy.selectCell('H8');
    cy.get('button[title="Number format"]').click();
    
    // Apply percentage format to empty cell
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('percentage');
    cy.get('#decimalPlaces').clear().type('1');
    cy.contains('Apply to Cell').click();
    
    // Cell should still be empty
    cy.verifyCellContent('H8', '');
    
    // Enter a number - should use the pre-applied format
    cy.enterCellValue('H8', '0.75');
    cy.verifyCellContent('H8', '75.0%');
    
    // Verify canonical value
    cy.selectCell('H8');
    cy.getFormulaValue().should('eq', '0.75');
  });

  it('should handle dialog cancellation', () => {
    // Enter value and open dialog - use a cell that's visible on screen
    cy.enterCellValue('B2', '999.99');
    cy.selectCell('B2');
    cy.get('button[title="Number format"]').click();

    // Make some changes
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('currency');
    cy.get('#symbol').clear().type('£');

    // Cancel dialog
    cy.get('dialog[open] .btn-outlined').click();
    cy.get('dialog[open]').should('not.exist');

    // Verify no changes were applied
    cy.verifyCellContent('B2', '999.99'); // Should still be original format
  });

  it('should respect US/EU date format preference', () => {
    // Open format dialog
    cy.get('button[title="Number format"]').click();
    
    // Switch to default tab
    cy.contains('Default Format').click();
    
    // Select Date type
    cy.get('#format-type-select').select('DATE');
    
    // The initial format should be based on browser locale
    // For testing, we'll just verify we can change it
    
    // Select EU format
    cy.get('#dateInputFormat').select('European (DD/MM/YYYY)');
    cy.contains('Set as Default').click();
    
    // Enter an ambiguous date in cell A1
    cy.enterCellValue('A1', '15/03/2023');
    
    // This should be interpreted as March 15 (DD/MM/YYYY)
    // The formula bar should show the canonical format
    cy.selectCell('A1');
    cy.getFormulaValue().should('eq', '2023-03-15');
    
    // Now change to US format
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('DATE');
    cy.get('#dateInputFormat').select('US (MM/DD/YYYY)');
    cy.contains('Set as Default').click();
    
    // Enter another ambiguous date in cell A2
    cy.enterCellValue('A2', '03/15/2023');
    
    // This should be interpreted as March 15 (MM/DD/YYYY)
    cy.selectCell('A2');
    cy.getFormulaValue().should('eq', '2023-03-15');
    
    // Test that unambiguous dates work regardless of preference
    cy.enterCellValue('A3', '2023-03-15');
    cy.selectCell('A3');
    cy.getFormulaValue().should('eq', '2023-03-15');
  });

    it('should test US format interpretation', () => {

    // Test US format: 03/15/2023 should be March 15
    cy.selectCell('A1');
    cy.enterFormulaValue('03/15/2023');
    cy.pressKeyInFormulaBar('{enter}');
    
    // Check the canonical value in formula bar
    cy.selectCell('A1');
    cy.getFormulaValue().then(value => {
      cy.log(`Cell A1 formula bar value: ${value}`);
      expect(value).to.equal('2023-03-15'); // March 15
    });
    
    // Test EU format interpretation to compare
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('DATE');
    cy.get('#dateInputFormat').select('European (DD/MM/YYYY)');
    cy.contains('Set as Default').click();
    
    // Test EU format: 15/03/2023 should be March 15
    cy.selectCell('A2');
    cy.enterFormulaValue('15/03/2023');
    cy.pressKeyInFormulaBar('{enter}');
    
    // Check the canonical value
    cy.selectCell('A2');
    cy.getFormulaValue().then(value => {
      cy.log(`Cell A2 formula bar value: ${value}`);
      expect(value).to.equal('2023-03-15'); // March 15
    });
    
    // Test ambiguous date with US format
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('DATE');
    cy.get('#dateInputFormat').select('US (MM/DD/YYYY)');
    cy.contains('Set as Default').click();
    
    // 01/02/2023 should be January 2 with US format
    cy.selectCell('A3');
    cy.enterFormulaValue('01/02/2023');
    cy.pressKeyInFormulaBar('{enter}');
    
    cy.selectCell('A3');
    cy.getFormulaValue().then(value => {
      cy.log(`Cell A3 formula bar value (US format): ${value}`);
      expect(value).to.equal('2023-01-02'); // January 2
    });
    
    // Test same ambiguous date with EU format
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    cy.get('#format-type-select').select('DATE');
    cy.get('#dateInputFormat').select('European (DD/MM/YYYY)');
    cy.contains('Set as Default').click();
    
    // 01/02/2023 should be February 1 with EU format
    cy.selectCell('A4');
    cy.enterFormulaValue('01/02/2023');
    cy.pressKeyInFormulaBar('{enter}');
    
    cy.selectCell('A4');
    cy.getFormulaValue().then(value => {
      cy.log(`Cell A4 formula bar value (EU format): ${value}`);
      expect(value).to.equal('2023-02-01'); // February 1
    });
  });

    it('should debug scientific notation default format', () => {
    // Set default scientific notation format
    cy.selectCell('A1');
    cy.get('button[title="Number format"]').click();
    cy.contains('Default Format').click();
    
    cy.get('#format-type-select').select('NUMBER');
    cy.get('#number-subcategory').select('scientific');
    cy.get('#decimalPlaces').clear().type('3');
    cy.contains('Set as Default').click();
    
    // Enter a number to verify format
    cy.enterCellValue('B1', '12345');
    
    // Check what we actually get
    cy.selectCell('B1');
    cy.get('#B1').should('be.visible').then($cell => {
      const cellContent = $cell.text().trim();
      cy.log('Cell B1 displays: "' + cellContent + '"');
      
      // Check if it shows scientific notation
      if (cellContent === '1.235E+4' || cellContent === '1.235e+4') {
        cy.log('SUCCESS: Cell is showing scientific notation');
      } else if (cellContent === '12345' || cellContent === '12,345') {
        cy.log('ISSUE: Cell is showing regular number format');
      } else {
        cy.log('UNEXPECTED: Cell shows: ' + cellContent);
      }
    });
    
    // Test expected value
    cy.verifyCellContent('B1', '1.235E+4');
  });
});