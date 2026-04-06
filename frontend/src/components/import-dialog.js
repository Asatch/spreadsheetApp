/**
 * @file Import Dialog Component
 * @description Modal dialog for importing zip packages with conflict resolution.
 */

import { escapeHtml } from '../utils/treeRenderer.js';
import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';

/**
 * Create an import dialog component.
 * @returns {Object} Import dialog interface
 */
export function createImportDialog() {
  let dialog = null;
  let bodyEl = null;
  let importBtn = null;
  let resolve = null;
  let currentImportData = null;
  let conflicts = null;
  let resolutions = new Map(); // id -> 'fork' | 'replace' | 'skip'
  let folderName = '';
  let dependencyWarnings = [];
  let importing = false;

  // Dependencies (injected)
  let storageEngine = null;
  let getOpfsService = null;
  let parseImportZip = null;
  let detectConflicts = null;
  let checkMissingDependencies = null;
  let executeImport = null;
  let generateImportFolderName = null;
  let functionCompiler = null;
  let publishImportedSheets = null;

  function init(deps) {
    storageEngine = deps.storageEngine;
    getOpfsService = deps.getOpfsService;
    parseImportZip = deps.parseImportZip;
    detectConflicts = deps.detectConflicts;
    checkMissingDependencies = deps.checkMissingDependencies;
    executeImport = deps.executeImport;
    generateImportFolderName = deps.generateImportFolderName;
    functionCompiler = deps.functionCompiler;
    publishImportedSheets = deps.publishImportedSheets;
  }

  function mount() {
    dialog = mountDialog('import-dialog', 'import-dialog', `
      ${dialogHeaderHTML('Import Package')}

      <div class="dialog-body"></div>

      <div class="dialog-footer">
        <button type="button" class="btn-outlined import-dialog-cancel-btn">Cancel</button>
        <button type="button" class="dialog-btn-confirm">Import</button>
      </div>
    `, close);

    bodyEl = dialog.querySelector('.dialog-body');
    importBtn = dialog.querySelector('.dialog-btn-confirm');

    // Static event listeners (dialog shell doesn't change)
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => close());
    dialog.querySelector('.import-dialog-cancel-btn').addEventListener('click', () => close());
    importBtn.addEventListener('click', () => handleImport());
    dialog.addEventListener('cancel', (e) => {
      if (importing) e.preventDefault();
    });
  }

  function unmount() {
    dialog = null;
    bodyEl = null;
    importBtn = null;
  }

  /**
   * Show the import dialog with already-parsed import data.
   * Handles conflict detection, rendering, and the Promise.
   * @param {Object} importData - Parsed import data
   * @param {string} sourceName - Display name for the source (e.g., filename or folder name)
   * @returns {Promise<Object>} Result of import or null if cancelled
   */
  async function showWithImportData(importData, sourceName) {
    if (!dialog) return null;

    // Reset state
    resolutions.clear();
    dependencyWarnings = [];

    currentImportData = importData;
    folderName = generateImportFolderName(sourceName);

    // Detect conflicts
    conflicts = await detectConflicts(currentImportData, storageEngine);

    // Check for missing dependencies
    dependencyWarnings = await checkMissingDependencies(currentImportData, storageEngine);

    // Set default resolutions to 'fork' for all conflicts
    for (const conflict of conflicts.sheets) {
      resolutions.set(conflict.id, 'fork');
    }

    render();
    dialog.showModal();

    return new Promise((res) => {
      resolve = res;
    });
  }

  /**
   * Open the import dialog with a file.
   * @param {File} file - The zip file to import
   * @returns {Promise<Object>} Result of import or null if cancelled
   */
  async function open(file) {
    try {
      const importData = await parseImportZip(file);
      return await showWithImportData(importData, file.name);
    } catch (err) {
      console.error('[ImportDialog] Failed to parse import file:', err);
      alert(`Failed to parse import file: ${err.message}`);
      return null;
    }
  }

  /**
   * Open the import dialog with pre-parsed import data.
   * Used for folder imports where parsing happens outside the dialog.
   * @param {Object} importData - Parsed import data
   * @param {string} sourceName - Display name for the source
   * @returns {Promise<Object>} Result of import or null if cancelled
   */
  async function openWithData(importData, sourceName) {
    return await showWithImportData(importData, sourceName);
  }

  function close(result = null) {
    if (importing) return;
    if (dialog) {
      dialog.close();
    }
    currentImportData = null;
    conflicts = null;
    if (resolve) {
      resolve(result);
      resolve = null;
    }
  }

  async function handleImport() {
    if (!currentImportData) return;

    // Lock the dialog — prevent close/cancel/backdrop/ESC during import
    importing = true;
    importBtn.disabled = true;
    const cancelBtn = dialog.querySelector('.import-dialog-cancel-btn');
    const closeBtn = dialog.querySelector('.dialog-close-btn');
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    const originalText = importBtn.textContent;
    importBtn.textContent = 'Importing…';

    try {
      const opfsService = getOpfsService();
      const result = await executeImport({
        importData: currentImportData,
        resolutions,
        folderName,
        storageEngine,
        opfsService,
      });

      // Batch publish sheets that need transpilation
      let publishResult = null;
      if (publishImportedSheets && functionCompiler) {
        try {
          publishResult = await publishImportedSheets({
            importData: currentImportData,
            importResult: result,
            storageEngine,
            opfsService,
            functionCompiler,
          });
        } catch (err) {
          console.warn('[ImportDialog] Batch publish failed:', err);
          // Non-fatal — import still succeeded
        }
      }

      console.log('[ImportDialog] Import complete:', result);
      importing = false;
      close({ ...result, publishResult });

    } catch (err) {
      console.error('[ImportDialog] Import failed:', err);
      importing = false;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      importBtn.disabled = false;
      importBtn.textContent = originalText;
      alert(`Import failed: ${err.message}`);
    }
  }

  function setResolution(id, resolution) {
    resolutions.set(id, resolution);
    render();
  }

  function applyToAll(resolution) {
    for (const conflict of conflicts.sheets) {
      resolutions.set(conflict.id, resolution);
    }
    render();
  }

  function render() {
    if (!bodyEl || !currentImportData) return;

    const { manifest, sheets } = currentImportData;
    const sheetCount = Object.keys(sheets).length;
    const folderCount = Object.keys(manifest.folders || {}).length;

    bodyEl.innerHTML = `
      ${currentImportData.recoveryMode ? `
        <div class="import-recovery-notice">
          Manifest was missing or unreadable. Package structure was reconstructed from XML files.
        </div>
      ` : ''}

      <!-- Summary -->
      <div class="import-summary">
        <p>This package contains:</p>
        <ul>
          ${sheetCount > 0 ? `<li>${sheetCount} sheet${sheetCount !== 1 ? 's' : ''}</li>` : ''}
          ${folderCount > 0 ? `<li>${folderCount} folder${folderCount !== 1 ? 's' : ''}</li>` : ''}
        </ul>
      </div>

      <!-- Folder Name -->
      <div class="import-folder-name">
        <label for="import-folder-input">Import into folder:</label>
        <input
          type="text"
          id="import-folder-input"
          class="import-folder-input"
          value="${escapeHtml(folderName)}"
        />
      </div>

      <!-- Conflicts Section -->
      ${conflicts.total > 0 ? renderConflicts() : ''}

      <!-- Dependency Warnings -->
      ${dependencyWarnings.length > 0 ? renderWarnings() : ''}
    `;

    // Update import button text
    const itemCount = sheetCount;
    importBtn.textContent = `Import ${itemCount} item${itemCount !== 1 ? 's' : ''}`;

    // Bind dynamic events
    const folderInput = bodyEl.querySelector('.import-folder-input');
    folderInput.oninput = (e) => {
      folderName = e.target.value;
    };

    // Conflict resolution buttons
    bodyEl.querySelectorAll('.conflict-resolution-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const resolution = btn.dataset.resolution;
        setResolution(id, resolution);
      };
    });

    // Apply to all
    const applyAllSelect = bodyEl.querySelector('.import-apply-all-select');
    if (applyAllSelect) {
      applyAllSelect.onchange = (e) => {
        if (e.target.value) {
          applyToAll(e.target.value);
        }
      };
    }
  }

  function renderConflicts() {
    return `
      <div class="import-conflicts">
        <div class="import-conflicts-header">
          <h3>${conflicts.total} item${conflicts.total !== 1 ? 's' : ''} already exist${conflicts.total === 1 ? 's' : ''} locally</h3>
          <div class="import-apply-all">
            <label for="apply-all-select">Apply to all:</label>
            <select id="apply-all-select" class="import-apply-all-select">
              <option value="">--</option>
              <option value="fork">Fork (create copy)</option>
              <option value="replace">Replace</option>
              <option value="skip">Skip</option>
            </select>
          </div>
        </div>

        <div class="import-conflicts-list">
          ${conflicts.sheets.map(c => renderConflictItem(c)).join('')}
        </div>
      </div>
    `;
  }

  function renderConflictItem(conflict) {
    const currentResolution = resolutions.get(conflict.id) || 'fork';
    const typeLabel = 'Sheet';
    const typeIcon = 'sheet';
    const details = `Local: "${conflict.existingName}" | Import: "${conflict.importName}"`;

    return `
      <div class="import-conflict-item">
        <div class="import-conflict-info">
          <span class="import-conflict-icon import-conflict-icon-${typeIcon}"></span>
          <div class="import-conflict-details">
            <div class="import-conflict-name">${escapeHtml(conflict.importName)}</div>
            <div class="import-conflict-meta">${typeLabel} - ${details}</div>
          </div>
        </div>
        <div class="import-conflict-actions">
          <button
            class="conflict-resolution-btn ${currentResolution === 'fork' ? 'active' : ''}"
            data-id="${conflict.id}"
            data-resolution="fork"
          >Fork</button>
          <button
            class="conflict-resolution-btn ${currentResolution === 'replace' ? 'active' : ''}"
            data-id="${conflict.id}"
            data-resolution="replace"
          >Replace</button>
          <button
            class="conflict-resolution-btn ${currentResolution === 'skip' ? 'active' : ''}"
            data-id="${conflict.id}"
            data-resolution="skip"
          >Skip</button>
        </div>
      </div>
    `;
  }

  function renderWarnings() {
    return `
      <div class="import-warnings">
        <h3>Missing Dependencies</h3>
        <p>The following sheets reference functions that are not available locally or in this package:</p>
        <ul>
          ${dependencyWarnings.map(w => `
            <li>
              <strong>${escapeHtml(w.sheetName)}</strong>:
              ${w.missingFunctions.map(f => escapeHtml(f)).join(', ')}
            </li>
          `).join('')}
        </ul>
        <p class="import-warning-note">These sheets may not work correctly until the missing functions are imported.</p>
      </div>
    `;
  }

  return {
    init,
    mount,
    unmount,
    open,
    openWithData
  };
}
