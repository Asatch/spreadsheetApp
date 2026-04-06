/**
 * @file Tree Renderer Utilities
 * @description Shared rendering functions for folder/item tree UIs.
 * Used by functions-dialog and other dialog components.
 */

/**
 * Escape HTML to prevent XSS.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

/**
 * Format a date for display.
 * @param {string} isoString - ISO date string
 * @returns {string} Formatted date (e.g., "Jan 15, 2024")
 */
export function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Render breadcrumb HTML from a folder path.
 * @param {Array<{id: string|null, name: string}>} path - Folder path from root to current
 * @returns {string} HTML string
 */
export function renderBreadcrumb(path) {
  return path.map((item, index) => {
    const isLast = index === path.length - 1;
    const name = escapeHtml(item.name);

    if (isLast) {
      return `<span class="tree-breadcrumb-item current">${name}</span>`;
    }

    return `<span class="tree-breadcrumb-item clickable" data-folder-id="${escapeHtml(item.id || '')}">${name}</span>`;
  }).join('<span class="tree-breadcrumb-sep">/</span>');
}

/**
 * Render a folder item.
 * @param {Object} folder - Folder data
 * @param {string} folder.id - Folder ID
 * @param {string} folder.name - Folder name
 * @param {Object} [options] - Render options
 * @param {boolean} [options.showCheckbox=false] - Show selection checkbox
 * @param {boolean} [options.showRename=true] - Show rename button
 * @param {boolean} [options.showDelete=true] - Show delete button
 * @param {boolean} [options.checked=false] - Checkbox checked state
 * @returns {string} HTML string
 */
export function renderFolderItem(folder, options = {}) {
  const {
    showCheckbox = false,
    showRename = true,
    showDelete = true,
    checked = false
  } = options;

  const safeId = escapeHtml(folder.id);

  const checkboxHtml = showCheckbox
    ? `<label class="tree-item-checkbox">
        <input type="checkbox" data-folder-id="${safeId}" ${checked ? 'checked' : ''}>
       </label>`
    : '';

  const renameBtn = showRename
    ? `<button type="button" class="tree-btn-icon tree-btn-rename" data-folder-id="${safeId}" title="Rename">&#9998;</button>`
    : '';

  const deleteBtn = showDelete
    ? `<button type="button" class="tree-btn-icon tree-btn-delete" data-folder-id="${safeId}" title="Delete">&times;</button>`
    : '';

  return `
    <div class="tree-item tree-folder-item" data-folder-id="${safeId}">
      ${checkboxHtml}
      <div class="tree-item-info">
        <div class="tree-item-name">
          <span class="tree-folder-icon">📁</span>
          ${escapeHtml(folder.name)}
        </div>
      </div>
      <div class="tree-item-actions">
        ${renameBtn}
        <button type="button" class="tree-btn tree-btn-open" data-folder-id="${safeId}">Open</button>
        ${deleteBtn}
      </div>
    </div>
  `;
}

/**
 * Render a sheet item in the file browser.
 * @param {Object} sheet - Sheet data
 * @param {string} sheet.id - Sheet ID
 * @param {string} sheet.name - Sheet name
 * @param {string} sheet.type - Sheet type ('standard' or 'loop')
 * @param {string} [sheet.updatedAt] - Last updated date
 * @param {boolean} [sheet.hasUnpublishedChanges] - Has unpublished changes
 * @param {string} [sheet.functionId] - Published function ID
 * @param {Object} [sheet.publishedVersion] - Published version info
 * @param {Object} [options] - Render options
 * @param {boolean} [options.showCheckbox=false] - Show selection checkbox
 * @param {boolean} [options.showOpen=true] - Show open button
 * @param {boolean} [options.showDelete=true] - Show delete button
 * @param {boolean} [options.checked=false] - Checkbox checked state
 * @returns {string} HTML string
 */
export function renderSheetItem(sheet, options = {}) {
  const {
    showCheckbox = false,
    showOpen = true,
    showDelete = true,
    checked = false
  } = options;

  const safeId = escapeHtml(sheet.id);

  const checkboxHtml = showCheckbox
    ? `<label class="tree-item-checkbox">
        <input type="checkbox" data-spreadsheet-id="${safeId}" ${checked ? 'checked' : ''}>
       </label>`
    : '';

  const openBtn = showOpen
    ? `<button type="button" class="tree-btn tree-btn-open" data-spreadsheet-id="${safeId}">Open</button>`
    : '';

  const deleteBtn = showDelete
    ? `<button type="button" class="tree-btn-icon tree-btn-delete" data-spreadsheet-id="${safeId}" title="Delete">&times;</button>`
    : '';

  const typeBadge = `<span class="tree-type-badge tree-type-${sheet.type}">${sheet.type}</span>`;
  const dateMeta = sheet.updatedAt ? `<span>${formatDate(sheet.updatedAt)}</span>` : '';
  const published = sheet.functionId && sheet.publishedVersion;
  const publishedBadge = published ? '<span class="tree-status-published">Published</span>' : '';
  const unpublishedBadge = sheet.hasUnpublishedChanges ? '<span class="tree-status-unpublished">Unpublished changes</span>' : '';

  return `
    <div class="tree-item tree-spreadsheet-item" data-spreadsheet-id="${safeId}">
      ${checkboxHtml}
      <div class="tree-item-info">
        <div class="tree-item-name">${escapeHtml(sheet.name)}</div>
        <div class="tree-item-meta">
          ${typeBadge}
          ${dateMeta}
          ${publishedBadge}
          ${unpublishedBadge}
        </div>
      </div>
      <div class="tree-item-actions">
        ${openBtn}
        ${deleteBtn}
      </div>
    </div>
  `;
}

/**
 * Render empty state message.
 * @param {string} message - Main message
 * @param {string} [hint] - Optional hint text
 * @returns {string} HTML string
 */
export function renderEmptyState(message, hint = '') {
  return `
    <div class="tree-empty">
      <p>${escapeHtml(message)}</p>
      ${hint ? `<p class="tree-empty-hint">${escapeHtml(hint)}</p>` : ''}
    </div>
  `;
}

/**
 * Render a selectable sheet row for the functions dialog.
 * Used in File Tree, Recents, and Search views.
 *
 * @param {Object} sheet - Sheet data
 * @param {Object} [options]
 * @param {boolean} [options.selected=false] - Whether the row is selected
 * @param {string} [options.folderPath] - Folder path string (shown in flat views)
 * @param {boolean} [options.isCurrent=false] - Whether this is the currently-open sheet
 * @param {number} [options.depthBadge] - Dependency depth to show as badge (undefined = hidden)
 * @returns {string} HTML string
 */
export function renderSelectableRow(item, options = {}) {
  const { selected = false, folderPath, isCurrent = false, depthBadge } = options;
  const pathHtml = folderPath ? `<span class="fn-row-path">${escapeHtml(folderPath)}</span>` : '';
  const typeBadge = `<span class="tree-type-badge tree-type-${item.type}">${item.type}</span>`;

  if (item.type === 'scenario') {
    const subtitle = item.functionName
      ? `<span class="fn-row-function-name">${escapeHtml(item.functionName)}</span>`
      : '';

    return `
      <div class="tree-item fn-row${selected ? ' tree-item-selected' : ''}"
           data-sheet-id="${escapeHtml(item.id)}" data-item-type="scenario">
        <div class="tree-item-info">
          <div class="tree-item-name">${escapeHtml(item.name)}</div>
          <div class="tree-item-meta">
            ${typeBadge}
            ${subtitle}
            ${pathHtml}
          </div>
        </div>
      </div>
    `;
  }

  // Sheet rendering (standard/loop)
  const published = item.functionId && item.publishedVersion;
  const versionInfo = published
    ? `<span class="tree-version">v${item.publishedVersion.versionString || '1.0'}</span>`
    : '<span class="tree-status-unpublished">unpublished</span>';

  // For published functions, show the published name (the interface name)
  const displayName = published
    ? (item.publishedVersion.publishedName || item.name)
    : item.name;

  // When draft name differs from published name, show an indicator
  const nameChanged = published && item.name !== displayName;
  const draftNameHtml = nameChanged
    ? `<span class="tree-draft-name-indicator" title="Draft name: ${escapeHtml(item.name)}">*</span>`
    : '';

  const depthHtml = depthBadge !== undefined
    ? `<span class="fn-depth-badge" title="Dependency depth">${depthBadge}</span>`
    : '';

  return `
    <div class="tree-item fn-row${selected ? ' tree-item-selected' : ''}${isCurrent ? ' tree-item-current' : ''}"
         data-sheet-id="${escapeHtml(item.id)}" data-item-type="sheet">
      ${depthHtml}
      <div class="tree-item-info">
        <div class="tree-item-name">${escapeHtml(displayName)}${draftNameHtml} ${versionInfo}</div>
        <div class="tree-item-meta">
          ${typeBadge}
          ${pathHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a selectable folder row for the functions dialog.
 *
 * @param {Object} folder - Folder data
 * @param {Object} [options]
 * @param {boolean} [options.selected=false] - Whether the row is selected
 * @returns {string} HTML string
 */
export function renderSelectableFolderRow(folder, options = {}) {
  const { selected = false } = options;

  return `
    <div class="tree-item fn-row${selected ? ' tree-item-selected' : ''}"
         data-folder-id="${escapeHtml(folder.id)}" data-item-type="folder">
      <div class="tree-item-info">
        <div class="tree-item-name">
          <span class="tree-folder-icon">\u{1F4C1}</span>
          ${escapeHtml(folder.name)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a tree toolbar with breadcrumb and optional new folder button.
 * @param {Array<{id: string|null, name: string}>} path - Folder path
 * @param {Object} [options] - Options
 * @param {boolean} [options.showNewFolder=true] - Show new folder button
 * @returns {string} HTML string
 */
export function renderTreeToolbar(path, options = {}) {
  const { showNewFolder = true } = options;

  const newFolderBtn = showNewFolder
    ? '<button type="button" class="tree-new-folder-btn">+ New Folder</button>'
    : '';

  return `
    <div class="tree-toolbar">
      <div class="tree-breadcrumb">${renderBreadcrumb(path)}</div>
      ${newFolderBtn}
    </div>
  `;
}
