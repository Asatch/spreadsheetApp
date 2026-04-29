/**
 * SCENARIO ANALYSIS COMPONENT
 * ============================
 *
 * Full-page component for scenario analysis. Not a spreadsheet grid —
 * it's a form-based UI for exploring how a function's outputs respond
 * to different input combinations.
 *
 * Rendering strategy:
 * - Full render (render()) only on major state transitions: mount, function
 *   selection, scenario list changes
 * - Targeted updates for interactive controls:
 *   - Setup changes (category/values) → updateRunBar() only
 *   - Results navigation (tabs/pins/input selector) → updateResultsContent() only
 *   - Run analysis → adds/replaces results panel without touching setup
 * - Event delegation on the container (bound once, survives DOM replacements)
 */

import { crossProduct, sampleCrossProduct, findTopDriver, formatNum, parseInputValue, formatOutputVal as formatOutputValUtil, buildDecisionTree, expandTreeNode } from '../utils/scenarioUtils.js';
import { sheetUrl as buildSheetUrl } from '../utils/appMode.js';
import { escapeHtml } from '../utils/htmlUtils.js';

export function createScenarioAnalysis({ scenarioEngine, container, scenarioId, folderId, preselectedFunctionId }) {
  let currentScenarioId = scenarioId;
  let scenarioData = null;       // { inputs, results }
  let scenarioMeta = null;       // manifest entry
  let loadedFunction = null;     // { callable, signature, name }
  let publishedFunctions = [];   // for the function picker
  let siblingScenarios = [];     // all analyses for the current function (for tab bar)
  const scenarioDataCache = new Map();  // id → { inputs, results } — preloaded for fast tab switching

  // Limits & sampling
  const MAX_COMBINATIONS = 1000000;
  const LOW_COVERAGE_THRESHOLD = 0.05;  // 5% — warn below this
  const SLOW_RUN_THRESHOLD = 500000;   // warn above this many runs
  let sampleSize = null;  // null = run all; number = sample that many

  // Auto-save state
  let saveTimeout = null;
  const AUTO_SAVE_DELAY = 2000;

  // Results view state
  let resultsView = 'headline';  // 'headline' | 'one-at-a-time' | 'pinned'
  let selectedInputName = null;  // for one-at-a-time view
  let pinnedValues = {};         // { inputName: value } for pin & explore
  let fullDataPage = 0;          // pagination for pin & explore
  let hiddenOutputs = new Set(); // output names to hide from results
  let outputFilters = {};    // { outputName: { min: number|null, max: number|null } }
  let dtExpandedPaths = []; // ordered list of "L"/"R" paths the user expanded in the decision tree
  let setupCollapsed = false;
  let fullScreenMode = false;
  let isSwitching = false;  // re-entrancy guard for tab switching
  let selectedRuns = new Set();  // selected run objects for "send to spreadsheet"
  const PAGE_SIZE = 20;
  const FULL_SCREEN_BATCH = 1000;

  // ============================================================================
  // FULL RENDER (major state transitions only)
  // ============================================================================

  function render() {
    container.innerHTML = '';
    container.appendChild(renderHeader());
    container.appendChild(renderTabBar());
    container.appendChild(renderBody());
  }

  function renderHeader() {
    const header = document.createElement('header');
    header.className = 'scenario-header';

    const title = scenarioMeta?.name || 'New Scenario Analysis';
    const funcName = scenarioMeta?.functionName || '';

    header.innerHTML = `
      <div class="scenario-header-left">
        <a href="${import.meta.env.BASE_URL}" class="scenario-back-link">&larr; Sheets</a>
        <input type="text" class="scenario-title-input" value="${escapeHtml(title)}" placeholder="Scenario name...">
        ${funcName ? `<span class="scenario-func-badge">${escapeHtml(funcName)}</span>` : ''}
      </div>
      <div class="scenario-header-right">
        <span class="scenario-save-status"></span>
        <button class="scenario-btn-theme" title="Toggle theme">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </button>
      </div>
    `;
    return header;
  }

  function renderBody() {
    const body = document.createElement('div');
    body.className = 'scenario-body';

    // No scenario loaded and no function preselected — show a message
    if (!currentScenarioId && !preselectedFunctionId) {
      const msg = document.createElement('div');
      msg.className = 'scenario-empty-landing';
      msg.innerHTML = '<p>Open a scenario from the file browser, or create one from a published sheet\'s detail panel.</p>';
      body.appendChild(msg);
      return body;
    }

    if (!loadedFunction) {
      // Scenario exists but function can't be loaded — show picker as fallback
      body.appendChild(renderFunctionPicker());
    } else {
      body.appendChild(renderSetupPanel());
      if (scenarioData?.results) {
        body.appendChild(renderResultsPanel());
      }
    }

    return body;
  }

  // ============================================================================
  // FUNCTION PICKER
  // ============================================================================

  function renderFunctionPicker() {
    const panel = document.createElement('div');
    panel.className = 'scenario-panel scenario-function-picker';

    if (publishedFunctions.length === 0) {
      panel.innerHTML = `
        <h2>Select a Function</h2>
        <div class="scenario-empty">
          No published functions found. Publish a spreadsheet first, then create a scenario analysis.
        </div>
        <a href="/" class="scenario-btn scenario-btn-secondary">Back to Sheets</a>
      `;
      return panel;
    }

    const listHtml = publishedFunctions.map(f => {
      const sigHtml = f.signature?.inputs?.length
        ? `<span class="scenario-func-sig">(${f.signature.inputs.map(i => i.name).join(', ')})</span>`
        : '';
      const selected = preselectedFunctionId === f.functionId ? ' scenario-func-selected' : '';
      return `
        <button class="scenario-func-option${selected}" data-function-id="${f.functionId}">
          <span class="scenario-func-name">${escapeHtml(f.name)}</span>
          ${sigHtml}
          <span class="scenario-func-version">v${escapeHtml(f.version)}</span>
        </button>
      `;
    }).join('');

    panel.innerHTML = `
      <h2>Select a Function</h2>
      <p class="scenario-subtitle">Choose a published function to analyze.</p>
      <div class="scenario-func-list">${listHtml}</div>
    `;
    return panel;
  }

  // ============================================================================
  // ANALYSIS TABS
  // ============================================================================

  function renderTabBar() {
    const nav = document.createElement('nav');
    nav.className = 'scenario-analysis-tabs';

    if (!loadedFunction || siblingScenarios.length === 0) return nav;

    const tabsHtml = siblingScenarios.map(s => {
      const isActive = s.id === currentScenarioId;
      const activeClass = isActive ? ' active' : '';
      const closeBtn = (!isActive && siblingScenarios.length > 1)
        ? `<span class="scenario-analysis-tab-close" data-tab-close-id="${s.id}" title="Delete analysis">&times;</span>`
        : '';
      return `<button class="scenario-analysis-tab${activeClass}" data-tab-id="${s.id}" title="${escapeHtml(s.name)}">
        <span class="scenario-analysis-tab-name">${escapeHtml(s.name)}</span>${closeBtn}
      </button>`;
    }).join('');

    nav.innerHTML = `
      <div class="scenario-analysis-tab-list">${tabsHtml}</div>
      <button class="scenario-analysis-tab-add" data-action="new-analysis" title="New analysis">+</button>
    `;
    return nav;
  }

  function updateTabBar() {
    const existing = container.querySelector('.scenario-analysis-tabs');
    if (existing) {
      existing.replaceWith(renderTabBar());
    }
  }

  async function refreshSiblingScenarios() {
    if (!scenarioMeta?.functionId) {
      siblingScenarios = [];
      return;
    }
    siblingScenarios = await scenarioEngine.listScenariosForFunction(scenarioMeta.functionId);

    // Preload all sibling data into cache (parallel)
    const toLoad = siblingScenarios.filter(s => !scenarioDataCache.has(s.id));
    if (toLoad.length > 0) {
      const loaded = await Promise.all(toLoad.map(s => scenarioEngine.loadScenarioData(s.id)));
      for (let i = 0; i < toLoad.length; i++) {
        scenarioDataCache.set(toLoad[i].id, loaded[i]);
      }
    }
  }

  function resetViewState() {
    resultsView = 'headline';
    selectedInputName = null;
    pinnedValues = {};
    fullDataPage = 0;
    hiddenOutputs = new Set();
    selectedRuns = new Set();
    outputFilters = {};
    setupCollapsed = false;
    fullScreenMode = false;
    sampleSize = null;
    container.classList.remove('scenario-fullscreen');
  }

  async function switchToTab(targetId) {
    if (targetId === currentScenarioId || isSwitching) return;
    isSwitching = true;

    try {
      // Flush pending save in background (don't block the switch)
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        save();  // fire-and-forget
      }

      // Use cached metadata from siblingScenarios instead of re-reading manifest
      const cached = siblingScenarios.find(s => s.id === targetId);

      currentScenarioId = targetId;
      scenarioMeta = cached || await scenarioEngine.getScenarioMetadata(targetId);
      resetViewState();

      // Update URL
      const url = new URL(window.location);
      url.searchParams.set('id', targetId);
      window.history.replaceState({}, '', url);

      // Show tab switch + loading state instantly
      updateTabBar();
      const header = container.querySelector('.scenario-header');
      if (header) {
        const titleInput = header.querySelector('.scenario-title-input');
        if (titleInput) titleInput.value = scenarioMeta?.name || '';
      }
      const body = container.querySelector('.scenario-body');
      if (body) body.innerHTML = '<div class="scenario-loading">Loading analysis\u2026</div>';

      // Load data from cache or OPFS
      scenarioData = scenarioDataCache.get(targetId)
        || await scenarioEngine.loadScenarioData(targetId);

      // Render header, tabs, and setup panel immediately (cheap — no run computation)
      container.innerHTML = '';
      container.appendChild(renderHeader());
      container.appendChild(renderTabBar());
      const switchBody = document.createElement('div');
      switchBody.className = 'scenario-body';
      if (loadedFunction) {
        switchBody.appendChild(renderSetupPanel());
      }
      container.appendChild(switchBody);

      // If results exist, show placeholder, yield to paint, then render the heavy results panel
      if (scenarioData?.results) {
        const resultsPlaceholder = document.createElement('div');
        resultsPlaceholder.className = 'scenario-loading';
        resultsPlaceholder.textContent = 'Loading results\u2026';
        switchBody.appendChild(resultsPlaceholder);

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        resultsPlaceholder.replaceWith(renderResultsPanel());
      }
    } finally {
      isSwitching = false;
    }
  }

  async function handleNewAnalysisTab() {
    if (isSwitching) return;
    isSwitching = true;

    try {
      // Flush pending save
      clearTimeout(saveTimeout);
      await save();

      // Create new scenario for the same function
      const funcId = scenarioMeta.functionId;
      const funcName = scenarioMeta.functionName;
      const name = `${funcName} Analysis ${siblingScenarios.length + 1}`;
      const newId = await scenarioEngine.createScenario(name, funcId, funcName, {
        folderId: scenarioMeta.folderId
      });

      currentScenarioId = newId;
      scenarioMeta = await scenarioEngine.getScenarioMetadata(newId);
      scenarioData = await scenarioEngine.loadScenarioData(newId);

      initializeInputsFromSignature();
      resetViewState();

      // Update URL
      const url = new URL(window.location);
      url.searchParams.set('id', newId);
      window.history.replaceState({}, '', url);

      await refreshSiblingScenarios();
      scheduleSave();
      render();
    } finally {
      isSwitching = false;
    }
  }

  async function handleDeleteTab(targetId) {
    if (targetId === currentScenarioId) return;

    scenarioDataCache.delete(targetId);
    await scenarioEngine.deleteScenario(targetId);
    await refreshSiblingScenarios();
    updateTabBar();
  }

  function initializeInputsFromSignature() {
    if (!scenarioData || !loadedFunction) return;
    if (scenarioData.inputs && Object.keys(scenarioData.inputs).length > 0) return;

    scenarioData.inputs = {};
    for (const inp of (loadedFunction.signature?.inputs || [])) {
      const canonical = inp.canonical != null ? parseInputValue(inp.canonical) : null;
      const testValues = inp.testValues?.map(v => parseInputValue(v)) || [];

      const seen = new Set();
      const uniqueValues = [];
      if (canonical != null) { seen.add(String(canonical)); uniqueValues.push(canonical); }
      for (const v of testValues) {
        const key = String(v);
        if (!seen.has(key)) { seen.add(key); uniqueValues.push(v); }
      }

      const hasMultiple = uniqueValues.length > 1;
      scenarioData.inputs[inp.name] = {
        category: hasMultiple ? 'unknown' : 'fixed',
        baseline: canonical,
        values: uniqueValues
      };
    }
  }

  // ============================================================================
  // SETUP PANEL
  // ============================================================================

  function renderSetupPanel() {
    const panel = document.createElement('div');
    panel.className = 'scenario-panel scenario-setup';

    const inputs = loadedFunction.signature?.inputs || [];
    if (inputs.length === 0) {
      panel.innerHTML = `
        <h2>Input Configuration</h2>
        <div class="scenario-empty">This function has no inputs to analyze.</div>
      `;
      return panel;
    }

    const inputsHtml = inputs.map(inp => {
      const config = scenarioData?.inputs?.[inp.name] || { category: 'fixed', values: [] };
      return renderInputRow(inp.name, inp.type, config);
    }).join('');

    const comboCount = getCombinationCount();
    const runBarHtml = getRunBarHtml(comboCount);

    const sheetUrl = buildSheetUrl(loadedFunction.sheetId, loadedFunction.sheetType);

    const collapseIcon = setupCollapsed ? '&#9654;' : '&#9660;';
    panel.innerHTML = `
      <div class="scenario-unpublished-banner" hidden></div>
      <h2 class="scenario-setup-header">
        <span class="scenario-setup-toggle">${collapseIcon}</span>
        Input Configuration
        <a href="${sheetUrl}" target="_blank" class="scenario-open-sheet">Open spreadsheet</a>
      </h2>
      <div class="scenario-setup-body${setupCollapsed ? ' collapsed' : ''}">
        <p class="scenario-subtitle">Categorize each input and set the values to explore.</p>
        <div class="scenario-inputs-table">
          <div class="scenario-inputs-header">
            <span class="scenario-col-name">Input</span>
            <span class="scenario-col-category">Category</span>
            <span class="scenario-col-baseline">Baseline</span>
            <span class="scenario-col-values">Other Values</span>
          </div>
          ${inputsHtml}
        </div>
        ${runBarHtml}
      </div>
    `;

    // Check for unpublished changes asynchronously
    checkUnpublishedChanges(panel);

    return panel;
  }

  async function checkUnpublishedChanges(panel) {
    if (!loadedFunction?.sheetId) return;
    try {
      const meta = await scenarioEngine.getSheetMetadata(loadedFunction.sheetId);
      if (meta?.hasUnpublishedChanges) {
        const banner = panel.querySelector('.scenario-unpublished-banner');
        if (banner) {
          banner.textContent = 'The spreadsheet has unpublished changes. This analysis runs against the last published version.';
          banner.hidden = false;
        }
      }
    } catch { /* ignore — sheet may not exist */ }
  }

  function renderInputRow(name, type, config) {
    const categories = ['fixed', 'decision', 'unknown'];
    const categoryOptions = categories.map(c =>
      `<option value="${c}"${config.category === c ? ' selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
    ).join('');

    const isFixed = config.category === 'fixed';
    const baselineStr = config.baseline != null ? String(config.baseline) : '';
    // Other values = all values except the first occurrence of the baseline
    const otherValues = [];
    let skippedBaseline = false;
    for (const v of config.values) {
      if (!skippedBaseline && String(v) === String(config.baseline)) {
        skippedBaseline = true;
      } else {
        otherValues.push(v);
      }
    }
    const otherStr = otherValues.join(', ');

    return `
      <div class="scenario-input-row" data-input-name="${escapeHtml(name)}">
        <span class="scenario-col-name">
          <span class="scenario-input-name">${escapeHtml(name)}</span>
          <span class="scenario-input-type">${escapeHtml(type || 'number')}</span>
        </span>
        <span class="scenario-col-category">
          <select class="scenario-category-select" data-input="${escapeHtml(name)}">
            ${categoryOptions}
          </select>
        </span>
        <span class="scenario-col-baseline${isFixed ? ' scenario-col-span-values' : ''}">
          <input type="text" class="scenario-baseline-input" data-input="${escapeHtml(name)}"
                 value="${escapeHtml(baselineStr)}"
                 placeholder="${isFixed ? 'Single value' : 'Baseline'}">
        </span>${isFixed ? '' : `
        <span class="scenario-col-values">
          <input type="text" class="scenario-values-input" data-input="${escapeHtml(name)}"
                 value="${escapeHtml(otherStr)}"
                 placeholder="Other values (comma separated)">
        </span>`}
      </div>
    `;
  }

  // ============================================================================
  // RESULTS PANEL
  // ============================================================================

  function renderResultsPanel() {
    const panel = document.createElement('div');
    panel.className = 'scenario-panel scenario-results';
    panel.innerHTML = getResultsPanelHtml();
    return panel;
  }

  function getResultsPanelHtml() {
    const results = scenarioData?.results;
    if (!results || !results.runs || results.runs.length === 0) {
      return '<div class="scenario-empty">No results yet.</div>';
    }

    const filteredRuns = getFilteredRuns(results.runs);

    const tabs = [
      { id: 'headline', label: 'Headline' },
      { id: 'one-at-a-time', label: 'One at a Time' },
      { id: 'pinned', label: 'Pin & Explore' },
      { id: 'decision-tree', label: 'Decision Tree' },
    ];
    const tabsHtml = tabs.map(t =>
      `<button class="scenario-result-tab${resultsView === t.id ? ' active' : ''}" data-view="${t.id}">${t.label}</button>`
    ).join('')
      + '<button class="scenario-download-csv">Download CSV</button>'
      + `<button class="scenario-fullscreen-btn">${fullScreenMode ? 'Exit Full Screen' : 'Full Screen'}</button>`;

    const allOutputs = getAllOutputNames(results.runs);
    const outputTogglesHtml = allOutputs.length > 1 ? `
      <div class="scenario-output-toggles">
        <span class="scenario-output-toggles-label">Outputs:</span>
        <button class="scenario-toggle-all" data-toggle-all="all">All</button>
        <button class="scenario-toggle-all" data-toggle-all="none">None</button>
        ${allOutputs.map(name => {
          const checked = !hiddenOutputs.has(name) ? ' checked' : '';
          return `<label class="scenario-output-toggle">
            <input type="checkbox" data-output-toggle="${escapeHtml(name)}"${checked}>
            <span>${escapeHtml(name)}</span>
          </label>`;
        }).join('')}
      </div>
    ` : '';

    const filtersHtml = getOutputFiltersHtml(results.runs, filteredRuns);

    if (fullScreenMode) {
      return `
        <div class="scenario-sticky-controls">
          <div class="scenario-result-tabs">${tabsHtml}</div>
          ${outputTogglesHtml}
          ${filtersHtml}
          ${resultsView === 'pinned' ? getPinControlsHtml() : ''}
        </div>
        <div class="scenario-result-content">${getResultsContentHtml(filteredRuns)}</div>
      `;
    }

    return `
      <h2>Results</h2>
      <div class="scenario-result-tabs">${tabsHtml}</div>
      ${outputTogglesHtml}
      ${filtersHtml}
      <div class="scenario-result-content">${getResultsContentHtml(filteredRuns)}</div>
    `;
  }

  function getResultsContentHtml(filteredRuns) {
    if (hasActiveFilters() && filteredRuns.length === 0) {
      return '<div class="scenario-empty">No rows match the current filters.</div>';
    }
    switch (resultsView) {
      case 'headline': return renderHeadlineView(filteredRuns);
      case 'one-at-a-time': return renderOneAtATimeView(filteredRuns);
      case 'pinned': return renderPinnedView(filteredRuns);
      case 'decision-tree': return renderDecisionTreeView();
      default: return renderHeadlineView(filteredRuns);
    }
  }

  function getOutputFiltersHtml(runs, filteredRuns) {
    const outputNames = getOutputNames(runs);
    const numericOutputs = outputNames.filter(name =>
      runs.some(r => typeof r.outputs[name] === 'number' && !isNaN(r.outputs[name]))
    );
    if (numericOutputs.length === 0) return '';

    const activeCount = Object.values(outputFilters)
      .filter(f => f.min != null || f.max != null).length;
    const isFiltered = filteredRuns.length < runs.length;

    const filterRows = numericOutputs.map(name => {
      const f = outputFilters[name] || {};
      return `
        <div class="scenario-filter-row">
          <span class="scenario-filter-name">${escapeHtml(name)}</span>
          <input type="text" class="scenario-filter-input" data-filter-output="${escapeHtml(name)}" data-filter-bound="min"
                 value="${f.min != null ? f.min : ''}" placeholder="min">
          <span class="scenario-filter-sep">&ndash;</span>
          <input type="text" class="scenario-filter-input" data-filter-output="${escapeHtml(name)}" data-filter-bound="max"
                 value="${f.max != null ? f.max : ''}" placeholder="max">
        </div>`;
    }).join('');

    const badge = activeCount > 0 ? ` <span class="scenario-filter-badge">${activeCount}</span>` : '';
    const clearBtn = activeCount > 0 ? ' <button class="scenario-clear-filters">Clear</button>' : '';
    const excludedCount = getExcludedNonNumericCount(runs);
    const excludedNote = isFiltered && excludedCount > 0
      ? ` <span class="scenario-filter-excluded">(${excludedCount} non-numeric excluded)</span>` : '';
    const info = isFiltered
      ? `<span class="scenario-filter-info">${filteredRuns.length.toLocaleString()} of ${runs.length.toLocaleString()} rows${excludedNote}</span>`
      : '';

    return `
      <div class="scenario-output-filters">
        <div class="scenario-filters-header">
          <span class="scenario-filters-label">Filters${badge}</span>
          ${clearBtn}${info}
        </div>
        <div class="scenario-filters-body">${filterRows}</div>
      </div>`;
  }

  function renderHeadlineView(runs) {
    const outputNames = getOutputNames(runs);
    const varyingInputs = getVaryingInputs();

    const headlines = outputNames.map(outputName => {
      const values = runs.map(r => r.outputs[outputName]).filter(v => typeof v === 'number' && !isNaN(v));
      if (values.length === 0) return '';

      const min = values.reduce((m, v) => v < m ? v : m, Infinity);
      const max = values.reduce((m, v) => v > m ? v : m, -Infinity);
      const driver = findTopDriver(runs, outputName, varyingInputs, scenarioData.inputs);

      let rangeStr;
      if (min === max) {
        rangeStr = `always ${formatOutputVal(min, outputName)}`;
      } else {
        rangeStr = `ranges from ${formatOutputVal(min, outputName)} to ${formatOutputVal(max, outputName)}`;
      }

      const driverStr = driver ? `, most driven by <strong>${escapeHtml(driver)}</strong>` : '';

      return `<div class="scenario-headline-item">
        <strong>${escapeHtml(outputName)}</strong> ${rangeStr}${driverStr}
      </div>`;
    }).join('');

    return `<div class="scenario-headline-list">${headlines}</div>`;
  }

  function renderOneAtATimeView(runs) {
    const varyingInputs = getVaryingInputs();
    const outputNames = getOutputNames(runs);

    if (varyingInputs.length === 0) {
      return '<div class="scenario-empty">No varying inputs to show.</div>';
    }

    // Input selector
    if (!selectedInputName || !varyingInputs.includes(selectedInputName)) {
      selectedInputName = varyingInputs[0];
    }

    const selectorHtml = varyingInputs.map(name =>
      `<button class="scenario-input-tab${selectedInputName === name ? ' active' : ''}" data-input-select="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join('');

    // Build table: rows = values of selected input, sorted numerically
    const inputConfig = scenarioData.inputs[selectedInputName];
    const inputValues = [...inputConfig.values].sort((a, b) => Number(a) - Number(b));

    // Estimate data widths based on what cells actually show (min–max ranges)
    const inputDataWidth = Math.max(...inputValues.map(v => formatNum(v).length), 1);
    const outputDataWidths = {};
    for (const n of outputNames) {
      let maxLen = 1;
      for (const val of inputValues) {
        const matchingRuns = runs.filter(r => String(r.inputs[selectedInputName]) === String(val));
        const outputValues = matchingRuns.map(r => r.outputs[n]).filter(v => typeof v === 'number' && !isNaN(v));
        if (outputValues.length === 0) continue;
        const min = outputValues.reduce((m, v) => v < m ? v : m, Infinity);
        const max = outputValues.reduce((m, v) => v > m ? v : m, -Infinity);
        const len = min === max
          ? formatOutputVal(min, n).length
          : formatOutputVal(min, n).length + 3 + formatOutputVal(max, n).length;
        if (len > maxLen) maxLen = len;
      }
      outputDataWidths[n] = maxLen;
    }

    const inputHeader = renderTh(selectedInputName, inputDataWidth, 'scenario-row-label');
    const headerCells = outputNames.map(n => renderTh(n, outputDataWidths[n])).join('');
    const bodyRows = inputValues.map(val => {
      const matchingRuns = runs.filter(r => String(r.inputs[selectedInputName]) === String(val));
      const cells = outputNames.map(outputName => {
        const outputValues = matchingRuns.map(r => r.outputs[outputName]).filter(v => typeof v === 'number' && !isNaN(v));
        if (outputValues.length === 0) return '<td>-</td>';
        const min = outputValues.reduce((m, v) => v < m ? v : m, Infinity);
        const max = outputValues.reduce((m, v) => v > m ? v : m, -Infinity);
        if (min === max) return `<td>${formatOutputVal(min, outputName)}</td>`;
        return `<td>${formatOutputVal(min, outputName)} &ndash; ${formatOutputVal(max, outputName)}</td>`;
      }).join('');
      const isBaseline = String(val) === String(inputConfig.baseline);
      const bold = isBaseline ? ' scenario-baseline-val' : '';
      return `<tr><td class="scenario-row-label${bold}">${formatNum(val)}</td>${cells}</tr>`;
    }).join('');

    return `
      <div class="scenario-input-selector">${selectorHtml}</div>
      <table class="scenario-data-table">
        <thead><tr>${inputHeader}${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }

  function getPinControlsHtml() {
    const varyingInputs = getVaryingInputs();
    if (varyingInputs.length === 0) return '';
    const controls = varyingInputs.map(name => {
      const values = scenarioData.inputs[name].values;
      const pinned = pinnedValues[name];
      const optionsHtml = [
        `<option value=""${pinned === undefined ? ' selected' : ''}>All</option>`,
        ...values.map(v => {
          const isBaseline = String(v) === String(scenarioData.inputs[name].baseline);
          const style = isBaseline ? ' style="font-weight:bold"' : '';
          return `<option value="${v}"${String(pinned) === String(v) ? ' selected' : ''}${style}>${formatNum(v)}</option>`;
        })
      ].join('');
      return `
        <div class="scenario-pin-control">
          <label>${escapeHtml(name)}</label>
          <select class="scenario-pin-select" data-pin-input="${escapeHtml(name)}">${optionsHtml}</select>
        </div>
      `;
    }).join('');
    return `<div class="scenario-pin-controls">${controls}</div>`;
  }

  function renderPinnedView(runs) {
    const varyingInputs = getVaryingInputs();
    const outputNames = getOutputNames(runs);

    if (varyingInputs.length === 0) {
      return '<div class="scenario-empty">No varying inputs to explore.</div>';
    }

    // Filter runs by pinned values
    const filteredRuns = applyPinFilter(runs);

    // Find unpinned varying inputs
    const unpinnedInputs = varyingInputs.filter(n => pinnedValues[n] === undefined);

    let tableHtml;
    if (unpinnedInputs.length === 0) {
      // All pinned — show single result
      if (filteredRuns.length === 0) {
        tableHtml = '<div class="scenario-empty">No matching results.</div>';
      } else {
        const run = filteredRuns[0];
        tableHtml = outputNames.map(n =>
          `<div class="scenario-pinned-result"><strong>${escapeHtml(n)}:</strong> ${formatOutputVal(run.outputs[n], n)}</div>`
        ).join('');
      }
    } else if (unpinnedInputs.length === 1) {
      // One unpinned — simple table
      const inputName = unpinnedInputs[0];
      const inputCfg = scenarioData.inputs[inputName];
      const values = [...inputCfg.values].sort((a, b) => Number(a) - Number(b));
      const inputDataWidth = Math.max(...values.map(v => formatNum(v).length), 1);
      const oWidths = {};
      for (const n of outputNames) {
        oWidths[n] = estimateDataWidth(filteredRuns, n, formatOutputVal, r => r.outputs[n]);
      }
      const inputHeader = renderTh(inputName, inputDataWidth, 'scenario-row-label');
      const headerCells = outputNames.map(n => renderTh(n, oWidths[n])).join('');
      const selectAllChecked = values.every(val => {
        const run = filteredRuns.find(r => String(r.inputs[inputName]) === String(val));
        return run && selectedRuns.has(run);
      });
      const bodyRows = values.map(val => {
        const run = filteredRuns.find(r => String(r.inputs[inputName]) === String(val));
        const cells = outputNames.map(n =>
          `<td>${run ? formatOutputVal(run.outputs[n], n) : '-'}</td>`
        ).join('');
        const isBaseline = String(val) === String(inputCfg.baseline);
        const bold = isBaseline ? ' scenario-baseline-val' : '';
        const checked = run && selectedRuns.has(run) ? ' checked' : '';
        const checkCell = run ? `<td class="scenario-select-cell"><input type="checkbox" class="scenario-select-row" data-run-ref="${filteredRuns.indexOf(run)}"${checked}></td>` : '<td></td>';
        return `<tr>${checkCell}<td class="scenario-row-label${bold}">${formatNum(val)}</td>${cells}</tr>`;
      }).join('');
      tableHtml = `
        <table class="scenario-data-table">
          <thead><tr><th class="scenario-select-cell"><input type="checkbox" class="scenario-select-all"${selectAllChecked ? ' checked' : ''}></th>${inputHeader}${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      `;
    } else {
      // Multiple unpinned — show all rows
      const oWidths = {};
      for (const n of outputNames) {
        oWidths[n] = estimateDataWidth(filteredRuns, n, formatOutputVal, r => r.outputs[n]);
      }
      const iWidths = {};
      for (const n of unpinnedInputs) {
        iWidths[n] = estimateDataWidth(filteredRuns, n, (v) => formatNum(v), r => r.inputs[n]);
      }
      const headerCells = outputNames.map(n => renderTh(n, oWidths[n])).join('');
      const headerInputCells = unpinnedInputs.map(n => renderTh(n, iWidths[n], 'scenario-row-label')).join('');

      const displayRuns = fullScreenMode
        ? filteredRuns.slice(0, FULL_SCREEN_BATCH)
        : (() => {
            const totalPages = Math.ceil(filteredRuns.length / PAGE_SIZE);
            if (fullDataPage >= totalPages) fullDataPage = Math.max(0, totalPages - 1);
            return filteredRuns.slice(fullDataPage * PAGE_SIZE, fullDataPage * PAGE_SIZE + PAGE_SIZE);
          })();

      const selectAllChecked = displayRuns.length > 0 && displayRuns.every(run => selectedRuns.has(run));
      const bodyRows = displayRuns.map(run => {
        const checked = selectedRuns.has(run) ? ' checked' : '';
        const checkCell = `<td class="scenario-select-cell"><input type="checkbox" class="scenario-select-row" data-run-ref="${filteredRuns.indexOf(run)}"${checked}></td>`;
        const inputCells = unpinnedInputs.map(n => {
          const bold = String(run.inputs[n]) === String(scenarioData.inputs[n]?.baseline) ? ' scenario-baseline-val' : '';
          return `<td class="scenario-row-label${bold}">${formatNum(run.inputs[n])}</td>`;
        }).join('');
        const outputCells = outputNames.map(n =>
          `<td>${formatOutputVal(run.outputs[n], n)}</td>`
        ).join('');
        return `<tr>${checkCell}${inputCells}${outputCells}</tr>`;
      }).join('');

      let footerHtml = '';
      if (fullScreenMode) {
        const remaining = filteredRuns.length - displayRuns.length;
        footerHtml = remaining > 0
          ? `<div class="scenario-load-sentinel" data-total="${filteredRuns.length}" data-loaded="${displayRuns.length}">Loading more...</div>`
          : '';
      } else {
        const totalPages = Math.ceil(filteredRuns.length / PAGE_SIZE);
        if (totalPages > 1) {
          footerHtml = `
            <div class="scenario-pagination">
              <button class="scenario-page-btn" data-page-delta="-1" ${fullDataPage === 0 ? 'disabled' : ''}>Prev</button>
              <span class="scenario-page-info">
                <input type="number" class="scenario-page-jump" min="1" max="${totalPages}" value="${fullDataPage + 1}">
                / ${totalPages.toLocaleString()}
              </span>
              <button class="scenario-page-btn" data-page-delta="1" ${fullDataPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
            </div>
          `;
        }
      }

      tableHtml = `
        <table class="scenario-data-table">
          <thead><tr><th class="scenario-select-cell"><input type="checkbox" class="scenario-select-all"${selectAllChecked ? ' checked' : ''}></th>${headerInputCells}${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
        ${footerHtml}
      `;
    }

    // In full screen, pin controls are in the sticky wrapper above
    const pinHtml = fullScreenMode ? '' : getPinControlsHtml();
    const selectionBar = selectedRuns.size > 0 ? `
      <div class="scenario-selection-bar">
        <span>${selectedRuns.size} row${selectedRuns.size !== 1 ? 's' : ''} selected</span>
        <button class="scenario-send-to-sheet">Send to Spreadsheet</button>
        <button class="scenario-clear-selection">Clear</button>
      </div>
    ` : '';
    return `
      ${pinHtml}
      ${tableHtml}
      ${selectionBar}
    `;
  }

  function renderDecisionTreeView() {
    const allRuns = scenarioData?.results?.runs || [];
    const universe = applyPinFilter(allRuns);

    if (universe.length === 0) {
      return '<div class="scenario-empty">No runs in scope (pins exclude everything).</div>';
    }
    if (!hasActiveFilters()) {
      return `
        <div class="dt-explainer">
          <p>The decision tree explains which inputs determine whether a run lands in your <em>filtered</em> set.</p>
          <p>Set one or more output filters above to see what drives runs in vs out.</p>
        </div>`;
    }

    const filteredSet = new Set(getFilteredRuns(universe));
    const isPositive = (r) => filteredSet.has(r);
    const positiveCount = filteredSet.size;

    if (positiveCount === 0) {
      return '<div class="scenario-empty">No runs match the filter — nothing to explain.</div>';
    }
    if (positiveCount === universe.length) {
      return '<div class="scenario-empty">All runs match the filter — nothing to split on.</div>';
    }

    const varying = getVaryingInputs();
    const candidateInputs = varying.filter(n => pinnedValues[n] === undefined);
    if (candidateInputs.length === 0) {
      return '<div class="scenario-empty">No varying inputs available to split on.</div>';
    }

    const tree = buildDecisionTree(universe, isPositive, candidateInputs, { maxDepth: 3, minLeaf: 2 });
    for (const path of dtExpandedPaths) {
      expandTreeNode(tree, path, isPositive, candidateInputs, { minLeaf: 2 });
    }
    const baseRate = positiveCount / universe.length;

    if (!tree.split) {
      return `
        <div class="scenario-empty">
          <div>${universe.length.toLocaleString()} runs in scope · ${positiveCount.toLocaleString()} match (${(baseRate*100).toFixed(0)}%).</div>
          <div>No single input separates the matched runs cleanly enough to explain the filter.</div>
        </div>`;
    }

    return `
      <div class="dt-summary">
        <strong>${universe.length.toLocaleString()}</strong> runs in scope ·
        <strong>${positiveCount.toLocaleString()}</strong> match the filter
        (<strong>${(baseRate*100).toFixed(0)}%</strong> base rate)
      </div>
      <div class="dt-legend">
        <span class="dt-legend-item"><span class="dt-swatch dt-swatch-in"></span>match filter</span>
        <span class="dt-legend-item"><span class="dt-swatch dt-swatch-out"></span>do not match</span>
      </div>
      <div class="dt-tree-wrapper">
        ${renderTreeSubtree(tree, baseRate, '')}
      </div>
    `;
  }

  function renderTreeSubtree(node, baseRate, path) {
    const matchPct = node.total > 0 ? (node.positive / node.total) : 0;
    const matchPctStr = (matchPct * 100).toFixed(0);
    const lift = matchPct - baseRate;
    let liftBadge = '';
    if (Math.abs(lift) >= 0.02) {
      const cls = lift > 0 ? 'dt-lift-up' : 'dt-lift-down';
      const sign = lift > 0 ? '+' : '';
      liftBadge = `<span class="dt-lift ${cls}">${sign}${(lift*100).toFixed(0)} pts</span>`;
    }

    const inPct = (matchPct * 100).toFixed(2);
    const isLeaf = !node.split;
    const nodeClass = isLeaf ? 'dt-node dt-node-leaf' : 'dt-node';

    const box = `
      <div class="${nodeClass}">
        <div class="dt-node-stats">
          <span class="dt-node-match">${matchPctStr}%</span>
          ${liftBadge}
        </div>
        <div class="dt-node-bar">
          <div class="dt-node-bar-in" style="width: ${inPct}%"></div>
        </div>
        <div class="dt-node-counts">
          ${node.positive.toLocaleString()} of ${node.total.toLocaleString()} runs
        </div>
      </div>
    `;

    if (isLeaf) {
      const canExpand = node.positive > 0 && node.positive < node.total && node.total >= 4;
      const expandBtn = canExpand
        ? `<button class="dt-expand" data-dt-path="${path}" title="Split this node further">+</button>`
        : '';
      return `<div class="dt-subtree">${box}${expandBtn}</div>`;
    }

    const splitLabel = `${escapeHtml(node.split.name)} ≤ ${formatNum(node.split.leftMax)}`;

    return `
      <div class="dt-subtree">
        ${box}
        <div class="dt-split-label">${splitLabel}?</div>
        <div class="dt-trunk"></div>
        <div class="dt-children">
          <div class="dt-child">
            <div class="dt-branch-label dt-branch-yes">yes</div>
            ${renderTreeSubtree(node.left, baseRate, path + 'L')}
          </div>
          <div class="dt-child">
            <div class="dt-branch-label dt-branch-no">no</div>
            ${renderTreeSubtree(node.right, baseRate, path + 'R')}
          </div>
        </div>
      </div>
    `;
  }

  function updateSelectionBar() {
    const existing = container.querySelector('.scenario-selection-bar');
    if (selectedRuns.size > 0) {
      const html = `
        <span>${selectedRuns.size} row${selectedRuns.size !== 1 ? 's' : ''} selected</span>
        <button class="scenario-send-to-sheet">Send to Spreadsheet</button>
        <button class="scenario-clear-selection">Clear</button>
      `;
      if (existing) {
        existing.innerHTML = html;
      } else {
        const bar = document.createElement('div');
        bar.className = 'scenario-selection-bar';
        bar.innerHTML = html;
        // Insert after the table
        const table = container.querySelector('.scenario-data-table');
        if (table) table.parentElement.appendChild(bar);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  async function sendToSpreadsheet() {
    if (selectedRuns.size === 0 || !loadedFunction) return;

    const sheetId = loadedFunction.sheetId;
    let xml;
    try {
      xml = await scenarioEngine.loadSheetXml(sheetId);
    } catch {
      alert('Could not load the spreadsheet draft. The sheet may not have a saved draft yet.');
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const root = doc.documentElement;

    // Read input name ordering from XML
    const inputNodes = [...root.querySelectorAll('Node[input_name]')]
      .sort((a, b) => Number(a.getAttribute('input_order')) - Number(b.getAttribute('input_order')));
    const xmlInputNames = inputNodes.map(n => n.getAttribute('input_name'));

    // Read output name ordering from XML
    const outputNodes = [...root.querySelectorAll('Outputs > Output')]
      .sort((a, b) => Number(a.getAttribute('output_order')) - Number(b.getAttribute('output_order')));
    const xmlOutputKeys = outputNodes.map(n => n.getAttribute('output_name') || n.getAttribute('key'));

    // Validate signature match
    const sigInputNames = loadedFunction.signature?.inputs?.map(i => i.name) || [];
    const sigOutputNames = loadedFunction.signature?.outputs?.map(o => o.name) || [];
    const inputsMatch = xmlInputNames.length === sigInputNames.length
      && xmlInputNames.every((n, i) => n === sigInputNames[i]);
    const outputsMatch = xmlOutputKeys.length === sigOutputNames.length
      && xmlOutputKeys.every((n, i) => n === sigOutputNames[i]);

    if (!inputsMatch || !outputsMatch) {
      alert('The spreadsheet\u2019s inputs/outputs no longer match this analysis. Republish the function and re-run the analysis first.');
      return;
    }

    // Find or create TestCases element
    let testCasesEl = root.querySelector('TestCases');
    if (!testCasesEl) {
      testCasesEl = doc.createElement('TestCases');
      const langSpecs = root.querySelector('LangSpecs');
      if (langSpecs?.nextSibling) {
        root.insertBefore(testCasesEl, langSpecs.nextSibling);
      } else {
        root.insertBefore(testCasesEl, root.firstChild);
      }
    }

    // Append selected runs as test cases
    for (const run of selectedRuns) {
      const tc = doc.createElement('test_case');
      for (const name of xmlInputNames) {
        const iv = doc.createElement('input_value');
        iv.setAttribute('Value', String(run.inputs[name] ?? ''));
        tc.appendChild(iv);
      }
      for (const key of xmlOutputKeys) {
        const ov = doc.createElement('output_value');
        ov.setAttribute('Value', String(run.outputs[key] ?? ''));
        tc.appendChild(ov);
      }
      testCasesEl.appendChild(tc);
    }

    // Serialize and save
    const serializer = new XMLSerializer();
    const newXml = serializer.serializeToString(doc);
    await scenarioEngine.saveSheetXml(sheetId, newXml);

    const count = selectedRuns.size;
    selectedRuns.clear();
    updateResultsContent();

    // Brief confirmation
    const bar = container.querySelector('.scenario-selection-bar');
    if (bar) {
      bar.innerHTML = `<span>Sent ${count} scenario${count !== 1 ? 's' : ''} to spreadsheet. Reload the sheet to see them.</span>`;
      setTimeout(() => bar.remove(), 4000);
    }
  }

  function downloadCsv() {
    const allRuns = scenarioData.results.runs;
    const runs = hasActiveFilters() ? getFilteredRuns(allRuns) : allRuns;
    const msg = hasActiveFilters()
      ? `Download ${runs.length.toLocaleString()} of ${allRuns.length.toLocaleString()} rows (filtered) as CSV?`
      : `Download ${runs.length.toLocaleString()} rows as CSV?`;
    if (!confirm(msg)) return;

    const inputNames = Object.keys(scenarioData.inputs);
    const outputNames = getAllOutputNames(runs);

    const escapeCsv = v => {
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [...inputNames, ...outputNames].map(escapeCsv).join(',');
    const rows = runs.map(run => {
      const inputVals = inputNames.map(n => escapeCsv(run.inputs[n]));
      const outputVals = outputNames.map(n => escapeCsv(run.outputs[n]));
      return [...inputVals, ...outputVals].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scenarioMeta?.name || 'scenario'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ============================================================================
  // TARGETED UPDATES (no full re-render)
  // ============================================================================

  function getRunBarHtml(comboCount) {
    const effectiveSize = getEffectiveRunSize(comboCount);
    const canRun = hasEnoughValues() && comboCount > 0;
    const isSampling = effectiveSize < comboCount;

    let coverageHtml = '';
    if (isSampling) {
      const pct = (effectiveSize / comboCount) * 100;
      const pctStr = pct < 0.1 ? '<0.1' : pct < 1 ? pct.toFixed(1) : Math.round(pct).toString();
      const isLow = pct / 100 < LOW_COVERAGE_THRESHOLD;
      coverageHtml = isLow
        ? `<span class="scenario-coverage scenario-coverage-low">${pctStr}% coverage — low sample</span>`
        : `<span class="scenario-coverage">${pctStr}% coverage</span>`;
    }

    return `
      <div class="scenario-run-bar">
        <div class="scenario-run-info">
          <label class="scenario-sample-label">
            Run
            <input type="number" class="scenario-sample-input" min="1" max="${comboCount}"
                   value="${effectiveSize}" ${comboCount === 0 ? 'disabled' : ''}>
            of ${comboCount.toLocaleString()} combinations
          </label>
          ${coverageHtml}
          ${effectiveSize > SLOW_RUN_THRESHOLD ? '<span class="scenario-coverage scenario-coverage-low">This may be slow — consider sampling fewer combinations</span>' : ''}
        </div>
        <button class="scenario-btn scenario-btn-primary scenario-run-btn" ${canRun ? '' : 'disabled'}>
          Run Analysis
        </button>
      </div>
    `;
  }

  function getEffectiveRunSize(comboCount) {
    if (comboCount === 0) return 0;
    if (sampleSize !== null) return Math.min(Math.max(1, sampleSize), comboCount);
    // Auto-cap when total exceeds limit
    if (comboCount > MAX_COMBINATIONS) return MAX_COMBINATIONS;
    return comboCount;
  }

  /** Update run bar contents. No full DOM rebuild. */
  function updateRunBar() {
    const comboCount = getCombinationCount();
    const runBar = container.querySelector('.scenario-run-bar');
    if (runBar) {
      runBar.outerHTML = getRunBarHtml(comboCount);
    }
  }

  /** Update result tab active states and replace result content. */
  function updateResultsPanel() {
    // Rebuild tabs + content since full screen button changes
    const panel = container.querySelector('.scenario-results');
    if (panel && scenarioData?.results) {
      panel.innerHTML = getResultsPanelHtml();
      if (fullScreenMode) setupLoadMoreObserver();
    }
  }

  /** Replace only the result content area (table/headline/pins). */
  function updateResultsContent() {
    const contentEl = container.querySelector('.scenario-result-content');
    if (!contentEl || !scenarioData?.results) return;
    const filteredRuns = getFilteredRuns(scenarioData.results.runs);
    contentEl.innerHTML = getResultsContentHtml(filteredRuns);
    if (fullScreenMode) setupLoadMoreObserver();
  }

  /** Update filter header metadata and result content without rebuilding filter inputs. */
  function updateFiltersAndContent() {
    const runs = scenarioData?.results?.runs;
    if (!runs) return;
    const filteredRuns = getFilteredRuns(runs);

    // Update filter header (badge, count, clear button) without touching filter inputs
    const header = container.querySelector('.scenario-filters-header');
    if (header) {
      const activeCount = Object.values(outputFilters)
        .filter(f => f.min != null || f.max != null).length;
      const isFiltered = filteredRuns.length < runs.length;
      const badge = activeCount > 0 ? ` <span class="scenario-filter-badge">${activeCount}</span>` : '';
      const clearBtn = activeCount > 0 ? ' <button class="scenario-clear-filters">Clear</button>' : '';
      const excludedCount = getExcludedNonNumericCount(runs);
      const excludedNote = isFiltered && excludedCount > 0
        ? ` <span class="scenario-filter-excluded">(${excludedCount} non-numeric excluded)</span>` : '';
      const info = isFiltered
        ? `<span class="scenario-filter-info">${filteredRuns.length.toLocaleString()} of ${runs.length.toLocaleString()} rows${excludedNote}</span>`
        : '';
      header.innerHTML = `
        <span class="scenario-filters-label">Filters${badge}</span>
        ${clearBtn}${info}
      `;
    }

    // Update result content
    const contentEl = container.querySelector('.scenario-result-content');
    if (contentEl) {
      contentEl.innerHTML = getResultsContentHtml(filteredRuns);
      if (fullScreenMode) setupLoadMoreObserver();
    }
  }

  /** Add results panel if missing, or update its contents. */
  function addOrUpdateResults() {
    let panel = container.querySelector('.scenario-results');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'scenario-panel scenario-results';
      container.querySelector('.scenario-body')?.appendChild(panel);
    }
    panel.innerHTML = getResultsPanelHtml();
    if (fullScreenMode) setupLoadMoreObserver();
  }

  // ============================================================================
  // ANALYSIS ENGINE
  // ============================================================================

  function getCombinationCount() {
    if (!scenarioData?.inputs) return 0;
    let count = 1;
    for (const config of Object.values(scenarioData.inputs)) {
      const n = config.values.length;
      if (n === 0) return 0;
      count *= n;
    }
    return count;
  }

  function hasEnoughValues() {
    if (!scenarioData?.inputs || !loadedFunction?.signature?.inputs) return false;
    for (const inp of loadedFunction.signature.inputs) {
      const config = scenarioData.inputs[inp.name];
      if (!config || config.values.length === 0) return false;
    }
    return true;
  }

  function getVaryingInputs() {
    if (!scenarioData?.inputs) return [];
    return Object.entries(scenarioData.inputs)
      .filter(([, config]) => config.category !== 'fixed' && config.values.length > 1)
      .map(([name]) => name);
  }

  function getAllOutputNames(runs) {
    if (runs.length === 0) return [];
    const first = runs[0].outputs;
    if (typeof first === 'object' && first !== null) {
      return Object.keys(first);
    }
    return ['result'];
  }

  function getOutputNames(runs) {
    return getAllOutputNames(runs).filter(n => !hiddenOutputs.has(n));
  }

  function getFilteredRuns(runs) {
    const active = Object.entries(outputFilters)
      .filter(([, f]) => f.min != null || f.max != null);
    if (active.length === 0) return runs;
    return runs.filter(run => {
      for (const [name, f] of active) {
        const val = run.outputs[name];
        if (typeof val !== 'number' || isNaN(val)) return false;
        if (f.min != null && val < f.min) return false;
        if (f.max != null && val > f.max) return false;
      }
      return true;
    });
  }

  function hasActiveFilters() {
    return Object.values(outputFilters).some(f => f.min != null || f.max != null);
  }

  /** Count runs excluded by filters due to non-numeric output values. */
  function getExcludedNonNumericCount(runs) {
    const active = Object.entries(outputFilters)
      .filter(([, f]) => f.min != null || f.max != null);
    if (active.length === 0) return 0;
    return runs.filter(run =>
      active.some(([name]) => {
        const val = run.outputs[name];
        return typeof val !== 'number' || isNaN(val);
      })
    ).length;
  }

  /** Filter runs by current pinned values. */
  function applyPinFilter(runs) {
    return runs.filter(r => {
      for (const [name, val] of Object.entries(pinnedValues)) {
        if (val !== undefined && String(r.inputs[name]) !== String(val)) return false;
      }
      return true;
    });
  }

  let analysisAborted = false;

  function runAnalysis() {
    if (!loadedFunction?.callable || !scenarioData?.inputs) return;

    analysisAborted = false;
    showRunningOverlay();
    executeAnalysis();
  }

  async function executeAnalysis() {
    const inputNames = loadedFunction.signature.inputs.map(i => i.name);
    const inputConfigs = inputNames.map(name => ({
      name,
      values: scenarioData.inputs[name]?.values || [],
    }));

    // Generate combinations (full cross product or random sample)
    const comboCount = inputConfigs.reduce((acc, c) => acc * c.values.length, 1);
    const effectiveSize = getEffectiveRunSize(comboCount);
    const combinations = effectiveSize < comboCount
      ? sampleCrossProduct(inputConfigs, effectiveSize)
      : crossProduct(inputConfigs);

    // Execute function for each combination, yielding periodically to keep the UI responsive
    const CHUNK_SIZE = 5000;
    const runs = [];
    const outputSig = loadedFunction.signature?.outputs || [{ name: 'result' }];

    for (let i = 0; i < combinations.length; i++) {
      if (analysisAborted) return;

      const combo = combinations[i];
      const args = inputNames.map(name => combo[name]);
      try {
        const result = loadedFunction.callable(...args);
        const outputs = (typeof result === 'object' && result !== null && !Array.isArray(result))
          ? result
          : { result };
        runs.push({ inputs: combo, outputs });
      } catch (err) {
        const errorOutputs = {};
        for (const o of outputSig) {
          errorOutputs[o.name] = `ERROR: ${err.message}`;
        }
        runs.push({ inputs: combo, outputs: errorOutputs });
      }

      if (i > 0 && i % CHUNK_SIZE === 0) {
        updateRunningProgress(i, combinations.length);
        await yieldToMain();
      }
    }

    if (analysisAborted) return;

    scenarioData.results = {
      runs,
      timestamp: new Date().toISOString(),
    };

    // Reset results view state
    resultsView = 'headline';
    selectedInputName = null;
    pinnedValues = {};
    fullDataPage = 0;
    outputFilters = {};

    hideRunningOverlay();
    scheduleSave();
    addOrUpdateResults();
  }

  function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function updateRunningProgress(completed, total) {
    const msg = container.querySelector('.scenario-running-message');
    if (msg) {
      const pct = Math.round((completed / total) * 100);
      msg.innerHTML = `<span class="scenario-running-spinner"></span>Running analysis\u2026 ${pct}%`;
    }
  }

  function showRunningOverlay() {
    let overlay = container.querySelector('.scenario-running-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'scenario-running-overlay';
      overlay.innerHTML = '<div class="scenario-running-message"><span class="scenario-running-spinner"></span>Running analysis\u2026</div>';
      container.appendChild(overlay);
    }
    overlay.hidden = false;
  }

  function hideRunningOverlay() {
    const overlay = container.querySelector('.scenario-running-overlay');
    if (overlay) overlay.hidden = true;
  }


  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => save(), AUTO_SAVE_DELAY);
    const status = container.querySelector('.scenario-save-status');
    if (status) status.textContent = 'Unsaved';
  }

  async function save() {
    if (!currentScenarioId || !scenarioData) return;
    try {
      scenarioDataCache.set(currentScenarioId, scenarioData);
      await scenarioEngine.saveScenarioData(currentScenarioId, scenarioData);
      const status = container.querySelector('.scenario-save-status');
      if (status) {
        status.textContent = 'Saved';
        setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 2000);
      }
    } catch (err) {
      console.error('[ScenarioAnalysis] Save failed:', err);
    }
  }

  // ============================================================================
  // EVENT DELEGATION (bound once, survives all DOM replacements)
  // ============================================================================

  function bindDelegatedEvents() {
    container.addEventListener('click', handleClick);
    container.addEventListener('change', handleChange);
  }

  function handleClick(e) {
    // Analysis tab switch
    const analysisTab = e.target.closest('[data-tab-id]');
    if (analysisTab && !e.target.closest('[data-tab-close-id]')) {
      switchToTab(analysisTab.dataset.tabId);
      return;
    }

    // Analysis tab close (delete)
    const tabClose = e.target.closest('[data-tab-close-id]');
    if (tabClose) {
      e.stopPropagation();
      handleDeleteTab(tabClose.dataset.tabCloseId);
      return;
    }

    // New analysis tab
    if (e.target.closest('[data-action="new-analysis"]')) {
      handleNewAnalysisTab();
      return;
    }

    // Theme toggle
    if (e.target.closest('.scenario-btn-theme')) {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? '' : 'dark';
      if (next) {
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('sc-theme', next);
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('sc-theme');
      }
      return;
    }

    // Setup panel collapse toggle
    if (e.target.closest('.scenario-setup-header') && !e.target.closest('.scenario-open-sheet')) {
      setupCollapsed = !setupCollapsed;
      const body = container.querySelector('.scenario-setup-body');
      const toggle = container.querySelector('.scenario-setup-toggle');
      if (body) body.classList.toggle('collapsed', setupCollapsed);
      if (toggle) toggle.innerHTML = setupCollapsed ? '&#9654;' : '&#9660;';
      return;
    }

    // Function selection
    const funcBtn = e.target.closest('.scenario-func-option');
    if (funcBtn) {
      handleFunctionSelect(funcBtn.dataset.functionId);
      return;
    }

    // Run button
    if (e.target.closest('.scenario-run-btn')) {
      runAnalysis();
      return;
    }

    // Full screen toggle
    if (e.target.closest('.scenario-fullscreen-btn')) {
      fullScreenMode = !fullScreenMode;
      fullDataPage = 0;
      container.classList.toggle('scenario-fullscreen', fullScreenMode);
      updateResultsPanel();
      if (fullScreenMode) setupLoadMoreObserver();
      return;
    }

    // Download CSV
    if (e.target.closest('.scenario-download-csv')) {
      downloadCsv();
      return;
    }

    // Clear output filters
    if (e.target.closest('.scenario-clear-filters')) {
      outputFilters = {};
      dtExpandedPaths = [];
      updateResultsPanel();
      return;
    }

    // Send selected runs to spreadsheet
    if (e.target.closest('.scenario-send-to-sheet')) {
      sendToSpreadsheet();
      return;
    }

    // Clear row selection
    if (e.target.closest('.scenario-clear-selection')) {
      selectedRuns.clear();
      updateResultsContent();
      return;
    }

    // Result view tabs
    const resultTab = e.target.closest('.scenario-result-tab');
    if (resultTab && resultTab.dataset.view) {
      resultsView = resultTab.dataset.view;
      fullDataPage = 0;
      updateResultsPanel();
      return;
    }

    // Decision tree: expand a leaf one more level
    const dtExpand = e.target.closest('.dt-expand');
    if (dtExpand) {
      const path = dtExpand.dataset.dtPath ?? '';
      if (!dtExpandedPaths.includes(path)) dtExpandedPaths.push(path);
      updateResultsContent();
      return;
    }

    // One-at-a-time input selector tabs
    const inputTab = e.target.closest('.scenario-input-tab');
    if (inputTab) {
      selectedInputName = inputTab.dataset.inputSelect;
      updateResultsContent();
      return;
    }

    // Toggle all/none outputs
    if (e.target.matches('[data-toggle-all]')) {
      const allOutputs = getAllOutputNames(scenarioData.results.runs);
      if (e.target.dataset.toggleAll === 'all') {
        hiddenOutputs.clear();
      } else {
        allOutputs.forEach(n => hiddenOutputs.add(n));
        outputFilters = {};
      }
      updateResultsPanel();
      return;
    }

    // Full data pagination
    const pageBtn = e.target.closest('.scenario-page-btn');
    if (pageBtn && !pageBtn.disabled) {
      fullDataPage += Number(pageBtn.dataset.pageDelta);
      updateResultsContent();
      return;
    }
  }

  function handleChange(e) {
    // Title change
    if (e.target.matches('.scenario-title-input')) {
      const newName = e.target.value.trim();
      if (newName && currentScenarioId) {
        scenarioEngine.renameScenario(currentScenarioId, newName);
        if (scenarioMeta) scenarioMeta.name = newName;
        // Sync tab bar text
        const entry = siblingScenarios.find(s => s.id === currentScenarioId);
        if (entry) entry.name = newName;
        const activeTabName = container.querySelector(`.scenario-analysis-tab[data-tab-id="${currentScenarioId}"] .scenario-analysis-tab-name`);
        if (activeTabName) activeTabName.textContent = newName;
      }
      return;
    }

    // Category change — update state + re-render row (DOM structure differs for fixed vs non-fixed)
    if (e.target.matches('.scenario-category-select')) {
      const inputName = e.target.dataset.input;
      if (scenarioData.inputs[inputName]) {
        const isFixed = e.target.value === 'fixed';
        const config = scenarioData.inputs[inputName];
        config.category = e.target.value;
        if (isFixed) {
          config.values = config.baseline != null ? [config.baseline] : [];
        }
        // Re-render just this row since the column layout changes
        const row = e.target.closest('.scenario-input-row');
        const inp = loadedFunction.signature.inputs.find(i => i.name === inputName);
        if (row && inp) {
          row.outerHTML = renderInputRow(inputName, inp.type, config);
        }
        scheduleSave();
        updateRunBar();
      }
      return;
    }

    // Baseline change — update baseline and rebuild values array
    if (e.target.matches('.scenario-baseline-input')) {
      const inputName = e.target.dataset.input;
      const raw = e.target.value.trim();
      if (scenarioData.inputs[inputName]) {
        const config = scenarioData.inputs[inputName];
        if (raw === '') {
          const oldBaseline = config.baseline;
          config.baseline = null;
          config.values = config.values.filter(v => String(v) !== String(oldBaseline));
        } else {
          const newBaseline = parseInputValue(raw);
          // Write cleaned value back to the field
          e.target.value = String(newBaseline);
          // Rebuild values: new baseline + existing non-baseline values
          const otherValues = config.values.filter(v => String(v) !== String(config.baseline));
          config.baseline = newBaseline;
          config.values = [newBaseline, ...otherValues];
        }
        scheduleSave();
        updateRunBar();
      }
      return;
    }

    // Page jump
    // Row selection checkbox
    if (e.target.matches('.scenario-select-row')) {
      const runIndex = parseInt(e.target.dataset.runRef, 10);
      const allRuns = scenarioData?.results?.runs;
      if (allRuns) {
        const filteredRuns = hasActiveFilters() ? getFilteredRuns(allRuns) : allRuns;
        const run = filteredRuns[runIndex];
        if (run) {
          if (e.target.checked) {
            selectedRuns.add(run);
          } else {
            selectedRuns.delete(run);
          }
          updateSelectionBar();
        }
      }
      return;
    }

    // Select all checkbox
    if (e.target.matches('.scenario-select-all')) {
      const allRuns = scenarioData?.results?.runs;
      if (allRuns) {
        const filteredRuns = hasActiveFilters() ? getFilteredRuns(allRuns) : allRuns;
        // In paginated mode, only affect visible rows
        const displayRuns = fullScreenMode
          ? filteredRuns.slice(0, FULL_SCREEN_BATCH)
          : filteredRuns.slice(fullDataPage * PAGE_SIZE, fullDataPage * PAGE_SIZE + PAGE_SIZE);
        if (e.target.checked) {
          for (const run of displayRuns) selectedRuns.add(run);
        } else {
          for (const run of displayRuns) selectedRuns.delete(run);
        }
        updateResultsContent();
      }
      return;
    }

    if (e.target.matches('.scenario-page-jump')) {
      const page = parseInt(e.target.value, 10);
      const max = parseInt(e.target.max, 10);
      if (!isNaN(page) && page >= 1 && page <= max) {
        fullDataPage = page - 1;
        updateResultsContent();
      }
      return;
    }

    // Sample size change
    if (e.target.matches('.scenario-sample-input')) {
      const val = parseInt(e.target.value, 10);
      const comboCount = getCombinationCount();
      if (isNaN(val) || val >= comboCount) {
        sampleSize = null;  // run all
      } else {
        sampleSize = Math.max(1, val);
      }
      updateRunBar();
      return;
    }

    // Other values change — update state, no re-render
    if (e.target.matches('.scenario-values-input')) {
      const inputName = e.target.dataset.input;
      const rawValues = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
      const otherValues = rawValues.map(parseInputValue);
      if (scenarioData.inputs[inputName]) {
        const config = scenarioData.inputs[inputName];
        // Full values = baseline (if set) + other values
        config.values = config.baseline != null
          ? [config.baseline, ...otherValues] : otherValues;
        scheduleSave();
        updateRunBar();
      }
      return;
    }

    // Output filter change
    if (e.target.matches('.scenario-filter-input')) {
      const outputName = e.target.dataset.filterOutput;
      const bound = e.target.dataset.filterBound;
      const raw = e.target.value.trim();
      if (!outputFilters[outputName]) outputFilters[outputName] = { min: null, max: null };
      if (raw === '') {
        outputFilters[outputName][bound] = null;
      } else {
        const num = Number(raw);
        if (!isNaN(num)) {
          outputFilters[outputName][bound] = num;
          e.target.value = String(num);
        } else {
          outputFilters[outputName][bound] = null;
          e.target.value = '';
        }
      }
      if (outputFilters[outputName].min == null && outputFilters[outputName].max == null) {
        delete outputFilters[outputName];
      }
      dtExpandedPaths = [];
      updateFiltersAndContent();
      return;
    }

    // Pin select change — update state, replace results content only
    if (e.target.matches('.scenario-pin-select')) {
      const inputName = e.target.dataset.pinInput;
      const val = e.target.value;
      if (val === '') {
        delete pinnedValues[inputName];
      } else {
        pinnedValues[inputName] = parseInputValue(val);
      }
      dtExpandedPaths = [];
      updateResultsContent();
      return;
    }

    // Output visibility toggle
    if (e.target.matches('[data-output-toggle]')) {
      const outputName = e.target.dataset.outputToggle;
      if (e.target.checked) {
        hiddenOutputs.delete(outputName);
      } else {
        hiddenOutputs.add(outputName);
        delete outputFilters[outputName];
      }
      updateResultsPanel();
      return;
    }
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  async function handleFunctionSelect(functionId) {
    try {
      loadedFunction = await scenarioEngine.loadPublishedFunction(functionId);

      if (!currentScenarioId) {
        // Create new scenario
        const name = `${loadedFunction.name} Analysis`;
        currentScenarioId = await scenarioEngine.createScenario(name, functionId, loadedFunction.name, { folderId });
        scenarioMeta = await scenarioEngine.getScenarioMetadata(currentScenarioId);

        // Update URL without reload
        const url = new URL(window.location);
        url.searchParams.set('id', currentScenarioId);
        url.searchParams.delete('folder');
        url.searchParams.delete('functionId');
        window.history.replaceState({}, '', url);
      }

      // Initialize input config from signature
      scenarioData = await scenarioEngine.loadScenarioData(currentScenarioId);
      if (!scenarioData.inputs || Object.keys(scenarioData.inputs).length === 0) {
        initializeInputsFromSignature();
        scheduleSave();
      }

      // Migrate legacy data: ensure every input has a baseline field
      for (const config of Object.values(scenarioData.inputs)) {
        if (config.baseline === undefined) {
          config.baseline = config.values.length > 0 ? config.values[0] : null;
        }
      }

      await refreshSiblingScenarios();
      render();
    } catch (err) {
      console.error('[ScenarioAnalysis] Failed to load function:', err);
      alert(`Failed to load function: ${err.message}`);
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Estimate the max formatted width (in chars) for a column, sampling runs.
   * @param {Array} runs
   * @param {string} name - column name
   * @param {function} formatter - (value, name) => string
   * @param {function} accessor - (run) => value
   * @returns {number}
   */
  function estimateDataWidth(runs, name, formatter, accessor) {
    const sample = runs.slice(0, 50);
    let max = 1;
    for (const run of sample) {
      const len = formatter(accessor(run), name).length;
      if (len > max) max = len;
    }
    return max;
  }

  /**
   * Render a <th> that auto-decides between horizontal wrap and rotation.
   * Rotates when the header would need more than 3 wrapped lines at dataWidth.
   */
  function renderTh(name, dataWidth, extraClass) {
    const cls = extraClass ? ` ${extraClass}` : '';
    const maxW = Math.max(dataWidth + 2, 4);
    if (name.length > dataWidth * 3) {
      // Rotated: split into multiple vertical lines that fit the column width.
      // Each vertical line takes ~2ch of horizontal space.
      const linesAvailable = Math.max(1, Math.floor(maxW / 2));
      const charsPerLine = Math.ceil(name.length / linesAvailable);
      const lines = splitHeaderText(name, charsPerLine);
      const content = lines.map(l => escapeHtml(l)).join('<br>');
      return `<th class="scenario-col-rotated${cls}">${content}</th>`;
    }
    // Hint line breaks at underscores so the browser wraps there first
    const wrappedContent = name.includes('_')
      ? name.split('_').map(s => escapeHtml(s)).join('_<wbr>')
      : escapeHtml(name);
    return `<th class="scenario-col-wrapped${cls}" style="max-width: ${maxW}ch">${wrappedContent}</th>`;
  }

  /**
   * Split header text into lines, preferring breaks at underscores.
   * Falls back to character-level splitting when no underscores present.
   */
  function splitHeaderText(name, charsPerLine) {
    if (name.length <= charsPerLine) return [name];

    // Try splitting at underscores first
    const segments = name.split('_');
    if (segments.length > 1) {
      const lines = [];
      let current = '';
      for (const seg of segments) {
        const next = current ? current + '_' + seg : seg;
        if (next.length > charsPerLine && current) {
          lines.push(current);
          current = seg;
        } else {
          current = next;
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    // No underscores — split at charsPerLine boundaries
    const lines = [];
    for (let i = 0; i < name.length; i += charsPerLine) {
      lines.push(name.slice(i, i + charsPerLine));
    }
    return lines;
  }

  /** Format an output value for display in HTML. */
  function formatOutputVal(val, outputName) {
    return escapeHtml(formatOutputValUtil(val, outputName, loadedFunction?.signature?.outputs));
  }

  // ============================================================================
  // FULL SCREEN DYNAMIC LOADING
  // ============================================================================

  let loadMoreObserver = null;

  function setupLoadMoreObserver() {
    if (loadMoreObserver) loadMoreObserver.disconnect();
    const sentinel = container.querySelector('.scenario-load-sentinel');
    if (!sentinel) return;

    loadMoreObserver = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      loadMoreRows();
    }, { rootMargin: '200px' });
    loadMoreObserver.observe(sentinel);
  }

  function loadMoreRows() {
    const sentinel = container.querySelector('.scenario-load-sentinel');
    const tbody = container.querySelector('.scenario-data-table tbody');
    if (!sentinel || !tbody || !scenarioData?.results) return;

    const loaded = parseInt(sentinel.dataset.loaded, 10);

    // Derive display runs from current state (not stale sentinel attributes)
    const runs = getFilteredRuns(scenarioData.results.runs);
    const varyingInputs = getVaryingInputs();
    const outputNames = getOutputNames(runs);
    const filteredRuns = applyPinFilter(runs);
    const total = filteredRuns.length;

    if (loaded >= total) {
      sentinel.remove();
      return;
    }

    const unpinnedInputs = varyingInputs.filter(n => pinnedValues[n] === undefined);
    const inputCols = unpinnedInputs.length > 0 ? unpinnedInputs : Object.keys(scenarioData.inputs);

    const nextBatch = filteredRuns.slice(loaded, loaded + FULL_SCREEN_BATCH);
    const fragment = document.createDocumentFragment();
    for (const run of nextBatch) {
      const tr = document.createElement('tr');
      let html = '';
      for (const n of inputCols) {
        const bold = String(run.inputs[n]) === String(scenarioData.inputs[n]?.baseline) ? ' scenario-baseline-val' : '';
        html += `<td class="scenario-row-label${bold}">${formatNum(run.inputs[n])}</td>`;
      }
      for (const n of outputNames) {
        html += `<td>${formatOutputVal(run.outputs[n], n)}</td>`;
      }
      tr.innerHTML = html;
      fragment.appendChild(tr);
    }
    tbody.appendChild(fragment);

    const newLoaded = loaded + nextBatch.length;
    if (newLoaded >= total) {
      sentinel.remove();
      if (loadMoreObserver) loadMoreObserver.disconnect();
    } else {
      sentinel.dataset.loaded = newLoaded;
    }
  }

  // ============================================================================
  // MOUNT
  // ============================================================================

  async function mount() {
    // Bind delegated events once — survives all DOM replacements
    bindDelegatedEvents();

    // Load published functions for the picker
    publishedFunctions = await scenarioEngine.listPublishedFunctions();

    if (currentScenarioId) {
      // Load existing scenario
      scenarioMeta = await scenarioEngine.getScenarioMetadata(currentScenarioId);
      scenarioData = await scenarioEngine.loadScenarioData(currentScenarioId);

      if (scenarioMeta?.functionId) {
        try {
          loadedFunction = await scenarioEngine.loadPublishedFunction(scenarioMeta.functionId);
        } catch (err) {
          console.warn('[ScenarioAnalysis] Failed to load function, showing picker:', err);
        }
      }
      await refreshSiblingScenarios();
    } else if (preselectedFunctionId) {
      // Auto-select the preselected function (coming from a spreadsheet page)
      await handleFunctionSelect(preselectedFunctionId);
      return; // handleFunctionSelect calls render()
    }

    render();
  }

  function destroy() {
    container.removeEventListener('click', handleClick);
    container.removeEventListener('change', handleChange);
    if (loadMoreObserver) {
      loadMoreObserver.disconnect();
      loadMoreObserver = null;
    }
    clearTimeout(saveTimeout);
  }

  return { mount, destroy };
}
