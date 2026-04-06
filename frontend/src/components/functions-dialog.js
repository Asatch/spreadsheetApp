/**
 * FUNCTIONS DIALOG
 * ================
 *
 * Consolidated dialog for browsing sheets and managing functions.
 * Replaces both file-browser-modal and custom-function-dialog.
 *
 * View modes:
 * - File Tree: Folder hierarchy with breadcrumbs, folder CRUD. Shows all sheets.
 * - Recents: Flat list sorted by updatedAt.
 * - Search: Search input + filtered flat results.
 * - Loaded: Registered functions + missing functions.
 *
 * Features:
 * - Selection-based action bar (contextual actions)
 * - Detail panel for single selection (editable name + description)
 * - Move mode (reuses folder navigation to pick a target folder)
 * - "+ New" dropdown for creating sheets/folders
 */

import { createFolderNavigation } from '../utils/folderNavigation.js';
import { createFolderOperationHandler } from '../utils/folderOperationHandlers.js';
import {
  escapeHtml,
  formatDate,
  renderBreadcrumb,
  renderSelectableRow,
  renderSelectableFolderRow,
  renderFolderItem,
  renderEmptyState
} from '../utils/treeRenderer.js';
import { mountDialog } from '../utils/dialogMount.js';
import { computeDependencyDepths } from '../utils/dependencySort.js';
import { isViewerMode } from '../utils/appMode.js';
import {
  formatSignature,
  sortByDependencyDepth,
  renderGroupedItems,
  renderSortToggle,
  formatFolderContents,
  countFolderContentsRecursive,
  detectMissingFunctions,
  formatSignatureFromSheet,
  buildFolderPathString,
  resolveDependencyNames,
  findCalledBy,
  findScenariosForFunction
} from './functions-dialog-helpers.js';

export function createFunctionsDialog() {
  // ============================================================================
  // STATE
  // ============================================================================

  // DOM references
  let dialog = null;
  let tabEls = {};         // { tree, recents, search, loaded }
  let viewContainerEl = null;
  let detailPanelEl = null;
  let actionBarEl = null;
  let breadcrumbEl = null;
  let searchInputEl = null;
  let newDropdownEl = null;

  // Dependencies (injected via init)
  // Sheet browsing
  let listSheets = null;
  let listFolderContents = null;
  let getFolderPath = null;
  let deleteSpreadsheetBatch = null;
  let updateSheetMetadata = null;
  let moveSheetToFolder = null;
  let moveFolderToFolder = null;
  let getCurrentSheetId = null;

  // Sheet creation/opening
  let onOpen = null;
  let onNewStandard = null;
  let onNewLoop = null;
  let onOpenScenario = null;

  // Scenario operations
  let listScenarios = null;
  let deleteScenarioBatch = null;
  let moveScenarioToFolder = null;
  let createScenario = null;

  // Folder CRUD
  let createFolder = null;
  let renameFolder = null;
  let deleteFolderFn = null;

  // Function loading
  let loadFunctionById = null;
  let registerFunction = null;
  let getFunctionsWithMetadata = null;
  let unregisterFunction = null;
  let getNodeCalcData = null;
  let onDrillDown = null;
  // Export
  let onExport = null;

  // Import
  let onImport = null;

  // Import from URL (for example packs)
  let onImportFromUrl = null;

  // Copy
  let duplicateSpreadsheet = null;

  // Draft creation for published-only sheets
  let createDraftFromPublished = null;

  // Dialog state
  let currentView = 'tree';       // 'tree' | 'recents' | 'search' | 'loaded'
  let selection = new Set();       // Set of IDs (sheet IDs or folder IDs)
  let selectionTypes = new Map();  // ID -> 'sheet' | 'folder'
  let folderNav = null;
  let folderClickHandler = null;
  let searchTerm = '';
  let allSheets = [];              // Cached for recents/search
  let allScenarios = [];           // Cached for recents/search
  let loadedFunctions = [];
  let missingFunctions = [];

  // File tree view state
  let treeFolders = [];
  let treeItems = [];

  // Move mode state
  let moveMode = false;
  let moveItemIds = [];            // IDs being moved
  let moveItemTypes = [];          // Types being moved ('sheet'|'folder')
  let preMoveView = null;          // View to restore after move

  // Copy mode state
  let copyMode = false;
  let copySheetId = null;
  let copySheetName = null;

  // Sort mode: 'dependencies' (default), 'alphabetical', or 'recent'
  let sortMode = 'dependencies';
  // Group by type toggle (layers on top of current sort)
  let groupByType = false;
  let collapsedGroups = new Set();  // Tracks which type groups are collapsed

  // Examples catalog cache
  let examplesCatalog = null;       // null = not loaded, array = loaded
  let examplesLoading = new Set();  // Set of filenames currently being imported
  let deleteInProgress = false;     // Guard against double-clicking delete

  // Detail panel save timeout
  let detailSaveTimeout = null;

  // ============================================================================
  // HELPERS
  // ============================================================================

  function isLoaded(functionId) {
    return loadedFunctions.some(f => f.id === functionId);
  }


  function updateLoadedBadge() {
    const badge = dialog?.querySelector('.fn-loaded-badge');
    if (!badge) return;
    const count = loadedFunctions.length;
    const missingCount = missingFunctions.length;
    if (count === 0 && missingCount === 0) {
      badge.textContent = '';
    } else if (missingCount > 0) {
      badge.textContent = `${count} / ${missingCount}!`;
    } else {
      badge.textContent = `${count}`;
    }
  }



  // ============================================================================
  // EXPORT HELPERS
  // ============================================================================

  /** Collect all sheet IDs from the current selection, recursively expanding folders. */
  async function collectSheetIdsFromSelection() {
    const sheetIds = new Set();
    for (const id of selection) {
      if (selectionTypes.get(id) === 'sheet') {
        sheetIds.add(id);
      } else if (selectionTypes.get(id) === 'folder') {
        const nested = await getAllSheetsInFolder(id);
        for (const sid of nested) sheetIds.add(sid);
      }
    }
    return sheetIds;
  }

  /** Recursively collect all sheet IDs within a folder (excludes scenarios). */
  async function getAllSheetsInFolder(folderId) {
    const contents = await listFolderContents(folderId);
    const ids = (contents.items || []).filter(s => s.type !== 'scenario').map(s => s.id);
    for (const subfolder of (contents.folders || [])) {
      const subIds = await getAllSheetsInFolder(subfolder.id);
      ids.push(...subIds);
    }
    return ids;
  }

  // ============================================================================
  // SELECTION
  // ============================================================================

  function clearSelection() {
    selection.clear();
    selectionTypes.clear();
  }

  function toggleSelection(id, type) {
    if (selection.has(id)) {
      selection.delete(id);
      selectionTypes.delete(id);
    } else {
      selection.add(id);
      selectionTypes.set(id, type);
    }
  }

  function getSelectedSheet() {
    if (selection.size !== 1) return null;
    const id = [...selection][0];
    if (selectionTypes.get(id) !== 'sheet') return null;
    return findItem(id);
  }

  function getSelectedScenario() {
    if (selection.size !== 1) return null;
    const id = [...selection][0];
    if (selectionTypes.get(id) !== 'scenario') return null;
    return findItem(id);
  }

  function getSelectedFolder() {
    if (selection.size !== 1) return null;
    const id = [...selection][0];
    if (selectionTypes.get(id) !== 'folder') return null;
    return treeFolders.find(f => f.id === id) || null;
  }

  /** Look up a sheet or scenario by ID across current data sources. */
  function findItem(id) {
    return treeItems.find(s => s.id === id)
      || allSheets.find(s => s.id === id)
      || allScenarios.find(s => s.id === id)
      || null;
  }

  /** Look up a folder by ID. */
  function findFolder(id) {
    return treeFolders.find(f => f.id === id) || null;
  }

  /** Get all selected items as { id, type, data } objects. */
  function getSelectedItems() {
    return [...selection].map(id => {
      const type = selectionTypes.get(id);
      const data = type === 'folder' ? findFolder(id) : findItem(id);
      return { id, type, data };
    }).filter(item => item.data);
  }

  // ============================================================================
  // VIEW SWITCHING
  // ============================================================================

  function switchView(view) {
    currentView = view;

    // Update tab active states
    for (const [name, el] of Object.entries(tabEls)) {
      el?.classList.toggle('active', name === view);
    }

    clearSelection();
    renderCurrentView();
    renderDetailPanel();
    renderActionBar();
  }

  // ============================================================================
  // RENDER: CURRENT VIEW
  // ============================================================================

  function renderCurrentView() {
    if (!viewContainerEl) return;

    if (moveMode) {
      renderMoveView();
      return;
    }

    if (copyMode) {
      renderCopyView();
      return;
    }

    switch (currentView) {
      case 'tree': renderTreeView(); break;
      case 'recents': renderRecentsView(); break;
      case 'search': renderSearchView(); break;
      case 'loaded': renderLoadedView(); break;
      case 'examples': renderExamplesView(); break;
    }
  }

  // ============================================================================
  // FILE TREE VIEW
  // ============================================================================

  /** Render an error message into the view container. */
  function renderViewError(message) {
    if (!viewContainerEl) return;
    viewContainerEl.innerHTML = `
      <div class="tree-list">
        ${renderEmptyState('Something went wrong', message)}
      </div>`;
  }

  /** Switch to File Tree view, navigate to an item's folder, and select it. */
  async function showInFolder(itemId, folderId) {
    try {
      currentView = 'tree';
      for (const [name, el] of Object.entries(tabEls)) {
        el?.classList.toggle('active', name === 'tree');
      }

      const { contents, path } = await folderNav.navigateTo(folderId);
      treeFolders = contents.folders || [];
      treeItems = (contents.items || []).filter(s => s.type !== 'scenario');
      // Load all scenarios (any folder) for detail card links
      allScenarios = listScenarios
        ? (await listScenarios()).map(s => ({ ...s, type: 'scenario' }))
        : [];

      clearSelection();
      if (itemId) {
        const item = treeItems.find(s => s.id === itemId);
        if (item) {
          selection.add(itemId);
          selectionTypes.set(itemId, 'sheet');
        }
      }

      renderTreeView();
      renderDetailPanel();
      renderActionBar();
      updateBreadcrumb(path);
    } catch (err) {
      console.error('[FunctionsDialog] showInFolder failed:', err);
      renderViewError('Failed to navigate to folder.');
    }
  }

  async function navigateToFolder(folderId) {
    try {
      const { contents, path } = await folderNav.navigateTo(folderId);
      treeFolders = contents.folders || [];
      treeItems = (contents.items || []).filter(s => s.type !== 'scenario');
      allScenarios = listScenarios
        ? (await listScenarios()).map(s => ({ ...s, type: 'scenario' }))
        : [];
      clearSelection();
      renderTreeView();
      renderDetailPanel();
      renderActionBar();
      updateBreadcrumb(path);
    } catch (err) {
      console.error('[FunctionsDialog] navigateToFolder failed:', err);
      renderViewError('Failed to load folder contents.');
    }
  }

  function updateBreadcrumb(path) {
    if (!breadcrumbEl) return;
    breadcrumbEl.innerHTML = renderBreadcrumb(path);
  }

  function renderTreeView() {
    if (!viewContainerEl) return;

    const currentId = getCurrentSheetId?.();

    // Toolbar
    const viewer = isViewerMode();
    const toolbarHtml = `
      <div class="tree-toolbar">
        <div class="tree-breadcrumb"></div>
        <div class="fn-toolbar-right">
          ${renderSortToggle(sortMode, groupByType)}
          <button type="button" class="fn-select-all-btn">Select All</button>
          <button type="button" class="fn-import-btn">Import</button>
          ${viewer ? '' : `<div class="fn-new-dropdown">
            <button type="button" class="fn-new-btn">+ New</button>
            <div class="fn-new-menu" hidden>
              <button type="button" class="fn-new-standard">Standard Sheet</button>
              <button type="button" class="fn-new-loop">Loop Sheet</button>
              <button type="button" class="tree-new-folder-btn">Folder</button>
            </div>
          </div>`}
        </div>
      </div>
    `;

    const sortedFolders = [...treeFolders].sort((a, b) => a.name.localeCompare(b.name));

    let depthMap = null;
    let sortedItems;
    if (sortMode === 'dependencies') {
      depthMap = computeDependencyDepths(treeItems);
      sortedItems = sortByDependencyDepth(treeItems, depthMap);
    } else if (sortMode === 'alphabetical') {
      sortedItems = [...treeItems].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sortedItems = [...treeItems].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
    if (sortedFolders.length === 0 && sortedItems.length === 0) {
      const isRoot = folderNav.getCurrentFolderId() === null;
      viewContainerEl.innerHTML = toolbarHtml + `
        <div class="tree-list">
          ${renderEmptyState(
            isRoot ? 'No sheets yet' : 'This folder is empty',
            isRoot ? 'Try going to the Examples tab and importing the common-math pack.' : ''
          )}
        </div>`;
      initTreeToolbar();
      return;
    }

    const foldersHtml = sortedFolders.map(f =>
      renderSelectableFolderRow(f, { selected: selection.has(f.id) })
    ).join('');

    const rowRenderer = s => renderSelectableRow(s, {
      selected: selection.has(s.id),
      isCurrent: s.id === currentId,
      depthBadge: depthMap ? depthMap.get(s.id) : undefined,
    });

    const sheetsHtml = groupByType
      ? renderGroupedItems(sortedItems, rowRenderer, collapsedGroups)
      : sortedItems.map(rowRenderer).join('');

    viewContainerEl.innerHTML = toolbarHtml + `<div class="tree-list fn-list">${foldersHtml}${sheetsHtml}</div>`;
    initTreeToolbar();
  }

  function initTreeToolbar() {
    // Breadcrumb
    const bc = viewContainerEl.querySelector('.tree-breadcrumb');
    if (bc && breadcrumbEl) {
      bc.replaceWith(breadcrumbEl);
    } else if (bc) {
      breadcrumbEl = bc;
      // Render breadcrumb for current folder
      getFolderPath(folderNav.getCurrentFolderId()).then(path => updateBreadcrumb(path));
    }

    // + New dropdown
    newDropdownEl = viewContainerEl.querySelector('.fn-new-dropdown');
    const newBtn = viewContainerEl.querySelector('.fn-new-btn');
    const newMenu = viewContainerEl.querySelector('.fn-new-menu');
    newBtn?.addEventListener('click', () => {
      if (newMenu) newMenu.hidden = !newMenu.hidden;
    });

    // Select All / Deselect All
    viewContainerEl.querySelector('.fn-select-all-btn')?.addEventListener('click', () => {
      const allIds = [
        ...treeFolders.map(f => ({ id: f.id, type: 'folder' })),
        ...treeItems.map(s => ({ id: s.id, type: s.type === 'scenario' ? 'scenario' : 'sheet' })),
      ];
      const allSelected = allIds.length > 0 && allIds.every(item => selection.has(item.id));
      if (allSelected) {
        clearSelection();
      } else {
        for (const item of allIds) {
          selection.add(item.id);
          selectionTypes.set(item.id, item.type);
        }
      }
      // Toggle visual state directly on rows instead of re-rendering
      // (which would reset scroll position).
      for (const row of viewContainerEl.querySelectorAll('.fn-row')) {
        const id = row.dataset.sheetId || row.dataset.folderId;
        row.classList.toggle('tree-item-selected', selection.has(id));
      }
      renderDetailPanel();
      renderActionBar();
    });

    viewContainerEl.querySelector('.fn-import-btn')?.addEventListener('click', () => {
      onImport?.();
    });
    viewContainerEl.querySelector('.fn-new-standard')?.addEventListener('click', () => {
      close();
      onNewStandard?.(folderNav.getCurrentFolderId());
    });
    viewContainerEl.querySelector('.fn-new-loop')?.addEventListener('click', () => {
      close();
      onNewLoop?.(folderNav.getCurrentFolderId());
    });
  }

  // ============================================================================
  // RECENTS VIEW
  // ============================================================================

  async function renderRecentsView() {
    if (!viewContainerEl) return;
    try {
      allSheets = await listSheets();
      allScenarios = listScenarios
        ? (await listScenarios()).map(s => ({ ...s, type: 'scenario' }))
        : [];
      const allItems = [...allSheets];  // Scenarios shown on function detail cards, not in list
      const currentId = getCurrentSheetId?.();

      // Recents always sorts by most recent
      const sorted = [...allItems].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      if (sorted.length === 0) {
        viewContainerEl.innerHTML = `
          <div class="tree-list">${renderEmptyState('No items yet')}</div>`;
        return;
      }

      // Build folder path strings
      const pathEntries = await Promise.all(
        sorted.map(async s => [s.id, await buildFolderPathString(s.folderId, getFolderPath)])
      );
      const pathStrings = Object.fromEntries(pathEntries);

      const html = sorted.map(s =>
        renderSelectableRow(s, {
          selected: selection.has(s.id),
          folderPath: pathStrings[s.id],
          isCurrent: s.id === currentId,
        })
      ).join('');

      viewContainerEl.innerHTML = `<div class="tree-list fn-list">${html}</div>`;
    } catch (err) {
      console.error('[FunctionsDialog] renderRecentsView failed:', err);
      renderViewError('Failed to load recent items.');
    }
  }

  // ============================================================================
  // SEARCH VIEW
  // ============================================================================

  async function renderSearchView() {
    if (!viewContainerEl) return;
    try {
      allSheets = await listSheets();
      allScenarios = listScenarios
        ? (await listScenarios()).map(s => ({ ...s, type: 'scenario' }))
        : [];
      const allItems = [...allSheets];  // Scenarios shown on function detail cards, not in list
      const currentId = getCurrentSheetId?.();

      // On first render, create the search input + results container.
      // On re-renders (triggered by typing), only update the results container
      // so the input element (and cursor position) is preserved.
      let resultsEl = viewContainerEl.querySelector('.fn-search-results');
      if (!resultsEl) {
        viewContainerEl.innerHTML = `
          <div class="fn-search-row">
            <input type="text" class="fn-search-input" placeholder="Search..." value="${escapeHtml(searchTerm)}">
            ${renderSortToggle(sortMode, groupByType)}
          </div>
          <div class="fn-search-results"></div>
        `;
        searchInputEl = viewContainerEl.querySelector('.fn-search-input');
        searchInputEl?.addEventListener('input', handleSearchInput);
        if (searchInputEl) setTimeout(() => searchInputEl.focus(), 50);
        resultsEl = viewContainerEl.querySelector('.fn-search-results');
      }

      const term = searchTerm.toLowerCase().trim();
      const filtered = term
        ? allItems.filter(s =>
            s.name.toLowerCase().includes(term) ||
            (s.description && s.description.toLowerCase().includes(term)) ||
            (s.functionName && s.functionName.toLowerCase().includes(term))
          )
        : allItems;

      let depthMap = null;
      let sorted;
      if (sortMode === 'dependencies') {
        depthMap = computeDependencyDepths(filtered);
        sorted = sortByDependencyDepth(filtered, depthMap);
      } else if (sortMode === 'recent') {
        sorted = [...filtered].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      } else {
        // alphabetical (also the natural default for search)
        sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      }
      // Build folder paths
      const pathEntries = await Promise.all(
        sorted.map(async s => [s.id, await buildFolderPathString(s.folderId, getFolderPath)])
      );
      const pathStrings = Object.fromEntries(pathEntries);

      if (term && sorted.length === 0) {
        resultsEl.innerHTML = `<div class="tree-list">${renderEmptyState(`No items matching "${escapeHtml(searchTerm)}"`)}</div>`;
      } else if (sorted.length === 0) {
        resultsEl.innerHTML = `<div class="tree-list">${renderEmptyState('No items yet')}</div>`;
      } else {
        const rowRenderer = s => renderSelectableRow(s, {
          selected: selection.has(s.id),
          folderPath: pathStrings[s.id],
          isCurrent: s.id === currentId,
          depthBadge: depthMap ? depthMap.get(s.id) : undefined,
        });
        const rowsHtml = groupByType
          ? renderGroupedItems(sorted, rowRenderer, collapsedGroups)
          : sorted.map(rowRenderer).join('');
        resultsEl.innerHTML = `<div class="tree-list fn-list">${rowsHtml}</div>`;
      }
    } catch (err) {
      console.error('[FunctionsDialog] renderSearchView failed:', err);
      const resultsEl = viewContainerEl.querySelector('.fn-search-results');
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="tree-list">${renderEmptyState('Search failed', 'Could not load items.')}</div>`;
      } else {
        renderViewError('Failed to load search results.');
      }
    }
  }

  // ============================================================================
  // LOADED VIEW
  // ============================================================================

  function renderLoadedView() {
    if (!viewContainerEl) return;

    loadedFunctions = getFunctionsWithMetadata?.() || [];
    missingFunctions = detectMissingFunctions(getNodeCalcData);

    let html = '';

    // Missing functions section
    if (missingFunctions.length > 0) {
      const missingHtml = missingFunctions.map(func => `
        <div class="custom-func-missing-item">
          <div class="custom-func-missing-info">
            <div class="custom-func-missing-signature">${escapeHtml(func.name)}(...)</div>
            <div class="tree-item-desc">Used in: ${func.usedIn.slice(0, 3).join(', ')}${func.usedIn.length > 3 ? ` (+${func.usedIn.length - 3} more)` : ''}</div>
          </div>
          <button type="button" class="tree-btn custom-func-find-btn" data-name="${escapeHtml(func.name)}">Find \u2192</button>
        </div>
      `).join('');

      html += `
        <div class="custom-func-section custom-func-missing-section">
          <div class="custom-func-section-title custom-func-warning-title">Missing Functions</div>
          <div class="custom-func-list custom-func-list-warning">${missingHtml}</div>
        </div>
      `;
    }

    // Loaded functions section
    if (loadedFunctions.length > 0) {
      const loadedHtml = loadedFunctions.map(func => {
        const hasAlias = func.canonicalName && func.name !== func.canonicalName;
        const aliasNotice = hasAlias
          ? `<div class="fn-loaded-alias-notice">Source function: ${escapeHtml(func.canonicalName)}</div>`
          : '';
        const renameBtn = `<button type="button" class="tree-btn fn-rename-btn" data-name="${escapeHtml(func.name)}" data-function-id="${func.id}" title="Rename">Rename</button>`;
        const syncBtn = hasAlias
          ? `<button type="button" class="tree-btn fn-sync-name-btn" data-name="${escapeHtml(func.name)}" data-canonical="${escapeHtml(func.canonicalName)}" data-function-id="${func.id}" title="Update to ${escapeHtml(func.canonicalName)}">Sync Name</button>`
          : '';

        return `
          <div class="tree-item fn-loaded-item" data-function-id="${func.id}">
            <div class="tree-item-info">
              <div class="tree-item-name">
                ${escapeHtml(func.name)}
                <span class="tree-version">v${func.version || '?'}</span>
              </div>
              ${aliasNotice}
              <div class="custom-func-item-signature">${formatSignature(func)}</div>
            </div>
            <div class="tree-item-actions">
              ${syncBtn}
              ${renameBtn}
              <button type="button" class="tree-btn fn-view-btn"
                      data-function-id="${func.id}"
                      data-version-id="${func.versionId || ''}"
                      data-name="${escapeHtml(func.name)}"
                      data-version="${func.version || '1.0'}"
                      data-sheet-type="${func.sheetType || 'standard'}">View</button>
              <button type="button" class="tree-btn-icon fn-unload-btn" data-name="${escapeHtml(func.name)}" title="Unload">&times;</button>
            </div>
          </div>
        `;
      }).join('');

      html += `
        <div class="custom-func-section">
          <div class="custom-func-section-title">Loaded Functions</div>
          <div class="custom-func-list">${loadedHtml}</div>
        </div>
      `;
    } else if (missingFunctions.length === 0) {
      html = renderEmptyState('No custom functions loaded');
    }

    viewContainerEl.innerHTML = `<div class="fn-loaded-view">${html}</div>`;
  }

  // ============================================================================
  // FOLDER PICKER (shared by move and copy modes)
  // ============================================================================

  /**
   * Render the folder picker view used by both move and copy modes.
   * @param {Object} options
   * @param {string} options.hintText - Hint displayed above the folder list
   * @param {string} options.confirmLabel - Label for the primary action button
   * @param {Function} options.onConfirm - Called when the primary button is clicked
   * @param {Function} options.onCancel - Called when cancel is clicked
   * @param {Function} [options.folderFilter] - Optional filter applied to folders
   */
  function renderFolderPickerView({ hintText, confirmLabel, onConfirm, onCancel, folderFilter }) {
    if (!viewContainerEl) return;

    const sortedFolders = [...treeFolders]
      .filter(f => folderFilter ? folderFilter(f) : true)
      .sort((a, b) => a.name.localeCompare(b.name));

    const foldersHtml = sortedFolders.map(f =>
      renderFolderItem(f, { showRename: false, showDelete: false })
    ).join('');

    const emptyHtml = sortedFolders.length === 0
      ? renderEmptyState('No subfolders here')
      : '';

    viewContainerEl.innerHTML = `
      <div class="tree-toolbar">
        <div class="tree-breadcrumb"></div>
      </div>
      <div class="fn-move-hint">${hintText}</div>
      <div class="tree-list fn-list">${foldersHtml}${emptyHtml}</div>
    `;

    // Replace breadcrumb placeholder
    const bc = viewContainerEl.querySelector('.tree-breadcrumb');
    if (bc && breadcrumbEl) {
      bc.replaceWith(breadcrumbEl);
    } else if (bc) {
      breadcrumbEl = bc;
      getFolderPath(folderNav.getCurrentFolderId()).then(path => updateBreadcrumb(path));
    }

    // Action bar
    if (actionBarEl) {
      actionBarEl.innerHTML = `
        <button type="button" class="fn-action-btn fn-picker-cancel">Cancel</button>
        <button type="button" class="fn-action-btn fn-action-btn-primary fn-picker-confirm">${confirmLabel}</button>
      `;
      actionBarEl.hidden = false;
      actionBarEl.querySelector('.fn-picker-cancel')?.addEventListener('click', onCancel);
      actionBarEl.querySelector('.fn-picker-confirm')?.addEventListener('click', onConfirm);
    }
  }

  async function navigatePickerToFolder(folderId) {
    try {
      const { contents, path } = await folderNav.navigateTo(folderId);
      treeFolders = contents.folders || [];
      renderCurrentView();
      updateBreadcrumb(path);
    } catch (err) {
      console.error('[FunctionsDialog] navigatePickerToFolder failed:', err);
      renderViewError('Failed to load folder contents.');
    }
  }

  // ============================================================================
  // MOVE MODE
  // ============================================================================

  function enterMoveMode() {
    if (selection.size === 0) return;
    moveMode = true;
    moveItemIds = [...selection];
    moveItemTypes = moveItemIds.map(id => selectionTypes.get(id));
    preMoveView = currentView;
    clearSelection();
    folderNav.reset();
    navigatePickerToFolder(null);
  }

  function renderMoveView() {
    renderFolderPickerView({
      hintText: `Select destination folder for ${moveItemIds.length} item${moveItemIds.length > 1 ? 's' : ''}`,
      confirmLabel: 'Move Here',
      onConfirm: executeMoveHere,
      onCancel: exitMoveMode,
      folderFilter: f => !moveItemIds.includes(f.id)
    });
  }

  function exitMoveMode() {
    moveMode = false;
    moveItemIds = [];
    moveItemTypes = [];
    switchView(preMoveView || 'tree');
    if (preMoveView === 'tree') {
      navigateToFolder(folderNav.getCurrentFolderId());
    }
  }

  async function executeMoveHere() {
    const targetFolderId = folderNav.getCurrentFolderId();
    try {
      for (let i = 0; i < moveItemIds.length; i++) {
        const id = moveItemIds[i];
        const type = moveItemTypes[i];
        if (type === 'sheet') {
          await moveSheetToFolder(id, targetFolderId);
        } else if (type === 'scenario') {
          await moveScenarioToFolder(id, targetFolderId);
        } else if (type === 'folder') {
          await moveFolderToFolder(id, targetFolderId);
        }
      }
    } catch (err) {
      alert(`Move failed: ${err.message}`);
    }
    exitMoveMode();
  }

  // ============================================================================
  // COPY MODE
  // ============================================================================

  function enterCopyMode(sheetId, sheetName) {
    copyMode = true;
    copySheetId = sheetId;
    copySheetName = sheetName;
    clearSelection();
    folderNav.reset();
    navigatePickerToFolder(null);
  }

  function renderCopyView() {
    renderFolderPickerView({
      hintText: `Select destination for copy of ${escapeHtml(copySheetName)}`,
      confirmLabel: 'Copy Here',
      onConfirm: executeCopyHere,
      onCancel: exitCopyMode
    });
  }

  function exitCopyMode() {
    copyMode = false;
    copySheetId = null;
    copySheetName = null;
    switchView('tree');
    navigateToFolder(folderNav.getCurrentFolderId());
  }

  async function executeCopyHere() {
    const targetFolderId = folderNav.getCurrentFolderId();
    try {
      const newName = copySheetName + ' (Copy)';
      await duplicateSpreadsheet(copySheetId, newName, targetFolderId);
    } catch (err) {
      alert(`Copy failed: ${err.message}`);
    }
    exitCopyMode();
  }

  // ============================================================================
  // DETAIL PANEL
  // ============================================================================

  function renderDetailPanel() {
    if (!detailPanelEl) return;

    if (moveMode || copyMode) {
      detailPanelEl.innerHTML = `<div class="fn-detail-empty">Select a destination folder</div>`;
      return;
    }

    const items = getSelectedItems();
    if (items.length === 0) {
      detailPanelEl.innerHTML = `<div class="fn-detail-empty">Select an item to view details</div>`;
      return;
    }

    const cardsHtml = items.map(item => {
      if (item.type === 'scenario') return renderScenarioDetailCard(item.data);
      if (item.type === 'folder') return renderFolderDetailCard(item.data);
      return renderSheetDetailCard(item.data);
    }).join('');

    detailPanelEl.innerHTML = cardsHtml;

    // Bind editable field events (name change, description input)
    for (const nameInput of detailPanelEl.querySelectorAll('.fn-detail-name')) {
      nameInput.addEventListener('change', handleDetailNameChange);
    }
    for (const descTextarea of detailPanelEl.querySelectorAll('.fn-detail-description')) {
      descTextarea.addEventListener('input', handleDetailDescriptionInput);
    }

    // Async: fill in folder content counts
    for (const countEl of detailPanelEl.querySelectorAll('.fn-detail-folder-contents')) {
      const folderId = countEl.dataset.folderId;
      countFolderContentsRecursive(folderId, listFolderContents).then(counts => {
        countEl.textContent = formatFolderContents(counts);
      });
    }
  }


  function renderSheetDetailCard(sheet) {
    const published = sheet.functionId && sheet.publishedVersion;
    const signature = published ? formatSignatureFromSheet(sheet, loadedFunctions) : '';
    const typeBadge = `<span class="tree-type-badge tree-type-${sheet.type}">${sheet.type}</span>`;
    const publishedOnlyBadge = sheet.hasDraft === false
      ? '<div class="fn-detail-published-only">Published only — no local draft</div>'
      : '';

    let signatureHtml = '';
    if (signature) {
      signatureHtml = `
        <label class="fn-detail-label">Signature</label>
        <div class="fn-detail-signature"><code>${escapeHtml(signature)}</code></div>
      `;
    }

    // Show draft name notice when published name differs from current draft name
    const publishedName = published ? (sheet.publishedVersion.publishedName || sheet.name) : null;
    const draftNameDiffers = published && sheet.name !== publishedName;
    const draftNameHtml = draftNameDiffers
      ? `<div class="fn-detail-draft-name">Draft name: ${escapeHtml(sheet.name)} (unpublished)</div>`
      : '';

    // Dependencies
    const sheetsForLookup = allSheets.length ? allSheets : treeItems;
    const calls = resolveDependencyNames(sheet.dependencies, sheetsForLookup);
    const calledBy = published ? findCalledBy(sheet.functionId, sheetsForLookup) : [];
    let depsHtml = '';
    if (calls.length > 0 || calledBy.length > 0) {
      const callsLinks = calls.map(d =>
        `<a href="#" class="fn-detail-dep-link" data-sheet-id="${escapeHtml(d.id)}" data-folder-id="${escapeHtml(d.folderId || '')}">${escapeHtml(d.name)}</a>`
      ).join(', ');
      const calledByLinks = calledBy.map(d =>
        `<a href="#" class="fn-detail-dep-link" data-sheet-id="${escapeHtml(d.id)}" data-folder-id="${escapeHtml(d.folderId || '')}">${escapeHtml(d.name)}</a>`
      ).join(', ');
      depsHtml = '<div class="fn-detail-deps">';
      if (calls.length > 0) depsHtml += `<div>Calls: ${callsLinks}</div>`;
      if (calledBy.length > 0) depsHtml += `<div>Called by: ${calledByLinks}</div>`;
      depsHtml += '</div>';
    }

    // Scenarios
    const scenarios = published ? findScenariosForFunction(sheet.functionId, allScenarios) : [];
    let scenariosHtml = '';
    if (published) {
      const scenarioLinks = scenarios.map(s =>
        `<a href="#" class="fn-detail-scenario-link" data-scenario-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</a>`
      ).join('');
      const newBtn = `<a href="#" class="fn-detail-new-scenario" data-function-id="${escapeHtml(sheet.functionId)}" data-function-name="${escapeHtml(publishedName || sheet.name)}" data-folder-id="${escapeHtml(sheet.folderId || '')}">+ New Scenario Analysis</a>`;
      scenariosHtml = `
        <div class="fn-detail-scenarios">
          <label class="fn-detail-label">Scenarios</label>
          ${scenarioLinks}
          ${newBtn}
        </div>`;
    }

    return `
      <div class="fn-detail-card fn-detail-collapsible">
        <button type="button" class="fn-detail-card-toggle">
          <span class="fn-detail-chevron">\u25B6</span>
          ${escapeHtml(publishedName || sheet.name)} ${typeBadge}
        </button>
        <div class="fn-detail-card-body">
          <div class="fn-detail-header">
            <input type="text" class="fn-detail-name" value="${escapeHtml(sheet.name)}" data-sheet-id="${sheet.id}" ${isViewerMode() ? 'readonly' : ''}>
          </div>
          ${publishedOnlyBadge}
          ${published ? `<div class="fn-detail-version">v${sheet.publishedVersion.versionString || '1.0'} &mdash; Published ${formatDate(sheet.publishedVersion.publishedAt)}</div>` : '<div class="fn-detail-version">Not published</div>'}
          ${draftNameHtml}
          ${signatureHtml}
          ${depsHtml}
          <label class="fn-detail-label">Description</label>
          <textarea class="fn-detail-description" data-sheet-id="${sheet.id}" rows="3" placeholder="Add a description..." ${isViewerMode() ? 'readonly' : ''}>${escapeHtml(sheet.description || '')}</textarea>
          ${scenariosHtml}
          <div class="fn-detail-dates">
            <div>Created: ${formatDate(sheet.createdAt)}</div>
            <div>Updated: ${formatDate(sheet.updatedAt)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderScenarioDetailCard(scenario) {
    const typeBadge = '<span class="tree-type-badge tree-type-scenario">scenario</span>';

    return `
      <div class="fn-detail-card fn-detail-collapsible">
        <button type="button" class="fn-detail-card-toggle">
          <span class="fn-detail-chevron">\u25B6</span>
          ${escapeHtml(scenario.name)} ${typeBadge}
        </button>
        <div class="fn-detail-card-body">
          ${scenario.functionName ? `<div class="fn-detail-version">Function: ${escapeHtml(scenario.functionName)}</div>` : ''}
          <div class="fn-detail-dates">
            <div>Created: ${formatDate(scenario.createdAt)}</div>
            <div>Updated: ${formatDate(scenario.updatedAt)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderFolderDetailCard(folder) {
    return `
      <div class="fn-detail-card fn-detail-collapsible">
        <button type="button" class="fn-detail-card-toggle">
          <span class="fn-detail-chevron">\u25B6</span>
          <span class="tree-folder-icon">\u{1F4C1}</span> ${escapeHtml(folder.name)}
        </button>
        <div class="fn-detail-card-body">
          <div class="fn-detail-folder-contents" data-folder-id="${folder.id}">Counting...</div>
          <div class="fn-detail-dates">
            ${folder.createdAt ? `<div>Created: ${formatDate(folder.createdAt)}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }


  /** Update a field on the cached item objects so re-renders see the new value. */
  function updateCachedItem(itemId, updates) {
    for (const list of [treeItems, allSheets, allScenarios]) {
      const item = list.find(s => s.id === itemId);
      if (item) Object.assign(item, updates);
    }
  }

  async function handleDetailNameChange(e) {
    const sheetId = e.target.dataset.sheetId;
    const newName = e.target.value.trim();
    if (sheetId && newName && updateSheetMetadata) {
      await updateSheetMetadata(sheetId, { name: newName });
      updateCachedItem(sheetId, { name: newName });
      // Update the row's displayed name directly instead of re-rendering
      // (which would reset scroll position).
      const row = viewContainerEl?.querySelector(`.fn-row[data-sheet-id="${sheetId}"]`);
      const nameEl = row?.querySelector('.tree-item-name');
      if (nameEl) nameEl.firstChild.textContent = newName;
      renderActionBar();
    }
  }

  function handleDetailDescriptionInput(e) {
    const sheetId = e.target.dataset.sheetId;
    const description = e.target.value;
    updateCachedItem(sheetId, { description });
    clearTimeout(detailSaveTimeout);
    detailSaveTimeout = setTimeout(async () => {
      if (sheetId && updateSheetMetadata) {
        await updateSheetMetadata(sheetId, { description });
      }
    }, 500);
  }

  // ============================================================================
  // ACTION BAR
  // ============================================================================

  function renderActionBar() {
    if (!actionBarEl) return;
    if (moveMode || copyMode) return;  // Move/copy mode manages its own action bar

    if (selection.size === 0) {
      actionBarEl.innerHTML = '';
      return;
    }

    const count = selection.size;
    const sheet = getSelectedSheet();
    const scenario = getSelectedScenario();
    const folder = getSelectedFolder();
    const isMulti = count > 1;
    const viewer = isViewerMode();

    let buttons = '';

    if (!isMulti && scenario) {
      if (currentView !== 'tree') {
        buttons += `<button type="button" class="fn-action-btn fn-action-show-in-folder" data-sheet-id="${scenario.id}" data-folder-id="${scenario.folderId || ''}">Show in Folder</button>`;
      }
      if (!viewer) {
        buttons += `<button type="button" class="fn-action-btn fn-action-move">Move</button>`;
      }
      buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-open-scenario" data-scenario-id="${scenario.id}">Open</button>`;
    } else if (!isMulti && sheet) {
      const published = sheet.functionId && sheet.publishedVersion;
      if (published) {
        buttons += `<button type="button" class="fn-action-btn fn-action-view"
                     data-function-id="${sheet.functionId}"
                     data-version-id="${sheet.publishedVersion.versionId || ''}"
                     data-name="${escapeHtml(sheet.name)}"
                     data-version="${sheet.publishedVersion.versionString || '1.0'}"
                     data-sheet-type="${sheet.type}">View Published</button>`;
      }
      if (currentView !== 'tree') {
        buttons += `<button type="button" class="fn-action-btn fn-action-show-in-folder" data-sheet-id="${sheet.id}" data-folder-id="${sheet.folderId || ''}">Show in Folder</button>`;
      }
      buttons += `<button type="button" class="fn-action-btn fn-action-export">Export</button>`;
      if (!viewer) {
        buttons += `<button type="button" class="fn-action-btn fn-action-copy" data-sheet-id="${sheet.id}" data-sheet-name="${escapeHtml(sheet.name)}">Copy</button>`;
        buttons += `<button type="button" class="fn-action-btn fn-action-move">Move</button>`;
      }
      if (published) {
        const loaded = isLoaded(sheet.functionId);
        if (!loaded) {
          buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-load" data-function-id="${sheet.functionId}">Load Function</button>`;
        }
      }
      if (sheet.hasDraft !== false) {
        buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-open" data-sheet-id="${sheet.id}">Open Draft</button>`;
      } else if (!viewer) {
        buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-create-draft" data-sheet-id="${sheet.id}">Create Draft</button>`;
      }
    } else if (!isMulti && folder) {
      if (!viewer) {
        buttons += `<button type="button" class="fn-action-btn fn-action-rename-folder" data-folder-id="${folder.id}">Rename</button>`;
      }
      buttons += `<button type="button" class="fn-action-btn fn-action-export">Export</button>`;
      if (!viewer) {
        buttons += `<button type="button" class="fn-action-btn fn-action-move">Move</button>`;
      }
      buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-load-multi">Load Functions</button>`;
      buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-open-folder" data-folder-id="${folder.id}">Open</button>`;
    } else if (isMulti) {
      // Check directly selected sheets for bulk load count
      const selectedSheetIds = [...selection].filter(id => selectionTypes.get(id) === 'sheet');
      const selectedFolderIds = [...selection].filter(id => selectionTypes.get(id) === 'folder');
      const selectedSheets = selectedSheetIds.map(id =>
        treeItems.find(s => s.id === id) || allSheets.find(s => s.id === id)
      ).filter(Boolean);
      const unloadedPublished = selectedSheets.filter(s => s.functionId && s.publishedVersion && !isLoaded(s.functionId));

      buttons += `<button type="button" class="fn-action-btn fn-action-export">Export</button>`;
      if (!viewer) {
        buttons += `<button type="button" class="fn-action-btn fn-action-move">Move</button>`;
      }
      // Show load button if there are unloaded published sheets, or folders that may contain them
      if (unloadedPublished.length > 0 || selectedFolderIds.length > 0) {
        const label = selectedFolderIds.length > 0 ? 'Load Functions' : `Load ${unloadedPublished.length} Functions`;
        buttons += `<button type="button" class="fn-action-btn fn-action-btn-primary fn-action-load-multi">${label}</button>`;
      }
    }

    actionBarEl.innerHTML = `
      ${viewer ? '' : '<button type="button" class="fn-action-btn fn-action-btn-danger fn-action-delete">Delete</button>'}
      <span class="fn-action-count">${count} selected</span>
      <div class="fn-action-buttons">${buttons}</div>
    `;
  }

  // ============================================================================
  // EXAMPLES VIEW
  // ============================================================================

  async function fetchExamplesCatalog() {
    if (examplesCatalog) return examplesCatalog;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}examples/catalog.json`);
      if (!res.ok) throw new Error(`${res.status}`);
      examplesCatalog = await res.json();
    } catch (err) {
      console.error('[FunctionsDialog] Failed to fetch examples catalog:', err);
      examplesCatalog = [];
    }
    return examplesCatalog;
  }

  async function renderExamplesView() {
    if (!viewContainerEl) return;

    // Show loading state while fetching catalog
    if (!examplesCatalog) {
      viewContainerEl.innerHTML = `
        <div class="tree-list">
          ${renderEmptyState('Loading examples\u2026')}
        </div>`;
      await fetchExamplesCatalog();
    }

    if (examplesCatalog.length === 0) {
      viewContainerEl.innerHTML = `
        <div class="tree-list">
          ${renderEmptyState('No examples available', 'Example packs could not be loaded.')}
        </div>`;
      return;
    }

    const cardsHtml = examplesCatalog.map(ex => {
      const isLoading = examplesLoading.has(ex.file);
      return `
        <div class="fn-example-card" data-example-file="${escapeHtml(ex.file)}">
          <div class="fn-example-info">
            <div class="fn-example-name">${escapeHtml(ex.name)}</div>
            <div class="fn-example-desc">${escapeHtml(ex.description)}</div>
            <div class="fn-example-meta">${ex.sheets} sheet${ex.sheets !== 1 ? 's' : ''}</div>
          </div>
          <button type="button" class="fn-example-download" ${isLoading ? 'disabled' : ''}>
            ${isLoading ? 'Importing\u2026' : 'Import'}
          </button>
        </div>`;
    }).join('');

    viewContainerEl.innerHTML = `<div class="fn-examples-list">${cardsHtml}</div>`;

    // Wire up download buttons
    for (const btn of viewContainerEl.querySelectorAll('.fn-example-download')) {
      btn.addEventListener('click', handleExampleDownload);
    }
  }

  async function handleExampleDownload(e) {
    const card = e.target.closest('.fn-example-card');
    if (!card) return;
    const file = card.dataset.exampleFile;
    if (!file || examplesLoading.has(file) || !onImportFromUrl) return;

    const btn = card.querySelector('.fn-example-download');

    examplesLoading.add(file);
    if (btn) { btn.disabled = true; btn.textContent = 'Importing\u2026'; }

    let imported = false;
    let importedFolderId = null;
    try {
      const url = `${window.location.origin}${import.meta.env.BASE_URL}examples/${encodeURIComponent(file)}`;
      const result = await onImportFromUrl(url);
      imported = !result.alreadyDownloaded;
      importedFolderId = result.importFolderId || null;
    } catch (err) {
      console.error('[FunctionsDialog] Example import failed:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Failed \u2014 Retry'; }
    }

    examplesLoading.delete(file);

    if (imported) {
      loadedFunctions = getFunctionsWithMetadata?.() || [];
      missingFunctions = detectMissingFunctions(getNodeCalcData);
      updateLoadedBadge();
      currentView = 'tree';
      for (const [name, el] of Object.entries(tabEls)) {
        el?.classList.toggle('active', name === 'tree');
      }
      await navigateToFolder(importedFolderId || folderNav.getCurrentFolderId());
    }
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  function handleTabClick(e) {
    const tab = e.target.closest('.fn-tab');
    if (!tab) return;
    const view = tab.dataset.view;
    if (view && !moveMode && !copyMode && examplesLoading.size === 0 && !deleteInProgress) switchView(view);
  }

  function handleSearchInput(e) {
    searchTerm = e.target.value;
    // Debounce re-render slightly
    clearTimeout(handleSearchInput._timeout);
    handleSearchInput._timeout = setTimeout(() => renderSearchView(), 150);
  }

  function handleRowClick(e) {
    // Don't handle clicks on buttons within rows
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return;

    const row = e.target.closest('.fn-row');
    if (!row) return;

    const sheetId = row.dataset.sheetId;
    const folderId = row.dataset.folderId;
    const type = row.dataset.itemType;

    if (sheetId && type === 'sheet') {
      toggleSelection(sheetId, 'sheet');
    } else if (sheetId && type === 'scenario') {
      toggleSelection(sheetId, 'scenario');
    } else if (folderId && type === 'folder') {
      toggleSelection(folderId, 'folder');
    }

    // Toggle the visual selected state directly on the row instead of
    // re-rendering the entire view (which would reset scroll position).
    row.classList.toggle('tree-item-selected');
    renderDetailPanel();
    renderActionBar();
  }

  async function handleRowDoubleClick(e) {
    const row = e.target.closest('.fn-row');
    if (!row) return;

    const sheetId = row.dataset.sheetId;
    const folderId = row.dataset.folderId;
    const type = row.dataset.itemType;

    if (type === 'folder' && folderId && currentView === 'tree') {
      navigateToFolder(folderId);
    } else if (type === 'scenario' && sheetId) {
      close();
      onOpenScenario?.(sheetId);
    } else if (type === 'sheet' && sheetId) {
      const sheet = treeItems.find(s => s.id === sheetId) || allSheets.find(s => s.id === sheetId);
      if (sheet && sheet.hasDraft === false && createDraftFromPublished && !isViewerMode()) {
        await createDraftFromPublished(sheetId);
      }
      close();
      onOpen?.(sheetId);
    }
  }

  async function handleActionBarClick(e) {
    const target = e.target.closest('button');
    if (!target) return;

    // Open Draft
    if (target.classList.contains('fn-action-open')) {
      const id = target.dataset.sheetId;
      if (id) { close(); onOpen?.(id); }
      return;
    }

    // Create Draft from published-only sheet
    if (target.classList.contains('fn-action-create-draft')) {
      const id = target.dataset.sheetId;
      if (id && createDraftFromPublished) {
        await createDraftFromPublished(id);
        close();
        onOpen?.(id);
      }
      return;
    }

    // Open Scenario
    if (target.classList.contains('fn-action-open-scenario')) {
      const id = target.dataset.scenarioId;
      if (id) { close(); onOpenScenario?.(id); }
      return;
    }

    // Load Function (single)
    if (target.classList.contains('fn-action-load')) {
      const functionId = target.dataset.functionId;
      if (functionId) await loadSingleFunction(functionId);
      return;
    }

    // Load Functions (multi)
    if (target.classList.contains('fn-action-load-multi')) {
      await loadSelectedFunctions();
      return;
    }

    // View Published
    if (target.classList.contains('fn-action-view')) {
      handleViewPublished(target);
      return;
    }

    // Show in Folder
    if (target.classList.contains('fn-action-show-in-folder')) {
      const sheetId = target.dataset.sheetId;
      const folderId = target.dataset.folderId || null;
      await showInFolder(sheetId, folderId);
      return;
    }

    // Export
    if (target.classList.contains('fn-action-export')) {
      const sheetIds = await collectSheetIdsFromSelection();
      if (sheetIds.size > 0) onExport?.({ sheetIds });
      return;
    }

    // Copy
    if (target.classList.contains('fn-action-copy')) {
      enterCopyMode(target.dataset.sheetId, target.dataset.sheetName);
      return;
    }

    // Move
    if (target.classList.contains('fn-action-move')) {
      enterMoveMode();
      return;
    }

    // Delete
    if (target.classList.contains('fn-action-delete')) {
      await handleDeleteSelected();
      return;
    }

    // Open folder
    if (target.classList.contains('fn-action-open-folder')) {
      const folderId = target.dataset.folderId;
      if (folderId) navigateToFolder(folderId);
      return;
    }

    // Rename folder
    if (target.classList.contains('fn-action-rename-folder')) {
      const folderId = target.dataset.folderId;
      if (folderId) {
        const folder = getSelectedFolder();
        const newName = prompt('Enter new folder name:', folder?.name || '');
        if (newName && newName !== folder?.name) {
          await renameFolder(folderId, newName);
          clearSelection();
          await navigateToFolder(folderNav.getCurrentFolderId());
        }
      }
      return;
    }
  }

  async function loadSingleFunction(functionId) {
    try {
      const funcDef = await loadFunctionById(functionId);
      registerFunction({ [funcDef.name]: funcDef });
      loadedFunctions = getFunctionsWithMetadata?.() || [];
      missingFunctions = detectMissingFunctions(getNodeCalcData);
      updateLoadedBadge();
      renderCurrentView();
      renderDetailPanel();
      renderActionBar();
    } catch (err) {
      console.error('[FunctionsDialog] Failed to load function:', err);
    }
  }

  async function loadSelectedFunctions() {
    // Collect all sheet IDs, recursing into selected folders
    const allSheetIds = await collectSheetIdsFromSelection();

    // Resolve sheet data for each ID
    if (!allSheets.length) allSheets = await listSheets();
    const sheetsToLoad = [...allSheetIds].map(id =>
      treeItems.find(s => s.id === id) || allSheets.find(s => s.id === id)
    ).filter(Boolean);

    const functionsToRegister = {};
    for (const sheet of sheetsToLoad) {
      if (sheet.functionId && sheet.publishedVersion && !isLoaded(sheet.functionId)) {
        try {
          const funcDef = await loadFunctionById(sheet.functionId);
          functionsToRegister[funcDef.name] = funcDef;
        } catch (err) {
          console.error(`[FunctionsDialog] Failed to load ${sheet.name}:`, err);
        }
      }
    }

    if (Object.keys(functionsToRegister).length > 0) {
      registerFunction(functionsToRegister);
      loadedFunctions = getFunctionsWithMetadata?.() || [];
      missingFunctions = detectMissingFunctions(getNodeCalcData);
      updateLoadedBadge();
    }

    clearSelection();
    renderCurrentView();
    renderDetailPanel();
    renderActionBar();
  }

  function handleViewPublished(btn) {
    const functionId = btn.dataset.functionId;
    const versionId = btn.dataset.versionId || null;
    const functionName = btn.dataset.name;
    const versionString = btn.dataset.version;
    const sheetType = btn.dataset.sheetType || 'standard';

    if (functionId && onDrillDown) {
      close();
      onDrillDown({ functionId, versionId, functionName, versionString, sheetType });
    }
  }

  async function handleDeleteSelected() {
    if (deleteInProgress) return;

    const ids = [...selection];
    const types = ids.map(id => selectionTypes.get(id));
    const count = ids.length;

    const confirmMsg = count === 1
      ? `Delete this ${types[0]}?\n\nThis cannot be undone.`
      : `Delete ${count} items?\n\nThis cannot be undone.`;

    if (!confirm(confirmMsg)) return;

    deleteInProgress = true;
    const deleteBtn = actionBarEl?.querySelector('.fn-action-delete');
    if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.textContent = 'Deleting\u2026'; }

    // Partition by type
    const sheetIds = [];
    const scenarioIds = [];
    const folderIds = [];
    for (let i = 0; i < ids.length; i++) {
      if (types[i] === 'sheet') sheetIds.push(ids[i]);
      else if (types[i] === 'scenario') scenarioIds.push(ids[i]);
      else if (types[i] === 'folder') folderIds.push(ids[i]);
    }

    try {
      // Folders sequentially (each reads/mutates/writes the manifest)
      for (const id of folderIds) {
        await deleteFolderFn(id);
      }

      // Then batch-delete directly selected sheets and scenarios in parallel
      await Promise.all([
        sheetIds.length > 0 ? deleteSpreadsheetBatch(sheetIds) : Promise.resolve(),
        scenarioIds.length > 0 ? deleteScenarioBatch(scenarioIds) : Promise.resolve()
      ]);
    } catch (err) {
      alert(`Failed to delete: ${err.message}`);
    } finally {
      deleteInProgress = false;
    }

    clearSelection();
    currentView = 'tree';
    for (const [name, el] of Object.entries(tabEls)) {
      el?.classList.toggle('active', name === 'tree');
    }
    await navigateToFolder(folderNav.getCurrentFolderId());
  }

  /** Handle clicks in the loaded view (unload, find, view, rename, sync) */
  function handleLoadedViewClick(e) {
    const target = e.target.closest('button');
    if (!target) return;

    // Unload
    if (target.classList.contains('fn-unload-btn')) {
      const name = target.dataset.name;
      if (name && unregisterFunction) {
        unregisterFunction(name);
        loadedFunctions = getFunctionsWithMetadata?.() || [];
        missingFunctions = detectMissingFunctions(getNodeCalcData);
        updateLoadedBadge();
        renderLoadedView();
      }
      return;
    }

    // Find missing function
    if (target.classList.contains('custom-func-find-btn')) {
      const name = target.dataset.name;
      if (name) {
        searchTerm = name;
        switchView('search');
      }
      return;
    }

    // View published
    if (target.classList.contains('fn-view-btn')) {
      handleViewPublished(target);
      return;
    }

    // Rename consumer function
    if (target.classList.contains('fn-rename-btn')) {
      handleRenameFunction(target.dataset.name, target.dataset.functionId);
      return;
    }

    // Sync name to canonical
    if (target.classList.contains('fn-sync-name-btn')) {
      handleRenameFunctionTo(target.dataset.name, target.dataset.canonical, target.dataset.functionId);
      return;
    }
  }

  function handleRenameFunction(currentName, functionId) {
    const newName = prompt('Rename function to:', currentName);
    if (!newName || newName === currentName) return;

    const normalized = newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!normalized) return;

    // Check for conflicts with other loaded functions
    const conflict = loadedFunctions.find(f => f.name === normalized && f.id !== functionId);
    if (conflict) {
      alert(`A function named ${normalized} is already loaded.`);
      return;
    }

    executeRename(currentName, normalized);
  }

  function handleRenameFunctionTo(currentName, newName, functionId) {
    if (currentName === newName) return;

    // Check for conflicts
    const conflict = loadedFunctions.find(f => f.name === newName && f.id !== functionId);
    if (conflict) {
      alert(`A function named ${newName} is already loaded.`);
      return;
    }

    executeRename(currentName, newName);
  }

  function executeRename(oldName, newName) {
    if (!unregisterFunction || !registerFunction || !loadFunctionById) return;

    // Find the function to get its funcDef before unregistering
    const func = loadedFunctions.find(f => f.name === oldName);
    if (!func) return;

    // Warn about formula impact
    const proceed = confirm(`Rename "${oldName}" to "${newName}"?\n\nFormulas using ${oldName} will need to be updated to ${newName}.`);
    if (!proceed) return;

    // Load first, then swap — so a failed load doesn't lose the function
    loadFunctionById(func.id).then(funcDef => {
      unregisterFunction(oldName);
      registerFunction({ [newName]: funcDef });
      loadedFunctions = getFunctionsWithMetadata?.() || [];
      renderLoadedView();
    }).catch(err => {
      console.error('[FunctionsDialog] Rename failed:', err);
      alert(`Rename failed: ${err.message}`);
    });
  }

  /** Handle clicks in move/copy folder picker (folder navigation) */
  async function handlePickerViewClick(e) {
    const target = e.target;

    // Breadcrumb
    if (target.classList.contains('tree-breadcrumb-item') && target.classList.contains('clickable')) {
      const folderId = target.dataset.folderId || null;
      await navigatePickerToFolder(folderId);
      return;
    }

    // Open folder
    if (target.classList.contains('tree-btn-open') && target.dataset.folderId) {
      await navigatePickerToFolder(target.dataset.folderId);
      return;
    }
  }

  // ============================================================================
  // DELEGATED CLICK HANDLER
  // ============================================================================

  async function handleDialogClick(e) {
    // Close button
    if (e.target.classList.contains('dialog-close-btn')) {
      close();
      return;
    }

    // Tab clicks
    handleTabClick(e);

    // Move/copy mode clicks (folder picker navigation)
    if (moveMode || copyMode) {
      handlePickerViewClick(e);
      return;
    }

    // Detail panel: collapsible card toggle
    const toggle = e.target.closest('.fn-detail-card-toggle');
    if (toggle) {
      const card = toggle.closest('.fn-detail-collapsible');
      if (card) card.classList.toggle('fn-detail-collapsed');
      return;
    }

    // Detail panel: dependency link — navigate to that sheet
    const depLink = e.target.closest('.fn-detail-dep-link');
    if (depLink) {
      e.preventDefault();
      const sheetId = depLink.dataset.sheetId;
      const folderId = depLink.dataset.folderId || null;
      if (sheetId) await showInFolder(sheetId, folderId);
      return;
    }

    // Detail panel: scenario link — open scenario
    const scenarioLink = e.target.closest('.fn-detail-scenario-link');
    if (scenarioLink) {
      e.preventDefault();
      const scenarioId = scenarioLink.dataset.scenarioId;
      if (scenarioId) { close(); onOpenScenario?.(scenarioId); }
      return;
    }

    // Detail panel: new scenario analysis
    const newScenarioLink = e.target.closest('.fn-detail-new-scenario');
    if (newScenarioLink) {
      e.preventDefault();
      const functionId = newScenarioLink.dataset.functionId;
      const functionName = newScenarioLink.dataset.functionName;
      const folderId = newScenarioLink.dataset.folderId || null;
      if (functionId && createScenario) {
        const name = prompt('Scenario name:', `${functionName} Analysis`);
        if (!name) return;
        try {
          const scenarioId = await createScenario(name, functionId, functionName, folderId);
          close();
          onOpenScenario?.(scenarioId);
        } catch (err) {
          alert(`Failed to create scenario: ${err.message}`);
        }
      }
      return;
    }

    // Type group header toggle
    const groupHeader = e.target.closest('.fn-type-group-header');
    if (groupHeader) {
      const type = groupHeader.dataset.groupType;
      const group = groupHeader.closest('.fn-type-group');
      if (collapsedGroups.has(type)) {
        collapsedGroups.delete(type);
        group?.classList.remove('fn-type-group-collapsed');
      } else {
        collapsedGroups.add(type);
        group?.classList.add('fn-type-group-collapsed');
      }
      // Update chevron
      const chevron = groupHeader.querySelector('.fn-type-group-chevron');
      if (chevron) chevron.textContent = collapsedGroups.has(type) ? '\u25B6' : '\u25BC';
      return;
    }

    // Action bar clicks
    if (e.target.closest('.fn-action-bar')) {
      handleActionBarClick(e);
      return;
    }

    // Loaded view clicks
    if (currentView === 'loaded') {
      handleLoadedViewClick(e);
      return;
    }

    // Tree view: folder operation clicks
    if (currentView === 'tree' && folderClickHandler) {
      const handled = await folderClickHandler(e);
      if (handled) {
        // Folder handler navigates, which triggers re-render
        return;
      }
    }

    // Row click (selection)
    handleRowClick(e);
  }

  function handleDialogChange(e) {
    if (e.target.classList.contains('fn-sort-select')) {
      const newSort = e.target.value;
      if (newSort !== sortMode) {
        sortMode = newSort;
        renderCurrentView();
      }
    }
    if (e.target.classList.contains('fn-group-type-checkbox')) {
      groupByType = e.target.checked;
      renderCurrentView();
    }
  }

  function handleDialogDblClick(e) {
    if (moveMode || copyMode) return;
    if (currentView === 'loaded') return;
    handleRowDoubleClick(e);
  }

  /** Dismiss + New dropdown when clicking outside */
  function handleDocumentClick(e) {
    if (newDropdownEl && !newDropdownEl.contains(e.target)) {
      const menu = newDropdownEl.querySelector('.fn-new-menu');
      if (menu) menu.hidden = true;
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  async function open(options = {}) {
    if (!dialog) {
      console.error('[FunctionsDialog] Not mounted');
      return;
    }

    // Reset state
    clearSelection();
    searchTerm = '';
    moveMode = false;
    moveItemIds = [];
    copyMode = false;
    copySheetId = null;
    copySheetName = null;

    // Load initial data
    loadedFunctions = getFunctionsWithMetadata?.() || [];
    missingFunctions = detectMissingFunctions(getNodeCalcData);
    updateLoadedBadge();
    allSheets = await listSheets();
    allScenarios = listScenarios
      ? (await listScenarios()).map(s => ({ ...s, type: 'scenario' }))
      : [];

    dialog.showModal();

    // Enter copy mode if requested
    if (options.copyMode && options.copySheetId) {
      enterCopyMode(options.copySheetId, options.copySheetName || 'Sheet');
      return;
    }

    const tab = options.tab || 'tree';
    currentView = tab;

    // Update tab states
    for (const [name, el] of Object.entries(tabEls)) {
      el?.classList.toggle('active', name === tab);
    }

    if (tab === 'tree') {
      folderNav.reset();
      await navigateToFolder(null);
    } else {
      renderCurrentView();
    }

    renderDetailPanel();
    renderActionBar();
  }

  function close() {
    if (!dialog) return;
    if (examplesLoading.size > 0 || deleteInProgress) return;
    clearTimeout(detailSaveTimeout);
    clearTimeout(handleSearchInput._timeout);
    dialog.close();
  }

  function mount() {
    if (dialog) return;  // Already mounted
    const loadedBadge = '<span class="fn-loaded-badge"></span>';

    dialog = mountDialog('fn-dialog', 'fn-dialog', `
      <div class="dialog-header">
        <div class="fn-tabs dialog-tabs">
          <button type="button" class="fn-tab active" data-view="tree">File Tree</button>
          <button type="button" class="fn-tab" data-view="recents">Recents</button>
          <button type="button" class="fn-tab" data-view="search">Search</button>
          <button type="button" class="fn-tab" data-view="loaded">Loaded${loadedBadge}</button>
          <button type="button" class="fn-tab" data-view="examples">Examples</button>
        </div>
        <button type="button" class="dialog-close-btn" aria-label="Close" title="Close">&times;</button>
      </div>

      <div class="fn-dialog-body">
        <div class="fn-dialog-main">
          <div class="fn-view-container"></div>
        </div>
        <div class="fn-dialog-detail"></div>
      </div>

      <div class="fn-action-bar"></div>
    `, close);

    // Cache references
    tabEls = {
      tree: dialog.querySelector('.fn-tab[data-view="tree"]'),
      recents: dialog.querySelector('.fn-tab[data-view="recents"]'),
      search: dialog.querySelector('.fn-tab[data-view="search"]'),
      loaded: dialog.querySelector('.fn-tab[data-view="loaded"]'),
      examples: dialog.querySelector('.fn-tab[data-view="examples"]'),
    };
    viewContainerEl = dialog.querySelector('.fn-view-container');
    detailPanelEl = dialog.querySelector('.fn-dialog-detail');
    actionBarEl = dialog.querySelector('.fn-action-bar');
    breadcrumbEl = null;  // Created dynamically in tree view

    // Event listeners
    dialog.addEventListener('click', handleDialogClick);
    dialog.addEventListener('dblclick', handleDialogDblClick);
    dialog.addEventListener('change', handleDialogChange);
    dialog.addEventListener('cancel', (e) => {
      if (examplesLoading.size > 0 || deleteInProgress) e.preventDefault();
    });
    document.addEventListener('click', handleDocumentClick);

    console.log('[FunctionsDialog] Mounted');
  }

  function unmount() {
    if (dialog) {
      dialog.removeEventListener('click', handleDialogClick);
      dialog.removeEventListener('dblclick', handleDialogDblClick);
      dialog.removeEventListener('change', handleDialogChange);
      document.removeEventListener('click', handleDocumentClick);
    }
    dialog = null;
    tabEls = {};
    viewContainerEl = null;
    detailPanelEl = null;
    actionBarEl = null;
    breadcrumbEl = null;
    searchInputEl = null;
    newDropdownEl = null;
    folderNav = null;
    folderClickHandler = null;
  }

  return {
    init(deps) {
      ({
        listSheets,
        listFolderContents,
        getFolderPath,
        deleteSpreadsheetBatch,
        updateSheetMetadata,
        moveSheetToFolder,
        moveFolderToFolder,
        getCurrentSheetId,
        onOpen,
        onNewStandard,
        onNewLoop,
        onOpenScenario,
        listScenarios,
        deleteScenarioBatch,
        moveScenarioToFolder,
        createScenario,
        createFolder,
        renameFolder,
        deleteFolder: deleteFolderFn,
        loadFunctionById,
        registerFunction,
        getFunctionsWithMetadata,
        unregisterFunction,
        getNodeCalcData,
        onDrillDown,
        onExport,
        onImport,
        onImportFromUrl,
        duplicateSpreadsheet,
        createDraftFromPublished,
      } = deps);

      folderNav = createFolderNavigation({
        listFolderContents,
        getFolderPath,
      });

      folderClickHandler = createFolderOperationHandler({
        createFolder,
        renameFolder,
        deleteFolder: deleteFolderFn,
        getCurrentFolderId: () => folderNav.getCurrentFolderId(),
        refreshCurrentFolder: () => navigateToFolder(folderNav.getCurrentFolderId()),
        navigateToFolder,
      });

      console.log('[FunctionsDialog] Initialized');
    },

    mount,
    unmount,
    open,
    close,

    /** Refresh the dialog's data and re-render if open. Call after external state changes. */
    async refresh() {
      if (!dialog || !dialog.open) return;
      loadedFunctions = getFunctionsWithMetadata?.() || [];
      missingFunctions = detectMissingFunctions(getNodeCalcData);
      updateLoadedBadge();

      // Tree view caches folder contents — re-fetch before re-rendering.
      // navigateToFolder handles its own render calls.
      if (currentView === 'tree' && folderNav) {
        await navigateToFolder(folderNav.getCurrentFolderId());
      } else {
        renderCurrentView();
        renderDetailPanel();
        renderActionBar();
      }
    },
  };
}
