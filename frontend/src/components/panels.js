/*
 * PANELS
 * ======
 *
 * Combined Inputs, Scenarios, and Outputs panels component - toggled together as one unit.
 *
 * Features:
 * - Named inputs with inline editing (name and value)
 * - Drag-and-drop reordering of inputs
 * - Scenario tabs: numbered tabs that switch between sets of input values
 * - Scenario generator: creates scenarios from cartesian product of value sets
 * - Output panel showing live cell/named range values with formatting
 * - Self-contained UI state (inputOrder managed internally)
 * - All operations delegate to orchestrator for validation and persistence
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';
import { crossProduct, sampleCrossProduct } from '../utils/scenarioUtils.js';

/**
 * Panels Component - Inputs, Scenarios, and Outputs sections with shared visibility lifecycle
 */
export function createPanelsComponent() {
  // Dependencies (injected via init)
  // Validated input operations (return {success, error/name})
  let createNamedInput = null;
  let renameNamedInput = null;
  let deleteNamedInput = null;

  // Value operations (canonicalValues)
  let getValue = null;
  let setValue = null;

  // Input order operations
  let getAllNamedInputs = null;
  let reorderNamedInputs = null;

  // Outputs callbacks
  let getCellDisplay = null;
  let getColumnValues = null;  // For output_mode="all" - returns array of all iteration values
  let getColumnNames = null;   // For loop sheets - returns { A: "Balance", B: "Year", ... }
  let resolveNamedRange = null; // Resolves named range name to notation (e.g., "TOTAL" → "A5")

  // Visibility callback
  let onVisibilityChange = null;

  // Dirty tracking callback
  let markDirty = null;

  // Formula reference picking
  let isFormulaEditingMode = null;
  let insertReference = null;

  // Scenario batch-apply (writes scenario values to canonical values engine)
  let setBatchSkipHistory = null;

  // Scenario analysis integration
  let isPublished = null;
  let onAnalyze = null;

  // Component state
  let scenarios = [];
  let visible = false;

  // Inputs DOM state
  let inputsPanelRoot = null;  // The .inputs-panel element (for show/hide)
  let inputsContainer = null;  // The .inputs-panel-left element (for input rows)

  // Drag state
  let draggedElement = null;
  let dragOffsetX = 0; // Offset from cursor to element center
  let dragOffsetY = 0;

  // Scenario state
  let activeScenarioIndex = -1;  // -1 = no scenario selected
  let scenarioContainer = null;  // The .inputs-panel-right element

  // Outputs state
  let outputsPanel = null;
  let outputsContainer = null;
  let addOutputBtn = null;
  let outputColumns = []; // Array of {column, addressInput, resultDisplay}

  // ============================================================================
  // SCENARIO HELPERS
  // ============================================================================

  /**
   * Parse comma-separated values string into array of trimmed values
   */
  function parseValuesString(str) {
    if (!str || !str.trim()) return [];
    return str.split(',').map(v => v.trim()).filter(v => v !== '');
  }

  /**
   * Ensure at least one scenario exists. Called whenever inputs exist
   * so there's never a state where values are edited outside a scenario.
   */
  function ensureScenarioExists() {
    if (scenarios.length > 0) {
      if (activeScenarioIndex < 0) activeScenarioIndex = 0;
      return;
    }
    const inputNames = getAllNamedInputs();
    if (inputNames.length === 0) return;
    const initialScenario = { inputs: {}, outputs: {} };
    for (const name of inputNames) {
      initialScenario.inputs[name] = getValue(name) || '';
    }
    scenarios = [initialScenario];
    activeScenarioIndex = 0;
  }

  /**
   * Update the active scenario's stored input value
   */
  function updateActiveScenarioValue(name, value) {
    if (activeScenarioIndex < 0 || activeScenarioIndex >= scenarios.length) return;
    scenarios[activeScenarioIndex].inputs[name] = value;
  }

  /**
   * Sync all current canonical values into the active scenario's inputs
   */
  function syncActiveScenarioFromCanonical() {
    if (activeScenarioIndex < 0 || activeScenarioIndex >= scenarios.length) return;
    const inputNames = getAllNamedInputs();
    for (const name of inputNames) {
      scenarios[activeScenarioIndex].inputs[name] = getValue(name) || '';
    }
  }

  /**
   * Apply a scenario's input values to the canonical values engine.
   */
  function applyScenarioToCanonical(index) {
    const scenario = scenarios[index];
    if (!scenario) return;
    const entries = getAllNamedInputs()
      .filter(name => scenario.inputs[name] !== undefined)
      .map(name => [name, scenario.inputs[name]]);
    setBatchSkipHistory(entries);
  }

  // ============================================================================
  // INPUT HANDLERS
  // ============================================================================

  /**
   * Handle add input button click
   */
  function handleAddInput() {
    let counter = 1;
    let result;
    do {
      const name = `INPUT${counter}`;
      result = createNamedInput(name);
      counter++;
    } while (!result.success && counter < 1000);

    if (result.success) {
      addInputRow(result.name);

      // Ensure a scenario exists now that we have an input
      ensureScenarioExists();

      // Add new input key to all scenarios
      for (const sc of scenarios) {
        if (sc.inputs[result.name] === undefined) {
          sc.inputs[result.name] = '';
        }
      }

      renderScenarioSection();
    } else {
      console.error(`[Panels] Failed to create input after 1000 attempts: ${result.error}`);
    }
  }

  /**
   * Handle rename input
   */
  function handleRenameInput(oldName, newName, nameInputElement) {
    const result = renameNamedInput(oldName, newName);

    if (result.success) {
      const row = nameInputElement.closest('.input-row');
      row.dataset.name = result.newName;
      nameInputElement.value = result.newName;

      // Update key in all scenarios
      for (const sc of scenarios) {
        if (oldName in sc.inputs) {
          sc.inputs[result.newName] = sc.inputs[oldName];
          delete sc.inputs[oldName];
        }
      }

      console.log(`[Panels] Renamed ${oldName} to ${result.newName}`);
    } else {
      nameInputElement.value = oldName;
      console.warn(`[Panels] Failed to rename: ${result.error}`);
    }
  }

  /**
   * Handle delete input
   */
  function handleDeleteInput(name) {
    const result = deleteNamedInput(name);

    if (result.success) {
      const row = inputsContainer.querySelector(`[data-name="${name}"]`);
      if (row) row.remove();

      // Remove from all scenarios
      for (const sc of scenarios) {
        delete sc.inputs[name];
      }

      console.log(`[Panels] Deleted ${name}`);
    } else {
      console.warn(`[Panels] Failed to delete: ${result.error}`);
    }
  }

  // ============================================================================
  // DRAG AND DROP
  // ============================================================================

  function handleDragStart(e) {
    draggedElement = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);

    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    dragOffsetX = centerX - e.clientX;
    dragOffsetY = centerY - e.clientY;
  }

  function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const afterElement = getDragAfterElement(inputsContainer, e.clientX, e.clientY);
    if (afterElement == null) {
      inputsContainer.appendChild(draggedElement);
    } else {
      inputsContainer.insertBefore(draggedElement, afterElement);
    }
    return false;
  }

  function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();

    const rows = Array.from(inputsContainer.querySelectorAll('.input-row'));
    const newOrder = rows.map(row => row.dataset.name);
    reorderNamedInputs(newOrder);

    console.log('[Panels] Reordered inputs:', newOrder);
    return false;
  }

  function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    draggedElement = null;
    dragOffsetX = 0;
    dragOffsetY = 0;
  }

  function getDragAfterElement(container, cursorX, cursorY) {
    if (!draggedElement) return null;

    const draggableElements = [
      ...container.querySelectorAll('.input-row:not(.dragging)')
    ];

    const virtualCenterX = cursorX + dragOffsetX;
    const virtualCenterY = cursorY + dragOffsetY;

    return draggableElements.find(child => {
      const box = child.getBoundingClientRect();
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;

      const yDiff = Math.abs(virtualCenterY - centerY);
      const isDifferentRow = yDiff > box.height / 2;

      if (isDifferentRow) {
        return virtualCenterY < centerY;
      }
      return virtualCenterX < centerX;
    }) || null;
  }

  // ============================================================================
  // INPUTS MOUNTING
  // ============================================================================

  let addInputBtn = null;

  function mountInputs(panelElement) {
    console.log('[Panels] Mounting inputs section...');

    inputsPanelRoot = panelElement;
    inputsContainer = panelElement.querySelector('.inputs-panel-left');
    scenarioContainer = panelElement.querySelector('.inputs-panel-right');

    // Find button inside the left section
    addInputBtn = inputsContainer.querySelector('.btn-add-input');
    addInputBtn?.addEventListener('click', handleAddInput);
  }

  /**
   * Add input row to display
   */
  function addInputRow(name) {
    const row = document.createElement('div');
    row.className = 'input-row';
    row.dataset.name = name;
    row.draggable = true;

    // Drag event handlers
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('drop', handleDrop);
    row.addEventListener('dragend', handleDragEnd);

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.textContent = '\u22EE\u22EE';
    dragHandle.setAttribute('aria-label', 'Drag to reorder');

    // Name field
    const nameInput = document.createElement('input');
    nameInput.className = 'input-name-field';
    nameInput.type = 'text';
    nameInput.placeholder = 'Name';
    nameInput.value = name || '';
    nameInput.setAttribute('aria-label', 'Input name');
    nameInput.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (isFormulaEditingMode && isFormulaEditingMode()) {
        e.preventDefault();
        insertReference(row.dataset.name);
      }
    });
    nameInput.addEventListener('blur', () => {
      const currentName = row.dataset.name;
      const newName = nameInput.value.trim();
      if (newName && newName !== currentName) {
        handleRenameInput(currentName, newName, nameInput);
      } else {
        nameInput.value = currentName;
      }
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });

    // Value field (inline editing) - with dual-write to active scenario
    const valueInput = document.createElement('input');
    valueInput.className = 'input-value-field';
    valueInput.type = 'text';
    valueInput.placeholder = 'Value';
    valueInput.value = getValue(name) || '';
    valueInput.setAttribute('aria-label', 'Input value');
    valueInput.addEventListener('mousedown', (e) => e.stopPropagation());
    valueInput.addEventListener('blur', () => {
      const currentName = row.dataset.name;
      const newValue = valueInput.value.trim();
      setValue(currentName, newValue);
      // Re-read to get normalized value
      const normalizedValue = getValue(currentName) || '';
      valueInput.value = normalizedValue;
      // Dual-write: also update active scenario
      updateActiveScenarioValue(currentName, normalizedValue);
    });
    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') valueInput.blur();
    });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-input';
    removeBtn.textContent = '\u00D7';
    removeBtn.setAttribute('aria-label', 'Remove input');
    removeBtn.title = 'Remove input';
    removeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    removeBtn.addEventListener('click', () => {
      const currentName = row.dataset.name;
      handleDeleteInput(currentName);
    });

    row.appendChild(dragHandle);
    row.appendChild(nameInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);

    inputsContainer.appendChild(row);
  }

  // ============================================================================
  // SCENARIO UI
  // ============================================================================

  /**
   * Render the scenario section in the right panel area
   */
  function renderScenarioSection() {
    if (!scenarioContainer) return;

    scenarioContainer.innerHTML = '';

    // Label row (label + generate button)
    const labelRow = document.createElement('div');
    labelRow.className = 'scenario-label-row';

    const label = document.createElement('div');
    label.className = 'scenario-label';
    label.textContent = 'Scenario:';
    labelRow.appendChild(label);

    const genBtn = document.createElement('button');
    genBtn.className = 'btn-generate-scenarios';
    genBtn.textContent = 'Generate';
    genBtn.title = 'Generate scenarios from combinations of input values';
    genBtn.addEventListener('click', openGeneratorDialog);
    labelRow.appendChild(genBtn);

    // Compare button - only meaningful with 2+ scenarios and at least one output
    const nonDrilldownCount = scenarios.filter(s => !s.drilldown).length;
    if (nonDrilldownCount >= 2 && outputColumns.length > 0) {
      const compareBtn = document.createElement('button');
      compareBtn.className = 'btn-compare-scenarios';
      compareBtn.textContent = 'Compare';
      compareBtn.title = 'View all scenario inputs and outputs side by side';
      compareBtn.addEventListener('click', openComparisonModal);
      labelRow.appendChild(compareBtn);
    }

    // Explore button - opens scenario analysis for the published function (new tab)
    if (isPublished && onAnalyze) {
      const analyzeBtn = document.createElement('button');
      analyzeBtn.className = 'btn-analyze-scenarios';
      analyzeBtn.textContent = 'Explore';
      analyzeBtn.title = 'Open scenario analysis to explore how inputs affect outputs';
      analyzeBtn.hidden = true;
      analyzeBtn.addEventListener('click', () => onAnalyze());
      labelRow.appendChild(analyzeBtn);

      isPublished().then(published => {
        if (published) analyzeBtn.hidden = false;
      });
    }

    scenarioContainer.appendChild(labelRow);

    // Tabs row
    const tabsRow = document.createElement('div');
    tabsRow.className = 'scenario-tabs-row';

    let regularIndex = 1;
    for (let i = 0; i < scenarios.length; i++) {
      const isDrilldown = scenarios[i].drilldown;
      const tab = document.createElement('button');
      tab.className = 'scenario-tab' + (i === activeScenarioIndex ? ' active' : '')
        + (isDrilldown ? ' scenario-tab-drilldown' : '');
      tab.textContent = isDrilldown ? 'D' : String(regularIndex++);
      tab.title = isDrilldown ? 'Drilldown values (from caller)' : `Scenario ${regularIndex - 1}`;

      tab.addEventListener('click', () => handleScenarioTabClick(i));

      // Delete badge (visible on hover via CSS, not for drilldown scenarios)
      if (scenarios.length > 1 && !isDrilldown) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-remove-scenario';
        deleteBtn.textContent = '\u00D7';
        deleteBtn.title = 'Delete scenario';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleDeleteScenario(i);
        });
        tab.appendChild(deleteBtn);
      }

      tabsRow.appendChild(tab);
    }

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-scenario';
    addBtn.textContent = '+';
    addBtn.title = 'Add scenario (copies current values)';
    addBtn.addEventListener('click', handleAddScenario);
    tabsRow.appendChild(addBtn);

    scenarioContainer.appendChild(tabsRow);
  }

  /**
   * Handle clicking a scenario tab
   */
  function handleScenarioTabClick(index) {
    if (index < 0 || index >= scenarios.length) return;

    activeScenarioIndex = index;
    applyScenarioToCanonical(index);

    // Refresh input value fields to show the new scenario's values
    refreshInputValues();
    renderScenarioSection();
  }

  /**
   * Handle adding a new scenario (copies current values)
   */
  function handleAddScenario() {
    const inputNames = getAllNamedInputs();

    // Create new scenario from current canonical values
    const newScenario = { inputs: {}, outputs: {} };
    for (const name of inputNames) {
      newScenario.inputs[name] = getValue(name) || '';
    }

    scenarios.push(newScenario);

    // Switch to the new scenario
    activeScenarioIndex = scenarios.length - 1;
    if (markDirty) markDirty();
    renderScenarioSection();
  }

  /**
   * Handle deleting a scenario
   */
  function handleDeleteScenario(index) {
    if (scenarios.length <= 1) return; // Don't delete the last one

    scenarios.splice(index, 1);

    // Adjust active index
    if (activeScenarioIndex >= scenarios.length) {
      activeScenarioIndex = scenarios.length - 1;
    } else if (activeScenarioIndex === index) {
      // Switched to the scenario that now occupies this index
      // (or the last one if we deleted the last)
      activeScenarioIndex = Math.min(index, scenarios.length - 1);
    } else if (activeScenarioIndex > index) {
      activeScenarioIndex--;
    }

    // Apply the now-active scenario's values
    applyScenarioToCanonical(activeScenarioIndex);
    refreshInputValues();
    if (markDirty) markDirty();
    renderScenarioSection();
  }

  /**
   * Refresh the value fields of all input rows from canonical values
   */
  function refreshInputValues() {
    if (!inputsContainer) return;
    const rows = inputsContainer.querySelectorAll('.input-row');
    for (const row of rows) {
      const name = row.dataset.name;
      const valueField = row.querySelector('.input-value-field');
      if (valueField) {
        valueField.value = getValue(name) || '';
      }
    }
  }

  // ============================================================================
  // GENERATOR DIALOG
  // ============================================================================

  const MAX_DEFAULT_GENERATE = 50;

  function openGeneratorDialog() {
    const inputNames = getAllNamedInputs();
    if (inputNames.length === 0) {
      alert('Define at least one input first.');
      return;
    }

    // Build field HTML
    const fieldsHtml = inputNames.map(name => `
      <label class="generator-field">
        <span class="generator-field-name">${name}</span>
        <input type="text" class="generator-field-input" data-name="${name}" placeholder="e.g., 0, 10, 100">
      </label>
    `).join('');

    const dialog = mountDialog('scenario-generator-dialog', 'scenario-generator-dialog', `
      ${dialogHeaderHTML('Generate Scenarios')}
      <div class="dialog-body">
        <p class="scenario-generator-help">Enter comma-separated values for each input:</p>
        <div class="scenario-generator-fields">${fieldsHtml}</div>
        <div class="scenario-generator-options">
          <label class="scenario-generator-max">
            <span>Generate up to:</span>
            <input type="number" value="10" min="1" max="1000">
            <span>scenarios</span>
          </label>
          <div class="scenario-generator-info"></div>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-outlined">Cancel</button>
        <button type="button" class="dialog-btn-confirm">Generate</button>
      </div>
    `, () => dialog.close());

    const infoEl = dialog.querySelector('.scenario-generator-info');
    const maxInput = dialog.querySelector('.scenario-generator-max input');

    function updateInfo() {
      const values = {};
      dialog.querySelectorAll('.generator-field-input').forEach(input => {
        values[input.dataset.name] = parseValuesString(input.value);
      });

      const names = Object.keys(values);
      if (names.length === 0 || names.some(n => values[n].length === 0)) {
        infoEl.textContent = 'Enter values for all inputs';
        return;
      }

      const total = names.reduce((acc, n) => acc * values[n].length, 1);
      infoEl.textContent = `${total} possible combination${total !== 1 ? 's' : ''}`;
      maxInput.max = total;
      maxInput.value = Math.min(total, MAX_DEFAULT_GENERATE);
    }

    dialog.querySelectorAll('.generator-field-input').forEach(input => {
      input.addEventListener('input', updateInfo);
    });

    // Cancel
    dialog.querySelector('.btn-outlined').addEventListener('click', () => dialog.close());
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.close());

    // Generate
    dialog.querySelector('.dialog-btn-confirm').addEventListener('click', () => {
      const values = {};
      dialog.querySelectorAll('.generator-field-input').forEach(input => {
        values[input.dataset.name] = parseValuesString(input.value);
      });

      const names = Object.keys(values);
      if (names.length === 0 || names.some(n => values[n].length === 0)) {
        alert('Please enter at least one value for each input.');
        return;
      }

      const maxCount = parseInt(maxInput.value, 10) || 10;
      const inputConfigs = Object.entries(values).map(([name, vals]) => ({ name, values: vals }));
      const total = inputConfigs.reduce((acc, c) => acc * c.values.length, 1);
      const combinations = maxCount >= total
        ? crossProduct(inputConfigs)
        : sampleCrossProduct(inputConfigs, maxCount);
      const toAdd = combinations.map(combo => ({ inputs: combo, outputs: {} }));
      if (toAdd.length === 0) {
        alert('No combinations to generate.');
        return;
      }

      scenarios.push(...toAdd);

      // Switch to last generated scenario
      activeScenarioIndex = scenarios.length - 1;
      applyScenarioToCanonical(activeScenarioIndex);
      refreshInputValues();
      if (markDirty) markDirty();
      renderScenarioSection();

      dialog.close();
      console.log(`[Panels] Generated ${toAdd.length} scenarios from ${total} combinations`);
    });

    updateInfo();
    dialog.showModal();
  }

  // ============================================================================
  // SCENARIO COMPARISON MODAL
  // ============================================================================

  function openComparisonModal() {
    const inputNames = getAllNamedInputs();
    const outputAddresses = getOutputCells();

    if (outputAddresses.length === 0) {
      alert('Add at least one output first.');
      return;
    }

    // Resolve output display names (named range → address, or just the address)
    const outputLabels = outputAddresses.map(addr => {
      if (resolveNamedRange) {
        const notation = resolveNamedRange(addr);
        if (notation && !notation.includes(':')) return `${addr} (${notation})`;
      }
      return addr;
    });

    // Save original input values
    const originalInputs = {};
    for (const name of inputNames) {
      originalInputs[name] = getValue(name);
    }

    // Evaluate each non-drilldown scenario
    const results = [];
    let regularIndex = 1;
    for (let i = 0; i < scenarios.length; i++) {
      if (scenarios[i].drilldown) continue;

      const sc = scenarios[i];
      const label = `Scenario ${regularIndex++}`;

      // Apply this scenario's inputs
      const entries = inputNames
        .filter(name => sc.inputs[name] !== undefined)
        .map(name => [name, sc.inputs[name]]);
      if (entries.length > 0) setBatchSkipHistory(entries);

      // Read each output
      const outputValues = outputAddresses.map(addr => {
        let displayAddress = addr;
        if (resolveNamedRange) {
          const notation = resolveNamedRange(addr);
          if (notation && !notation.includes(':')) displayAddress = notation;
        }
        if (!getCellDisplay) return { text: '', styles: {} };
        const display = getCellDisplay(displayAddress);
        return display && display.text !== undefined
          ? { text: display.text || '', styles: display.styles || {} }
          : { text: '#REF!', error: true };
      });

      results.push({ label, inputs: sc.inputs, outputValues });
    }

    // Restore original values
    const restoreEntries = inputNames.map(name => [name, originalInputs[name]]);
    if (restoreEntries.length > 0) setBatchSkipHistory(restoreEntries);

    // Build sortable comparison table
    let sortCol = null;  // null = original order, or { type: 'input'|'output', index: number }
    let sortAsc = true;

    function renderBodyRows(sorted) {
      return sorted.map(r => {
        const inputCells = inputNames.map(name => {
          const val = r.inputs[name] !== undefined ? String(r.inputs[name]) : '';
          return `<td class="compare-cell-input">${escapeHtml(val)}</td>`;
        }).join('');
        const outputCells = r.outputValues.map(v => {
          const cls = v.error ? ' compare-cell-error' : '';
          const style = buildInlineStyle(v.styles || {});
          return `<td class="compare-cell-output${cls}"${style}>${escapeHtml(v.text)}</td>`;
        }).join('');
        return `<tr><td class="compare-row-label">${escapeHtml(r.label)}</td>${inputCells}${outputCells}</tr>`;
      }).join('');
    }

    function getSorted() {
      if (!sortCol) return results;
      const sorted = [...results];
      sorted.sort((a, b) => {
        let aVal, bVal;
        if (sortCol.type === 'input') {
          const name = inputNames[sortCol.index];
          aVal = a.inputs[name] !== undefined ? String(a.inputs[name]) : '';
          bVal = b.inputs[name] !== undefined ? String(b.inputs[name]) : '';
        } else {
          aVal = a.outputValues[sortCol.index].text;
          bVal = b.outputValues[sortCol.index].text;
        }
        // Try numeric comparison — strip formatting (currency symbols, commas, %)
        const aNum = parseNumeric(aVal), bNum = parseNumeric(bVal);
        if (aNum !== null && bNum !== null) {
          return sortAsc ? aNum - bNum : bNum - aNum;
        }
        const cmp = aVal.localeCompare(bVal);
        return sortAsc ? cmp : -cmp;
      });
      return sorted;
    }

    function sortIndicator(type, index) {
      if (!sortCol || sortCol.type !== type || sortCol.index !== index) return '';
      return ` ${sortAsc ? '\u25B2' : '\u25BC'}`;
    }

    function renderHeaders() {
      const inputHeaderCells = inputNames.map((name, i) =>
        `<th class="compare-col-header compare-col-input compare-sortable" data-sort-type="input" data-sort-index="${i}">${escapeHtml(name)}${sortIndicator('input', i)}</th>`
      ).join('');
      const outputHeaderCells = outputAddresses.map((addr, i) =>
        `<th class="compare-col-header compare-col-output compare-sortable" data-sort-type="output" data-sort-index="${i}" title="${escapeHtml(outputLabels[i])}">${escapeHtml(addr)}${sortIndicator('output', i)}</th>`
      ).join('');
      return `<tr><th></th>${inputHeaderCells}${outputHeaderCells}</tr>`;
    }

    function updateTable(dialog) {
      const thead = dialog.querySelector('.scenario-compare-table thead');
      const tbody = dialog.querySelector('.scenario-compare-table tbody');
      // Re-render header row (second row in thead) to update sort indicators
      const rows = thead.querySelectorAll('tr');
      rows[1].outerHTML = renderHeaders();
      tbody.innerHTML = renderBodyRows(getSorted());
      wireHeaderClicks(dialog);
    }

    function wireHeaderClicks(dialog) {
      dialog.querySelectorAll('.compare-sortable').forEach(th => {
        th.addEventListener('click', () => {
          const type = th.dataset.sortType;
          const index = Number(th.dataset.sortIndex);
          if (sortCol && sortCol.type === type && sortCol.index === index) {
            if (sortAsc) { sortAsc = false; }
            else { sortCol = null; sortAsc = true; }  // Third click resets
          } else {
            sortCol = { type, index };
            sortAsc = true;
          }
          updateTable(dialog);
        });
      });
    }

    const contentHTML = `
      ${dialogHeaderHTML('Compare Scenarios')}
      <div class="dialog-body scenario-compare-body">
        <table class="scenario-compare-table">
          <thead>
            <tr class="compare-group-row">
              <th></th>
              ${inputNames.length > 0 ? `<th colspan="${inputNames.length}" class="compare-group-input">Inputs</th>` : ''}
              <th colspan="${outputAddresses.length}" class="compare-group-output">Outputs</th>
            </tr>
            ${renderHeaders()}
          </thead>
          <tbody>${renderBodyRows(results)}</tbody>
        </table>
      </div>
    `;

    // Re-render content each time (results change between opens)
    let dialog = document.getElementById('scenario-compare-dialog');
    if (dialog) {
      dialog.innerHTML = contentHTML;
    } else {
      dialog = mountDialog('scenario-compare-dialog', 'scenario-compare-dialog', contentHTML, () => dialog.close());
    }

    dialog.querySelector('.dialog-close-btn')?.addEventListener('click', () => dialog.close());
    wireHeaderClicks(dialog);
    dialog.showModal();
  }

  function parseNumeric(str) {
    if (!str || str === '') return null;
    // Strip currency symbols, commas, whitespace, and trailing %
    const cleaned = str.replace(/[^0-9.\-eE]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
  }

  function buildInlineStyle(styles) {
    const parts = [];
    if (styles.bold) parts.push('font-weight:bold');
    if (styles.italic) parts.push('font-style:italic');
    if (styles.fontSize) parts.push(`font-size:${styles.fontSize}px`);
    if (styles.alignment) parts.push(`text-align:${styles.alignment}`);
    if (styles.color) parts.push(`color:${styles.color}`);
    if (styles.backgroundColor) parts.push(`background-color:${styles.backgroundColor}`);
    return parts.length > 0 ? ` style="${parts.join(';')}"` : '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================================
  // OUTPUTS
  // ============================================================================

  function handleAddOutput() {
    addOutputColumn('');
  }

  function mountOutputs(panelElement) {
    console.log('[Panels] Mounting outputs section...');

    outputsPanel = panelElement;
    outputsContainer = panelElement.querySelector('.outputs-container');
    addOutputBtn = panelElement.querySelector('.btn-add-output');

    addOutputBtn?.addEventListener('click', handleAddOutput);
    outputColumns = [];
  }

  /**
   * Add a new output column
   * @param {string} address - Initial address value (default empty)
   * @param {string} mode - Output mode: 'last' (default) or 'all'
   */
  function addOutputColumn(address = '', mode = 'last') {
    const column = document.createElement('div');
    column.className = 'output-column';

    const addressInput = document.createElement('input');
    addressInput.className = 'output-address-field';
    addressInput.type = 'text';
    addressInput.placeholder = 'e.g., A1';
    addressInput.value = address;
    addressInput.setAttribute('aria-label', 'Output cell reference');

    // Alias label for column name (loop sheets only)
    let aliasLabel = null;
    if (getColumnNames) {
      aliasLabel = document.createElement('span');
      aliasLabel.className = 'output-alias-label';
      if (address) {
        const col = address.trim().toUpperCase().replace(/[0-9]/g, '');
        const names = getColumnNames();
        if (col && names[col]) {
          aliasLabel.textContent = names[col];
          aliasLabel.title = `Column ${col} alias`;
        }
      }
    }

    let modeSelect = null;
    if (getColumnValues) {
      modeSelect = document.createElement('select');
      modeSelect.className = 'output-mode-select';
      modeSelect.innerHTML = `
        <option value="last">Last</option>
        <option value="all">All</option>
      `;
      modeSelect.value = mode;
      modeSelect.setAttribute('aria-label', 'Output mode');
      modeSelect.title = 'Last: final iteration value | All: all iteration values';
    }

    const resultDisplay = document.createElement('div');
    resultDisplay.className = 'output-result-display';
    resultDisplay.addEventListener('click', () => {
      if (resultDisplay.classList.contains('output-mode-all')) {
        resultDisplay.classList.toggle('expanded');
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-output';
    removeBtn.textContent = '\u00D7';
    removeBtn.setAttribute('aria-label', 'Remove output');
    removeBtn.title = 'Remove output';

    const columnData = { column, addressInput, modeSelect, resultDisplay, aliasLabel };

    addressInput.addEventListener('change', () => {
      updateAliasLabel(columnData);
      updateColumnResult(columnData);
      if (markDirty) markDirty();
    });
    addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        updateAliasLabel(columnData);
        updateColumnResult(columnData);
        if (markDirty) markDirty();
      }
    });
    if (modeSelect) {
      modeSelect.addEventListener('change', () => {
        updateColumnResult(columnData);
        if (markDirty) markDirty();
      });
    }
    removeBtn.addEventListener('click', () => removeOutputColumn(columnData));

    column.appendChild(addressInput);
    if (aliasLabel) column.appendChild(aliasLabel);
    column.appendChild(resultDisplay);
    if (modeSelect) column.appendChild(modeSelect);
    column.appendChild(removeBtn);

    outputsContainer.appendChild(column);
    outputColumns.push(columnData);

    if (address) updateColumnResult(columnData);

    console.log('[Panels] Added output column, total:', outputColumns.length);
  }

  function removeOutputColumn(columnData) {
    const index = outputColumns.indexOf(columnData);
    if (index !== -1) {
      columnData.column.remove();
      outputColumns.splice(index, 1);
      if (markDirty) markDirty();
      console.log('[Panels] Removed output column, total:', outputColumns.length);
    }
  }

  function normalizeAddress(address) {
    return address.trim().toUpperCase();
  }

  function updateAliasLabel(columnData) {
    const { addressInput, aliasLabel } = columnData;
    if (!aliasLabel || !getColumnNames) return;
    const raw = addressInput.value.trim().toUpperCase().replace(/[0-9]/g, '');
    const names = getColumnNames();
    if (raw && names[raw]) {
      aliasLabel.textContent = names[raw];
      aliasLabel.title = `Column ${raw} alias`;
    } else {
      aliasLabel.textContent = '';
      aliasLabel.title = '';
    }
  }

  function updateColumnResult(columnData) {
    const { addressInput, modeSelect, resultDisplay } = columnData;
    const rawAddress = addressInput.value.trim();
    const mode = modeSelect ? modeSelect.value : 'last';

    if (!rawAddress) {
      resultDisplay.textContent = '';
      resultDisplay.className = 'output-result-display';
      resetResultStyles(resultDisplay);
      return;
    }

    const address = normalizeAddress(rawAddress);
    if (address !== rawAddress) addressInput.value = address;

    if (mode === 'all' && getColumnValues) {
      const values = getColumnValues(address);
      if (values && values.length > 0) {
        const textValues = values.map(v => v.text !== undefined ? v.text : String(v));
        resultDisplay.textContent = textValues.join(', ');
        resultDisplay.className = 'output-result-display output-mode-all';
        resultDisplay.title = `${values.length} values`;
        resetResultStyles(resultDisplay);
      } else {
        resultDisplay.textContent = '(empty)';
        resultDisplay.className = 'output-result-display';
        resetResultStyles(resultDisplay);
      }
      return;
    }

    if (!getCellDisplay) {
      resultDisplay.textContent = '';
      return;
    }

    // If address is a named range pointing to a single cell, use that cell for display formatting
    let displayAddress = address;
    if (resolveNamedRange) {
      const notation = resolveNamedRange(address);
      if (notation && !notation.includes(':')) {
        displayAddress = notation;
      }
    }
    const displayData = getCellDisplay(displayAddress);

    if (displayData && displayData.text !== undefined) {
      resultDisplay.textContent = displayData.text || '';
      resultDisplay.className = 'output-result-display';

      const styles = displayData.styles || {};
      resultDisplay.style.fontWeight = styles.bold ? 'bold' : 'normal';
      resultDisplay.style.fontStyle = styles.italic ? 'italic' : 'normal';
      resultDisplay.style.fontSize = styles.fontSize ? `${styles.fontSize}px` : '';
      resultDisplay.style.textAlign = styles.alignment || 'left';
      resultDisplay.style.color = styles.color || '';
      resultDisplay.style.backgroundColor = styles.backgroundColor || '';
    } else {
      resultDisplay.textContent = '#REF!';
      resultDisplay.className = 'output-result-display error';
      resetResultStyles(resultDisplay);
    }
  }

  function resetResultStyles(resultDisplay) {
    resultDisplay.style.fontWeight = '';
    resultDisplay.style.fontStyle = '';
    resultDisplay.style.fontSize = '';
    resultDisplay.style.textAlign = '';
    resultDisplay.style.color = '';
    resultDisplay.style.backgroundColor = '';
  }

  function refreshOutputs() {
    for (const columnData of outputColumns) {
      if (columnData.addressInput.value.trim()) {
        updateAliasLabel(columnData);
        updateColumnResult(columnData);
      }
    }
  }

  function getOutputCells() {
    return outputColumns
      .map(col => col.addressInput.value.trim().toUpperCase())
      .filter(addr => addr !== '');
  }

  function getOutputModes() {
    const modes = {};
    for (const col of outputColumns) {
      const addr = col.addressInput.value.trim().toUpperCase();
      if (addr) {
        modes[addr] = col.modeSelect ? col.modeSelect.value : 'last';
      }
    }
    return modes;
  }

  function setOutputCells(cells, modes = {}) {
    for (const columnData of outputColumns) {
      columnData.column.remove();
    }
    outputColumns = [];

    for (const address of cells) {
      const mode = modes[address.toUpperCase()] || 'last';
      addOutputColumn(address, mode);
    }

    console.log('[Panels] Set output cells:', cells, 'modes:', modes);
  }

  // ============================================================================
  // REBUILD & LIFECYCLE
  // ============================================================================

  /**
   * Rebuild the inputs list from the engine (call after undo/redo)
   */
  function rebuildInputsList() {
    console.log('[Panels] rebuildInputsList called');

    // Clear existing input rows (but keep header, divider)
    if (inputsContainer) {
      const existingRows = inputsContainer.querySelectorAll('.input-row');
      existingRows.forEach(row => row.remove());
    }

    const orderedInputs = getAllNamedInputs();
    console.log('[Panels] Got ordered inputs from engine:', orderedInputs);

    for (const name of orderedInputs) {
      addInputRow(name);
    }

    // Ensure a scenario exists if inputs do
    ensureScenarioExists();

    // Sync active scenario from current canonical values (after undo/redo)
    syncActiveScenarioFromCanonical();

    // Re-render scenario tabs
    renderScenarioSection();

    console.log('[Panels] Rebuilt inputs list with', orderedInputs.length, 'inputs');
  }

  function mount({ inputsPanel, outputsPanel }) {
    console.log('[Panels] Mounting...');
    mountInputs(inputsPanel);
    mountOutputs(outputsPanel);
    visible = false;
    console.log('[Panels] Mounted');
  }

  function unmount() {
    addInputBtn?.removeEventListener('click', handleAddInput);
    addOutputBtn?.removeEventListener('click', handleAddOutput);

    inputsPanelRoot = null;
    inputsContainer = null;
    scenarioContainer = null;
    outputsPanel = null;
    outputsContainer = null;
    addInputBtn = null;
    addOutputBtn = null;
    outputColumns = [];
    scenarios = [];
    activeScenarioIndex = -1;

    console.log('[Panels] Unmounted');
  }

  /**
   * Show both panels.
   */
  function show() {
    if (inputsPanelRoot) inputsPanelRoot.hidden = false;
    if (outputsPanel) outputsPanel.hidden = false;
    visible = true;
    onVisibilityChange(true);

    ensureScenarioExists();
    renderScenarioSection();
    console.log('[Panels] Shown');
  }

  function hide() {
    if (inputsPanelRoot) inputsPanelRoot.hidden = true;
    if (outputsPanel) outputsPanel.hidden = true;
    visible = false;
    onVisibilityChange(false);
    console.log('[Panels] Hidden');
  }

  function toggle() {
    if (visible) {
      hide();
    } else {
      show();
    }
  }

  function isVisible() {
    return visible;
  }

  return {
    init(deps) {
      ({
        createNamedInput,
        renameNamedInput,
        deleteNamedInput,
        getValue,
        setValue,
        getAllNamedInputs,
        reorderNamedInputs,
        getCellDisplay,
        resolveNamedRange,
        getColumnValues,
        getColumnNames,
        onVisibilityChange,
        markDirty,
        setBatchSkipHistory,
        isFormulaEditingMode,
        insertReference,
        isPublished,
        onAnalyze,
      } = deps);
      console.log('[Panels] Initialized');
    },

    mount,
    unmount,
    show,
    toggle,
    isVisible,
    // Outputs methods
    getOutputCells,
    getOutputModes,
    setOutputCells,
    refreshOutputs,
    // Inputs methods
    rebuildInputsList,
    // Scenario methods
    getScenarios() {
      return scenarios;
    },
    loadScenarios(newScenarios) {
      scenarios = newScenarios || [];
      activeScenarioIndex = scenarios.length > 0 ? 0 : -1;
      renderScenarioSection();
    },
    rebuildScenarioTabs() {
      renderScenarioSection();
    },
    setActiveScenario(index) {
      handleScenarioTabClick(index);
    },
    getActiveScenarioIndex() {
      return activeScenarioIndex;
    },
    setActiveScenarioVisual(index) {
      activeScenarioIndex = index;
      refreshInputValues();
      renderScenarioSection();
    },
  };
}
