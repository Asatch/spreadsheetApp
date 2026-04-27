/**
 * HISTORY ENGINE
 * ==============
 * Handles undo/redo mechanism using delta-based snapshots.
 *
 * Key principles:
 * - Delta-based: Only tracks changed keys, not full state
 * - Engines call recordChanges() before mutations
 * - On undo/redo: restore Map values directly, then notify engines to rebuild
 * - No orchestrator coordination needed
 */
export function createHistoryEngine() {
  // Configuration
  let maxSize = 50;
  let onHistoryStateChange = null;

  // Registered Maps and rebuild callbacks
  const registeredMaps = new Map();  // mapName -> Map instance
  const rebuildCallbacks = new Map();  // mapName -> callback function

  // Snapshot providers (for small structures like Sets)
  const snapshotProviders = new Map();  // name -> getter function

  // History stacks
  const undoStack = [];  // Array of checkpoints: { deltas: [{mapName, delta}, ...], snapshots: {name: snapshot} }
  const redoStack = [];

  // Current checkpoint being built
  let currentCheckpoint = null;
  let isRestoring = false;  // Flag to prevent recording during undo/redo
  let batchDepth = 0;       // Depth counter for nestable batch mode

  /**
   * Register a Map for history tracking
   * @param {string} mapName - Unique identifier for this map
   * @param {Map} mapInstance - The Map instance to track
   */
  function registerMap(mapName, mapInstance) {
    if (!(mapInstance instanceof Map)) {
      throw new Error(`[HistoryEngine] ${mapName} must be a Map instance`);
    }
    registeredMaps.set(mapName, mapInstance);
  }

  /**
   * Register a callback to rebuild derived state after restore
   * @param {string} mapName - Map name to listen for
   * @param {Function} callback - Called with Map of key → value to restore
   */
  function registerRebuildCallback(mapName, callback) {
    rebuildCallbacks.set(mapName, callback);
  }

  /**
   * Register a snapshot provider for small structures
   * @param {string} name - Unique name for this snapshot
   * @param {Function} getter - Function that returns current snapshot (called on each checkpoint)
   * @param {Function} restorer - Function that restores from snapshot
   */
  function registerSnapshotProvider(name, getter, restorer) {
    snapshotProviders.set(name, { getter, restorer });
  }

  /**
   * Record changes before they happen
   * Reads current values and saves them for undo
   * @param {string} mapName - Which map is changing
   * @param {Array<string>} keys - Keys that will be changed
   */
  function recordChanges(mapName, keys) {
    // Don't record during restore operations
    if (isRestoring) return;

    const map = registeredMaps.get(mapName);
    if (!map) {
      console.warn(`[HistoryEngine] Map ${mapName} not registered`);
      return;
    }

    // Read current values (before they're changed)
    const delta = new Map();
    for (const key of keys) {
      if (map.has(key)) {
        delta.set(key, structuredClone(map.get(key)));  // Save OLD value (deep copy)
      } else {
        delta.set(key, undefined);  // Mark as non-existent (will delete on restore)
      }
    }

    // Create checkpoint if needed
    if (!currentCheckpoint) {
      currentCheckpoint = { deltas: [] };
    }

    // Add delta to current checkpoint
    currentCheckpoint.deltas.push({ mapName, delta });

    // Auto-commit unless in batch mode
    if (batchDepth === 0) {
      commitCheckpoint();
    }
  }

  /**
   * Begin a batch operation - collect multiple deltas into one checkpoint
   * Call endBatch() when done to commit all changes as a single undo step
   */
  function beginBatch() {
    if (batchDepth === 0) {
      currentCheckpoint = { deltas: [] };
    }
    batchDepth++;
  }

  /**
   * End a batch operation - only the outermost endBatch() commits
   */
  function endBatch() {
    if (batchDepth === 0) {
      console.warn('[HistoryEngine] Not in batch mode');
      return;
    }
    batchDepth--;
    if (batchDepth === 0) {
      commitCheckpoint();
    }
  }

  /**
   * Commit the current checkpoint to undo stack
   * @private
   */
  function commitCheckpoint() {
    if (!currentCheckpoint || currentCheckpoint.deltas.length === 0) {
      currentCheckpoint = null;
      return;
    }

    // Capture snapshots from all registered providers
    if (snapshotProviders.size > 0) {
      currentCheckpoint.snapshots = {};
      for (const [name, { getter }] of snapshotProviders) {
        currentCheckpoint.snapshots[name] = getter();
      }
    }

    // Push to undo stack
    undoStack.push(currentCheckpoint);

    // Clear redo stack (new action invalidates redo history)
    redoStack.length = 0;

    // Enforce max size
    if (undoStack.length > maxSize) {
      undoStack.shift();
    }

    currentCheckpoint = null;

    // Notify state change
    if (onHistoryStateChange) {
      onHistoryStateChange({ canUndo: canUndo(), canRedo: canRedo() });
    }
  }

  /**
   * Undo - restore previous state
   * @returns {boolean} - True if undo was performed
   */
  function undo() {
    if (undoStack.length === 0) {
      return false;
    }

    isRestoring = true;

    const checkpoint = undoStack.pop();

    // Build redo checkpoint by reading CURRENT values before restoring
    const redoCheckpoint = { deltas: [] };
    for (const { mapName, delta } of checkpoint.deltas) {
      const map = registeredMaps.get(mapName);
      if (!map) continue;

      const redoDelta = new Map();

      for (const [key] of delta) {
        // Save current value for redo
        if (map.has(key)) {
          redoDelta.set(key, structuredClone(map.get(key)));
        } else {
          redoDelta.set(key, undefined);
        }
      }

      redoCheckpoint.deltas.push({ mapName, delta: redoDelta });
    }

    // Capture CURRENT snapshots for redo (before restoring old state)
    if (snapshotProviders.size > 0) {
      redoCheckpoint.snapshots = {};
      for (const [name, { getter }] of snapshotProviders) {
        redoCheckpoint.snapshots[name] = getter();
      }
    }

    redoStack.push(redoCheckpoint);

    // Call rebuild callbacks to restore old values
    // Callbacks are responsible for mutating the maps via their normal setValue/setBatch APIs
    for (const { mapName, delta } of checkpoint.deltas) {
      const callback = rebuildCallbacks.get(mapName);
      if (callback) {
        callback(delta);  // Pass the full delta Map with values
      }
    }

    // Restore snapshots
    if (checkpoint.snapshots) {
      for (const [name, snapshot] of Object.entries(checkpoint.snapshots)) {
        const provider = snapshotProviders.get(name);
        if (provider && provider.restorer) {
          provider.restorer(snapshot);
        }
      }
    }

    isRestoring = false;

    // Notify state change
    if (onHistoryStateChange) {
      onHistoryStateChange({ canUndo: canUndo(), canRedo: canRedo() });
    }

    return true;
  }

  /**
   * Redo - restore next state
   * @returns {boolean} - True if redo was performed
   */
  function redo() {
    if (redoStack.length === 0) {
      return false;
    }

    isRestoring = true;

    const checkpoint = redoStack.pop();

    // Build undo checkpoint by reading CURRENT values before restoring
    const undoCheckpoint = { deltas: [] };
    for (const { mapName, delta } of checkpoint.deltas) {
      const map = registeredMaps.get(mapName);
      if (!map) continue;

      const undoDelta = new Map();

      for (const [key] of delta) {
        // Save current value for undo
        if (map.has(key)) {
          undoDelta.set(key, structuredClone(map.get(key)));
        } else {
          undoDelta.set(key, undefined);
        }
      }

      undoCheckpoint.deltas.push({ mapName, delta: undoDelta });
    }

    // Capture CURRENT snapshots for undo (before restoring new state)
    if (snapshotProviders.size > 0) {
      undoCheckpoint.snapshots = {};
      for (const [name, { getter }] of snapshotProviders) {
        undoCheckpoint.snapshots[name] = getter();
      }
    }

    undoStack.push(undoCheckpoint);

    // Call rebuild callbacks to restore new values
    // Callbacks are responsible for mutating the maps via their normal setValue/setBatch APIs
    for (const { mapName, delta } of checkpoint.deltas) {
      const callback = rebuildCallbacks.get(mapName);
      if (callback) {
        callback(delta);  // Pass the full delta Map with values
      }
    }

    // Restore snapshots
    if (checkpoint.snapshots) {
      for (const [name, snapshot] of Object.entries(checkpoint.snapshots)) {
        const provider = snapshotProviders.get(name);
        if (provider && provider.restorer) {
          provider.restorer(snapshot);
        }
      }
    }

    isRestoring = false;

    // Notify state change
    if (onHistoryStateChange) {
      onHistoryStateChange({ canUndo: canUndo(), canRedo: canRedo() });
    }

    return true;
  }

  /**
   * Query if undo is available
   */
  function canUndo() {
    return undoStack.length > 0;
  }

  /**
   * Query if redo is available
   */
  function canRedo() {
    return redoStack.length > 0;
  }

  return {
    init(deps) {
      ({ maxSize, onHistoryStateChange } = deps);
      maxSize = maxSize || 50;
    },

    // Map registration
    registerMap,
    registerRebuildCallback,

    // Snapshot registration (for small structures)
    registerSnapshotProvider,

    // Delta recording
    recordChanges,

    // Batch operations (for multi-engine atomic changes)
    beginBatch,
    endBatch,

    // Undo/redo operations
    undo,
    redo,

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      onHistoryStateChange?.({ canUndo: false, canRedo: false });
    },
  };
}
