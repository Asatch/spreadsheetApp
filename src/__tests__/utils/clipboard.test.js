import {
  generateClipboardHash,
  formatCellsForClipboard,
  replaceOverwrittenCellRefsInTokens,
  adjustTokenReferences
} from '../../utils/clipboardUtils';
import { tokenize, serializeTokens } from '../../utils/formulaTokenizer.js';

// ============================================================================
// Test-only string-in/string-out wrappers
// ============================================================================
// These are thin adapters over the token-native utilities in clipboardUtils.js.
// Production code now operates on tokens directly (tokenize once at the edge,
// mutate through the pipeline, serialize at the storage boundary). These
// wrappers exist purely so the historical edge-case test suite below — which
// was written against string-in/string-out signatures — keeps covering those
// cases without requiring every test to construct a token array by hand.

function replaceOverwrittenCellsWithRef(formula, overwrittenCells) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=') || !overwrittenCells?.size) {
    return formula;
  }
  const tokens = tokenize(formula);
  replaceOverwrittenCellRefsInTokens(tokens, overwrittenCells);
  return serializeTokens(tokens);
}

function adjustFormulaReferences(formula, sourceRange, targetTopLeft, options = {}) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }
  const tokens = tokenize(formula);
  const ok = adjustTokenReferences(tokens, sourceRange, targetTopLeft, options);
  if (!ok) return formula;
  return serializeTokens(tokens);
}

describe('Clipboard operations', () => {
  describe('generateClipboardHash', () => {
    it('should generate the same hash for identical strings', () => {
      const text = "Sample clipboard content";
      const hash1 = generateClipboardHash(text);
      const hash2 = generateClipboardHash(text);
      
      expect(hash1).toBe(hash2);
    });
    
    it('should generate different hashes for different strings', () => {
      const text1 = "Sample clipboard content";
      const text2 = "Different clipboard content";
      const hash1 = generateClipboardHash(text1);
      const hash2 = generateClipboardHash(text2);
      
      expect(hash1).not.toBe(hash2);
    });
    
    it('should return empty string for empty input', () => {
      expect(generateClipboardHash('')).toBe('');
      expect(generateClipboardHash(null)).toBe('');
      expect(generateClipboardHash(undefined)).toBe('');
    });
  });
  
  describe('formatCellsForClipboard', () => {
    // Test data: cellKey -> value mapping
    const testData = {
      'A1': '10',
      'A2': 'Text',
      'B1': '=A1*2',
      'B2': '',
      'C1': 'Display Only'
    };

    // Helper function that acts as getValue callback
    const getValue = (cellKey) => testData[cellKey] || '';

    it('should format a single cell for clipboard', () => {
      const cellKeys = ['A1'];
      const selectionRange = { start: 'A1', end: 'A1' };
      const result = formatCellsForClipboard(getValue, cellKeys, selectionRange);

      expect(result).toBe('10');
    });

    it('should format multiple cells for clipboard in a tab-delimited format', () => {
      const cellKeys = ['A1', 'B1', 'A2', 'B2'];
      const selectionRange = { start: 'A1', end: 'B2' };
      const result = formatCellsForClipboard(getValue, cellKeys, selectionRange);

      // Expected output:
      // 10    =A1*2
      // Text  [empty]
      expect(result).toBe('10\t=A1*2\nText\t');
    });

    it('should preserve formulas in clipboard text', () => {
      const cellKeys = ['B1'];
      const selectionRange = { start: 'B1', end: 'B1' };
      const result = formatCellsForClipboard(getValue, cellKeys, selectionRange);

      expect(result).toBe('=A1*2');
    });

    it('should use value when available', () => {
      const cellKeys = ['C1'];
      const selectionRange = { start: 'C1', end: 'C1' };
      const result = formatCellsForClipboard(getValue, cellKeys, selectionRange);

      expect(result).toBe('Display Only');
    });

    it('should return empty string for empty selection', () => {
      expect(formatCellsForClipboard(getValue, [], { start: 'A1', end: 'A1' })).toBe('');
      expect(formatCellsForClipboard(getValue, null, { start: 'A1', end: 'A1' })).toBe('');
      expect(formatCellsForClipboard(null, ['A1'], { start: 'A1', end: 'A1' })).toBe('');
    });
  });
  
  describe('replaceOverwrittenCellsWithRef', () => {
    it('should replace references to overwritten cells with #REF!', () => {
      const formula = '=A1+B2+C3';
      const overwrittenCells = new Set(['B2', 'D4']);
      
      const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);
      
      expect(result).toBe('=A1+#REF!+C3');
    });
    
    it('should replace multiple references to overwritten cells', () => {
      const formula = '=SUM(A1:A5)+B2*C3';
      const overwrittenCells = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'C3']);
      
      const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);
      
      // This is a complex case since the range reference A1:A5 involves multiple cells
      // In a real implementation, this might need more sophisticated handling
      // Our expectation is based on the current implementation
      expect(result).toBe('=SUM(#REF!:#REF!)+B2*#REF!');
    });
    
    it('should handle absolute references correctly', () => {
      const formula = '=$A$1+$B2+C$3';
      const overwrittenCells = new Set(['A1', 'C3']);
      
      const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);
      
      expect(result).toBe('=#REF!+$B2+#REF!');
    });
    
    it('should return the original formula if no overwritten cells', () => {
      const formula = '=A1+B2+C3';
      const overwrittenCells = new Set(['D4', 'E5']);
      
      const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);
      
      expect(result).toBe(formula);
    });
    
    it('should return the original input if not a formula', () => {
      expect(replaceOverwrittenCellsWithRef('A1+B2', new Set(['A1']))).toBe('A1+B2');
      expect(replaceOverwrittenCellsWithRef('', new Set(['A1']))).toBe('');
      expect(replaceOverwrittenCellsWithRef(null, new Set(['A1']))).toBe(null);
    });
    
    it('should handle empty or missing overwrittenCells set', () => {
      const formula = '=A1+B2';
      
      expect(replaceOverwrittenCellsWithRef(formula, new Set())).toBe(formula);
      expect(replaceOverwrittenCellsWithRef(formula, null)).toBe(formula);
      expect(replaceOverwrittenCellsWithRef(formula)).toBe(formula);
    });
  });
  
  describe('adjustFormulaReferences', () => {
    it('should adjust references within a cut range', () => {
      // Formula inside a cell being cut from A1:B2 to C3
      const formula = '=A1+B2';
      const sourceRange = { start: 'A1', end: 'B2' };
      const targetTopLeft = 'C3';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: true
      });
      
      // References should be adjusted to the new position
      expect(result).toBe('=C3+D4');
    });
    
    it('should adjust references to a cut range from outside', () => {
      // Formula that references cells in a range being cut
      const formula = '=SUM(A1:B2)';
      const sourceRange = { start: 'A1', end: 'B2' };
      const targetTopLeft = 'C3';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: true
      });
      
      // References should be adjusted to the new position
      expect(result).toBe('=SUM(C3:D4)');
    });
    
    it('should replace references to overwritten cells with #REF!', () => {
      const formula = '=A1+B2+C3';
      const sourceRange = { start: 'D1', end: 'E2' };
      const targetTopLeft = 'A1';
      const overwrittenCells = new Set(['B2']);
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: true,
        overwrittenCells
      });
      
      expect(result).toBe('=A1+#REF!+C3');
    });
    
    it('should preserve absolute references', () => {
      const formula = '=$A$1+$B2+C$3';
      const sourceRange = { start: 'A1', end: 'C3' };
      const targetTopLeft = 'D4';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: true
      });
      
      // Absolute references should remain absolute but point to new locations
      expect(result).toBe('=$D$4+$E5+F$6');
    });
    
    it('should handle references outside the source range', () => {
      // Formula with references both inside and outside the cut range
      const formula = '=A1+Z99';
      const sourceRange = { start: 'A1', end: 'B2' };
      const targetTopLeft = 'C3';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: true
      });
      
      // Only A1 should be adjusted, Z99 should remain the same
      expect(result).toBe('=C3+Z99');
    });
    
    it('should return the original formula if not a formula', () => {
      expect(adjustFormulaReferences('A1+B2', { start: 'A1', end: 'B2' }, 'C3')).toBe('A1+B2');
      expect(adjustFormulaReferences('', { start: 'A1', end: 'B2' }, 'C3')).toBe('');
      expect(adjustFormulaReferences(null, { start: 'A1', end: 'B2' }, 'C3')).toBe(null);
    });
    
    it('should handle invalid range specifications', () => {
      const formula = '=A1+B2';
      
      expect(adjustFormulaReferences(formula, { start: 'invalid' }, 'C3')).toBe(formula);
      expect(adjustFormulaReferences(formula, { start: 'A1' }, 'invalid')).toBe(formula);
      expect(adjustFormulaReferences(formula, {}, 'C3')).toBe(formula);
    });

    it('should adjust references correctly for copy operations', () => {
      // Formula referencing cell in the copy range - when copied, should reference new position
      const formula = '=A1+B2';
      const sourceRange = { start: 'A1', end: 'B2' };
      const targetTopLeft = 'C3';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: false // This is a COPY operation
      });
      
      // References should be adjusted to the new position 
      expect(result).toBe('=C3+D4');
    });
    
    it('should respect absolute references during copy operations', () => {
      const formula = '=$A$1+$B2+C$3';
      const sourceRange = { start: 'A1', end: 'C3' };
      const targetTopLeft = 'D4';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: false // This is a COPY operation
      });
      
      // Absolute references should stay fixed according to $ signs:
      // $A$1 - both column and row absolute, should remain $A$1
      // $B2 - column absolute, row relative, should become $B5 (row shifted by 3)
      // C$3 - column relative, row absolute, should become F$3 (column shifted from C to F)
      expect(result).toBe('=$A$1+$B5+F$3');
    });
    
    it('should adjust external references when copying a formula', () => {
      // This tests the scenario where copying a cell with a formula should update
      // references to cells outside the copied range by the same relative offset
      
      // Scenario: B2 contains formula "=A1+1", copying to C2 should result in "=B1+1"
      const formula = '=A1+1';
      const sourceRange = { start: 'B2', end: 'B2' }; // Single cell range
      const targetTopLeft = 'C2';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: false // This is a COPY operation
      });
      
      // The A1 reference should shift right by one column to become B1
      // because we're moving from column B to column C (one column to the right)
      expect(result).toBe('=B1+1');
    });
    
    it('should adjust multiple external references when copying formulas', () => {
      // Test copying a formula that references multiple external cells
      const formula = '=A1+B1+A2';
      const sourceRange = { start: 'C3', end: 'C3' };
      const targetTopLeft = 'E5';
      
      const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
        isCutOperation: false // This is a COPY operation
      });
      
      // All references should shift by the same offset (2 columns, 2 rows)
      expect(result).toBe('=C3+D3+C4');
    });
  });

  describe('Edge Cases', () => {
    describe('formatCellsForClipboard - Edge Cases', () => {
      const testData = {
        'A1': '10',
        'A2': 'Text',
        'B1': '=A1*2',
        'B2': '',
        'C1': 'Display Only'
      };
      const getValue = (cellKey) => testData[cellKey] || '';

      it('should handle very large ranges', () => {
        // Create a 10x10 grid
        const largeCellKeys = [];
        for (let row = 1; row <= 10; row++) {
          for (let col = 0; col < 10; col++) {
            const colLetter = String.fromCharCode(65 + col); // A-J
            largeCellKeys.push(`${colLetter}${row}`);
          }
        }

        const result = formatCellsForClipboard(getValue, largeCellKeys, { start: 'A1', end: 'J10' });

        // Should produce 10 rows (separated by \n)
        const rows = result.split('\n');
        expect(rows.length).toBe(10);
        // Each row should have 10 columns (separated by \t)
        expect(rows[0].split('\t').length).toBe(10);
      });

      it('should handle single row range', () => {
        const cellKeys = ['A1', 'B1', 'C1'];
        const result = formatCellsForClipboard(getValue, cellKeys, { start: 'A1', end: 'C1' });

        expect(result).toBe('10\t=A1*2\tDisplay Only');
        expect(result).not.toContain('\n'); // No newlines for single row
      });

      it('should handle single column range', () => {
        const cellKeys = ['A1', 'A2'];
        const result = formatCellsForClipboard(getValue, cellKeys, { start: 'A1', end: 'A2' });

        expect(result).toBe('10\nText');
      });

      it('should handle all empty cells', () => {
        const emptyCellKeys = ['D1', 'D2', 'E1', 'E2'];
        const result = formatCellsForClipboard(getValue, emptyCellKeys, { start: 'D1', end: 'E2' });

        expect(result).toBe('\t\n\t');
      });

      it('should handle cells with special characters', () => {
        const specialData = {
          'A1': 'Line1\nLine2',
          'B1': 'Tab\there',
          'C1': 'Quote"here'
        };
        const specialGetValue = (cellKey) => specialData[cellKey] || '';

        const result = formatCellsForClipboard(specialGetValue, ['A1', 'B1', 'C1'], { start: 'A1', end: 'C1' });

        expect(result).toContain('Line1\nLine2');
        expect(result).toContain('Tab\there');
        expect(result).toContain('Quote"here');
      });

      it('should handle cells with formulas containing commas', () => {
        const commaData = {
          'A1': '=SUM(A1,B1,C1)',
          'B1': '=IF(A1>0,"Yes","No")'
        };
        const commaGetValue = (cellKey) => commaData[cellKey] || '';

        const result = formatCellsForClipboard(commaGetValue, ['A1', 'B1'], { start: 'A1', end: 'B1' });

        expect(result).toBe('=SUM(A1,B1,C1)\t=IF(A1>0,"Yes","No")');
      });

      it('should handle null getValue callback gracefully', () => {
        const result = formatCellsForClipboard(null, ['A1'], { start: 'A1', end: 'A1' });
        expect(result).toBe('');
      });

      it('should handle undefined cells in the range', () => {
        const result = formatCellsForClipboard(getValue, ['Z99', 'Z100'], { start: 'Z99', end: 'Z100' });
        // Should return empty values
        expect(result).toBe('\n');
      });

      it('should handle very long cell values', () => {
        const longData = {
          'A1': 'x'.repeat(10000)
        };
        const longGetValue = (cellKey) => longData[cellKey] || '';

        const result = formatCellsForClipboard(longGetValue, ['A1'], { start: 'A1', end: 'A1' });

        expect(result.length).toBe(10000);
      });
    });

    describe('replaceOverwrittenCellsWithRef - Edge Cases', () => {
      it('should handle formulas with many cell references', () => {
        const formula = '=A1+A2+A3+A4+A5+A6+A7+A8+A9+A10';
        const overwrittenCells = new Set(['A2', 'A5', 'A8']);

        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=A1+#REF!+A3+A4+#REF!+A6+A7+#REF!+A9+A10');
      });

      it('should handle formulas with nested functions and overwritten cells', () => {
        const formula = '=SUM(IF(A1>0,B2,C3))';
        const overwrittenCells = new Set(['B2']);

        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=SUM(IF(A1>0,#REF!,C3))');
      });

      it('should handle formulas where all references are overwritten', () => {
        const formula = '=A1+B2+C3';
        const overwrittenCells = new Set(['A1', 'B2', 'C3']);

        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=#REF!+#REF!+#REF!');
      });

      it('should handle formulas with same cell referenced multiple times', () => {
        const formula = '=A1+A1*A1';
        const overwrittenCells = new Set(['A1']);

        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=#REF!+#REF!*#REF!');
      });

      it('should not replace cell-like strings that aren\'t references', () => {
        const formula = '=A1+1';
        const overwrittenCells = new Set(['A1', 'B1']);

        // B1 is in overwritten set but not in formula
        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=#REF!+1');
      });

      it('should handle large Set of overwritten cells', () => {
        const formula = '=SUM(A1:A100)';
        const overwrittenCells = new Set();
        // Add many cells to the set
        for (let i = 1; i <= 100; i++) {
          overwrittenCells.add(`A${i}`);
        }

        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=SUM(#REF!:#REF!)');
      });

      it('should handle mixed row and column letters', () => {
        const formula = '=AA1+AB2+BA3';
        const overwrittenCells = new Set(['AB2']);

        const result = replaceOverwrittenCellsWithRef(formula, overwrittenCells);

        expect(result).toBe('=AA1+#REF!+BA3');
      });
    });

    describe('adjustFormulaReferences - Edge Cases', () => {
      it('should handle very large offset adjustments', () => {
        const formula = '=A1+B2';
        const sourceRange = { start: 'A1', end: 'B2' };
        const targetTopLeft = 'ZZ999';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        expect(result).toBeDefined();
        expect(result).toContain('ZZ');
      });

      it('should handle negative offsets (moving left/up)', () => {
        const formula = '=C3+D4';
        const sourceRange = { start: 'C3', end: 'D4' };
        const targetTopLeft = 'A1';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        expect(result).toBe('=A1+B2');
      });

      it('should handle formula with only absolute references', () => {
        const formula = '=$A$1+$B$2';
        const sourceRange = { start: 'C3', end: 'C3' };
        const targetTopLeft = 'E5';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        // Absolute references should not change in copy operation
        expect(result).toBe('=$A$1+$B$2');
      });

      it('should handle formula with mixed relative and absolute in same reference', () => {
        const formula = '=$A1+B$2';
        const sourceRange = { start: 'C3', end: 'C3' };
        const targetTopLeft = 'D5';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        // $A1: column absolute, row relative -> $A3 (row shifts by 2)
        // B$2: column relative, row absolute -> C$2 (column shifts by 1)
        expect(result).toBe('=$A3+C$2');
      });

      it('should handle formulas with nested parentheses', () => {
        const formula = '=((A1+B2)*C3)';
        const sourceRange = { start: 'D1', end: 'D1' };
        const targetTopLeft = 'E1';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        // All external references should shift by 1 column
        expect(result).toBe('=((B1+C2)*D3)');
      });

      it('should handle formulas referencing the entire range being moved', () => {
        const formula = '=SUM(A1:C3)';
        const sourceRange = { start: 'A1', end: 'C3' };
        const targetTopLeft = 'D4';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: true
        });

        expect(result).toBe('=SUM(D4:F6)');
      });

      it('should handle moving formula to same location (no-op)', () => {
        const formula = '=A1+B2';
        const sourceRange = { start: 'C3', end: 'C3' };
        const targetTopLeft = 'C3';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        // No change expected
        expect(result).toBe('=A1+B2');
      });

      it('should handle formulas with error values', () => {
        const formula = '=A1+#REF!';
        const sourceRange = { start: 'B1', end: 'B1' };
        const targetTopLeft = 'C1';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        // Should adjust A1 but preserve #REF!
        expect(result).toBe('=B1+#REF!');
      });

      it('should handle complex formulas with multiple function calls', () => {
        const formula = '=SUM(A1:A10)+AVERAGE(B1:B10)*MAX(C1:C10)';
        const sourceRange = { start: 'D1', end: 'D1' };
        const targetTopLeft = 'E1';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {
          isCutOperation: false
        });

        // All ranges should shift by 1 column
        expect(result).toBe('=SUM(B1:B10)+AVERAGE(C1:C10)*MAX(D1:D10)');
      });

      it('should handle empty options object', () => {
        const formula = '=A1+B2';
        const sourceRange = { start: 'C3', end: 'C3' };
        const targetTopLeft = 'D4';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft, {});

        expect(result).toBeDefined();
      });

      it('should handle undefined options', () => {
        const formula = '=A1+B2';
        const sourceRange = { start: 'C3', end: 'C3' };
        const targetTopLeft = 'D4';

        const result = adjustFormulaReferences(formula, sourceRange, targetTopLeft);

        expect(result).toBeDefined();
      });
    });

    describe('generateClipboardHash - Edge Cases', () => {
      it('should generate same hash for identical multi-line content', () => {
        const multiline = "Line1\nLine2\nLine3";
        const hash1 = generateClipboardHash(multiline);
        const hash2 = generateClipboardHash(multiline);

        expect(hash1).toBe(hash2);
        expect(hash1).not.toBe('');
      });

      it('should generate different hashes for similar content', () => {
        const content1 = "abc";
        const content2 = "abd";

        expect(generateClipboardHash(content1)).not.toBe(generateClipboardHash(content2));
      });

      it('should handle very long strings', () => {
        const longString = 'x'.repeat(100000);
        const hash = generateClipboardHash(longString);

        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
      });

      it('should handle strings with special characters', () => {
        const special = "Special: \t\n\r\0 characters!@#$%^&*()";
        const hash = generateClipboardHash(special);

        expect(hash).toBeDefined();
        expect(hash).not.toBe('');
      });

      it('should handle unicode strings', () => {
        const unicode = "Hello 世界 🎉";
        const hash = generateClipboardHash(unicode);

        expect(hash).toBeDefined();
        expect(hash).not.toBe('');
      });

      it('should differentiate between whitespace differences', () => {
        const str1 = "hello world";
        const str2 = "hello  world"; // Two spaces

        expect(generateClipboardHash(str1)).not.toBe(generateClipboardHash(str2));
      });
    });
  });
});