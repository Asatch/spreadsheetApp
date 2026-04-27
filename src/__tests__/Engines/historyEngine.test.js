/**
 * Tests for historyEngine.js
 * Tests undo/redo mechanism, delta-based snapshots, batching, and state tracking
 */

import { createHistoryEngine } from '../../Engines/historyEngine.js';
import { vi } from 'vitest';

describe('historyEngine', () => {
  let history;
  let stateCallback;

  /** Wire up a map with a standard rebuild callback that applies deltas directly */
  function wireMap(mapName, map) {
    history.registerMap(mapName, map);
    history.registerRebuildCallback(mapName, (delta) => {
      for (const [key, value] of delta) {
        if (value === undefined) map.delete(key);
        else map.set(key, value);
      }
    });
  }

  beforeEach(() => {
    history = createHistoryEngine();
    stateCallback = vi.fn();
    history.init({ maxSize: 50, onHistoryStateChange: stateCallback });
  });

  describe('recordChanges and undo', () => {
    let map;

    beforeEach(() => {
      map = new Map();
      wireMap('values', map);
    });

    test('undo restores previous value', () => {
      map.set('A1', 'old');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'new');

      history.undo();
      expect(map.get('A1')).toBe('old');
    });

    test('undo restores deletion (key that did not exist)', () => {
      history.recordChanges('values', ['A1']);
      map.set('A1', 'created');

      history.undo();
      expect(map.has('A1')).toBe(false);
    });

    test('undo returns true when there is history, false when empty', () => {
      expect(history.undo()).toBe(false);

      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');

      expect(history.undo()).toBe(true);
      expect(history.undo()).toBe(false);
    });

    test('multiple undos restore in reverse order', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');

      history.recordChanges('values', ['A1']);
      map.set('A1', 'v3');

      history.undo();
      expect(map.get('A1')).toBe('v2');

      history.undo();
      expect(map.get('A1')).toBe('v1');
    });

    test('undo deep-clones values so post-record mutations do not corrupt history', () => {
      const obj = { nested: { x: 1 } };
      map.set('A1', obj);
      history.recordChanges('values', ['A1']);
      obj.nested.x = 999;
      map.set('A1', { nested: { x: 2 } });

      history.undo();
      expect(map.get('A1')).toEqual({ nested: { x: 1 } });
    });

    test('tracks changes across multiple keys in one call', () => {
      map.set('A1', 'a');
      map.set('B1', 'b');
      history.recordChanges('values', ['A1', 'B1']);
      map.set('A1', 'x');
      map.set('B1', 'y');

      history.undo();
      expect(map.get('A1')).toBe('a');
      expect(map.get('B1')).toBe('b');
    });
  });

  describe('redo', () => {
    let map;

    beforeEach(() => {
      map = new Map();
      wireMap('values', map);
    });

    test('redo returns false when nothing to redo', () => {
      expect(history.redo()).toBe(false);
    });

    test('redo restores the undone state', () => {
      map.set('A1', 'old');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'new');

      history.undo();
      expect(map.get('A1')).toBe('old');

      history.redo();
      expect(map.get('A1')).toBe('new');
    });

    test('multiple redo after multiple undo', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v3');

      history.undo();
      history.undo();

      history.redo();
      expect(map.get('A1')).toBe('v2');

      history.redo();
      expect(map.get('A1')).toBe('v3');
    });

    test('new action after undo clears redo stack', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');

      history.undo();

      history.recordChanges('values', ['A1']);
      map.set('A1', 'v3');

      expect(history.redo()).toBe(false);
    });

    test('undo/redo round-trips preserve values through multiple cycles', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');

      for (let i = 0; i < 5; i++) {
        history.undo();
        expect(map.get('A1')).toBe('v1');
        history.redo();
        expect(map.get('A1')).toBe('v2');
      }
    });

    test('redo deep-clones values so post-undo mutations do not corrupt redo stack', () => {
      map.set('A1', { nested: { x: 1 } });
      history.recordChanges('values', ['A1']);
      map.set('A1', { nested: { x: 2 } });

      history.undo();
      // Mutate the restored value — should not corrupt redo
      map.get('A1').nested.x = 999;

      history.redo();
      expect(map.get('A1')).toEqual({ nested: { x: 2 } });
    });
  });

  describe('batching', () => {
    let map;

    beforeEach(() => {
      map = new Map();
      wireMap('values', map);
    });

    test('batch groups multiple recordChanges into one undo step', () => {
      map.set('A1', 'a');
      map.set('B1', 'b');

      history.beginBatch();
      history.recordChanges('values', ['A1']);
      map.set('A1', 'x');
      history.recordChanges('values', ['B1']);
      map.set('B1', 'y');
      history.endBatch();

      history.undo();
      expect(map.get('A1')).toBe('a');
      expect(map.get('B1')).toBe('b');
      expect(history.undo()).toBe(false);
    });

    test('nested batches only commit on outermost endBatch', () => {
      map.set('A1', 'original');
      map.set('B1', 'original-b');

      history.beginBatch();
      history.recordChanges('values', ['A1']);
      map.set('A1', 'changed-a');

      history.beginBatch();
      history.recordChanges('values', ['B1']);
      map.set('B1', 'changed-b');
      history.endBatch(); // inner — should not commit yet

      expect(stateCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ canUndo: true })
      );

      history.endBatch(); // outer — now commits

      history.undo();
      expect(map.get('A1')).toBe('original');
      expect(map.get('B1')).toBe('original-b');
    });

    test('empty batch does not create a checkpoint', () => {
      history.beginBatch();
      history.endBatch();
      expect(history.undo()).toBe(false);
    });

    test('same key recorded twice in batch: last recorded value wins on undo', () => {
      // Documents engine semantics: if the same key is recorded twice in a batch,
      // undo replays deltas in order so the second delta overwrites the first.
      // Callers currently prevent this (clipboard engine uses non-overlapping cell sets),
      // but this test documents the contract.
      map.set('A1', 'original');

      history.beginBatch();
      history.recordChanges('values', ['A1']); // captures 'original'
      map.set('A1', 'intermediate');
      history.recordChanges('values', ['A1']); // captures 'intermediate'
      map.set('A1', 'final');
      history.endBatch();

      history.undo();
      // The second delta ('intermediate') is applied last, overwriting the first ('original')
      expect(map.get('A1')).toBe('intermediate');
    });
  });

  describe('multiple maps', () => {
    let mapA;
    let mapB;

    beforeEach(() => {
      mapA = new Map();
      mapB = new Map();
      wireMap('mapA', mapA);
      wireMap('mapB', mapB);
    });

    test('batch across multiple maps undoes as single step', () => {
      mapA.set('A1', 'a-old');
      mapB.set('B1', 'b-old');

      history.beginBatch();
      history.recordChanges('mapA', ['A1']);
      mapA.set('A1', 'a-new');
      history.recordChanges('mapB', ['B1']);
      mapB.set('B1', 'b-new');
      history.endBatch();

      history.undo();
      expect(mapA.get('A1')).toBe('a-old');
      expect(mapB.get('B1')).toBe('b-old');
    });
  });

  describe('snapshot providers', () => {
    let map;
    let externalSet;

    beforeEach(() => {
      map = new Map();
      externalSet = new Set(['x', 'y']);
      wireMap('values', map);
      history.registerSnapshotProvider(
        'mySet',
        () => new Set(externalSet),
        (snapshot) => { externalSet = new Set(snapshot); }
      );
    });

    test('undo restores snapshot alongside map deltas', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');
      externalSet.add('z');

      history.undo();
      expect(map.get('A1')).toBe('v1');
      expect(externalSet).toEqual(new Set(['x', 'y']));
    });

    test('redo restores snapshot to the state captured at undo time', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');
      externalSet.add('z');

      history.undo();
      expect(externalSet).toEqual(new Set(['x', 'y']));

      history.redo();
      // Redo restores the snapshot captured during undo (before restore),
      // which included 'z' — the state at the time undo was called
      expect(externalSet).toEqual(new Set(['x', 'y', 'z']));
    });
  });

  describe('max size enforcement', () => {
    let map;

    beforeEach(() => {
      history = createHistoryEngine();
      history.init({ maxSize: 3, onHistoryStateChange: stateCallback });
      map = new Map();
      wireMap('values', map);
    });

    test('drops oldest checkpoint when exceeding maxSize', () => {
      map.set('A1', 'v0');

      for (let i = 1; i <= 4; i++) {
        history.recordChanges('values', ['A1']);
        map.set('A1', `v${i}`);
      }

      expect(history.undo()).toBe(true); // v4 -> v3
      expect(map.get('A1')).toBe('v3');
      expect(history.undo()).toBe(true); // v3 -> v2
      expect(history.undo()).toBe(true); // v2 -> v1
      expect(history.undo()).toBe(false); // v0 was dropped
    });
  });

  describe('state change callback', () => {
    let map;

    beforeEach(() => {
      map = new Map();
      wireMap('values', map);
    });

    test('reports correct canUndo/canRedo after record, undo, redo', () => {
      stateCallback.mockClear();

      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');
      expect(stateCallback).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });

      stateCallback.mockClear();
      history.undo();
      expect(stateCallback).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true });

      stateCallback.mockClear();
      history.redo();
      expect(stateCallback).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });
    });
  });

  describe('clear', () => {
    let map;

    beforeEach(() => {
      map = new Map();
      wireMap('values', map);
    });

    test('empties both stacks and fires callback', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');
      history.undo(); // now both stacks have entries

      stateCallback.mockClear();
      history.clear();

      expect(history.undo()).toBe(false);
      expect(history.redo()).toBe(false);
      expect(stateCallback).toHaveBeenCalledWith({ canUndo: false, canRedo: false });
    });
  });

  describe('isRestoring flag', () => {
    let map;

    beforeEach(() => {
      map = new Map();
      wireMap('values', map);
    });

    test('undo/redo do not create recursive history entries', () => {
      map.set('A1', 'v1');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v2');
      history.recordChanges('values', ['A1']);
      map.set('A1', 'v3');

      history.undo();
      history.undo();

      // Exactly 2 redos available — no extras from recursive recording
      expect(history.redo()).toBe(true);
      expect(history.redo()).toBe(true);
      expect(history.redo()).toBe(false);
    });
  });
});
