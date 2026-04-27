/**
 * Tests for functionValidation.js
 * Tests type matching, variant dispatch, error propagation, and result wrapping
 */

import {
  validateAndExecute,
  matchesType,
  collectErrorMeta,
  wrapResult
} from '../../utils/functionValidation.js';
import { vi } from 'vitest';

// ============================================================================
// HELPERS
// ============================================================================

/** Create a {refValue, type} argument */
function arg(refValue, type, errorMeta) {
  const a = { refValue, type };
  if (errorMeta) a.errorMeta = errorMeta;
  return a;
}

/** Create a simple funcDef with one variant */
function singleVariant(argTypes, returnType, impl) {
  return {
    variants: [{ argTypes, returnType, impl }]
  };
}

// ============================================================================
// matchesType
// ============================================================================

describe('matchesType', () => {
  test('simple type: exact match', () => {
    expect(matchesType(arg(42, 'Number'), 'Number')).toBe(true);
    expect(matchesType(arg('hi', 'Text'), 'Text')).toBe(true);
    expect(matchesType(arg(true, 'Boolean'), 'Boolean')).toBe(true);
    expect(matchesType(arg(45000, 'Date'), 'Date')).toBe(true);
  });

  test('simple type: mismatch', () => {
    expect(matchesType(arg(42, 'Number'), 'Text')).toBe(false);
    expect(matchesType(arg('hi', 'Text'), 'Number')).toBe(false);
    expect(matchesType(arg(true, 'Boolean'), 'Date')).toBe(false);
  });

  test('ARRAY type: matches with same inner type', () => {
    expect(matchesType(arg([1, 2], 'ARRAY[Number]'), 'ARRAY[Number]')).toBe(true);
    expect(matchesType(arg(['a'], 'ARRAY[Text]'), 'ARRAY[Text]')).toBe(true);
  });

  test('ARRAY type: inner type comparison is case-insensitive', () => {
    expect(matchesType(arg([1], 'ARRAY[number]'), 'ARRAY[Number]')).toBe(true);
    expect(matchesType(arg([1], 'ARRAY[NUMBER]'), 'ARRAY[number]')).toBe(true);
  });

  test('ARRAY type: rejects non-array value', () => {
    expect(matchesType(arg(42, 'Number'), 'ARRAY[Number]')).toBe(false);
  });

  test('ARRAY type: rejects different inner type', () => {
    expect(matchesType(arg(['a'], 'ARRAY[Text]'), 'ARRAY[Number]')).toBe(false);
  });

  test('Object (unparameterized): matches any Object[...] value', () => {
    expect(matchesType(arg({}, 'Object[Number]'), 'Object')).toBe(true);
    expect(matchesType(arg({}, 'Object[Number, Text]'), 'Object')).toBe(true);
  });

  test('Object (unparameterized): rejects non-object types', () => {
    expect(matchesType(arg(42, 'Number'), 'Object')).toBe(false);
    expect(matchesType(arg([1], 'ARRAY[Number]'), 'Object')).toBe(false);
  });

  test('Object (parameterized): requires exact type string match', () => {
    expect(matchesType(arg({}, 'Object[Number, Text]'), 'Object[Number, Text]')).toBe(true);
    expect(matchesType(arg({}, 'Object[Number]'), 'Object[Number, Text]')).toBe(false);
  });

  test('null/undefined value does not throw', () => {
    expect(matchesType(null, 'Number')).toBe(false);
    expect(matchesType(undefined, 'Number')).toBe(false);
    expect(matchesType(arg(null, null), 'Number')).toBe(false);
  });
});

// ============================================================================
// collectErrorMeta
// ============================================================================

describe('collectErrorMeta', () => {
  test('collects errorMeta from multiple args', () => {
    const result = collectErrorMeta([
      arg(1, 'Number', [{ source: 'A1', error: '#DOMAIN!' }]),
      arg(2, 'Number', [{ source: 'B1', error: '#OVERFLOW!' }])
    ]);
    expect(result).toEqual([
      { source: 'A1', error: '#DOMAIN!' },
      { source: 'B1', error: '#OVERFLOW!' }
    ]);
  });

  test('deduplicates by source', () => {
    const result = collectErrorMeta([
      arg(1, 'Number', [{ source: 'A1', error: '#DOMAIN!' }]),
      arg(2, 'Number', [{ source: 'A1', error: '#DOMAIN!' }])
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'A1', error: '#DOMAIN!' });
  });

  test('skips args without errorMeta', () => {
    const result = collectErrorMeta([
      arg(1, 'Number'),
      arg(2, 'Number', [{ source: 'A1', error: '#DOMAIN!' }]),
      arg(3, 'Number')
    ]);
    expect(result).toEqual([{ source: 'A1', error: '#DOMAIN!' }]);
  });

  test('returns empty array when no errors present', () => {
    expect(collectErrorMeta([arg(1, 'Number'), arg(2, 'Number')])).toEqual([]);
  });

  test('returns empty array for empty input', () => {
    expect(collectErrorMeta([])).toEqual([]);
  });
});

// ============================================================================
// wrapResult
// ============================================================================

describe('wrapResult', () => {
  test('wraps normal result with returnType', () => {
    const result = wrapResult({ value: 42 }, 'Number', []);
    expect(result).toEqual({ refValue: 42, type: 'Number' });
  });

  test('does not attach errorMeta when empty', () => {
    const result = wrapResult({ value: 42 }, 'Number', []);
    expect(result).not.toHaveProperty('errorMeta');
  });

  test('passes through input errorMeta', () => {
    const metas = [{ source: 'A1', error: '#DOMAIN!' }];
    const result = wrapResult({ value: 42 }, 'Number', metas);
    expect(result.errorMeta).toEqual([{ source: 'A1', error: '#DOMAIN!' }]);
  });

  test('merges generates with input errorMeta', () => {
    const metas = [{ source: 'A1', error: '#DOMAIN!' }];
    const result = wrapResult({ value: Infinity, generates: '#DOMAIN!' }, 'Number', metas);
    expect(result.errorMeta).toEqual([
      { source: 'A1', error: '#DOMAIN!' },
      { error: '#DOMAIN!' }
    ]);
  });

  test('adds #OVERFLOW! for Infinity when no upstream errors', () => {
    const result = wrapResult({ value: Infinity }, 'Number', []);
    expect(result.refValue).toBe(Infinity);
    expect(result.type).toBe('Number');
    expect(result.errorMeta).toEqual([{ error: '#OVERFLOW!' }]);
  });

  test('adds #OVERFLOW! for NaN when no upstream errors', () => {
    const result = wrapResult({ value: NaN }, 'Number', []);
    expect(result.errorMeta).toEqual([{ error: '#OVERFLOW!' }]);
  });

  test('does NOT add #OVERFLOW! when upstream errors already exist', () => {
    const metas = [{ source: 'A1', error: '#DOMAIN!' }];
    const result = wrapResult({ value: Infinity }, 'Number', metas);
    // Only the upstream error, no additional #OVERFLOW!
    expect(result.errorMeta).toEqual([{ source: 'A1', error: '#DOMAIN!' }]);
  });

  test('does NOT add #OVERFLOW! when generates already set', () => {
    const result = wrapResult({ value: Infinity, generates: '#DOMAIN!' }, 'Number', []);
    // Only the generated error, no additional #OVERFLOW!
    expect(result.errorMeta).toEqual([{ error: '#DOMAIN!' }]);
  });

  test('passes through Error-type result from impl', () => {
    const errorResult = { refValue: '#REF!', type: 'Error' };
    const result = wrapResult(errorResult, 'Number', []);
    expect(result.type).toBe('Error');
    expect(result.refValue).toBe('#REF!');
    expect(result.errorMeta).toEqual([{ error: '#REF!' }]);
  });

  test('Error-type result merges with input errorMeta', () => {
    const errorResult = { refValue: '#REF!', type: 'Error' };
    const metas = [{ source: 'A1', error: '#DOMAIN!' }];
    const result = wrapResult(errorResult, 'Number', metas);
    expect(result.errorMeta).toEqual([
      { source: 'A1', error: '#DOMAIN!' },
      { error: '#REF!' }
    ]);
  });
});

// ============================================================================
// validateAndExecute
// ============================================================================

describe('validateAndExecute', () => {
  describe('variant matching and execution', () => {
    test('matches single variant and executes', () => {
      const impl = vi.fn((args) => ({ value: args[0].refValue + args[1].refValue }));
      const funcDef = singleVariant(['Number', 'Number'], 'Number', impl);

      const result = validateAndExecute([arg(3, 'Number'), arg(4, 'Number')], funcDef);

      expect(result).toEqual({ refValue: 7, type: 'Number' });
      expect(impl).toHaveBeenCalledTimes(1);
    });

    test('first matching variant wins when multiple could match', () => {
      const impl1 = vi.fn(() => ({ value: 'first' }));
      const impl2 = vi.fn(() => ({ value: 'second' }));
      const funcDef = {
        variants: [
          { argTypes: ['Number', 'Number'], returnType: 'Text', impl: impl1 },
          { argTypes: ['Number', 'Number'], returnType: 'Text', impl: impl2 }
        ]
      };

      validateAndExecute([arg(1, 'Number'), arg(2, 'Number')], funcDef);
      expect(impl1).toHaveBeenCalledTimes(1);
      expect(impl2).not.toHaveBeenCalled();
    });

    test('selects correct variant based on argument types', () => {
      const numImpl = vi.fn(() => ({ value: 'num+num' }));
      const dateImpl = vi.fn(() => ({ value: 'date+num' }));
      const funcDef = {
        variants: [
          { argTypes: ['Number', 'Number'], returnType: 'Text', impl: numImpl },
          { argTypes: ['Date', 'Number'], returnType: 'Text', impl: dateImpl }
        ]
      };

      validateAndExecute([arg(45000, 'Date'), arg(7, 'Number')], funcDef);
      expect(numImpl).not.toHaveBeenCalled();
      expect(dateImpl).toHaveBeenCalledTimes(1);
    });

    test('returns #TYPE! when no variant matches', () => {
      const funcDef = singleVariant(['Number', 'Number'], 'Number', () => ({ value: 0 }));
      const result = validateAndExecute([arg('hi', 'Text'), arg(1, 'Number')], funcDef);

      expect(result.refValue).toBe('#TYPE!');
      expect(result.type).toBe('Error');
      expect(result.errorMeta).toContainEqual({ error: '#TYPE!' });
    });

    test('returns #TYPE! when argument count mismatches', () => {
      const funcDef = singleVariant(['Number', 'Number'], 'Number', () => ({ value: 0 }));
      const result = validateAndExecute([arg(1, 'Number')], funcDef);

      expect(result.refValue).toBe('#TYPE!');
      expect(result.type).toBe('Error');
    });
  });

  describe('resolveReturnType', () => {
    test('uses resolveReturnType when provided', () => {
      const funcDef = {
        variants: [
          { argTypes: ['Object', 'Number'], returnType: 'Dynamic', impl: (args) => ({ value: 42 }) }
        ],
        resolveReturnType: (variant, args) => 'Number'
      };

      const result = validateAndExecute(
        [arg({ X: 42 }, 'Object[Number]'), arg(1, 'Number')],
        funcDef
      );
      expect(result.type).toBe('Number');
    });

    test('falls back to variant.returnType without resolveReturnType', () => {
      const funcDef = singleVariant(['Number'], 'Date', (args) => ({ value: args[0].refValue }));
      const result = validateAndExecute([arg(45000, 'Number')], funcDef);
      expect(result.type).toBe('Date');
    });
  });

  describe('structural error propagation', () => {
    test('propagates structural error from any argument', () => {
      const impl = vi.fn(() => ({ value: 0 }));
      const funcDef = singleVariant(['Number', 'Number'], 'Number', impl);

      const result = validateAndExecute(
        [arg(1, 'Number'), arg('#REF!', 'Error', [{ error: '#REF!' }])],
        funcDef
      );

      expect(result.refValue).toBe('#REF!');
      expect(result.type).toBe('Error');
      expect(impl).not.toHaveBeenCalled();
    });

    test('propagates first structural error when multiple exist', () => {
      const funcDef = singleVariant(['Number', 'Number'], 'Number', () => ({ value: 0 }));

      const result = validateAndExecute(
        [arg('#NAME!', 'Error'), arg('#REF!', 'Error')],
        funcDef
      );
      expect(result.refValue).toBe('#NAME!');
    });

    test('structural error output includes errorMeta from all inputs', () => {
      const funcDef = singleVariant(['Number', 'Number'], 'Number', () => ({ value: 0 }));

      const result = validateAndExecute([
        arg('#REF!', 'Error', [{ source: 'A1', error: '#REF!' }]),
        arg(5, 'Number', [{ source: 'B1', error: '#DOMAIN!' }])
      ], funcDef);

      // Should include errorMeta from both inputs plus the propagated error
      expect(result.errorMeta).toContainEqual({ source: 'A1', error: '#REF!' });
      expect(result.errorMeta).toContainEqual({ source: 'B1', error: '#DOMAIN!' });
      expect(result.errorMeta).toContainEqual({ error: '#REF!' });
    });
  });

  describe('ARRAY constructor', () => {
    const arrayDef = {
      arrayConstructor: true,
      impl: (args) => ({ value: args.map(a => a.refValue) })
    };

    test('constructs array from homogeneous args', () => {
      const result = validateAndExecute(
        [arg(1, 'Number'), arg(2, 'Number'), arg(3, 'Number')],
        arrayDef
      );

      expect(result.refValue).toEqual([1, 2, 3]);
      expect(result.type).toBe('ARRAY[Number]');
    });

    test('return type reflects element type', () => {
      const result = validateAndExecute(
        [arg('a', 'Text'), arg('b', 'Text')],
        arrayDef
      );
      expect(result.type).toBe('ARRAY[Text]');
    });

    test('rejects mixed types with #TYPE!', () => {
      const result = validateAndExecute(
        [arg(1, 'Number'), arg('hi', 'Text')],
        arrayDef
      );
      expect(result.refValue).toBe('#TYPE!');
      expect(result.type).toBe('Error');
    });

    test('rejects empty args with #TYPE!', () => {
      const result = validateAndExecute([], arrayDef);
      expect(result.refValue).toBe('#TYPE!');
      expect(result.type).toBe('Error');
    });

    test('single element array works', () => {
      const result = validateAndExecute([arg(42, 'Number')], arrayDef);
      expect(result.refValue).toEqual([42]);
      expect(result.type).toBe('ARRAY[Number]');
    });
  });

  describe('errorMeta flow', () => {
    test('runtime errorMeta from inputs passes through to output', () => {
      const funcDef = singleVariant(
        ['Number', 'Number'], 'Number',
        (args) => ({ value: args[0].refValue + args[1].refValue })
      );

      const result = validateAndExecute([
        arg(Infinity, 'Number', [{ source: 'A1', error: '#DOMAIN!' }]),
        arg(1, 'Number')
      ], funcDef);

      expect(result.type).toBe('Number'); // Not Error — runtime errors preserve type
      expect(result.errorMeta).toContainEqual({ source: 'A1', error: '#DOMAIN!' });
    });

    test('impl-generated error merges with input errorMeta', () => {
      const funcDef = singleVariant(
        ['Number', 'Number'], 'Number',
        () => ({ value: Infinity, generates: '#DOMAIN!' })
      );

      const result = validateAndExecute([
        arg(1, 'Number', [{ source: 'A1', error: '#OVERFLOW!' }]),
        arg(0, 'Number')
      ], funcDef);

      expect(result.errorMeta).toContainEqual({ source: 'A1', error: '#OVERFLOW!' });
      expect(result.errorMeta).toContainEqual({ error: '#DOMAIN!' });
    });

    test('no errorMeta when inputs clean and impl succeeds', () => {
      const funcDef = singleVariant(
        ['Number', 'Number'], 'Number',
        (args) => ({ value: args[0].refValue + args[1].refValue })
      );

      const result = validateAndExecute([arg(1, 'Number'), arg(2, 'Number')], funcDef);
      expect(result).not.toHaveProperty('errorMeta');
    });

    test('#TYPE! includes errorMeta from inputs', () => {
      const funcDef = singleVariant(['Number'], 'Number', () => ({ value: 0 }));

      const result = validateAndExecute(
        [arg('hi', 'Text', [{ source: 'A1', error: '#DOMAIN!' }])],
        funcDef
      );

      expect(result.refValue).toBe('#TYPE!');
      expect(result.errorMeta).toContainEqual({ source: 'A1', error: '#DOMAIN!' });
      expect(result.errorMeta).toContainEqual({ error: '#TYPE!' });
    });
  });

  describe('argument validation', () => {
    test('throws on malformed argument (missing refValue/type)', () => {
      const funcDef = singleVariant(['Number'], 'Number', () => ({ value: 0 }));
      expect(() => validateAndExecute([{ value: 42 }], funcDef)).toThrow('CalcEngine bug');
      expect(() => validateAndExecute([null], funcDef)).toThrow();
      expect(() => validateAndExecute([42], funcDef)).toThrow();
    });
  });
});
