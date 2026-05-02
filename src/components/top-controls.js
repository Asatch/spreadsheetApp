/*
 * TOP CONTROLS
 * ============
 *
 * Header and Toolbar components - both horizontal control bars at top.
 * Attaches to existing DOM structure defined in index.html.
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';
import { isViewerMode } from '../utils/appMode.js';
import { createPopover } from '../utils/popover.js';
import { createPersistenceDialog } from './persistence-dialog.js';
import { INDICATOR_KEYS, isIndicatorEnabled, setIndicatorEnabled } from './indicator-keys.js';

/**
 * Header - Application branding and file operations
 */
export function createHeader() {
  // Dependencies (injected via init)
  let onOpen = null;       // Opens file browser modal
  let onPublish = null;    // Publishes spreadsheet as a function
  let onTitleChange = null;
  let onPreviewMerge = null;    // Merge preview changes to source ("Overwrite Draft")
  let onPreviewDiscard = null;  // Reload preview at published baseline ("Revert to Published")
  let onPreviewSwitchToDraft = null; // Navigate to source sheet, abandoning preview edits
  let onPreviewSaveAsNew = null;     // Fork preview into a brand new sheet
  let onPreviewFork = null;     // Called when renaming in preview mode (implicit fork)
  let onViewBuiltVersion = null;      // View the built/published function
  let onDiscardToLastPublished = null; // Revert to last published version
  let onClearAllData = null;           // Clear all OPFS data
  let onCopy = null;                   // Copy current sheet
  let onExportCurrent = null;          // Export current sheet as .zip
  let onExportHtml = null;             // Export current sheet as portable HTML
  let onExportCode = null;             // Export code in various languages
  let onDeleteCurrent = null;          // Delete current sheet
  let onScenarioAnalysis = null;       // Open scenario analysis for current function
  let onManageLanguagePacks = null;    // Open language pack management
  let onIndicatorPrefsChanged = null;  // Re-render reference indicators after a settings toggle

  // DOM references
  let container = null;
  let openBtn = null;
  let settingsBtn = null;
  let themeToggleBtn = null;
  let settingsDialog = null;
  let publishBtn = null;
  let saveStatusEl = null;
  let dirtyIndicatorEl = null;
  let titleEl = null;
  let titleInput = null;
  let previewControlsEl = null;  // Container for preview mode controls
  let unpublishedBannerEl = null; // Container for unpublished changes banner
  let fileMenuBtn = null;
  let fileMenuPopover = null;
  let fileMenuController = null;

  // State
  let currentTitle = 'Untitled';
  let isEditable = true;
  let isEditing = false;
  let saveStatusTimeout = null;
  let isDirtyState = false;

  // Preview mode state
  let isPreviewMode = false;
  let previewInfo = null;  // { functionId, versionId, functionName, versionString, basedOnSpreadsheetId }

  // Unpublished changes state
  let unpublishedInfo = null;  // { hasChanges, versionString, functionId }

  function handleThemeToggle() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    if (currentTheme === 'dark') {
      html.removeAttribute('data-theme');
      localStorage.removeItem('sc-theme');
    } else {
      html.setAttribute('data-theme', 'dark');
      localStorage.setItem('sc-theme', 'dark');
    }
  }

  function handleSettingsClose() {
    if (settingsDialog) settingsDialog.close();
  }

  async function handleClearAllData() {
    if (!confirm('This will delete all locally stored spreadsheets, functions, and manifests. This cannot be undone.\n\nContinue?')) {
      return;
    }
    try {
      await onClearAllData();
      settingsDialog.close();
      window.location.href = window.location.origin + window.location.pathname;
    } catch (error) {
      console.error('[Header] Failed to clear data:', error);
      alert('Failed to clear data: ' + error.message);
    }
  }

  function handleTitleClick() {
    if (!isEditable || isEditing) return;
    startEditing();
  }

  function startEditing() {
    isEditing = true;
    titleEl.hidden = true;
    titleInput.value = currentTitle;
    titleInput.hidden = false;
    titleInput.focus();
    titleInput.select();
  }

  function finishEditing() {
    if (!isEditing) return;
    isEditing = false;

    const newTitle = titleInput.value.trim() || 'Untitled';
    titleInput.hidden = true;
    titleEl.hidden = false;

    if (newTitle !== currentTitle) {
      // In preview mode, renaming triggers implicit fork
      if (isPreviewMode) {
        onPreviewFork?.(newTitle);
        exitPreviewMode();
      }

      currentTitle = newTitle;
      titleEl.textContent = currentTitle;
      if (onTitleChange) {
        onTitleChange(currentTitle);
      }
    }
  }

  function handleTitleInputKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Cancel editing - restore original
      isEditing = false;
      titleInput.hidden = true;
      titleEl.hidden = false;
    }
  }

  function handleTitleInputBlur() {
    finishEditing();
  }

  function updateFileMenuItemVisibility() {
    if (!fileMenuPopover) return;

    const discardItem = fileMenuPopover.querySelector('[data-action="discard-to-published"]');
    const overwriteItem = fileMenuPopover.querySelector('[data-action="overwrite-draft"]');
    const switchToDraftItem = fileMenuPopover.querySelector('[data-action="switch-to-draft"]');
    const saveAsNewItem = fileMenuPopover.querySelector('[data-action="save-as-new"]');
    const revertItem = fileMenuPopover.querySelector('[data-action="revert-to-published"]');
    const scenarioItem = fileMenuPopover.querySelector('[data-action="scenario-analysis"]');

    // In preview mode, drilldown inputs are pre-filled during setLoading(true), so
    // isDirtyState only flips on post-load user edits — exactly what we want to gate on.
    const showDiscard = unpublishedInfo?.hasChanges;
    const showOverwrite = isPreviewMode && isDirtyState;
    const showRevert = isPreviewMode && isDirtyState;
    const anyConditionalVisible = showDiscard || isPreviewMode;

    if (discardItem) discardItem.hidden = !showDiscard;
    if (overwriteItem) overwriteItem.hidden = !showOverwrite;
    if (switchToDraftItem) switchToDraftItem.hidden = !isPreviewMode;
    if (saveAsNewItem) saveAsNewItem.hidden = !isPreviewMode;
    if (revertItem) revertItem.hidden = !showRevert;
    if (scenarioItem) scenarioItem.disabled = !unpublishedInfo?.functionId;

    // Hide the divider before conditional items if none are visible
    const dividers = fileMenuPopover.querySelectorAll('.file-menu-divider');
    if (dividers.length >= 1) {
      dividers[0].hidden = !anyConditionalVisible;
    }
  }

  function handleFileMenuAction(e) {
    const btn = e.target.closest('.file-menu-item');
    if (!btn) return;

    const action = btn.dataset.action;
    fileMenuController?.close();

    switch (action) {
      case 'rename':
        startEditing();
        break;
      case 'copy':
        onCopy?.();
        break;
      case 'export':
        onExportCurrent?.();
        break;
      case 'export-html':
        onExportHtml?.();
        break;
      case 'export-code':
        onExportCode?.();
        break;
      case 'discard-to-published':
        onDiscardToLastPublished?.();
        break;
      case 'overwrite-draft':
        onPreviewMerge?.();
        break;
      case 'switch-to-draft':
        onPreviewSwitchToDraft?.();
        break;
      case 'save-as-new':
        onPreviewSaveAsNew?.();
        break;
      case 'revert-to-published':
        onPreviewDiscard?.();
        break;
      case 'scenario-analysis':
        onScenarioAnalysis?.();
        break;
      case 'delete':
        onDeleteCurrent?.();
        break;
    }
  }

  function mount(headerElement) {
    container = headerElement;

    // Find child elements
    openBtn = container.querySelector('.btn-open');
    publishBtn = container.querySelector('.btn-publish');
    settingsBtn = container.querySelector('.btn-settings');
    themeToggleBtn = container.querySelector('.btn-theme-toggle');

    // Mount settings dialog
    settingsDialog = mountDialog('settings-dialog', 'settings-dialog', `
      ${dialogHeaderHTML('Settings')}
      <div class="settings-dialog-body">
        <div class="settings-section">
          <h4 class="settings-section-title">Drilldown</h4>
          <label class="settings-toggle-label">
            <input type="checkbox" class="settings-breadcrumb-toggle" ${localStorage.getItem('sc-breadcrumb-drilldown') === 'true' ? 'checked' : ''}>
            <span>Breadcrumb drilldown</span>
          </label>
          <p class="settings-section-desc">Ctrl+D loads drilled-down functions in the current tab with a breadcrumb trail, instead of opening a new tab.</p>
        </div>
        <div class="settings-section">
          <h4 class="settings-section-title">Reference Indicators</h4>
          ${INDICATOR_KEYS.map(({ key, label }) => `
          <label class="settings-toggle-label">
            <input type="checkbox" class="settings-indicator-toggle" data-indicator-key="${key}" ${isIndicatorEnabled(key) ? 'checked' : ''}>
            <span>${label}</span>
          </label>`).join('')}
          <p class="settings-section-desc">Show the colored boxes and edge-of-viewport arrows that trace the active cell's references and the cells that reference it.</p>
        </div>
        <div class="settings-section">
          <h4 class="settings-section-title">Language Packs</h4>
          <p class="settings-section-desc">Manage language packs for exporting spreadsheet code.</p>
          <button type="button" class="btn-action settings-manage-packs">Manage Packs...</button>
        </div>
        <div class="settings-section">
          <h4 class="settings-section-title">Saving</h4>
          <p class="settings-section-desc">Choose where this app saves your data — hosted browser storage or local self-hosted options.</p>
          <button type="button" class="btn-action settings-deployment">Save to...</button>
        </div>
        <div class="settings-section">
          <h4 class="settings-section-title">Local Storage</h4>
          <p class="settings-section-desc">Clear all locally stored spreadsheets, functions, and manifests.</p>
          <button type="button" class="btn-action settings-clear-data">Clear All Local Data</button>
        </div>
      </div>`, handleSettingsClose);

    const persistenceDialog = createPersistenceDialog();

    settingsDialog.querySelector('.dialog-close-btn')?.addEventListener('click', handleSettingsClose);
    settingsDialog.querySelector('.settings-clear-data')?.addEventListener('click', handleClearAllData);
    settingsDialog.querySelector('.settings-manage-packs')?.addEventListener('click', () => {
      settingsDialog.close();
      onManageLanguagePacks?.();
    });
    settingsDialog.querySelector('.settings-deployment')?.addEventListener('click', () => {
      settingsDialog.close();
      persistenceDialog.open();
    });
    settingsDialog.querySelector('.settings-breadcrumb-toggle')?.addEventListener('change', (e) => {
      localStorage.setItem('sc-breadcrumb-drilldown', e.target.checked ? 'true' : 'false');
    });
    settingsDialog.querySelectorAll('.settings-indicator-toggle').forEach((toggle) => {
      toggle.addEventListener('change', (e) => {
        const key = e.target.dataset.indicatorKey;
        if (!key) return;
        setIndicatorEnabled(key, e.target.checked);
        onIndicatorPrefsChanged?.();
      });
    });

    saveStatusEl = container.querySelector('.save-status');
    dirtyIndicatorEl = container.querySelector('.dirty-indicator');
    titleEl = container.querySelector('.app-title');

    // Create hidden input for editing
    titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'app-title-input';
    titleInput.hidden = true;
    titleEl.parentNode.insertBefore(titleInput, titleEl.nextSibling);

    // Create preview controls container (inserted after title)
    previewControlsEl = document.createElement('div');
    previewControlsEl.className = 'preview-controls';
    previewControlsEl.hidden = true;
    titleEl.parentNode.insertBefore(previewControlsEl, titleInput.nextSibling);

    // Create unpublished changes banner (inserted after preview controls)
    unpublishedBannerEl = document.createElement('div');
    unpublishedBannerEl.className = 'unpublished-banner';
    unpublishedBannerEl.hidden = true;
    titleEl.parentNode.insertBefore(unpublishedBannerEl, previewControlsEl.nextSibling);

    // File menu
    fileMenuBtn = container.querySelector('.btn-file-menu');
    fileMenuPopover = container.querySelector('.file-menu-popover');

    // Attach event listeners
    openBtn?.addEventListener('click', () => onOpen());
    publishBtn?.addEventListener('click', () => onPublish());
    settingsBtn?.addEventListener('click', () => { if (settingsDialog) settingsDialog.showModal(); });
    themeToggleBtn?.addEventListener('click', handleThemeToggle);
    titleEl?.addEventListener('click', handleTitleClick);
    titleInput.addEventListener('keydown', handleTitleInputKeydown);
    titleInput.addEventListener('blur', handleTitleInputBlur);
    if (fileMenuBtn && fileMenuPopover) {
      fileMenuController = createPopover({
        trigger: fileMenuBtn,
        popover: fileMenuPopover,
        onOpen: updateFileMenuItemVisibility,
      });
    }
    fileMenuPopover?.addEventListener('click', handleFileMenuAction);

    // Single-bundle builds (viewer + disk-persistence) have no sibling export
    // artifact to fetch — hide the HTML export entry point.
    if (import.meta.env.SC_SINGLE_BUNDLE) {
      const item = fileMenuPopover?.querySelector('[data-action="export-html"]');
      if (item) item.hidden = true;
    }

    // In viewer mode, hide elements that require OPFS or the server
    if (isViewerMode()) {
      if (publishBtn) publishBtn.hidden = true;
      if (saveStatusEl) saveStatusEl.hidden = true;
      if (dirtyIndicatorEl) dirtyIndicatorEl.hidden = true;

      // Hide file menu items that would break in viewer mode
      const hideActions = ['rename', 'delete', 'copy', 'export-html', 'scenario-analysis', 'discard-to-published', 'overwrite-draft', 'switch-to-draft', 'save-as-new'];
      for (const action of hideActions) {
        const item = fileMenuPopover?.querySelector(`[data-action="${action}"]`);
        if (item) item.hidden = true;
      }

      // Hide breadcrumb toggle in settings (forced on in viewer mode)
      const breadcrumbToggle = settingsDialog?.querySelector('.settings-breadcrumb-toggle');
      if (breadcrumbToggle) {
        const label = breadcrumbToggle.closest('.settings-toggle-label');
        if (label) label.hidden = true;
      }

      // Hide "Clear All Local Data" in settings (no persistent storage in viewer mode)
      const clearDataBtn = settingsDialog?.querySelector('.settings-clear-data');
      if (clearDataBtn) {
        const section = clearDataBtn.closest('.settings-section');
        if (section) section.hidden = true;
      }
    }
  }

  function updatePreviewUI() {
    if (!previewControlsEl) return;

    // Update publish button label and tooltip
    if (publishBtn) {
      publishBtn.textContent = isPreviewMode ? 'Publish Copy' : 'Publish';
      publishBtn.title = isPreviewMode
        ? 'Save as new spreadsheet or apply to existing to publish'
        : 'Publish as reusable function';
    }

    // Show/hide preview controls
    previewControlsEl.hidden = !isPreviewMode;

    // Hide unpublished banner in preview mode
    if (isPreviewMode && unpublishedBannerEl) {
      unpublishedBannerEl.hidden = true;
    }

    if (isPreviewMode && previewInfo) {
      previewControlsEl.innerHTML = `
        <span class="preview-badge">PREVIEW</span>
        <span class="preview-info">${previewInfo.functionName || ''} ${previewInfo.versionString ? 'v' + previewInfo.versionString : ''}</span>
      `;
    }
  }

  function exitPreviewMode() {
    isPreviewMode = false;
    previewInfo = null;
    updatePreviewUI();
  }

  // Unpublished banner UI handlers
  function handleViewBuiltVersion() {
    onViewBuiltVersion?.();
  }

  function updateUnpublishedBannerUI() {
    if (!unpublishedBannerEl) return;

    // Don't show in preview mode
    if (isPreviewMode) {
      unpublishedBannerEl.hidden = true;
      return;
    }

    const shouldShow = unpublishedInfo?.hasChanges;
    unpublishedBannerEl.hidden = !shouldShow;

    if (shouldShow) {
      const versionText = unpublishedInfo.versionString
        ? `Unpublished changes since v${unpublishedInfo.versionString}`
        : 'Unpublished changes';

      unpublishedBannerEl.innerHTML = `
        <span class="unpublished-icon">!</span>
        <span class="unpublished-text">${versionText}</span>
        <button class="header-btn unpublished-btn" data-action="view-built">View Built Version</button>
      `;

      // Wire up banner button handler
      unpublishedBannerEl.querySelector('[data-action="view-built"]')?.addEventListener('click', handleViewBuiltVersion);
    }
  }

  return {
    /**
     * Initialize with injected dependencies
     */
    init(deps) {
      ({
        onOpen,
        onPublish,
        onTitleChange,
        onPreviewMerge,
        onPreviewDiscard,
        onPreviewSwitchToDraft,
        onPreviewSaveAsNew,
        onPreviewFork,
        onViewBuiltVersion,
        onDiscardToLastPublished,
        onClearAllData,
        onCopy,
        onExportCurrent,
        onExportHtml,
        onExportCode,
        onDeleteCurrent,
        onScenarioAnalysis,
        onManageLanguagePacks,
        onIndicatorPrefsChanged,
      } = deps);
    },

    mount,

    /**
     * Clear stale visual state between orchestrator swaps.
     * Called when the orchestrator is destroyed but the header stays mounted.
     */
    reset() {
      this.setTitle('Untitled', true);
      this.setDirty(false);
      this.hideSaveStatus();
      exitPreviewMode();
      unpublishedInfo = null;
      if (unpublishedBannerEl) unpublishedBannerEl.hidden = true;
    },

    /**
     * Set the displayed title.
     * @param {string} title - The title to display
     * @param {boolean} editable - Whether the title can be edited (false for drill-down mode)
     */
    setTitle(title, editable = true) {
      currentTitle = title || 'Untitled';
      isEditable = editable;
      if (titleEl) {
        titleEl.textContent = currentTitle;
        titleEl.style.cursor = editable ? 'pointer' : 'default';
        titleEl.title = editable ? 'Click to rename' : '';
      }
    },

    /**
     * Get the current title.
     * @returns {string}
     */
    getTitle() {
      return currentTitle;
    },

    /**
     * Show save status indicator briefly.
     * @param {string} status - Status text to display (e.g., "Saved", "Saving...")
     * @param {number} duration - How long to show in ms (0 = persistent until next call)
     */
    showSaveStatus(status, duration = 2000) {
      if (saveStatusEl) {
        clearTimeout(saveStatusTimeout);
        saveStatusEl.textContent = status;
        saveStatusEl.hidden = false;

        if (duration > 0) {
          saveStatusTimeout = setTimeout(() => {
            saveStatusEl.hidden = true;
          }, duration);
        }
      }
    },

    /**
     * Hide the save status indicator.
     */
    hideSaveStatus() {
      if (saveStatusEl) {
        clearTimeout(saveStatusTimeout);
        saveStatusEl.hidden = true;
      }
    },

    /**
     * Set the dirty (unsaved changes) indicator visibility.
     * @param {boolean} isDirty - Whether there are unsaved changes
     */
    setDirty(isDirty) {
      isDirtyState = isDirty;
      if (dirtyIndicatorEl) {
        dirtyIndicatorEl.hidden = !isDirty;
      }
    },

    /**
     * Check if there are unsaved changes.
     * @returns {boolean}
     */
    isDirty() {
      return isDirtyState;
    },

    /**
     * Enable preview mode with info about the function being previewed.
     * @param {Object} info - Preview info
     * @param {string} info.functionName - Function name being previewed
     * @param {string} info.versionString - Human-readable version string
     * @param {string} info.basedOnSpreadsheetId - Source sheet ID for navigation/merge
     */
    setPreviewMode(info) {
      isPreviewMode = true;
      previewInfo = info;
      updatePreviewUI();
    },

    /**
     * Exit preview mode.
     */
    exitPreviewMode() {
      exitPreviewMode();
    },

    /**
     * Check if currently in preview mode.
     * @returns {boolean}
     */
    isInPreviewMode() {
      return isPreviewMode;
    },

    /**
     * Get current preview info.
     * @returns {Object|null}
     */
    getPreviewInfo() {
      return previewInfo;
    },

    /**
     * Set unpublished changes info to show/hide the banner.
     * @param {Object} info - Unpublished info
     * @param {boolean} info.hasChanges - Whether there are unpublished changes
     * @param {string} [info.versionString] - Last published version string
     * @param {string} [info.functionId] - Function ID this publishes to
     */
    setUnpublishedInfo(info) {
      unpublishedInfo = info;
      updateUnpublishedBannerUI();
    },
  };
}

/**
 * Toolbar - Icon buttons for formatting, editing, and operations
 */
export function createToolbar() {
  // Dependencies (injected via init)
  let onBold = null;
  let onItalic = null;
  let onFontSizeIncrease = null;
  let onFontSizeDecrease = null;
  let onAlignLeft = null;
  let onAlignCenter = null;
  let onAlignRight = null;
  let onCopyOrCut = null;
  let onPaste = null;
  let onPasteValues = null;
  let onCancelCut = null;
  let onUndo = null;
  let onRedo = null;
  let onFormat = null;
  let onClearFormatting = null;
  let onCustomFunctions = null;
  let onTogglePanels = null;
  let onNamedRanges = null;
  let onHighlight = null;
  let onFind = null;

  // DOM references
  let container = null;
  let cancelCutButton = null;
  let toggleButton = null;
  let undoButton = null;
  let redoButton = null;

  let pastePopoverController = null;

  // Highlight UI references (swatch/options used by public API + handleHighlightOptionClick)
  let highlightSwatch = null;
  let highlightOptions = [];
  let currentHighlightColor = 'yellow';
  let highlightPopoverController = null;


  function handleHighlightOptionClick(e) {
    const btn = e.currentTarget;
    const color = btn.dataset.highlight;
    if (color) {
      currentHighlightColor = color;
      // Update the swatch on the main button
      if (highlightSwatch) {
        highlightSwatch.style.background = `var(--highlight-${color})`;
      }
    }
    if (onHighlight) onHighlight(color);
    highlightPopoverController?.close();
  }

  function mount(toolbarElement) {
    container = toolbarElement;

    // Wire toolbar buttons
    container.querySelector('.btn-copy')?.addEventListener('click', () => onCopyOrCut(false));
    container.querySelector('.btn-cut')?.addEventListener('click', () => onCopyOrCut(true));
    container.querySelector('.btn-paste')?.addEventListener('click', () => onPaste());
    container.querySelector('.btn-align-left')?.addEventListener('click', () => onAlignLeft());
    container.querySelector('.btn-align-center')?.addEventListener('click', () => onAlignCenter());
    container.querySelector('.btn-align-right')?.addEventListener('click', () => onAlignRight());
    container.querySelector('.btn-font-increase')?.addEventListener('click', () => onFontSizeIncrease());
    container.querySelector('.btn-font-decrease')?.addEventListener('click', () => onFontSizeDecrease());
    container.querySelector('.btn-bold')?.addEventListener('click', () => onBold());
    container.querySelector('.btn-italic')?.addEventListener('click', () => onItalic());
    container.querySelector('.btn-format')?.addEventListener('click', () => onFormat());
    container.querySelector('.btn-clear-format')?.addEventListener('click', () => onClearFormatting());
    container.querySelector('.btn-custom-functions')?.addEventListener('click', () => onCustomFunctions());
    container.querySelector('.btn-named-ranges')?.addEventListener('click', () => onNamedRanges());
    container.querySelector('.btn-find')?.addEventListener('click', () => onFind?.());

    // Buttons referenced by public API for state updates
    undoButton = container.querySelector('.btn-undo');
    redoButton = container.querySelector('.btn-redo');
    cancelCutButton = container.querySelector('.btn-cancel-cut');
    toggleButton = container.querySelector('.btn-toggle-panels');

    undoButton?.addEventListener('click', () => onUndo());
    redoButton?.addEventListener('click', () => onRedo());
    cancelCutButton?.addEventListener('click', () => onCancelCut());
    toggleButton?.addEventListener('click', () => onTogglePanels());

    // Paste split button
    const pasteDropdownBtn = container.querySelector('.btn-paste-dropdown');
    const pastePopover = container.querySelector('.paste-popover');

    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const shortcutEl = pastePopover?.querySelector('.paste-option-shortcut');
    if (shortcutEl) shortcutEl.textContent = isMac ? '\u2318+Shift+V' : 'Ctrl+Shift+V';

    if (pasteDropdownBtn && pastePopover) {
      pastePopoverController = createPopover({ trigger: pasteDropdownBtn, popover: pastePopover });
    }
    container.querySelector('.btn-paste-values')?.addEventListener('click', () => {
      onPasteValues?.();
      pastePopoverController?.close();
    });

    // Highlight split button
    const highlightDropdownBtn = container.querySelector('.btn-highlight-dropdown');
    const highlightPopoverEl = container.querySelector('.highlight-popover');
    highlightSwatch = container.querySelector('.highlight-swatch');
    highlightOptions = Array.from(container.querySelectorAll('.highlight-option'));

    container.querySelector('.btn-highlight-apply')?.addEventListener('click', () => onHighlight?.(currentHighlightColor));
    if (highlightDropdownBtn && highlightPopoverEl) {
      highlightPopoverController = createPopover({ trigger: highlightDropdownBtn, popover: highlightPopoverEl });
    }
    highlightOptions.forEach(opt => opt.addEventListener('click', handleHighlightOptionClick));
  }

  return {
    /**
     * Initialize with injected dependencies
     */
    init(deps) {
      ({
        onBold,
        onItalic,
        onFontSizeIncrease,
        onFontSizeDecrease,
        onAlignLeft,
        onAlignCenter,
        onAlignRight,
        onCopyOrCut,
        onPaste,
        onPasteValues,
        onCancelCut,
        onUndo,
        onRedo,
        onFormat,
        onClearFormatting,
        onCustomFunctions,
        onTogglePanels,
        onNamedRanges,
        onHighlight,
        onFind,
      } = deps);
    },

    mount,

    /**
     * Update panel toggle button state to reflect panel visibility
     * Called by panels when visibility changes
     */
    updatePanelToggleState(visible) {
      if (toggleButton) {
        if (visible) {
          toggleButton.classList.add('active');
        } else {
          toggleButton.classList.remove('active');
        }
      }
    },

    /**
     * Enable or disable the undo button
     * Called by orchestrator after history state changes
     */
    setUndoEnabled(enabled) {
      if (undoButton) {
        undoButton.disabled = !enabled;
      }
    },

    /**
     * Enable or disable the redo button
     * Called by orchestrator after history state changes
     */
    setRedoEnabled(enabled) {
      if (redoButton) {
        redoButton.disabled = !enabled;
      }
    },

    /**
     * Show or hide the cancel cut button based on cut operation state
     * Called when cut operation state changes
     */
    setCancelCutVisible(visible) {
      if (cancelCutButton) {
        cancelCutButton.hidden = !visible;
      }
    },

    /**
     * Update highlight button state to reflect the active cell's highlight.
     * Called on selection change.
     * @param {string|null} activeName - Highlight name shared by all selected cells, or null
     */
    updateHighlightState(activeName) {
      // Update active marker in popover
      highlightOptions.forEach(opt => {
        const isActive = opt.dataset.highlight === (activeName || '');
        opt.classList.toggle('active', isActive);
      });
    },
  };
}
