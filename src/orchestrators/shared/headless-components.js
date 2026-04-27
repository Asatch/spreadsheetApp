/**
 * Headless component stubs for running orchestrators without a DOM.
 *
 * Use case: Node-based callers (function-workshop) that want the orchestrator's
 * full evaluation pipeline (XML load, custom-function resolution, loop iteration,
 * input/output handling) without any UI.
 *
 * Pattern: each component is a Proxy that returns a no-op for any unknown
 * method, plus a small set of overrides for methods that have meaningful
 * return contracts (getters returning shapes/arrays/booleans) or that need
 * to remain stateful so the orchestrator's reads-after-writes still work.
 */

function stub(overrides = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
}

export function createHeadlessComponents() {
  // Stateful panels: orchestrator writes outputCells/scenarios on load,
  // headless callers (workshop) read them back via getOutputs/getAllCells.
  const panelsState = {
    outputCells: [],
    outputModes: {},
    scenarios: [],
    activeScenarioIndex: 0,
  };

  return {
    grid: stub({
      getGridBounds: () => ({ maxCol: 'Z', maxRow: 100 }),
      getActiveCell: () => null,
      getColumnNames: () => ({}),
      getSelection: () => ({ start: null, end: null }),
      getSelectionNotation: () => '',
    }),

    panels: stub({
      getOutputCells: () => panelsState.outputCells,
      getOutputModes: () => panelsState.outputModes,
      getScenarios: () => panelsState.scenarios,
      getActiveScenarioIndex: () => panelsState.activeScenarioIndex,
      setOutputCells: (cells, modes) => {
        panelsState.outputCells = cells || [];
        if (modes) panelsState.outputModes = modes;
      },
      loadScenarios: (scenarios) => {
        panelsState.scenarios = scenarios || [];
      },
      setActiveScenarioVisual: (idx) => {
        panelsState.activeScenarioIndex = idx ?? 0;
      },
    }),

    formulaBar: stub({
      isEditingFormula: () => false,
    }),

    header: stub({
      isInPreviewMode: () => false,
      isDirty: () => false,
      getPreviewInfo: () => null,
    }),

    toolbar: stub(),
    formatDialog: stub(),
    functionsDialog: stub(),
    namedRangesDialog: stub(),
    importDialog: stub(),
    dropZone: stub(),
    codeExportDialog: stub(),
    languagePackListDialog: stub(),
    languagePackEditor: stub(),
  };
}
