/*
 * TOP CONTROLS
 * ============
 *
 * Header and Toolbar components - both horizontal control bars at top.
 * Attaches to existing DOM structure defined in index.html.
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';
import { isViewerMode } from '../utils/appMode.js';

/**
 * Header - Application branding and file operations
 */
export function createHeader() {
  // Dependencies (injected via init)
  let onOpen = null;       // Opens file browser modal
  let onPublish = null;    // Publishes spreadsheet as a function
  let onTitleChange = null;
  let onPreviewMerge = null;    // Merge preview changes to source
  let onPreviewDiscard = null;  // Discard preview changes
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
  let fileMenuClickOutsideHandler = null;
  let fileMenuEscapeHandler = null;

  // State
  let currentTitle = 'Untitled';
  let isEditable = true;
  let isEditing = false;
  let saveStatusTimeout = null;
  let isDirtyState = false;

  // Preview mode state
  let isPreviewMode = false;
  let previewInfo = null;  // { functionName, versionString, hasLocalSource }

  // Unpublished changes state
  let unpublishedInfo = null;  // { hasChanges, versionString, functionId }

  // Event handlers (stored for removal on unmount)
  function handleOpen() {
    console.log('[Header] Open clicked');
    onOpen();
  }

  function handlePublish() {
    console.log('[Header] Publish clicked');
    onPublish();
  }

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

  function handleSettings() {
    if (settingsDialog) settingsDialog.showModal();
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
        console.log('[Header] Rename in preview mode - triggering fork');
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

  // File menu handlers
  function closeFileMenu() {
    if (!fileMenuPopover) return;
    fileMenuPopover.hidden = true;
    if (fileMenuClickOutsideHandler) {
      document.removeEventListener('click', fileMenuClickOutsideHandler);
      fileMenuClickOutsideHandler = null;
    }
    if (fileMenuEscapeHandler) {
      document.removeEventListener('keydown', fileMenuEscapeHandler);
      fileMenuEscapeHandler = null;
    }
  }

  function handleFileMenuToggle(e) {
    e.stopPropagation();
    if (!fileMenuPopover) return;

    if (!fileMenuPopover.hidden) {
      closeFileMenu();
      return;
    }

    // Opening - update visibility of conditional items
    fileMenuPopover.hidden = false;
    updateFileMenuItemVisibility();

    fileMenuClickOutsideHandler = (evt) => {
      if (!fileMenuPopover.contains(evt.target) && evt.target !== fileMenuBtn) {
        closeFileMenu();
      }
    };
    fileMenuEscapeHandler = (evt) => {
      if (evt.key === 'Escape') {
        closeFileMenu();
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener('click', fileMenuClickOutsideHandler);
      document.addEventListener('keydown', fileMenuEscapeHandler);
    });
  }

  function updateFileMenuItemVisibility() {
    if (!fileMenuPopover) return;

    const discardItem = fileMenuPopover.querySelector('[data-action="discard-to-published"]');
    const overwriteItem = fileMenuPopover.querySelector('[data-action="overwrite-draft"]');
    const discardChangesItem = fileMenuPopover.querySelector('[data-action="discard-changes"]');
    const scenarioItem = fileMenuPopover.querySelector('[data-action="scenario-analysis"]');

    const showDiscard = unpublishedInfo?.hasChanges;
    const showOverwrite = isPreviewMode && previewInfo?.hasLocalSource;
    const showDiscardChanges = isPreviewMode;
    const anyConditionalVisible = showDiscard || showOverwrite || showDiscardChanges;

    if (discardItem) discardItem.hidden = !showDiscard;
    if (overwriteItem) overwriteItem.hidden = !showOverwrite;
    if (discardChangesItem) discardChangesItem.hidden = !showDiscardChanges;
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
    closeFileMenu();

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
      case 'discard-changes':
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
    console.log('[Header] Mounting...');

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
          <h4 class="settings-section-title">Language Packs</h4>
          <p class="settings-section-desc">Manage language packs for exporting spreadsheet code.</p>
          <button type="button" class="btn-action settings-manage-packs">Manage Packs...</button>
        </div>
        <div class="settings-section">
          <h4 class="settings-section-title">Local Storage</h4>
          <p class="settings-section-desc">Clear all locally stored spreadsheets, functions, and manifests.</p>
          <button type="button" class="btn-action settings-clear-data">Clear All Local Data</button>
        </div>
      </div>`, handleSettingsClose);

    settingsDialog.querySelector('.dialog-close-btn')?.addEventListener('click', handleSettingsClose);
    settingsDialog.querySelector('.settings-clear-data')?.addEventListener('click', handleClearAllData);
    settingsDialog.querySelector('.settings-manage-packs')?.addEventListener('click', () => {
      settingsDialog.close();
      onManageLanguagePacks?.();
    });
    settingsDialog.querySelector('.settings-breadcrumb-toggle')?.addEventListener('change', (e) => {
      localStorage.setItem('sc-breadcrumb-drilldown', e.target.checked ? 'true' : 'false');
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
    openBtn?.addEventListener('click', handleOpen);
    publishBtn?.addEventListener('click', handlePublish);
    settingsBtn?.addEventListener('click', handleSettings);
    themeToggleBtn?.addEventListener('click', handleThemeToggle);
    titleEl?.addEventListener('click', handleTitleClick);
    titleInput.addEventListener('keydown', handleTitleInputKeydown);
    titleInput.addEventListener('blur', handleTitleInputBlur);
    fileMenuBtn?.addEventListener('click', handleFileMenuToggle);
    fileMenuPopover?.addEventListener('click', handleFileMenuAction);

    // In viewer mode, hide elements that require OPFS or the server
    if (isViewerMode()) {
      if (publishBtn) publishBtn.hidden = true;
      if (saveStatusEl) saveStatusEl.hidden = true;
      if (dirtyIndicatorEl) dirtyIndicatorEl.hidden = true;

      // Hide file menu items that would break in viewer mode
      const hideActions = ['rename', 'delete', 'copy', 'export-html', 'scenario-analysis', 'discard-to-published', 'overwrite-draft'];
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

    console.log('[Header] Mounted');
  }

  function unmount() {
    // Remove event listeners
    openBtn?.removeEventListener('click', handleOpen);
    publishBtn?.removeEventListener('click', handlePublish);
    settingsBtn?.removeEventListener('click', handleSettings);
    themeToggleBtn?.removeEventListener('click', handleThemeToggle);
    titleEl?.removeEventListener('click', handleTitleClick);
    titleInput?.removeEventListener('keydown', handleTitleInputKeydown);
    titleInput?.removeEventListener('blur', handleTitleInputBlur);
    fileMenuBtn?.removeEventListener('click', handleFileMenuToggle);
    fileMenuPopover?.removeEventListener('click', handleFileMenuAction);
    closeFileMenu();

    // Clear timeout
    clearTimeout(saveStatusTimeout);

    // Remove created elements
    titleInput?.remove();
    previewControlsEl?.remove();
    unpublishedBannerEl?.remove();

    // Clear references (DOM remains in index.html)
    container = null;
    openBtn = null;
    publishBtn = null;
    settingsBtn = null;
    themeToggleBtn = null;
    settingsDialog = null;
    saveStatusEl = null;
    dirtyIndicatorEl = null;
    titleEl = null;
    titleInput = null;
    previewControlsEl = null;
    unpublishedBannerEl = null;
    fileMenuBtn = null;
    fileMenuPopover = null;

    // Reset state
    isPreviewMode = false;
    previewInfo = null;
    unpublishedInfo = null;
    isDirtyState = false;
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
    console.log('[Header] exitPreviewMode called, was:', isPreviewMode);
    isPreviewMode = false;
    previewInfo = null;
    updatePreviewUI();
    console.log('[Header] Preview controls hidden:', previewControlsEl?.hidden);
  }

  // Unpublished banner UI handlers
  function handleViewBuiltVersion() {
    console.log('[Header] View built version clicked');
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
      } = deps);
      console.log('[Header] Initialized');
    },

    mount,
    unmount,

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
     * @param {boolean} info.hasLocalSource - Whether source spreadsheet exists locally
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

  // DOM references
  let container = null;
  let cancelCutButton = null;
  let toggleButton = null;
  let undoButton = null;
  let redoButton = null;

  // Paste dropdown UI references
  let pasteDropdownBtn = null;
  let pastePopover = null;
  let pasteValuesBtn = null;
  let pasteClickOutsideHandler = null;

  // Highlight UI references
  let highlightApplyBtn = null;
  let highlightDropdownBtn = null;
  let highlightPopover = null;
  let highlightSwatch = null;
  let highlightOptions = [];
  let currentHighlightColor = 'yellow';
  let clickOutsideHandler = null;

  // All button references for cleanup
  let buttons = {};

  // Event handlers (named functions for removal on unmount)
  const handlers = {
    copy: () => { console.log('[Toolbar] Copy clicked'); onCopyOrCut(false); },
    cut: () => { console.log('[Toolbar] Cut clicked'); onCopyOrCut(true); },
    paste: () => { console.log('[Toolbar] Paste clicked'); onPaste(); },
    alignLeft: () => { console.log('[Toolbar] Align left clicked'); onAlignLeft(); },
    alignCenter: () => { console.log('[Toolbar] Align center clicked'); onAlignCenter(); },
    alignRight: () => { console.log('[Toolbar] Align right clicked'); onAlignRight(); },
    fontIncrease: () => { console.log('[Toolbar] Font increase clicked'); onFontSizeIncrease(); },
    fontDecrease: () => { console.log('[Toolbar] Font decrease clicked'); onFontSizeDecrease(); },
    bold: () => { console.log('[Toolbar] Bold clicked'); onBold(); },
    italic: () => { console.log('[Toolbar] Italic clicked'); onItalic(); },
    format: () => { console.log('[Toolbar] Format clicked'); onFormat(); },
    clearFormat: () => { console.log('[Toolbar] Clear format clicked'); onClearFormatting(); },
    customFunctions: () => { console.log('[Toolbar] Custom functions clicked'); onCustomFunctions(); },
    undo: () => { console.log('[Toolbar] Undo clicked'); onUndo(); },
    redo: () => { console.log('[Toolbar] Redo clicked'); onRedo(); },
    cancelCut: () => { console.log('[Toolbar] Cancel cut clicked'); onCancelCut(); },
    togglePanels: () => { console.log('[Toolbar] Toggle panels clicked'); onTogglePanels(); },
    namedRanges: () => { console.log('[Toolbar] Named ranges clicked'); onNamedRanges(); },
  };

  function handlePasteDropdown(e) {
    e.stopPropagation();
    if (pastePopover) {
      const isHidden = pastePopover.hidden;
      pastePopover.hidden = !isHidden;
      if (!isHidden) return;
      pasteClickOutsideHandler = (evt) => {
        if (!pastePopover.contains(evt.target) && evt.target !== pasteDropdownBtn) {
          pastePopover.hidden = true;
          document.removeEventListener('click', pasteClickOutsideHandler);
          pasteClickOutsideHandler = null;
        }
      };
      requestAnimationFrame(() => {
        document.addEventListener('click', pasteClickOutsideHandler);
      });
    }
  }

  function handlePasteValuesClick() {
    if (onPasteValues) onPasteValues();
    if (pastePopover) pastePopover.hidden = true;
    if (pasteClickOutsideHandler) {
      document.removeEventListener('click', pasteClickOutsideHandler);
      pasteClickOutsideHandler = null;
    }
  }

  function handleHighlightApply() {
    if (onHighlight) onHighlight(currentHighlightColor);
  }

  function handleHighlightDropdown(e) {
    e.stopPropagation();
    if (highlightPopover) {
      const isHidden = highlightPopover.hidden;
      highlightPopover.hidden = !isHidden;
      if (!isHidden) return;
      // Add click-outside listener when opening
      clickOutsideHandler = (evt) => {
        if (!highlightPopover.contains(evt.target) && evt.target !== highlightDropdownBtn) {
          highlightPopover.hidden = true;
          document.removeEventListener('click', clickOutsideHandler);
          clickOutsideHandler = null;
        }
      };
      // Delay to avoid catching the same click
      requestAnimationFrame(() => {
        document.addEventListener('click', clickOutsideHandler);
      });
    }
  }

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
    if (highlightPopover) highlightPopover.hidden = true;
    if (clickOutsideHandler) {
      document.removeEventListener('click', clickOutsideHandler);
      clickOutsideHandler = null;
    }
  }

  function mount(toolbarElement) {
    console.log('[Toolbar] Mounting...');

    container = toolbarElement;

    // Find and wire up all buttons
    buttons = {
      copy: container.querySelector('.btn-copy'),
      cut: container.querySelector('.btn-cut'),
      paste: container.querySelector('.btn-paste'),
      alignLeft: container.querySelector('.btn-align-left'),
      alignCenter: container.querySelector('.btn-align-center'),
      alignRight: container.querySelector('.btn-align-right'),
      fontIncrease: container.querySelector('.btn-font-increase'),
      fontDecrease: container.querySelector('.btn-font-decrease'),
      bold: container.querySelector('.btn-bold'),
      italic: container.querySelector('.btn-italic'),
      format: container.querySelector('.btn-format'),
      clearFormat: container.querySelector('.btn-clear-format'),
      customFunctions: container.querySelector('.btn-custom-functions'),
      undo: container.querySelector('.btn-undo'),
      redo: container.querySelector('.btn-redo'),
      cancelCut: container.querySelector('.btn-cancel-cut'),
      togglePanels: container.querySelector('.btn-toggle-panels'),
      namedRanges: container.querySelector('.btn-named-ranges'),
    };

    // Store special button references
    undoButton = buttons.undo;
    redoButton = buttons.redo;
    cancelCutButton = buttons.cancelCut;
    toggleButton = buttons.togglePanels;

    // Attach event listeners
    Object.entries(buttons).forEach(([key, btn]) => {
      if (btn && handlers[key]) {
        btn.addEventListener('click', handlers[key]);
      }
    });

    // Paste split button wiring
    pasteDropdownBtn = container.querySelector('.btn-paste-dropdown');
    pastePopover = container.querySelector('.paste-popover');
    pasteValuesBtn = container.querySelector('.btn-paste-values');

    // Set platform-appropriate shortcut hint
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const shortcutText = isMac ? '\u2318+Shift+V' : 'Ctrl+Shift+V';
    const shortcutEl = pastePopover?.querySelector('.paste-option-shortcut');
    if (shortcutEl) shortcutEl.textContent = shortcutText;

    pasteDropdownBtn?.addEventListener('click', handlePasteDropdown);
    pasteValuesBtn?.addEventListener('click', handlePasteValuesClick);

    // Highlight split button wiring
    highlightApplyBtn = container.querySelector('.btn-highlight-apply');
    highlightDropdownBtn = container.querySelector('.btn-highlight-dropdown');
    highlightPopover = container.querySelector('.highlight-popover');
    highlightSwatch = container.querySelector('.highlight-swatch');
    highlightOptions = Array.from(container.querySelectorAll('.highlight-option'));

    highlightApplyBtn?.addEventListener('click', handleHighlightApply);
    highlightDropdownBtn?.addEventListener('click', handleHighlightDropdown);
    highlightOptions.forEach(opt => opt.addEventListener('click', handleHighlightOptionClick));

    console.log('[Toolbar] Mounted');
  }

  function unmount() {
    // Remove event listeners
    Object.entries(buttons).forEach(([key, btn]) => {
      if (btn && handlers[key]) {
        btn.removeEventListener('click', handlers[key]);
      }
    });

    // Clean up paste dropdown listeners
    pasteDropdownBtn?.removeEventListener('click', handlePasteDropdown);
    pasteValuesBtn?.removeEventListener('click', handlePasteValuesClick);
    if (pasteClickOutsideHandler) {
      document.removeEventListener('click', pasteClickOutsideHandler);
      pasteClickOutsideHandler = null;
    }

    // Clean up highlight listeners
    highlightApplyBtn?.removeEventListener('click', handleHighlightApply);
    highlightDropdownBtn?.removeEventListener('click', handleHighlightDropdown);
    highlightOptions.forEach(opt => opt.removeEventListener('click', handleHighlightOptionClick));
    if (clickOutsideHandler) {
      document.removeEventListener('click', clickOutsideHandler);
      clickOutsideHandler = null;
    }

    // Clear references (DOM remains in index.html)
    container = null;
    buttons = {};
    undoButton = null;
    redoButton = null;
    cancelCutButton = null;
    toggleButton = null;
    pasteDropdownBtn = null;
    pastePopover = null;
    pasteValuesBtn = null;
    highlightApplyBtn = null;
    highlightDropdownBtn = null;
    highlightPopover = null;
    highlightSwatch = null;
    highlightOptions = [];
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
      } = deps);
      console.log('[Toolbar] Initialized');
    },

    mount,
    unmount,

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
