/**
 * LANGUAGE PACK LIST DIALOG
 * =========================
 * Dialog for managing language packs: view, create, import, export, delete.
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';

export function createLanguagePackListDialog() {
  let languagePackEngine = null;
  let onEditPack = null;

  // DOM references
  let dialog = null;
  let listContainer = null;
  let fileInput = null;

  function init(deps) {
    languagePackEngine = deps.languagePackEngine;
    onEditPack = deps.onEditPack || (() => {});
  }

  function mount() {
    dialog = mountDialog('lang-pack-list-dialog', 'lang-pack-list-dialog', `
      ${dialogHeaderHTML('Language Packs')}
      <div class="lang-pack-list-body">
        <div class="lang-pack-list-items"></div>
        <div class="lang-pack-list-footer">
          <button type="button" class="btn-action lang-pack-new">+ New Pack</button>
          <button type="button" class="btn-action lang-pack-import">Import Pack...</button>
        </div>
      </div>
      <input type="file" class="lang-pack-file-input" accept=".json" hidden>
    `, handleClose);

    dialog.querySelector('.dialog-close-btn')?.addEventListener('click', handleClose);
    listContainer = dialog.querySelector('.lang-pack-list-items');

    dialog.querySelector('.lang-pack-new')?.addEventListener('click', handleNewPack);
    dialog.querySelector('.lang-pack-import')?.addEventListener('click', handleImportClick);

    fileInput = dialog.querySelector('.lang-pack-file-input');
    fileInput?.addEventListener('change', handleImportFile);

    listContainer.addEventListener('click', handleListAction);
  }

  function unmount() {
    dialog = null;
    listContainer = null;
    fileInput = null;
  }

  async function open() {
    if (!dialog) return;
    await renderList();
    dialog.showModal();
  }

  function handleClose() {
    if (dialog) dialog.close();
  }

  async function renderList() {
    if (!listContainer) return;

    const packs = await languagePackEngine.listPacks();
    listContainer.innerHTML = '';

    for (const pack of packs) {
      const row = document.createElement('div');
      row.className = 'lang-pack-row';

      const info = document.createElement('div');
      info.className = 'lang-pack-row-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'lang-pack-row-name';
      nameSpan.textContent = pack.name;
      info.appendChild(nameSpan);

      if (pack.isBuiltin) {
        const badge = document.createElement('span');
        badge.className = 'lang-pack-builtin-badge';
        badge.textContent = '(built-in)';
        info.appendChild(badge);
      }

      if (pack.description) {
        const desc = document.createElement('div');
        desc.className = 'lang-pack-row-desc';
        desc.textContent = pack.description;
        info.appendChild(desc);
      }

      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'lang-pack-actions';

      if (pack.isBuiltin) {
        actions.appendChild(makeBtn('View', 'view', pack.id));
      } else {
        actions.appendChild(makeBtn('Edit', 'edit', pack.id));
        actions.appendChild(makeBtn('Export', 'export', pack.id));
        actions.appendChild(makeBtn('Delete', 'delete', pack.id));
      }

      row.appendChild(actions);
      listContainer.appendChild(row);
    }
  }

  function makeBtn(label, action, packId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action';
    btn.textContent = label;
    btn.dataset.packAction = action;
    btn.dataset.packId = packId;
    return btn;
  }

  async function handleListAction(e) {
    const btn = e.target.closest('[data-pack-action]');
    if (!btn) return;

    const action = btn.dataset.packAction;
    const packId = btn.dataset.packId;

    switch (action) {
      case 'view':
        onEditPack(packId, true);
        break;
      case 'edit':
        onEditPack(packId, false);
        break;
      case 'export':
        await handleExport(packId);
        break;
      case 'delete':
        await handleDelete(packId);
        break;
    }
  }

  async function handleExport(packId) {
    try {
      const packData = await languagePackEngine.loadPack(packId);
      const json = languagePackEngine.exportPack(packData);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${packData.meta.name.toLowerCase().replace(/\s+/g, '-')}-language-pack.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  }

  async function handleDelete(packId) {
    if (!confirm('Delete this language pack?')) return;
    try {
      await languagePackEngine.deletePack(packId);
      await renderList();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function handleNewPack() {
    const name = prompt('Language pack name:');
    if (!name) return;

    const existingPacks = await languagePackEngine.listPacks();
    if (existingPacks.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert(`A language pack named "${name}" already exists.`);
      return;
    }

    try {
      const id = crypto.randomUUID();
      const syntax = languagePackEngine.getBuiltinSyntaxSource();
      const functions = languagePackEngine.getBuiltinFunctionsData();
      const meta = {
        name,
        description: '',
        fileExtension: '.txt'
      };

      const overrides = languagePackEngine.getDefaultOverridesSource();
      await languagePackEngine.savePack(id, { syntax, functions, overrides, meta });
      await renderList();
      onEditPack(id, false);
    } catch (e) {
      alert('Failed to create pack: ' + e.message);
    }
  }

  function handleImportClick() {
    fileInput?.click();
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    fileInput.value = '';

    try {
      const text = await file.text();
      const packData = languagePackEngine.importPack(text);

      const existingPacks = await languagePackEngine.listPacks();
      const duplicate = existingPacks.find(p => p.name.toLowerCase() === packData.meta.name.toLowerCase());
      if (duplicate) {
        if (!confirm(`A language pack named "${packData.meta.name}" already exists. Import anyway?`)) return;
      }

      await languagePackEngine.savePack(packData.id, {
        syntax: packData.syntax,
        functions: packData.functions,
        overrides: packData.overrides,
        meta: packData.meta
      });
      await renderList();
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  }

  return {
    init,
    mount,
    unmount,
    open
  };
}
