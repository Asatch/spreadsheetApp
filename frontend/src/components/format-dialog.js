/*
 * FORMAT DIALOG COMPONENT
 * =======================
 *
 * Vanilla JS component for cell and default formatting.
 * Allows users to configure number formats, date formats, and styles.
 */

import {
  DATE_FORMAT_CONFIG,
  DATETIME_FORMAT_CONFIG,
  getDateFormatDefaults,
  getDateTimeFormatDefaults,
  getDateTimeFormatOptions
} from '../utils/dateFormatter.js';
import { NUMBER_FORMAT_CONFIG, getNumberFormatDefaults } from '../utils/numberFormatter.js';
import { mountDialog } from '../utils/dialogMount.js';

// ============================================================================
// FIELD CONFIGURATION SYSTEM
// ============================================================================

/**
 * Configuration-driven form field definitions
 * Each format type returns an array of field configs based on current state
 * @param {Object} formatOptions - Current format options
 * @param {string} activeTab - Current active tab ('cell' or 'default')
 */
const FIELD_CONFIGS = {
  NUMBER: (formatOptions) => {
    const fields = [];

    // Get current subcategory (now using flat structure with subCategory field)
    const currentSubCategory = formatOptions.subCategory || 'number';

    // Subcategory selector (built from config)
    const subcategoryOptions = Object.entries(NUMBER_FORMAT_CONFIG.subcategories).map(([value, config]) => ({
      value,
      label: config.label
    }));

    fields.push({
      type: 'select',
      id: 'number-subcategory',
      label: 'Number Format',
      value: currentSubCategory,
      options: subcategoryOptions,
    });

    // Get field definitions for current subcategory from config
    const subcategoryConfig = NUMBER_FORMAT_CONFIG.subcategories[currentSubCategory];

    if (subcategoryConfig) {
      // Add info section if there's a description and no fields
      if (subcategoryConfig.description && Object.keys(subcategoryConfig.fields).length === 0) {
        fields.push({
          type: 'info',
          title: subcategoryConfig.label,
          text: subcategoryConfig.description,
        });
      }

      // Map config field IDs to dialog field format
      // subcategoryConfig.fields is now: { fieldId: default | null, ... }
      for (const fieldId of Object.keys(subcategoryConfig.fields)) {
        const fieldConfig = NUMBER_FORMAT_CONFIG.fields[fieldId];
        if (!fieldConfig) continue; // Skip if field definition not found

        // Check visibility condition
        if (!shouldShowField(fieldConfig, formatOptions)) {
          continue; // Skip fields that shouldn't be visible
        }

        // Get current value from formatOptions, or determine default
        // (subcategory default or global default, resolved by getNumberFormatDefaults)
        const subcategoryDefault = subcategoryConfig.fields[fieldId];
        const defaultValue = subcategoryDefault !== null ? subcategoryDefault : fieldConfig.default;
        const value = formatOptions[fieldId] ?? defaultValue;

        // Map field config to dialog field format
        const dialogField = {
          type: fieldConfig.type,
          id: fieldConfig.id,
          label: fieldConfig.label,
          value: value,
        };

        // Add type-specific properties
        if (fieldConfig.type === 'number') {
          dialogField.min = fieldConfig.min;
          dialogField.max = fieldConfig.max;
        } else if (fieldConfig.type === 'text') {
          if (fieldConfig.maxlength) {
            dialogField.maxlength = fieldConfig.maxlength;
          }
        } else if (fieldConfig.type === 'select' || fieldConfig.type === 'checkbox-group') {
          dialogField.options = fieldConfig.options;
        }

        fields.push(dialogField);
      }
    }

    return fields;
  },

  DATE: (formatOptions, activeTab) => {
    const fields = [];

    // Build fields from DATE_FORMAT_CONFIG
    for (const fieldId of Object.keys(DATE_FORMAT_CONFIG.fields)) {
      const fieldConfig = DATE_FORMAT_CONFIG.fields[fieldId];
      if (!fieldConfig) continue;

      // Skip dateInputFormat field on Cell Format tab (only show on Defaults tab)
      if (fieldId === 'dateInputFormat' && activeTab === 'cell') {
        continue;
      }

      // Get current value from formatOptions or use default
      const value = formatOptions[fieldId] ?? fieldConfig.default;

      // Map field config to dialog field format
      const dialogField = {
        type: fieldConfig.type,
        id: fieldConfig.id,
        label: fieldConfig.label,
        value: value,
      };

      // Add type-specific properties
      if (fieldConfig.type === 'select') {
        dialogField.options = fieldConfig.options;
      }

      fields.push(dialogField);
    }

    // Add info section
    const infoText = activeTab === 'default'
      ? 'Date format affects display only. Date Entry Format determines how ambiguous dates like "03/04/2024" are interpreted.'
      : 'Date format affects display only. Time is set to midnight (00:00:00).';

    fields.push({
      type: 'info',
      title: 'Date Format Information',
      text: infoText,
    });

    return fields;
  },

  DATETIME: (formatOptions) => {
    const fields = [];

    // Get current displayType for dynamic field generation
    const displayType = formatOptions?.displayType || DATETIME_FORMAT_CONFIG.fields.displayType.default;

    // Build fields from DATETIME_FORMAT_CONFIG
    for (const fieldId of Object.keys(DATETIME_FORMAT_CONFIG.fields)) {
      const fieldConfig = DATETIME_FORMAT_CONFIG.fields[fieldId];
      if (!fieldConfig) continue;

      // Get current value from formatOptions or use default
      const value = formatOptions[fieldId] ?? fieldConfig.default;

      // Map field config to dialog field format
      const dialogField = {
        type: fieldConfig.type,
        id: fieldConfig.id,
        label: fieldConfig.label,
        value: value,
      };

      // Handle dynamic displayFormat field
      if (fieldId === 'displayFormat') {
        // Get options from dateFormatter based on displayType
        dialogField.options = getDateTimeFormatOptions(displayType);
        dialogField.label = displayType === 'timeOnly' ? 'Time Format' : 'Date & Time Format';
      } else if (fieldConfig.type === 'select') {
        dialogField.options = fieldConfig.options;
      }

      fields.push(dialogField);
    }

    // Add info section
    fields.push({
      type: 'info',
      title: 'DateTime Format Information',
      text: displayType === 'timeOnly'
        ? 'Time Only shows just the time portion of datetime values.'
        : 'Date & Time format shows both date and time information.',
    });

    return fields;
  },
};

// ============================================================================
// RENDERING HELPERS
// ============================================================================

/**
 * Check if a field should be visible based on visibleWhen conditions
 * @param {Object} fieldConfig - The field configuration
 * @param {Object} currentOptions - Current format options
 * @returns {boolean} True if field should be visible
 */
function shouldShowField(fieldConfig, currentOptions) {
  if (!fieldConfig.visibleWhen) return true;

  for (const [key, expectedValue] of Object.entries(fieldConfig.visibleWhen)) {
    if (currentOptions[key] !== expectedValue) {
      return false;
    }
  }
  return true;
}

/**
 * Build a set of field IDs that trigger re-render when changed
 * (fields that appear in any visibleWhen condition)
 * @param {Object} fieldsConfig - The fields configuration object
 * @returns {Set<string>} Set of field IDs that affect visibility
 */
function getFieldsThatAffectVisibility(fieldsConfig) {
  const triggerFields = new Set();

  for (const fieldConfig of Object.values(fieldsConfig)) {
    if (fieldConfig.visibleWhen) {
      for (const key of Object.keys(fieldConfig.visibleWhen)) {
        triggerFields.add(key);
      }
    }
  }

  return triggerFields;
}

/**
 * Render a select dropdown from config
 */
function renderSelect(config) {
  const { id, label, value, options, optgroups } = config;

  let optionsHTML = '';

  if (optgroups) {
    // Grouped options
    optionsHTML = optgroups.map(group => `
      <optgroup label="${group.label}">
        ${group.options.map(opt => `
          <option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>${opt.label}</option>
        `).join('')}
      </optgroup>
    `).join('');
  } else {
    // Flat options
    optionsHTML = options.map(opt => `
      <option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>${opt.label}</option>
    `).join('');
  }

  return `
    <div class="format-section">
      <label for="${id}">${label}</label>
      <select id="${id}" class="format-select">
        ${optionsHTML}
      </select>
    </div>
  `;
}

/**
 * Render a text input from config
 */
function renderTextInput(config) {
  const { id, label, value, maxlength } = config;

  return `
    <div class="format-section">
      <label for="${id}">${label}</label>
      <input
        type="text"
        id="${id}"
        class="format-input"
        value="${value}"
        ${maxlength ? `maxlength="${maxlength}"` : ''}
      />
    </div>
  `;
}

/**
 * Render a number input from config
 */
function renderNumberInput(config) {
  const { id, label, value, min, max } = config;

  return `
    <div class="format-section">
      <label for="${id}">${label}</label>
      <input
        type="number"
        id="${id}"
        class="format-input"
        value="${value}"
        ${min !== undefined ? `min="${min}"` : ''}
        ${max !== undefined ? `max="${max}"` : ''}
      />
    </div>
  `;
}

/**
 * Render an info section from config
 */
function renderInfo(config) {
  const { title, text } = config;

  return `
    <div class="format-info">
      <p>${title}</p>
      <p class="format-info-text">${text}</p>
    </div>
  `;
}

/**
 * Render a single checkbox from config
 */
function renderCheckbox(config) {
  const { id, label, value } = config;

  return `
    <div class="format-section">
      <label class="checkbox-label">
        <input
          type="checkbox"
          id="${id}"
          ${value ? 'checked' : ''}
        />
        <span>${label}</span>
      </label>
    </div>
  `;
}

/**
 * Render a checkbox group from config
 */
function renderCheckboxGroup(config) {
  const { id, label, value, options } = config;

  // value should be an array of selected values
  const selectedValues = Array.isArray(value) ? value : [];

  const checkboxesHTML = options.map(opt => `
    <label class="checkbox-option">
      <input
        type="checkbox"
        name="${id}"
        value="${opt.value}"
        ${selectedValues.includes(opt.value) ? 'checked' : ''}
      />
      <span>${opt.label}</span>
    </label>
  `).join('');

  return `
    <div class="format-section">
      <label>${label}</label>
      <div class="checkbox-group">
        ${checkboxesHTML}
      </div>
    </div>
  `;
}

/**
 * Render a field from config based on its type
 */
function renderField(config) {
  switch (config.type) {
    case 'select':
      return renderSelect(config);
    case 'text':
      return renderTextInput(config);
    case 'number':
      return renderNumberInput(config);
    case 'checkbox':
      return renderCheckbox(config);
    case 'checkbox-group':
      return renderCheckboxGroup(config);
    case 'info':
      return renderInfo(config);
    default:
      console.warn(`[FormatDialog] Unknown field type: ${config.type}`);
      return '';
  }
}

/**
 * Render all fields from an array of configs
 */
function renderFields(configs) {
  return configs.map(renderField).join('');
}

export function createFormatDialog() {
  // ============================================================================
  // STATE
  // ============================================================================

  // DOM references (found in existing HTML, not created)
  let dialog = null;
  let optionsContainer = null;
  let typeSelect = null;
  let applyBtn = null;
  let closeBtn = null;
  let cancelBtn = null;
  let tabs = null;

  // Bound handler references (for removal in unmount)
  let handleTypeSelectChange = null;
  let handleOptionsInput = null;

  // Dependencies (injected via init)
  let onApplyCellFormat = null;
  let onApplyDefaultFormat = null;
  let getSpreadsheetDefaults = null;
  let getSelection = null;
  let getCellFormatRules = null;

  // Dialog state
  let activeTab = 'cell'; // 'cell' or 'default'
  let formatType = 'NUMBER'; // 'NUMBER', 'DATE', 'DATETIME'
  let formatOptions = getNumberFormatDefaults('number'); // Current format options
  let currentCellSubCategory = null; // Track the subcategory of the currently selected cell (for NUMBER format)

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Get the format rules for a single selected cell, or null if multiple cells selected
   * @returns {Object|null} Format rules object or null
   */
  function getSingleCellFormat() {
    if (!getSelection || !getCellFormatRules) return null;

    const selection = getSelection();

    // Check if single cell is selected (start === end)
    if (selection.start !== selection.end) {
      return null; // Multiple cells selected
    }

    // Get format rules for the single cell
    return getCellFormatRules(selection.start);
  }

  /**
   * Get factory default format options for a given format type
   * @param {string} type - Format type ('NUMBER', 'DATE', 'DATETIME')
   * @returns {Object} Factory default format options
   */
  function getFactoryDefaults(type) {
    switch (type) {
      case 'NUMBER':
        return getNumberFormatDefaults('number');
      case 'DATE':
        return getDateFormatDefaults();
      case 'DATETIME':
        return getDateTimeFormatDefaults();
      default:
        console.warn(`[FormatDialog] Unknown format type: ${type}`);
        return getNumberFormatDefaults('number');
    }
  }

  /**
   * Load format options from spreadsheet defaults or factory defaults
   * @param {string} type - Format type ('NUMBER', 'DATE', 'DATETIME')
   * @param {boolean} trackSubCategory - Whether to update currentCellSubCategory
   */
  function loadDefaultFormatOptions(type, trackSubCategory = false) {
    const currentDefaults = getSpreadsheetDefaults();
    formatOptions = currentDefaults[type] || getFactoryDefaults(type);

    if (trackSubCategory) {
      currentCellSubCategory = type === 'NUMBER' ? (formatOptions.subCategory || null) : null;
    }
  }

  /**
   * Load format options from cell format or factory defaults
   * @param {string} type - Format type ('NUMBER', 'DATE', 'DATETIME')
   */
  function loadCellFormatOptions(type) {
    const cellFormat = getSingleCellFormat();

    if (cellFormat?.[type]) {
      // Load cell's format
      formatOptions = cellFormat[type];
      currentCellSubCategory = type === 'NUMBER' ? (cellFormat[type].subCategory || null) : null;
    } else {
      // No cell format: use factory defaults
      formatOptions = getFactoryDefaults(type);
      currentCellSubCategory = null;
    }
  }

  // ============================================================================
  // RENDER OPTIONS
  // ============================================================================

  /**
   * Render options using configuration system
   * Pure function: state → HTML (no side effects)
   */
  function renderOptions() {
    if (!optionsContainer) return;

    // Get field configs for current format type
    const configFn = FIELD_CONFIGS[formatType];
    if (!configFn) {
      console.warn(`[FormatDialog] No config for format type: ${formatType}`);
      optionsContainer.innerHTML = '';
      return;
    }

    // Generate fields from config (pass activeTab for conditional rendering)
    const fields = configFn(formatOptions, activeTab);
    const html = renderFields(fields);

    // Update DOM
    optionsContainer.innerHTML = html;
  }

  // ============================================================================
  // STATE UPDATERS
  // ============================================================================

  /**
   * Update number subcategory and re-render
   */
  function updateNumberSubcategoryState(newSubCategory) {
    // Check if we should load cell format or defaults
    if (activeTab === 'cell' && currentCellSubCategory === newSubCategory) {
      // Load the cell's current format for this subcategory
      const cellFormat = getSingleCellFormat();
      if (cellFormat?.NUMBER) {
        formatOptions = cellFormat.NUMBER;
        renderOptions();
        return;
      }
    }

    // Otherwise, load factory defaults for new subcategory
    formatOptions = getNumberFormatDefaults(newSubCategory);
    renderOptions();
  }

  /**
   * Update number format options (flat structure now)
   */
  function updateNumberFormatOptionState(key, value) {
    formatOptions = { ...formatOptions, [key]: value };
  }

  /**
   * Update date format options (generic for any DATE field)
   */
  function updateDateFormatOption(key, value) {
    formatOptions = { ...formatOptions, [key]: value };
  }

  /**
   * Update datetime display type and re-render
   */
  function updateDateTimeDisplayType(newType) {
    formatOptions = { ...formatOptions, displayType: newType };
    renderOptions();
  }

  /**
   * Update datetime display format
   */
  function updateDateTimeFormat(newFormat) {
    formatOptions = { ...formatOptions, displayFormat: newFormat };
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Delegated event handler for all form inputs
   * Attached once in mount(), handles all input/change events
   */
  function handleFormInput(event) {
    const { target } = event;

    // Handle checkbox-group specially (checkboxes don't have id, parent group does)
    if (target.type === 'checkbox' && target.name) {
      const groupId = target.name;
      const checkboxGroup = target.closest('.checkbox-group');
      if (checkboxGroup) {
        // Collect all checked values from this group
        const checkedBoxes = checkboxGroup.querySelectorAll('input[type="checkbox"]:checked');
        const selectedValues = Array.from(checkedBoxes).map(cb => cb.value);

        // Update state with array
        updateNumberFormatOptionState(groupId, selectedValues);
        return;
      }
    }

    // Handle single checkbox (has id, no name)
    if (target.type === 'checkbox' && target.id && !target.name) {
      const { id, checked } = target;

      // Check if it's a number format field
      const numberFieldDef = NUMBER_FORMAT_CONFIG.fields[id];
      if (numberFieldDef && numberFieldDef.type === 'checkbox') {
        const fieldsAffectingVisibility = getFieldsThatAffectVisibility(NUMBER_FORMAT_CONFIG.fields);
        const needsRerender = fieldsAffectingVisibility.has(id);

        updateNumberFormatOptionState(id, checked);

        if (needsRerender) {
          renderOptions();
        }
        return;
      }
    }

    const { id, value } = target;

    // Special case handlers (non-data fields)
    if (id === 'number-subcategory') {
      updateNumberSubcategoryState(value);
      return;
    }

    // DATETIME displayType triggers re-render (dynamic fields)
    if (id === 'displayType') {
      updateDateTimeDisplayType(value);
      return;
    }

    // Dynamic number format field handlers (loaded from config)
    const numberFieldDef = NUMBER_FORMAT_CONFIG.fields[id];
    if (numberFieldDef) {
      // Check if this field affects visibility (appears in any visibleWhen)
      const fieldsAffectingVisibility = getFieldsThatAffectVisibility(NUMBER_FORMAT_CONFIG.fields);
      const needsRerender = fieldsAffectingVisibility.has(id);

      // Handle based on field type from config
      let processedValue = value;
      if (numberFieldDef.type === 'number') {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
          processedValue = numValue;
        }
      } else if (numberFieldDef.type === 'select') {
        // Handle boolean values from select options
        if (value === 'true') processedValue = true;
        else if (value === 'false') processedValue = false;
      }

      // Update state
      updateNumberFormatOptionState(id, processedValue);

      // Re-render if this field affects visibility of other fields
      if (needsRerender) {
        renderOptions();
      }

      return;
    }

    // Dynamic date format field handlers (loaded from config)
    const dateFieldDef = DATE_FORMAT_CONFIG.fields[id];
    if (dateFieldDef) {
      updateDateFormatOption(id, value);
      return;
    }

    // Dynamic datetime format field handlers (loaded from config)
    const datetimeFieldDef = DATETIME_FORMAT_CONFIG.fields[id];
    if (datetimeFieldDef) {
      // displayType already handled above (triggers re-render)
      updateDateTimeFormat(value);
      return;
    }

    // Unknown field, ignore
    console.warn(`[FormatDialog] Unknown field ID: ${id}`);
  }

  function handleTabClick(tab) {
    activeTab = tab;

    // Update tab UI
    dialog.querySelectorAll('.format-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Update apply button text
    if (applyBtn) {
      applyBtn.textContent = activeTab === 'cell' ? 'Apply to Cell' : 'Set as Default';
    }

    // Load current spreadsheet defaults when switching to defaults tab
    if (tab === 'default' && getSpreadsheetDefaults) {
      // Load the default for the current format type
      // If no custom default exists, use factory defaults
      loadDefaultFormatOptions(formatType, false);

      // Re-render options to show current defaults
      renderOptions();
    }
  }

  function handleTabClickFromEvent(e) {
    handleTabClick(e.currentTarget.dataset.tab);
  }

  function handleFormatTypeChange(newType) {
    formatType = newType;

    // Load options based on current tab
    if (activeTab === 'default' && getSpreadsheetDefaults) {
      // On defaults tab: load current spreadsheet defaults (or factory defaults if not set)
      loadDefaultFormatOptions(formatType, true);
    } else {
      // On cell format tab: check if single cell has format for this type
      loadCellFormatOptions(formatType);
    }

    renderOptions();
  }

  function handleApply() {
    console.log('[FormatDialog] Apply clicked, tab:', activeTab, 'type:', formatType);

    // Build format object based on type
    let formatToApply = {};

    switch (formatType) {
      case 'NUMBER':
        formatToApply = { NUMBER: formatOptions };
        break;
      case 'DATE':
        formatToApply = { DATE: formatOptions };
        break;
      case 'DATETIME':
        formatToApply = { DATETIME: formatOptions };
        break;
    }

    if (activeTab === 'cell') {
      onApplyCellFormat(formatToApply);
    } else {
      onApplyDefaultFormat(formatToApply);
    }

    close();
  }

  function handleCancel() {
    console.log('[FormatDialog] Cancel clicked');
    close();
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  function open() {
    console.log('[FormatDialog] Opening...');

    if (!dialog) {
      console.error('[FormatDialog] Not mounted');
      return;
    }

    activeTab = 'cell';
    formatType = 'NUMBER';

    // Check if single cell is selected and has a NUMBER format
    const cellFormat = getSingleCellFormat();
    if (cellFormat?.NUMBER?.subCategory) {
      // Store the cell's current subcategory for NUMBER format
      currentCellSubCategory = cellFormat.NUMBER.subCategory;
      // Load the cell's current NUMBER format
      formatOptions = cellFormat.NUMBER;
    } else {
      // Multiple cells or no format: use factory defaults
      currentCellSubCategory = null;
      formatOptions = getNumberFormatDefaults('number');
    }

    // Native showModal() - handles backdrop, focus trap, ESC key
    dialog.showModal();

    // Update UI
    handleTabClick('cell');
    if (typeSelect) {
      typeSelect.value = 'NUMBER';
    }

    renderOptions();

    console.log('[FormatDialog] Opened');
  }

  function close() {
    console.log('[FormatDialog] Closing...');

    if (!dialog) return;

    // Native close
    dialog.close();

    console.log('[FormatDialog] Closed');
  }

  function mount() {
    console.log('[FormatDialog] Mounting...');

    dialog = mountDialog('format-dialog', 'format-dialog', `
        <div class="dialog-header">
          <div class="dialog-tabs">
            <button type="button" class="format-tab active" data-tab="cell">Cell Format</button>
            <button type="button" class="format-tab" data-tab="default">Default Format</button>
          </div>
          <button type="button" class="dialog-close-btn" aria-label="Close" title="Close">&times;</button>
        </div>

        <div class="dialog-body">
          <div class="format-section">
            <label for="format-type-select">Data Type</label>
            <select id="format-type-select" class="format-select format-type-select">
              <option value="NUMBER">Number</option>
              <option value="DATE">Date</option>
              <option value="DATETIME">DateTime</option>
            </select>
          </div>

          <div class="format-options-container"></div>
        </div>

        <div class="dialog-footer">
          <button type="button" class="btn-outlined">Cancel</button>
          <button type="button" class="dialog-btn-confirm">Apply</button>
        </div>
    `, close);

    // Find child elements within the dialog
    optionsContainer = dialog.querySelector('.format-options-container');
    typeSelect = dialog.querySelector('.format-type-select');
    applyBtn = dialog.querySelector('.dialog-btn-confirm');
    closeBtn = dialog.querySelector('.dialog-close-btn');
    cancelBtn = dialog.querySelector('.btn-outlined');

    // Create bound handlers for listeners that need wrapping
    handleTypeSelectChange = (e) => handleFormatTypeChange(e.target.value);
    handleOptionsInput = (e) => {
      if (e.target.tagName !== 'SELECT') handleFormInput(e);
    };

    // Attach tab click handlers
    tabs = dialog.querySelectorAll('.format-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', handleTabClickFromEvent);
    });

    // Format type selector
    if (typeSelect) {
      typeSelect.addEventListener('change', handleTypeSelectChange);
    }

    // Event delegation for dynamic format options
    if (optionsContainer) {
      // Use 'input' for text fields (fires on every keystroke), skip selects (handled by 'change')
      optionsContainer.addEventListener('input', handleOptionsInput);
      // Use 'change' for select dropdowns and number inputs (fires on blur/selection)
      optionsContainer.addEventListener('change', handleFormInput);
    }

    // Apply button
    if (applyBtn) {
      applyBtn.addEventListener('click', handleApply);
    }

    // Close button (×)
    if (closeBtn) {
      closeBtn.addEventListener('click', close);
    }

    // Cancel button
    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }

    console.log('[FormatDialog] Mounted');
  }

  function unmount() {
    // Remove all event listeners before clearing references
    if (tabs) {
      tabs.forEach(tab => {
        tab.removeEventListener('click', handleTabClickFromEvent);
      });
    }
    if (typeSelect) {
      typeSelect.removeEventListener('change', handleTypeSelectChange);
    }
    if (optionsContainer) {
      optionsContainer.removeEventListener('input', handleOptionsInput);
      optionsContainer.removeEventListener('change', handleFormInput);
    }
    if (applyBtn) {
      applyBtn.removeEventListener('click', handleApply);
    }
    if (closeBtn) {
      closeBtn.removeEventListener('click', close);
    }
    if (cancelBtn) {
      cancelBtn.removeEventListener('click', handleCancel);
    }

    // Clear references
    dialog = null;
    optionsContainer = null;
    typeSelect = null;
    applyBtn = null;
    closeBtn = null;
    cancelBtn = null;
    tabs = null;
    handleTypeSelectChange = null;
    handleOptionsInput = null;
    console.log('[FormatDialog] Unmounted');
  }

  return {
    init(deps) {
      ({
        onApplyCellFormat,
        onApplyDefaultFormat,
        getSpreadsheetDefaults,
        getSelection,
        getCellFormatRules
      } = deps);
      console.log('[FormatDialog] Initialized');
    },

    mount,
    unmount,
    open,
    close,
  };
}
