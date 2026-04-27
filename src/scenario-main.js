/**
 * Scenario Analysis Entry Point
 *
 * Bootstraps the scenario analysis page with minimal infrastructure:
 * - OPFS service for storage
 * - Scenario engine for CRUD
 * - Scenario analysis UI component
 *
 * URL Parameters:
 * - ?id=<scenarioId> - Load existing scenario
 * - ?folder=<folderId> - Create new scenario in this folder
 * - ?functionId=<functionId> - Pre-select this function for new scenario
 */

import { createOpfsService } from './Engines/opfsService.js';
import { createStorageEngine } from './Engines/storageEngine.js';
import { createScenarioEngine } from './Engines/scenarioEngine.js';
import { createScenarioAnalysis } from './components/scenario-analysis.js';

const urlParams = new URLSearchParams(window.location.search);
const scenarioId = urlParams.get('id');
const folderId = urlParams.get('folder');
const preselectedFunctionId = urlParams.get('functionId');

async function init() {
  // Initialize OPFS
  const opfsService = createOpfsService();
  await opfsService.init();

  // Initialize storage engine (manifest access only — no init() needed)
  const storageEngine = createStorageEngine();
  storageEngine.setOpfsService(opfsService);

  // Initialize scenario engine
  const scenarioEngine = createScenarioEngine();
  scenarioEngine.setDependencies({ storageEngine, opfsService });

  // Mount UI
  const container = document.getElementById('scenario-root');
  if (!container) {
    console.error('[ScenarioMain] Failed to find scenario-root container');
    return;
  }

  const app = createScenarioAnalysis({
    scenarioEngine,
    container,
    scenarioId,
    folderId,
    preselectedFunctionId,
  });

  await app.mount();
}

init().catch(err => {
  console.error('[ScenarioMain] Failed to initialize:', err);
  const container = document.getElementById('scenario-root');
  if (container) {
    container.innerHTML = `<div style="padding: 2rem; color: var(--text-error, #e53e3e);">
      Failed to initialize: ${err.message}
    </div>`;
  }
});
