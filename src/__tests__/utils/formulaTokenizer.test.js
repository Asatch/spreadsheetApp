/**
 * Tests for Formula Tokenizer
 *
 * Tests the single-pass tokenizer that converts formula strings into
 * token arrays with type, position, and normalized value.
 */

import { tokenize, TokenType } from '../../utils/formulaTokenizer';

/** Helper: extract just types from token array */
const types = (tokens) => tokens.map(t => t.type);

/** Helper: extract just values from token array */
const values = (tokens) => tokens.map(t => t.value);

describe('formulaTokenizer', () => {
  describe('Empty and minimal input', () => {
    it('should return empty array for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('should return empty array for null/undefined', () => {
      expect(tokenize(null)).toEqual([]);
      expect(tokenize(undefined)).toEqual([]);
    });

    it('should tokenize bare equals sign', () => {
      const tokens = tokenize('=');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: 'EQUALS', start: 0, end: 1, value: '=' });
    });
  });

  describe('Leading equals', () => {
    it('should emit EQUALS for leading =', () => {
      const tokens = tokenize('=A1');
      expect(tokens[0]).toMatchObject({ type: 'EQUALS', start: 0, end: 1, value: '=' });
    });

    it('should not emit EQUALS when formula does not start with =', () => {
      const tokens = tokenize('A1+B1');
      expect(tokens[0].type).not.toBe('EQUALS');
    });
  });

  describe('Cell references', () => {
    it('should tokenize simple cell reference', () => {
      const tokens = tokenize('=A1');
      expect(tokens[1]).toMatchObject({ type: 'CELL_REF', start: 1, end: 3, value: 'A1' });
    });

    it('should tokenize two-letter column cell reference', () => {
      const tokens = tokenize('=AA1');
      expect(tokens[1]).toMatchObject({ type: 'CELL_REF', start: 1, end: 4, value: 'AA1' });
    });

    it('should handle $ in cell references — included in span, stripped from value', () => {
      const tokens = tokenize('=$A$1');
      expect(tokens[1].type).toBe('CELL_REF');
      expect(tokens[1].value).toBe('A1');
      expect(tokens[1].start).toBe(1);
      expect(tokens[1].end).toBe(5);
    });

    it('should handle partial $ in cell references', () => {
      const tokens = tokenize('=A$1');
      expect(tokens[1].type).toBe('CELL_REF');
      expect(tokens[1].value).toBe('A1');
      expect(tokens[1].start).toBe(1);
      expect(tokens[1].end).toBe(4);
    });

    it('should handle $ before column letter', () => {
      const tokens = tokenize('=$A1');
      expect(tokens[1].type).toBe('CELL_REF');
      expect(tokens[1].value).toBe('A1');
      expect(tokens[1].start).toBe(1);
      expect(tokens[1].end).toBe(4);
    });

    it('should handle ~ in cell references', () => {
      const tokens = tokenize('=~A~1');
      expect(tokens[1].type).toBe('CELL_REF');
      expect(tokens[1].value).toBe('A1');
    });

    it('should tokenize case-insensitively', () => {
      const tokens = tokenize('=a1');
      expect(tokens[1].type).toBe('CELL_REF');
      expect(tokens[1].value).toBe('A1');
    });

    it('should tokenize high-row cell reference', () => {
      const tokens = tokenize('=A100');
      expect(tokens[1]).toMatchObject({ type: 'CELL_REF', start: 1, end: 5, value: 'A100' });
    });
  });

  describe('Identifiers (function names, named entities)', () => {
    it('should tokenize function name', () => {
      const tokens = tokenize('=SUM(A1)');
      expect(tokens[1]).toMatchObject({ type: 'IDENT', start: 1, end: 4, value: 'SUM' });
    });

    it('should tokenize lowercase function name and uppercase the value', () => {
      const tokens = tokenize('=sum(a1)');
      expect(tokens[1].type).toBe('IDENT');
      expect(tokens[1].value).toBe('SUM');
    });

    it('should tokenize named entity', () => {
      const tokens = tokenize('=Revenue');
      expect(tokens[1].type).toBe('IDENT');
      expect(tokens[1].value).toBe('REVENUE');
    });

    it('should tokenize identifier with digits', () => {
      const tokens = tokenize('=VAL1');
      // VAL1 is not a valid cell ref pattern, so it should be IDENT
      // Actually VAL1 might match cell ref pattern... let me check
      // isCellReference tests against /^([A-Z]{1,2}|_STOP)([0-9]+)$/i after stripping $
      // VAL is 3 letters, so it won't match {1,2}
      expect(tokens[1].type).toBe('IDENT');
      expect(tokens[1].value).toBe('VAL1');
    });

    it('should tokenize identifier with underscores', () => {
      const tokens = tokenize('=MY_FUNC(A1)');
      expect(tokens[1].type).toBe('IDENT');
      expect(tokens[1].value).toBe('MY_FUNC');
    });

    it('should tokenize ITER as IDENT', () => {
      const tokens = tokenize('=ITER');
      expect(tokens[1].type).toBe('IDENT');
      expect(tokens[1].value).toBe('ITER');
    });
  });

  describe('Numbers', () => {
    it('should tokenize integer', () => {
      const tokens = tokenize('=42');
      expect(tokens[1]).toMatchObject({ type: 'NUMBER', start: 1, end: 3, value: '42' });
    });

    it('should tokenize decimal', () => {
      const tokens = tokenize('=3.14');
      expect(tokens[1]).toMatchObject({ type: 'NUMBER', start: 1, end: 5, value: '3.14' });
    });

    it('should tokenize number with leading decimal', () => {
      // .5 — the dot is not a digit, so tokenizer won't start a NUMBER token
      // This is fine: the parser handles this case
      const tokens = tokenize('=.5');
      expect(tokens[1].type).toBe('UNKNOWN'); // '.' is unknown
      expect(tokens[2].type).toBe('NUMBER');   // '5' is a number
    });

    it('should not include leading minus in number token', () => {
      const tokens = tokenize('=-5');
      expect(tokens[1].type).toBe('OP');
      expect(tokens[1].value).toBe('-');
      expect(tokens[2].type).toBe('NUMBER');
      expect(tokens[2].value).toBe('5');
    });
  });

  describe('String literals', () => {
    it('should tokenize quoted string and preserve case', () => {
      const tokens = tokenize('="hello"');
      expect(tokens[1]).toMatchObject({ type: 'STRING', start: 1, end: 8, value: '"hello"' });
    });

    it('should handle unclosed string gracefully', () => {
      const tokens = tokenize('="hello');
      expect(tokens[1].type).toBe('STRING');
      expect(tokens[1].start).toBe(1);
      expect(tokens[1].end).toBe(7); // consumes to end
    });

    it('should handle empty string', () => {
      const tokens = tokenize('=""');
      expect(tokens[1].type).toBe('STRING');
      expect(tokens[1].value).toBe('""');
    });

    it('should handle string with special characters', () => {
      const tokens = tokenize('="hello (world)"');
      expect(tokens[1].type).toBe('STRING');
      // Parentheses inside string should not become LPAREN/RPAREN
      expect(tokens).toHaveLength(2); // EQUALS + STRING
    });
  });

  describe('Booleans', () => {
    it('should tokenize TRUE', () => {
      const tokens = tokenize('=TRUE');
      expect(tokens[1]).toMatchObject({ type: 'BOOLEAN', start: 1, end: 5, value: 'TRUE' });
    });

    it('should tokenize FALSE', () => {
      const tokens = tokenize('=FALSE');
      expect(tokens[1]).toMatchObject({ type: 'BOOLEAN', start: 1, end: 6, value: 'FALSE' });
    });

    it('should tokenize case-insensitively', () => {
      const tokens = tokenize('=true');
      expect(tokens[1].type).toBe('BOOLEAN');
      expect(tokens[1].value).toBe('TRUE');
    });
  });

  describe('Error literals', () => {
    it('should tokenize #REF!', () => {
      const tokens = tokenize('=#REF!');
      expect(tokens[1]).toMatchObject({ type: 'ERROR', start: 1, end: 6, value: '#REF!' });
    });

    it('should tokenize #NAME!', () => {
      const tokens = tokenize('=#NAME!');
      expect(tokens[1]).toMatchObject({ type: 'ERROR', start: 1, end: 7, value: '#NAME!' });
    });

    it('should tokenize #SYNTAX!', () => {
      const tokens = tokenize('=#SYNTAX!');
      expect(tokens[1]).toMatchObject({ type: 'ERROR', start: 1, end: 9, value: '#SYNTAX!' });
    });

    it('should handle error without closing ! gracefully', () => {
      const tokens = tokenize('=#REF');
      expect(tokens[1].type).toBe('ERROR');
      expect(tokens[1].end).toBe(5); // consumes to end
    });
  });

  describe('Operators', () => {
    it('should tokenize arithmetic operators', () => {
      const tokens = tokenize('=A1+B1-C1*D1/E1^F1');
      const ops = tokens.filter(t => t.type === 'OP');
      expect(ops.map(t => t.value)).toEqual(['+', '-', '*', '/', '^']);
    });
  });

  describe('Comparison operators', () => {
    it('should tokenize single-char comparisons', () => {
      const tokens = tokenize('=A1<B1');
      expect(tokens[2]).toMatchObject({ type: 'COMPARE', start: 3, end: 4, value: '<' });
    });

    it('should tokenize > comparison', () => {
      const tokens = tokenize('=A1>B1');
      expect(tokens[2]).toMatchObject({ type: 'COMPARE', start: 3, end: 4, value: '>' });
    });

    it('should tokenize <= comparison', () => {
      const tokens = tokenize('=A1<=B1');
      expect(tokens[2]).toMatchObject({ type: 'COMPARE', start: 3, end: 5, value: '<=' });
    });

    it('should tokenize >= comparison', () => {
      const tokens = tokenize('=A1>=B1');
      expect(tokens[2]).toMatchObject({ type: 'COMPARE', start: 3, end: 5, value: '>=' });
    });

    it('should tokenize <> comparison', () => {
      const tokens = tokenize('=A1<>B1');
      expect(tokens[2]).toMatchObject({ type: 'COMPARE', start: 3, end: 5, value: '<>' });
    });

    it('should tokenize = as comparison inside formula', () => {
      const tokens = tokenize('=A1=B1');
      // First = is EQUALS, second = is COMPARE
      expect(tokens[0].type).toBe('EQUALS');
      expect(tokens[2].type).toBe('COMPARE');
      expect(tokens[2].value).toBe('=');
    });
  });

  describe('Colon (range operator)', () => {
    it('should tokenize colon', () => {
      const tokens = tokenize('=A1:B2');
      expect(tokens[2]).toMatchObject({ type: 'COLON', start: 3, end: 4, value: ':' });
    });
  });

  describe('Structural tokens', () => {
    it('should tokenize parentheses', () => {
      const tokens = tokenize('=(A1)');
      expect(tokens[1]).toMatchObject({ type: 'LPAREN', start: 1, end: 2, value: '(' });
      expect(tokens[3]).toMatchObject({ type: 'RPAREN', start: 4, end: 5, value: ')' });
    });

    it('should tokenize comma', () => {
      const tokens = tokenize('=SUM(A1,B1)');
      // EQUALS, IDENT(SUM), LPAREN, CELL_REF(A1), COMMA, CELL_REF(B1), RPAREN
      expect(tokens[4]).toMatchObject({ type: 'COMMA', start: 7, end: 8, value: ',' });
    });
  });

  describe('Whitespace handling', () => {
    it('should emit WHITESPACE tokens', () => {
      const tokens = tokenize('= A1 + B1 ');
      const wsTokens = tokens.filter(t => t.type === 'WHITESPACE');
      expect(wsTokens.length).toBeGreaterThan(0);
    });

    it('should produce correct positions with whitespace tokens', () => {
      const tokens = tokenize('= A1 + B1');
      // '=' at 0, ' ' at 1, 'A1' at 2-4, ' ' at 4, '+' at 5, ' ' at 6, 'B1' at 7-9
      const nonWs = tokens.filter(t => t.type !== 'WHITESPACE');
      expect(nonWs[0]).toMatchObject({ type: 'EQUALS', start: 0, end: 1, value: '=' });
      expect(nonWs[1]).toMatchObject({ type: 'CELL_REF', start: 2, end: 4, value: 'A1' });
      expect(nonWs[2]).toMatchObject({ type: 'OP', start: 5, end: 6, value: '+' });
      expect(nonWs[3]).toMatchObject({ type: 'CELL_REF', start: 7, end: 9, value: 'B1' });
    });

    it('should have contiguous coverage including whitespace', () => {
      const tokens = tokenize('= A1 + B1');
      // Every character accounted for — no gaps
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i].start).toBe(tokens[i - 1].end);
      }
    });

    it('should handle tabs as whitespace', () => {
      const tokens = tokenize('=\tA1');
      const wsTokens = tokens.filter(t => t.type === 'WHITESPACE');
      expect(wsTokens).toHaveLength(1);
      expect(wsTokens[0].value).toBe('\t');
      const nonWs = tokens.filter(t => t.type !== 'WHITESPACE');
      expect(nonWs[1].type).toBe('CELL_REF');
    });

    it('should coalesce adjacent whitespace into one token', () => {
      const tokens = tokenize('=  A1');
      const wsTokens = tokens.filter(t => t.type === 'WHITESPACE');
      expect(wsTokens).toHaveLength(1);
      expect(wsTokens[0]).toMatchObject({ start: 1, end: 3, value: '  ' });
    });

    it('should handle NBSP (U+00A0) as whitespace', () => {
      // Browsers convert consecutive spaces in contentEditable to NBSP, and pasted
      // content from word processors / web pages often carries NBSPs.
      const tokens = tokenize('=\u00A0A1');
      const wsTokens = tokens.filter(t => t.type === 'WHITESPACE');
      expect(wsTokens).toHaveLength(1);
      expect(wsTokens[0].value).toBe('\u00A0');
      const nonWs = tokens.filter(t => t.type !== 'WHITESPACE');
      expect(nonWs[1].type).toBe('CELL_REF');
    });
  });

  describe('Unknown tokens', () => {
    it('should tokenize unknown characters', () => {
      const tokens = tokenize('=A1@B1');
      expect(tokens[2]).toMatchObject({ type: 'UNKNOWN', start: 3, end: 4, value: '@' });
    });

    it('should tokenize standalone $ as unknown', () => {
      const tokens = tokenize('=$');
      expect(tokens[1]).toMatchObject({ type: 'UNKNOWN', start: 1, end: 2, value: '$' });
    });
  });

  describe('Complete formulas', () => {
    it('should tokenize SUM function call', () => {
      const tokens = tokenize('=SUM(A1,B1)');
      expect(types(tokens)).toEqual([
        'EQUALS', 'IDENT', 'LPAREN', 'CELL_REF', 'COMMA', 'CELL_REF', 'RPAREN'
      ]);
      expect(values(tokens)).toEqual(['=', 'SUM', '(', 'A1', ',', 'B1', ')']);
    });

    it('should tokenize nested function call', () => {
      const tokens = tokenize('=IF(A1>0,SUM(B1:B10),0)');
      expect(types(tokens)).toEqual([
        'EQUALS', 'IDENT', 'LPAREN',
        'CELL_REF', 'COMPARE', 'NUMBER', 'COMMA',
        'IDENT', 'LPAREN', 'CELL_REF', 'COLON', 'CELL_REF', 'RPAREN', 'COMMA',
        'NUMBER',
        'RPAREN'
      ]);
    });

    it('should tokenize arithmetic expression', () => {
      const tokens = tokenize('=A1+B1*C1');
      expect(types(tokens)).toEqual([
        'EQUALS', 'CELL_REF', 'OP', 'CELL_REF', 'OP', 'CELL_REF'
      ]);
    });

    it('should tokenize formula with absolute references', () => {
      const tokens = tokenize('=$A$1+$B$2');
      expect(types(tokens)).toEqual(['EQUALS', 'CELL_REF', 'OP', 'CELL_REF']);
      expect(values(tokens)).toEqual(['=', 'A1', '+', 'B2']);
      // But the spans cover the $ characters
      expect(tokens[1].start).toBe(1);
      expect(tokens[1].end).toBe(5); // $A$1 is 4 chars
      expect(tokens[3].start).toBe(6);
      expect(tokens[3].end).toBe(10); // $B$2 is 4 chars
    });

    it('should tokenize unary minus followed by expression', () => {
      const tokens = tokenize('=-A1');
      expect(types(tokens)).toEqual(['EQUALS', 'OP', 'CELL_REF']);
      expect(values(tokens)).toEqual(['=', '-', 'A1']);
    });

    it('should tokenize complex formula with string', () => {
      const tokens = tokenize('=IF(A1="yes",B1,C1)');
      expect(types(tokens)).toEqual([
        'EQUALS', 'IDENT', 'LPAREN',
        'CELL_REF', 'COMPARE', 'STRING', 'COMMA',
        'CELL_REF', 'COMMA', 'CELL_REF',
        'RPAREN'
      ]);
    });

    it('should handle formula with range and function', () => {
      const tokens = tokenize('=SUM(A1:B2)');
      expect(types(tokens)).toEqual([
        'EQUALS', 'IDENT', 'LPAREN', 'CELL_REF', 'COLON', 'CELL_REF', 'RPAREN'
      ]);
    });
  });

  describe('Position accuracy', () => {
    it('should have correct positions for every token in a complex formula', () => {
      const formula = '=SUM(A1,B1+C1)';
      const tokens = tokenize(formula);

      for (const token of tokens) {
        // Raw text from source should be recoverable
        const raw = formula.slice(token.start, token.end);
        // Verify the span is non-empty
        expect(token.end).toBeGreaterThan(token.start);
        // Verify raw text uppercased matches value (for non-cell-ref tokens without $)
        // For cell refs, value has $ stripped, so we compare differently
        if (token.type !== 'CELL_REF') {
          expect(raw.toUpperCase()).toBe(token.value);
        }
      }
    });

    it('should have contiguous coverage (no gaps except whitespace)', () => {
      const formula = '=A1+B1';
      const tokens = tokenize(formula);

      // No whitespace, so tokens should be contiguous
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i].start).toBe(tokens[i - 1].end);
      }
      expect(tokens[0].start).toBe(0);
      expect(tokens[tokens.length - 1].end).toBe(formula.length);
    });

    it('should have gaps only where whitespace exists', () => {
      const formula = '= A1 + B1';
      const tokens = tokenize(formula);

      // Verify gaps are only whitespace
      let pos = 0;
      for (const token of tokens) {
        const gap = formula.slice(pos, token.start);
        expect(gap.trim()).toBe(''); // gap is only whitespace
        pos = token.end;
      }
      // Trailing whitespace after last token is fine too
      const trailing = formula.slice(pos);
      expect(trailing.trim()).toBe('');
    });
  });

  describe('Edge cases', () => {
    it('should handle formula with only whitespace after =', () => {
      const tokens = tokenize('=   ');
      expect(tokens).toHaveLength(2); // EQUALS + WHITESPACE
      expect(tokens[0]).toMatchObject({ type: 'EQUALS', start: 0, end: 1, value: '=' });
      expect(tokens[1]).toMatchObject({ type: 'WHITESPACE', start: 1, end: 4 });
    });

    it('should handle _STOP special column', () => {
      const tokens = tokenize('=_STOP0');
      // _STOP0 matches the cell ref pattern with reserved column _STOP
      expect(tokens[1].type).toBe('CELL_REF');
      expect(tokens[1].value).toBe('_STOP0');
    });

    it('should handle consecutive operators', () => {
      const tokens = tokenize('=A1++B1');
      expect(types(tokens)).toEqual(['EQUALS', 'CELL_REF', 'OP', 'OP', 'CELL_REF']);
    });

    it('should handle unmatched parentheses', () => {
      const tokens = tokenize('=SUM(A1');
      expect(types(tokens)).toEqual(['EQUALS', 'IDENT', 'LPAREN', 'CELL_REF']);
      // No RPAREN — that's fine, tokenizer doesn't validate structure
    });

    it('should handle extra closing parenthesis', () => {
      const tokens = tokenize('=A1)');
      expect(types(tokens)).toEqual(['EQUALS', 'CELL_REF', 'RPAREN']);
    });

    it('should handle non-formula input (no leading =)', () => {
      const tokens = tokenize('42');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: 'NUMBER', start: 0, end: 2, value: '42' });
    });

    it('should handle plain text input', () => {
      const tokens = tokenize('hello');
      expect(tokens[0].type).toBe('IDENT');
      expect(tokens[0].value).toBe('HELLO');
    });

    it('should handle error literal in expression', () => {
      const tokens = tokenize('=#REF!+1');
      expect(types(tokens)).toEqual(['EQUALS', 'ERROR', 'OP', 'NUMBER']);
    });

    it('should handle percent sign as unknown', () => {
      const tokens = tokenize('=50%');
      expect(tokens[1].type).toBe('NUMBER');
      expect(tokens[2].type).toBe('UNKNOWN');
      expect(tokens[2].value).toBe('%');
    });
  });
});
