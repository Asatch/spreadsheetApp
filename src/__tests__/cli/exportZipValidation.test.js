/**
 * Unit tests for the scenario-file validator used by function-workshop's
 * export_zip.mjs CLI. Imported directly (the CLI gates main() on direct
 * execution so importing it for tests doesn't run the script).
 */

import { describe, it, expect } from 'vitest';
import { validateScenarioFile } from '../../../function-workshop/export_zip.mjs';

const SRC = '/tmp/scenarios/sweep.json';

function valid() {
  return {
    name: 'Sweep',
    functionName: 'TARGET',
    inputs: {
      X: { category: 'decision', values: [1, 2, 3] },
      Y: { category: 'fixed', values: [42] },
      Z: { category: 'unknown', values: [0.01, 0.05] },
    },
  };
}

describe('validateScenarioFile', () => {
  it('accepts a well-formed scenario', () => {
    expect(() => validateScenarioFile(valid(), SRC)).not.toThrow();
  });

  it('rejects non-object root', () => {
    expect(() => validateScenarioFile(null, SRC)).toThrow(/scenario file must be a JSON object/);
    expect(() => validateScenarioFile([], SRC)).toThrow(/scenario file must be a JSON object/);
    expect(() => validateScenarioFile('foo', SRC)).toThrow(/scenario file must be a JSON object/);
  });

  it('rejects missing or non-string name', () => {
    const s = valid(); delete s.name;
    expect(() => validateScenarioFile(s, SRC)).toThrow(/missing or invalid "name"/);

    const s2 = valid(); s2.name = 42;
    expect(() => validateScenarioFile(s2, SRC)).toThrow(/missing or invalid "name"/);

    const s3 = valid(); s3.name = '';
    expect(() => validateScenarioFile(s3, SRC)).toThrow(/missing or invalid "name"/);
  });

  it('rejects missing or non-string functionName', () => {
    const s = valid(); delete s.functionName;
    expect(() => validateScenarioFile(s, SRC)).toThrow(/missing or invalid "functionName"/);

    const s2 = valid(); s2.functionName = 123;
    expect(() => validateScenarioFile(s2, SRC)).toThrow(/missing or invalid "functionName"/);

    const s3 = valid(); s3.functionName = '';
    expect(() => validateScenarioFile(s3, SRC)).toThrow(/missing or invalid "functionName"/);
  });

  it('rejects missing or non-object inputs', () => {
    const s = valid(); delete s.inputs;
    expect(() => validateScenarioFile(s, SRC)).toThrow(/missing or invalid "inputs"/);

    const s2 = valid(); s2.inputs = [];
    expect(() => validateScenarioFile(s2, SRC)).toThrow(/missing or invalid "inputs"/);

    const s3 = valid(); s3.inputs = 'foo';
    expect(() => validateScenarioFile(s3, SRC)).toThrow(/missing or invalid "inputs"/);
  });

  it('rejects an input entry that is not an object', () => {
    const s = valid(); s.inputs.X = 'oops';
    expect(() => validateScenarioFile(s, SRC)).toThrow(/input "X" must be an object/);

    const s2 = valid(); s2.inputs.X = [1, 2];
    expect(() => validateScenarioFile(s2, SRC)).toThrow(/input "X" must be an object/);
  });

  it('rejects invalid category values', () => {
    const s = valid(); s.inputs.X.category = 'bogus';
    expect(() => validateScenarioFile(s, SRC)).toThrow(/input "X" has invalid category "bogus"/);

    const s2 = valid(); delete s2.inputs.X.category;
    expect(() => validateScenarioFile(s2, SRC)).toThrow(/input "X" has invalid category/);

    const s3 = valid(); s3.inputs.X.category = 'Decision'; // case-sensitive
    expect(() => validateScenarioFile(s3, SRC)).toThrow(/input "X" has invalid category "Decision"/);
  });

  it('rejects values that are not a non-empty array', () => {
    const s = valid(); s.inputs.X.values = [];
    expect(() => validateScenarioFile(s, SRC)).toThrow(/input "X" must have a non-empty "values" array/);

    const s2 = valid(); s2.inputs.X.values = 'not-array';
    expect(() => validateScenarioFile(s2, SRC)).toThrow(/input "X" must have a non-empty "values" array/);

    const s3 = valid(); delete s3.inputs.X.values;
    expect(() => validateScenarioFile(s3, SRC)).toThrow(/input "X" must have a non-empty "values" array/);
  });

  it('rejects fixed-category inputs that have ≠ 1 value', () => {
    const s = valid(); s.inputs.Y.values = [42, 43];
    expect(() => validateScenarioFile(s, SRC)).toThrow(/input "Y" with category "fixed" must have exactly 1 value \(got 2\)/);
  });

  it('accepts decision/unknown with multiple values, including fixed with 1', () => {
    expect(() => validateScenarioFile({
      name: 'OK',
      functionName: 'F',
      inputs: {
        D: { category: 'decision', values: [1, 2, 3, 4, 5] },
        U: { category: 'unknown', values: [0.01, 0.02] },
        F: { category: 'fixed', values: [99] },
      },
    }, SRC)).not.toThrow();
  });

  it('includes the source path in error messages', () => {
    const s = valid(); delete s.name;
    expect(() => validateScenarioFile(s, '/some/path/foo.json')).toThrow(/^\/some\/path\/foo\.json:/);
  });
});
