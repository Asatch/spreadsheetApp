/**
 * @file Folder Navigation Utility
 * @description Shared logic for navigating folder structures in dialogs.
 * Used by functions-dialog and other dialog components.
 */

/**
 * Creates a folder navigation controller.
 * Manages current folder state and provides navigation helpers.
 *
 * @param {Object} options
 * @param {Function} options.listFolderContents - (manifestType, folderId) => Promise<{folders, items}>
 * @param {Function} options.getFolderPath - (manifestType, folderId) => Promise<Array<{id, name}>>
 * @param {Function} [options.onNavigate] - Called after navigation with (folderId, contents, path)
 * @returns {Object} Folder navigation controller
 */
export function createFolderNavigation({ listFolderContents, getFolderPath, onNavigate }) {
  let currentFolderId = null;

  /**
   * Navigate to a folder and get its contents.
   * @param {string|null} folderId - Target folder ID (null for root)
   * @returns {Promise<{contents: Object, path: Array}>}
   */
  async function navigateTo(folderId) {
    currentFolderId = folderId;

    const contents = listFolderContents
      ? await listFolderContents(folderId)
      : { folders: [], items: [] };

    const path = getFolderPath
      ? await getFolderPath(folderId)
      : [{ id: null, name: 'Home' }];

    if (onNavigate) {
      onNavigate(folderId, contents, path);
    }

    return { contents, path };
  }

  /**
   * Get the current folder ID.
   * @returns {string|null}
   */
  function getCurrentFolderId() {
    return currentFolderId;
  }

  /**
   * Reset navigation to root.
   */
  function reset() {
    currentFolderId = null;
  }

  /**
   * Refresh the current folder view.
   * @returns {Promise<{contents: Object, path: Array}>}
   */
  async function refresh() {
    return navigateTo(currentFolderId);
  }

  return {
    navigateTo,
    getCurrentFolderId,
    reset,
    refresh
  };
}