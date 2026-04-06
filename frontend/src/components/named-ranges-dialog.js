/**
 * NAMED RANGES DIALOG
 * ===================
 *
 * Management dialog for viewing, renaming, and deleting named ranges.
 * Opened from File menu > "Named Ranges..."
 *
 * Features:
 * - Lists all named ranges with their cell/range notation
 * - Inline rename (click Rename, name becomes input, Enter/blur saves, Escape cancels)
 * - Delete with confirmation
 * - Empty state when no named ranges exist
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';

export function createNamedRangesDialog() {
  // Dependencies (injected via init)
  let getAllNamedRanges = null;
  let renameNamedRange = null;
  let deleteNamedRange = null;
  let onRefreshNamedRangeDisplay = null;

  // DOM references
  let dialog = null;
  let listEl = null;

  // State
  let editingName = null; // Name currently being edited, or null

  function renderList() {
    const ranges = getAllNamedRanges();

    if (ranges.length === 0) {
      listEl.innerHTML = '<div class="tree-empty">No named ranges defined.</div>';
      return;
    }

    listEl.innerHTML = ranges.map(({ name, notation }) => {
      if (name === editingName) {
        return `
          <div class="tree-item nr-item" data-name="${name}">
            <div class="tree-item-info">
              <input class="nr-rename-input" value="${name}" data-original="${name}" />
              <span class="nr-notation">${notation}</span>
            </div>
            <div class="tree-item-actions">
              <button class="tree-btn nr-save-btn">Save</button>
              <button class="tree-btn nr-cancel-btn">Cancel</button>
            </div>
          </div>`;
      }
      return `
        <div class="tree-item nr-item" data-name="${name}">
          <div class="tree-item-info">
            <span class="tree-item-name">${name}</span>
            <span class="nr-notation">${notation}</span>
          </div>
          <div class="tree-item-actions">
            <button class="tree-btn nr-rename-btn">Rename</button>
            <button class="tree-btn-icon tree-btn-delete nr-delete-btn" title="Delete">&times;</button>
          </div>
        </div>`;
    }).join('');

    // If editing, focus the input
    if (editingName) {
      const input = listEl.querySelector('.nr-rename-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  function commitRename(input) {
    const oldName = input.dataset.original;
    const newName = input.value.trim();

    if (!newName || newName === oldName) {
      editingName = null;
      renderList();
      return;
    }

    const result = renameNamedRange(oldName, newName);
    if (!result.success) {
      // Show inline error
      const item = input.closest('.nr-item');
      let errorEl = item.querySelector('.nr-error');
      if (!errorEl) {
        errorEl = document.createElement('span');
        errorEl.className = 'nr-error';
        item.querySelector('.tree-item-info').appendChild(errorEl);
      }
      errorEl.textContent = result.error;
      input.focus();
      return;
    }

    editingName = null;
    renderList();
    onRefreshNamedRangeDisplay();
  }

  function cancelRename() {
    editingName = null;
    renderList();
  }

  function handleClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.classList.contains('dialog-close-btn')) {
      close();
      return;
    }

    const item = btn.closest('.nr-item');
    if (!item) return;

    const name = item.dataset.name;

    if (btn.classList.contains('nr-rename-btn')) {
      editingName = name;
      renderList();
    } else if (btn.classList.contains('nr-save-btn')) {
      const input = item.querySelector('.nr-rename-input');
      if (input) commitRename(input);
    } else if (btn.classList.contains('nr-cancel-btn')) {
      cancelRename();
    } else if (btn.classList.contains('nr-delete-btn')) {
      if (!confirm(`Delete named range "${name}"?`)) return;
      deleteNamedRange(name);
      editingName = null;
      renderList();
      onRefreshNamedRangeDisplay();
    }
  }

  function handleKeydown(e) {
    if (e.target.classList.contains('nr-rename-input')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename(e.target);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
    }
  }

  function handleBlur(e) {
    if (e.target.classList.contains('nr-rename-input')) {
      // Use setTimeout so click on Save/Cancel fires before blur commits
      setTimeout(() => {
        if (editingName !== null) {
          commitRename(e.target);
        }
      }, 100);
    }
  }

  function open() {
    editingName = null;
    renderList();
    dialog.showModal();
  }

  function close() {
    dialog.close();
  }

  return {
    init(deps) {
      ({ getAllNamedRanges, renameNamedRange, deleteNamedRange, onRefreshNamedRangeDisplay } = deps);
    },

    mount() {
      const html = `
        ${dialogHeaderHTML('Named Ranges')}
        <div class="dialog-body nr-dialog-body">
          <div class="tree-list nr-list"></div>
        </div>`;

      dialog = mountDialog('named-ranges-dialog', 'named-ranges-dialog', html, close);
      listEl = dialog.querySelector('.nr-list');

      dialog.addEventListener('click', handleClick);
      dialog.addEventListener('keydown', handleKeydown);
      dialog.addEventListener('focusout', handleBlur);
    },

    unmount() {
      if (dialog) {
        dialog.removeEventListener('click', handleClick);
        dialog.removeEventListener('keydown', handleKeydown);
        dialog.removeEventListener('focusout', handleBlur);
        dialog.remove();
        dialog = null;
        listEl = null;
      }
    },

    open,
    close,
  };
}
