/**
 * @file Folder Operation Handlers
 * @description Reusable delegated click handler for folder CRUD operations.
 * Extracts the duplicated folder click handling from dialogs into a single utility.
 */

/**
 * Extract folder name from a .tree-folder-item element, excluding the icon span.
 */
function getFolderName(itemEl) {
  const nameEl = itemEl.querySelector('.tree-item-name');
  if (!nameEl) return '';
  const clone = nameEl.cloneNode(true);
  const icon = clone.querySelector('.tree-folder-icon');
  if (icon) icon.remove();
  return clone.textContent.trim();
}

/**
 * Creates a delegated click handler for folder operations (create, rename, delete, open).
 *
 * @param {Object} deps
 * @param {Function} deps.createFolder - (name, parentId) => Promise
 * @param {Function} deps.renameFolder - (folderId, newName) => Promise
 * @param {Function} deps.deleteFolder - (folderId) => Promise
 * @param {Function} deps.getCurrentFolderId - () => string|null
 * @param {Function} deps.refreshCurrentFolder - () => Promise (re-renders current folder)
 * @param {Function} deps.navigateToFolder - (folderId) => Promise
 * @returns {Function} handleFolderClick(event) => Promise<boolean> — true if handled
 */
export function createFolderOperationHandler({
  createFolder,
  renameFolder,
  deleteFolder,
  getCurrentFolderId,
  refreshCurrentFolder,
  navigateToFolder,
}) {
  return async function handleFolderClick(e) {
    const target = e.target;

    // Breadcrumb navigation
    if (target.classList.contains('tree-breadcrumb-item') && target.classList.contains('clickable')) {
      const folderId = target.dataset.folderId || null;
      await navigateToFolder(folderId);
      return true;
    }

    // Open folder
    if (target.classList.contains('tree-btn-open') && target.dataset.folderId) {
      await navigateToFolder(target.dataset.folderId);
      return true;
    }

    // Rename folder
    if (target.classList.contains('tree-btn-rename') && target.dataset.folderId) {
      const item = target.closest('.tree-folder-item');
      if (item && renameFolder) {
        const currentName = getFolderName(item);
        const newName = prompt('Enter new folder name:', currentName);
        if (newName && newName !== currentName) {
          await renameFolder(target.dataset.folderId, newName);
          await refreshCurrentFolder();
        }
      }
      return true;
    }

    // Delete folder
    if (target.classList.contains('tree-btn-delete') && target.dataset.folderId) {
      const item = target.closest('.tree-folder-item');
      if (item && deleteFolder) {
        const folderName = getFolderName(item);
        if (confirm(`Delete folder "${folderName}" and all its contents?`)) {
          try {
            await deleteFolder(target.dataset.folderId);
            await refreshCurrentFolder();
          } catch (err) {
            alert(`Failed to delete folder: ${err.message}`);
          }
        }
      }
      return true;
    }

    // New folder button
    if (target.classList.contains('tree-new-folder-btn')) {
      if (createFolder) {
        const folderName = prompt('Enter folder name:');
        if (folderName) {
          await createFolder(folderName, getCurrentFolderId());
          await refreshCurrentFolder();
        }
      }
      return true;
    }

    return false;
  };
}
