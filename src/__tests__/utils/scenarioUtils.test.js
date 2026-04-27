import { crossProduct, sampleCrossProduct, findTopDriver, formatNum, parseInputValue, formatOutputVal } from '../../utils/scenarioUtils.js';

// ============================================================================
// crossProduct
// ============================================================================

describe('crossProduct', () => {
  test('returns single empty object for no inputs', () => {
    expect(crossProduct([])).toEqual([{}]);
  });

  test('returns one combo per value for a single input', () => {
    const result = crossProduct([{ name: 'X', values: [1, 2, 3] }]);
    expect(result).toEqual([{ X: 1 }, { X: 2 }, { X: 3 }]);
  });

  test('returns full cross product of two inputs', () => {
    const result = crossProduct([
      { name: 'A', values: [1, 2] },
      { name: 'B', values: [10, 20] },
    ]);
    expect(result).toEqual([
      { A: 1, B: 10 },
      { A: 1, B: 20 },
      { A: 2, B: 10 },
      { A: 2, B: 20 },
    ]);
  });

  test('returns full cross product of three inputs', () => {
    const result = crossProduct([
      { name: 'A', values: [1, 2] },
      { name: 'B', values: [10] },
      { name: 'C', values: ['x', 'y'] },
    ]);
    expect(result).toEqual([
      { A: 1, B: 10, C: 'x' },
      { A: 1, B: 10, C: 'y' },
      { A: 2, B: 10, C: 'x' },
      { A: 2, B: 10, C: 'y' },
    ]);
  });

  test('returns empty array when any input has no values', () => {
    const result = crossProduct([
      { name: 'A', values: [1, 2] },
      { name: 'B', values: [] },
    ]);
    expect(result).toEqual([]);
  });

  test('produces correct count for larger inputs', () => {
    const result = crossProduct([
      { name: 'A', values: [1, 2, 3] },
      { name: 'B', values: [4, 5] },
      { name: 'C', values: [6, 7, 8] },
    ]);
    expect(result).toHaveLength(3 * 2 * 3);
  });

  test('handles string values', () => {
    const result = crossProduct([
      { name: 'color', values: ['red', 'blue'] },
      { name: 'size', values: ['S', 'L'] },
    ]);
    expect(result).toEqual([
      { color: 'red', size: 'S' },
      { color: 'red', size: 'L' },
      { color: 'blue', size: 'S' },
      { color: 'blue', size: 'L' },
    ]);
  });
});

// ============================================================================
// sampleCrossProduct
// ============================================================================

describe('sampleCrossProduct', () => {
  test('returns all combinations when sampleSize >= total', () => {
    const configs = [
      { name: 'x', values: [1, 2] },
      { name: 'y', values: [10, 20] },
    ];
    const result = sampleCrossProduct(configs, 100);
    expect(result).toHaveLength(4);
  });

  test('returns exact sample size when less than total', () => {
    const configs = [
      { name: 'x', values: [1, 2, 3, 4, 5] },
      { name: 'y', values: [10, 20, 30, 40, 50] },
    ];
    const result = sampleCrossProduct(configs, 7);
    expect(result).toHaveLength(7);
  });

  test('returns unique combinations (no duplicates)', () => {
    const configs = [
      { name: 'x', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { name: 'y', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    ];
    const result = sampleCrossProduct(configs, 20);
    const keys = result.map(r => `${r.x}-${r.y}`);
    expect(new Set(keys).size).toBe(20);
  });

  test('each combination has all input names', () => {
    const configs = [
      { name: 'a', values: [1, 2, 3] },
      { name: 'b', values: [4, 5, 6] },
      { name: 'c', values: [7, 8, 9] },
    ];
    const result = sampleCrossProduct(configs, 5);
    for (const combo of result) {
      expect(combo).toHaveProperty('a');
      expect(combo).toHaveProperty('b');
      expect(combo).toHaveProperty('c');
    }
  });

  test('values come from the original input arrays', () => {
    const configs = [
      { name: 'x', values: [10, 20] },
      { name: 'y', values: [30, 40] },
    ];
    const result = sampleCrossProduct(configs, 3);
    for (const combo of result) {
      expect([10, 20]).toContain(combo.x);
      expect([30, 40]).toContain(combo.y);
    }
  });
});

// ============================================================================
// findTopDriver
// ============================================================================

describe('findTopDriver', () => {
  test('returns null when no varying inputs', () => {
    expect(findTopDriver([], 'output', [], {})).toBeNull();
  });

  test('identifies the input with highest output range (OAT)', () => {
    // A has baseline 1, B has baseline 10
    // Vary A (B=10): A=1→100, A=2→102 → range 2
    // Vary B (A=1): B=10→100, B=20→120 → range 20
    const runs = [
      { inputs: { A: 1, B: 10 }, outputs: { profit: 100 } },
      { inputs: { A: 1, B: 20 }, outputs: { profit: 120 } },
      { inputs: { A: 2, B: 10 }, outputs: { profit: 102 } },
      { inputs: { A: 2, B: 20 }, outputs: { profit: 122 } },
    ];
    const inputConfigs = {
      A: { values: [1, 2], baseline: 1 },
      B: { values: [10, 20], baseline: 10 },
    };
    expect(findTopDriver(runs, 'profit', ['A', 'B'], inputConfigs)).toBe('B');
  });

  test('handles single varying input', () => {
    const runs = [
      { inputs: { X: 1 }, outputs: { out: 10 } },
      { inputs: { X: 2 }, outputs: { out: 20 } },
    ];
    const inputConfigs = { X: { values: [1, 2], baseline: 1 } };
    expect(findTopDriver(runs, 'out', ['X'], inputConfigs)).toBe('X');
  });

  test('returns null when all outputs are identical', () => {
    const runs = [
      { inputs: { A: 1, B: 10 }, outputs: { out: 50 } },
      { inputs: { A: 1, B: 20 }, outputs: { out: 50 } },
      { inputs: { A: 2, B: 10 }, outputs: { out: 50 } },
      { inputs: { A: 2, B: 20 }, outputs: { out: 50 } },
    ];
    const inputConfigs = {
      A: { values: [1, 2], baseline: 1 },
      B: { values: [10, 20], baseline: 10 },
    };
    expect(findTopDriver(runs, 'out', ['A', 'B'], inputConfigs)).toBeNull();
  });

  test('ignores non-numeric output values', () => {
    // With only one numeric output, can't compute a range — returns null
    const runs = [
      { inputs: { A: 1 }, outputs: { out: 'ERROR' } },
      { inputs: { A: 2 }, outputs: { out: 10 } },
    ];
    const inputConfigs = { A: { values: [1, 2], baseline: 1 } };
    expect(findTopDriver(runs, 'out', ['A'], inputConfigs)).toBeNull();
  });

  test('detects driver when some values have errors', () => {
    // Two numeric outputs → can compute range
    const runs = [
      { inputs: { A: 1 }, outputs: { out: 10 } },
      { inputs: { A: 2 }, outputs: { out: 'ERROR' } },
      { inputs: { A: 3 }, outputs: { out: 30 } },
    ];
    const inputConfigs = { A: { values: [1, 2, 3], baseline: 1 } };
    expect(findTopDriver(runs, 'out', ['A'], inputConfigs)).toBe('A');
  });

  test('handles mixed string/number types via String() coercion', () => {
    // Baselines are numbers, but run inputs are strings (common when values
    // round-trip through JSON or form fields)
    const runs = [
      { inputs: { A: '1', B: '10' }, outputs: { profit: 100 } },
      { inputs: { A: '1', B: '20' }, outputs: { profit: 120 } },
      { inputs: { A: '2', B: '10' }, outputs: { profit: 102 } },
      { inputs: { A: '2', B: '20' }, outputs: { profit: 122 } },
    ];
    const inputConfigs = {
      A: { values: [1, 2], baseline: 1 },       // number baseline & values
      B: { values: ['10', '20'], baseline: 10 }, // string values, number baseline
    };
    // Without String() coercion this would return null because no runs match
    expect(findTopDriver(runs, 'profit', ['A', 'B'], inputConfigs)).toBe('B');
  });

  test('uses baseline to isolate one input at a time', () => {
    // With interaction: A and B together amplify output
    // A baseline=1, B baseline=5
    // Vary A (B=5): A=1→10, A=2→15, A=3→20 → range 10
    // Vary B (A=1): B=5→10, B=10→50 → range 40
    const runs = [
      { inputs: { A: 1, B: 5 }, outputs: { out: 10 } },
      { inputs: { A: 1, B: 10 }, outputs: { out: 50 } },
      { inputs: { A: 2, B: 5 }, outputs: { out: 15 } },
      { inputs: { A: 2, B: 10 }, outputs: { out: 80 } },
      { inputs: { A: 3, B: 5 }, outputs: { out: 20 } },
      { inputs: { A: 3, B: 10 }, outputs: { out: 120 } },
    ];
    const inputConfigs = {
      A: { values: [1, 2, 3], baseline: 1 },
      B: { values: [5, 10], baseline: 5 },
    };
    expect(findTopDriver(runs, 'out', ['A', 'B'], inputConfigs)).toBe('B');
  });
});

// ============================================================================
// formatNum
// ============================================================================

describe('formatNum', () => {
  test('formats integers with locale separators', () => {
    const result = formatNum(1000);
    // toLocaleString is locale-dependent; just verify it returns a string containing the digits
    expect(result).toContain('1');
    expect(result).toContain('000');
  });

  test('formats decimals >= 1 with up to 2 fraction digits', () => {
    const result = formatNum(3.14159);
    expect(result).toContain('3');
    // Should have at most 2 decimal places
    const parts = result.replace(/,/g, '').split('.');
    if (parts[1]) {
      expect(parts[1].length).toBeLessThanOrEqual(2);
    }
  });

  test('formats small decimals with 4 significant digits', () => {
    expect(formatNum(0.001234)).toBe('0.001234');
    expect(formatNum(0.05678)).toBe('0.05678');
  });

  test('returns string representation of non-numeric values', () => {
    expect(formatNum('hello')).toBe('hello');
    expect(formatNum(null)).toBe('null');
    expect(formatNum(undefined)).toBe('undefined');
  });

  test('handles zero', () => {
    expect(formatNum(0)).toContain('0');
  });

  test('handles negative numbers', () => {
    const result = formatNum(-42);
    expect(result).toContain('42');
  });

  test('handles negative small decimals', () => {
    // Math.abs(-0.005) < 1, so toPrecision(4) applies
    expect(formatNum(-0.005678)).toBe('-0.005678');
  });
});

// ============================================================================
// parseInputValue
// ============================================================================

describe('parseInputValue', () => {
  test('strips commas and parses as number', () => {
    expect(parseInputValue('100,000')).toBe(100000);
  });

  test('parses plain integer strings', () => {
    expect(parseInputValue('42')).toBe(42);
  });

  test('parses decimal strings', () => {
    expect(parseInputValue('3.14')).toBe(3.14);
  });

  test('parses negative numbers', () => {
    expect(parseInputValue('-50')).toBe(-50);
  });

  test('returns original string for non-numeric values', () => {
    expect(parseInputValue('hello')).toBe('hello');
  });

  test('returns original string for empty string', () => {
    expect(parseInputValue('')).toBe('');
  });

  test('handles strings with only commas as non-numeric', () => {
    // "," stripped becomes "" which is empty → returns original
    expect(parseInputValue(',')).toBe(',');
  });

  test('handles whitespace-padded numbers', () => {
    expect(parseInputValue('  42  ')).toBe(42);
  });

  test('handles numbers with commas and decimals', () => {
    expect(parseInputValue('1,234.56')).toBe(1234.56);
  });

  test('strips space thousand separators', () => {
    expect(parseInputValue('100 000')).toBe(100000);
  });

  test('strips multiple space thousand separators', () => {
    expect(parseInputValue('1 000 000')).toBe(1000000);
  });

  test('preserves spaces in non-numeric text', () => {
    expect(parseInputValue('hello world')).toBe('hello world');
  });
});

// ============================================================================
// formatOutputVal
// ============================================================================

describe('formatOutputVal', () => {
  test('formats number with format spec from output signature', () => {
    const sig = [
      { name: 'revenue', format: { subCategory: 'currency', symbol: '$', symbolPosition: 'before', decimalPlaces: 0 } },
    ];
    const result = formatOutputVal(1234, 'revenue', sig);
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('$');
  });

  test('uses default 2-decimal formatting when no format spec', () => {
    const sig = [{ name: 'profit' }]; // no format property
    const result = formatOutputVal(3.14159, 'profit', sig);
    // Default is 2 decimal places
    expect(result).toContain('3');
    expect(result).toMatch(/14/);
  });

  test('uses default formatting when output not found in signature', () => {
    const sig = [{ name: 'other' }];
    const result = formatOutputVal(1000.5, 'missing', sig);
    expect(result).toContain('1');
    expect(result).toContain('000');
  });

  test('uses default formatting when signature is null', () => {
    const result = formatOutputVal(42.123, 'anything', null);
    expect(result).toContain('42');
    expect(result).toContain('12');
  });

  test('returns string representation for NaN', () => {
    expect(formatOutputVal(NaN, 'out', null)).toBe('NaN');
  });

  test('returns string representation for non-numeric values', () => {
    expect(formatOutputVal('ERROR: division by zero', 'out', null)).toBe('ERROR: division by zero');
    expect(formatOutputVal(undefined, 'out', null)).toBe('undefined');
    expect(formatOutputVal(null, 'out', null)).toBe('null');
  });

  test('formats consistently across multiple calls with same signature', () => {
    const sig = [
      { name: 'a', format: { subCategory: 'number', decimalPlaces: 1 } },
      { name: 'b' },
    ];
    const r1 = formatOutputVal(10.123, 'a', sig);
    const r2 = formatOutputVal(20.456, 'a', sig);
    expect(r1).toContain('10');
    expect(r2).toContain('20');
  });
});
