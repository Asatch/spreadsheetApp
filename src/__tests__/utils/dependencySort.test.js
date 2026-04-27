/**
 * Tests for dependencySort.js
 * Tests dependency depth computation for sheet ordering.
 */

import { computeDependencyDepths } from '../../utils/dependencySort.js';

describe('computeDependencyDepths', () => {
  test('sheets with no dependencies all get depth 0', () => {
    const depths = computeDependencyDepths([
      { id: 'a', functionId: 'fa', dependencies: [] },
      { id: 'b', functionId: 'fb', dependencies: [] }
    ]);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(0);
  });

  test('single dependency chain: leaf=0, parent=1, grandparent=2', () => {
    const depths = computeDependencyDepths([
      { id: 'leaf', functionId: 'f-leaf', dependencies: [] },
      { id: 'mid', functionId: 'f-mid', dependencies: ['f-leaf'] },
      { id: 'top', functionId: 'f-top', dependencies: ['f-mid'] }
    ]);
    expect(depths.get('leaf')).toBe(0);
    expect(depths.get('mid')).toBe(1);
    expect(depths.get('top')).toBe(2);
  });

  test('diamond dependency: depth is max of both paths', () => {
    // top depends on left and right, both depend on bottom
    const depths = computeDependencyDepths([
      { id: 'bottom', functionId: 'fb', dependencies: [] },
      { id: 'left', functionId: 'fl', dependencies: ['fb'] },
      { id: 'right', functionId: 'fr', dependencies: ['fb'] },
      { id: 'top', functionId: 'ft', dependencies: ['fl', 'fr'] }
    ]);
    expect(depths.get('bottom')).toBe(0);
    expect(depths.get('left')).toBe(1);
    expect(depths.get('right')).toBe(1);
    expect(depths.get('top')).toBe(2);
  });

  test('out-of-scope dependencies are ignored', () => {
    const depths = computeDependencyDepths([
      { id: 'a', functionId: 'fa', dependencies: ['f-external'] }
    ]);
    // f-external is not in the input set, so a has no in-scope deps
    expect(depths.get('a')).toBe(0);
  });

  test('cycle does not cause infinite recursion', () => {
    const depths = computeDependencyDepths([
      { id: 'a', functionId: 'fa', dependencies: ['fb'] },
      { id: 'b', functionId: 'fb', dependencies: ['fa'] }
    ]);
    // Should complete without hanging; exact depths are cycle-guard artifacts
    expect(depths.has('a')).toBe(true);
    expect(depths.has('b')).toBe(true);
  });

  test('sheets without functionId can still have depth computed', () => {
    // A display-only sheet (no functionId) that depends on a function
    const depths = computeDependencyDepths([
      { id: 'func', functionId: 'f1', dependencies: [] },
      { id: 'display', functionId: null, dependencies: ['f1'] }
    ]);
    expect(depths.get('func')).toBe(0);
    expect(depths.get('display')).toBe(1);
  });

  test('missing dependencies array treated as empty', () => {
    const depths = computeDependencyDepths([
      { id: 'a', functionId: 'fa' }  // no dependencies field
    ]);
    expect(depths.get('a')).toBe(0);
  });

  test('empty input returns empty map', () => {
    const depths = computeDependencyDepths([]);
    expect(depths.size).toBe(0);
  });

  test('multiple roots with shared leaf', () => {
    // root1 and root2 both depend on shared
    const depths = computeDependencyDepths([
      { id: 'shared', functionId: 'fs', dependencies: [] },
      { id: 'root1', functionId: 'f1', dependencies: ['fs'] },
      { id: 'root2', functionId: 'f2', dependencies: ['fs'] }
    ]);
    expect(depths.get('shared')).toBe(0);
    expect(depths.get('root1')).toBe(1);
    expect(depths.get('root2')).toBe(1);
  });

  test('asymmetric diamond: depth reflects longest path', () => {
    // top -> mid -> bottom (depth 2 via mid)
    // top -> bottom (depth 1 direct)
    // top should be depth 2 (longest path wins)
    const depths = computeDependencyDepths([
      { id: 'bottom', functionId: 'fb', dependencies: [] },
      { id: 'mid', functionId: 'fm', dependencies: ['fb'] },
      { id: 'top', functionId: 'ft', dependencies: ['fm', 'fb'] }
    ]);
    expect(depths.get('bottom')).toBe(0);
    expect(depths.get('mid')).toBe(1);
    expect(depths.get('top')).toBe(2);
  });
});
