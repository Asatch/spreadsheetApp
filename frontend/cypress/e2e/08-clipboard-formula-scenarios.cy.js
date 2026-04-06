/**
 * Clipboard Formula & Formatting Scenarios
 *
 * Comprehensive tests for copy/paste and cut/paste behavior:
 * - Formula reference adjustment (relative, absolute, mixed)
 * - Multi-cell range operations
 * - Formatting transfer (copy and cut)
 * - Edge cases (overlapping ranges, grid boundaries, fill mode)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enter a value into a cell via the formula bar, then press Enter. */
function enterValue(cellId, value) {
  cy.get(`#${cellId}`).dblclick();
  cy.get('.formula-input').type(`${value}{enter}`);
}

/** Click a cell to select it (no editing). */
function selectCell(cellId) {
  cy.get(`#${cellId}`).click();
}

/** Verify the display value of a cell. */
function verifyContent(cellId, expected) {
  cy.verifyCellContent(cellId, expected);
}

/** Verify the raw formula bar value after clicking a cell. */
function verifyFormula(cellId, expected) {
  selectCell(cellId);
  cy.get('.formula-input').should('have.value', expected);
}

/** Copy selection via toolbar button. */
function clickCopy() {
  cy.get('button[title="Copy"]').click();
}

/** Cut selection via toolbar button. */
function clickCut() {
  cy.get('button[title="Cut"]').click();
}

/** Paste via toolbar button. */
function clickPaste() {
  cy.get('button[title="Paste"]').click();
}

/** Apply bold formatting to the selected cell via toolbar. */
function applyBold() {
  cy.get('.btn-bold').click();
}

/** Apply highlight formatting to the selected cell via toolbar. */
function applyHighlight() {
  cy.get('.btn-highlight-apply').click();
}

// ===========================================================================
// COPY + PASTE SCENARIOS
// ===========================================================================

describe('Copy and Paste – Formula Scenarios', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('#A1').should('exist');
  });

  // ---- Single-cell copy with external reference ----

  it('should shift external reference when copying a single cell', () => {
    // B2 contains =A1+1.  Copy B2 → C3.
    // A1 is external to the copied range (B2:B2).
    // Copy shifts all relative refs by +1 col, +1 row → =B2+1
    // B2 still has =A1+1 = 11, so C3 = =B2+1 = 12
    enterValue('A1', '10');
    enterValue('B2', '=A1+1');
    verifyContent('B2', '11');

    selectCell('B2');
    clickCopy();
    selectCell('C3');
    clickPaste();

    verifyFormula('C3', '=B2+1');
    verifyContent('C3', '12');
  });

  // ---- Multi-cell copy with internal references ----

  it('should adjust internal references when copying a multi-cell range', () => {
    // A1: 5,  A2: =A1*2  (internal ref within the range A1:A2)
    // Copy A1:A2 → C1:C2.  A2's formula should become =C1*2
    enterValue('A1', '5');
    enterValue('A2', '=A1*2');
    verifyContent('A2', '10');

    cy.selectRange('A1', 'A2');
    clickCopy();
    selectCell('C1');
    clickPaste();

    verifyContent('C1', '5');
    verifyContent('C2', '10');
    verifyFormula('C2', '=C1*2');
  });

  // ---- Multi-cell copy with external references ----

  it('should shift external references when copying a multi-cell range', () => {
    // E1: 100
    // A1: =E1+1  (external to the range A1:A2)
    // A2: 50
    // Copy A1:A2 → B3:B4.  A1's formula shifts by +1 col, +2 rows → =F3+1
    enterValue('E1', '100');
    enterValue('A1', '=E1+1');
    verifyContent('A1', '101');
    enterValue('A2', '50');

    cy.selectRange('A1', 'A2');
    clickCopy();
    selectCell('B3');
    clickPaste();

    verifyFormula('B3', '=F3+1');
    verifyContent('B4', '50');
  });

  // ---- Copy with $A1 (column-absolute, row-relative) ----

  it('should only shift the row for $Column references when copying', () => {
    // B1: 10
    // A1: =$B1+1
    // Copy A1 → C3 (+2 cols, +2 rows).  $B stays, row shifts: =$B3+1
    enterValue('B1', '10');
    enterValue('A1', '=$B1+1');
    verifyContent('A1', '11');

    selectCell('A1');
    clickCopy();
    selectCell('C3');
    clickPaste();

    verifyFormula('C3', '=$B3+1');
  });

  // ---- Copy with A$1 (column-relative, row-absolute) ----

  it('should only shift the column for Row$ references when copying', () => {
    // A1: 20
    // B2: =A$1+1
    // Copy B2 → D4 (+2 cols, +2 rows).  A shifts to C, $1 stays: =C$1+1
    enterValue('A1', '20');
    enterValue('B2', '=A$1+1');
    verifyContent('B2', '21');

    selectCell('B2');
    clickCopy();
    selectCell('D4');
    clickPaste();

    verifyFormula('D4', '=C$1+1');
  });

  // ---- Copy DOES transfer formatting ----

  it('should carry formatting when copying', () => {
    // Bold A1, enter value, copy to B1 → B1 should be bold
    enterValue('A1', 'styled');
    selectCell('A1');
    applyBold();

    // Verify A1 is bold
    cy.get('#A1').should(($el) => {
      expect($el[0].style.fontWeight).to.equal('bold');
    });

    selectCell('A1');
    clickCopy();
    selectCell('B1');
    clickPaste();

    verifyContent('B1', 'styled');

    // B1 should be bold
    cy.get('#B1').should(($el) => {
      expect($el[0].style.fontWeight).to.equal('bold');
    });

    // A1 should still be bold (copy doesn't clear source formatting)
    cy.get('#A1').should(($el) => {
      expect($el[0].style.fontWeight).to.equal('bold');
    });
  });

  // ---- Copy fill mode (tiling) ----

  it('should tile clipboard contents across a larger selection (fill mode)', () => {
    // A1: 1, B1: 2
    // Copy A1:B1, select C1:F1 (4 cells > 2 cells), paste → tiles: 1, 2, 1, 2
    enterValue('A1', '1');
    enterValue('B1', '2');

    cy.selectRange('A1', 'B1');
    clickCopy();
    cy.selectRange('C1', 'F1');
    clickPaste();

    verifyContent('C1', '1');
    verifyContent('D1', '2');
    verifyContent('E1', '1');
    verifyContent('F1', '2');
  });

  // ---- Copy range including empty cells ----

  it('should handle copying a range that includes empty cells', () => {
    // A1: 10, A2: (empty), A3: 30
    // Copy A1:A3 → C1:C3
    enterValue('A1', '10');
    enterValue('A3', '30');

    cy.selectRange('A1', 'A3');
    clickCopy();
    selectCell('C1');
    clickPaste();

    verifyContent('C1', '10');
    verifyContent('C2', '');
    verifyContent('C3', '30');
  });

  // ---- Copy where adjusted reference goes out of bounds → #REF! ----

  it('should produce #REF! when a copy-adjusted reference goes out of grid bounds', () => {
    // A1: 10
    // B1: =A1+1  (references one column to the left)
    // Copy B1 → A3.  Formula shifts −1 col → column 0 doesn't exist → #REF!
    enterValue('A1', '10');
    enterValue('B1', '=A1+1');
    verifyContent('B1', '11');

    selectCell('B1');
    clickCopy();
    selectCell('A3');
    clickPaste();

    // The reference A1 shifted left by 1 col would be invalid
    verifyContent('A3', '#REF!');
  });
});


// ===========================================================================
// CUT + PASTE SCENARIOS
// ===========================================================================

describe('Cut and Paste – Formula Scenarios', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('#A1').should('exist');
  });

  // ---- Cut multi-cell range with internal references ----

  it('should adjust internal references when cutting a multi-cell range', () => {
    // A1: 5,  A2: =A1+1  (internal ref)
    // Cut A1:A2 → C3:C4.  Formula should become =C3+1
    enterValue('A1', '5');
    enterValue('A2', '=A1+1');
    verifyContent('A2', '6');

    cy.selectRange('A1', 'A2');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('C3');
    clickPaste();

    verifyContent('C3', '5');
    verifyContent('C4', '6');
    verifyFormula('C4', '=C3+1');

    // Source should be cleared
    verifyContent('A1', '');
    verifyContent('A2', '');
  });

  // ---- Cut multi-cell range – formulas referencing outside the range ----

  it('should preserve external references when cutting a range with outward refs', () => {
    // E1: 100
    // A1: =E1+1  (references cell outside cut range)
    // A2: 50
    // Cut A1:A2 → C3:C4.  Formula should still reference E1: =E1+1
    enterValue('E1', '100');
    enterValue('A1', '=E1+1');
    verifyContent('A1', '101');
    enterValue('A2', '50');

    cy.selectRange('A1', 'A2');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('C3');
    clickPaste();

    verifyFormula('C3', '=E1+1');
    verifyContent('C3', '101');
    verifyContent('C4', '50');
  });

  // ---- Cut range – outside formulas referencing into the range ----

  it('should update outside formulas that reference cells in the cut range', () => {
    // A1: 10,  A2: 20
    // C1: =A1+A2 (external formula referencing cut range)
    // Cut A1:A2 → D1:D2
    // C1's formula should update to =D1+D2
    enterValue('A1', '10');
    enterValue('A2', '20');
    enterValue('C1', '=A1+A2');
    verifyContent('C1', '30');

    cy.selectRange('A1', 'A2');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('D1');
    clickPaste();

    verifyContent('D1', '10');
    verifyContent('D2', '20');
    verifyFormula('C1', '=D1+D2');
    verifyContent('C1', '30');
  });

  // ---- Cut multi-cell range with mixed references ($A1 and A$1) ----

  it('should adjust mixed references when cutting a multi-cell range', () => {
    // B2: 5, B3: 10
    // C2: =$B2+B$3  (mixed refs, both inside the range B2:C3)
    // Cut B2:C3 → D5:E6
    // Since this is cut (not copy), both $ and non-$ parts move:
    //   $B2 → $D5, B$3 → D$6
    enterValue('B2', '5');
    enterValue('B3', '10');
    enterValue('C2', '=$B2+B$3');
    verifyContent('C2', '15');

    cy.selectRange('B2', 'C3');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('D5');
    clickPaste();

    verifyFormula('E5', '=$D5+D$6');
    verifyContent('E5', '15');
  });

  // ---- Cut with overlapping source and destination ----

  it('should handle overlapping source and destination correctly', () => {
    // A1: 10,  A2: =A1+1
    // Cut A1:A2 → A2:A3 (overlapping: A2 is in both source and dest)
    // Result: A2: 10, A3: =A2+1
    enterValue('A1', '10');
    enterValue('A2', '=A1+1');
    verifyContent('A2', '11');

    cy.selectRange('A1', 'A2');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');
    cy.get('#A1').should('have.class', 'cell-marked-for-cut');

    selectCell('A2');
    clickPaste();

    // Wait for paste to complete — cut markers should be gone
    cy.get('#A1').should('not.have.class', 'cell-marked-for-cut');

    // Verify display values
    verifyContent('A1', '');
    verifyContent('A2', '10');
    verifyContent('A3', '11');

    // Verify A3 has a live formula (not a literal) by changing its dependency
    // If A3 has =A2+1, changing A2 from 10 to 20 should make A3 show 21
    enterValue('A2', '20');
    verifyContent('A3', '21');
  });

  // ---- Cut transfers formatting ----

  it('should transfer formatting from source to destination when cutting', () => {
    // Bold A1, enter value, cut to C1 → C1 should be bold, A1 should not
    enterValue('A1', 'bold text');
    selectCell('A1');
    applyBold();

    // Verify A1 is bold
    cy.get('#A1').should(($el) => {
      expect($el[0].style.fontWeight).to.equal('bold');
    });

    selectCell('A1');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('C1');
    clickPaste();

    verifyContent('C1', 'bold text');

    // C1 should be bold (formatting transferred)
    cy.get('#C1').should(($el) => {
      expect($el[0].style.fontWeight).to.equal('bold');
    });

    // A1 should no longer be bold (formatting cleared from source)
    cy.get('#A1').should(($el) => {
      expect($el[0].style.fontWeight).to.not.equal('bold');
    });
  });

  // ---- Cut transfers highlight formatting ----

  it('should transfer highlight formatting from source to destination when cutting', () => {
    enterValue('A1', 'highlighted');
    selectCell('A1');
    applyHighlight();

    // Verify A1 has highlight
    cy.get('#A1').should(($el) => {
      const bg = $el[0].style.backgroundColor;
      expect(bg).to.not.equal('');
    });

    selectCell('A1');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('C1');
    clickPaste();

    verifyContent('C1', 'highlighted');

    // C1 should have highlight
    cy.get('#C1').should(($el) => {
      const bg = $el[0].style.backgroundColor;
      expect(bg).to.not.equal('');
    });

    // A1 should NOT have highlight
    cy.get('#A1').should(($el) => {
      const bg = $el[0].style.backgroundColor;
      expect(bg === '' || bg === 'transparent' || !bg).to.be.true;
    });
  });

  // ---- Larger multi-cell cut scenario (the bug report case) ----

  it('should handle cutting B2:D5 to C3:E6 with formulas', () => {
    // Build a small grid with values and formulas in B2:D5
    // B2: 1, C2: 2, D2: 3
    // B3: =B2+1, C3: =C2+1, D3: =D2+1
    enterValue('B2', '1');
    enterValue('C2', '2');
    enterValue('D2', '3');
    enterValue('B3', '=B2+1');
    enterValue('C3', '=C2+1');
    enterValue('D3', '=D2+1');
    verifyContent('B3', '2');
    verifyContent('C3', '3');
    verifyContent('D3', '4');

    cy.selectRange('B2', 'D3');
    clickCut();
    cy.get('button[title="Cancel Cut"]').should('be.visible');

    selectCell('C3');
    clickPaste();

    // Values should land at C3:E4
    verifyContent('C3', '1');
    verifyContent('D3', '2');
    verifyContent('E3', '3');

    // Formulas should adjust: B3's =B2+1 → =C3+1 (shifted +1 col, +1 row)
    verifyFormula('C4', '=C3+1');
    verifyContent('C4', '2');
    verifyFormula('D4', '=D3+1');
    verifyContent('D4', '3');
    verifyFormula('E4', '=E3+1');
    verifyContent('E4', '4');

    // Source cells that aren't in dest should be cleared
    verifyContent('B2', '');
    verifyContent('B3', '');
  });
});
