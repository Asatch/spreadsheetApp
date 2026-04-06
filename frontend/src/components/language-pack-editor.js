/**
 * LANGUAGE PACK EDITOR
 * ====================
 * Full-screen editor for language pack syntax objects and functions data,
 * with a live transpilation preview.
 *
 * The syntax tab has two view modes:
 *   - Sections: collapsible blocks (one per annotation) for focused editing
 *   - Raw: single textarea for bulk copy/paste
 */

import { mountDialog } from '../utils/dialogMount.js';

export function createLanguagePackEditor() {
  let languagePackEngine = null;
  let storageEngine = null;

  // DOM references
  let dialog = null;
  let nameInput = null;
  let saveBtn = null;
  let errorDisplay = null;
  let tabBtns = null;
  let textarea = null;
  let rawToolbar = null;
  let sectionsContainer = null;
  let settingsPanel = null;
  let previewSelect = null;
  let previewCode = null;
  let previewError = null;
  let coverageDisplay = null;

  // Settings fields
  let descInput = null;
  let extInput = null;

  // State
  let currentPackId = null;
  let isReadOnly = false;
  let referencePanel = null;
  let activeTab = 'syntax'; // 'syntax' | 'functions' | 'overrides' | 'settings' | 'reference'
  let syntaxSource = '';
  let syntaxSections = []; // [{ title, content }]
  let syntaxViewMode = 'sections'; // 'sections' | 'raw'
  let functionsJson = '';
  let overridesSource = '';
  let meta = { name: '', description: '', fileExtension: '.txt' };
  let dirty = false;
  let previewDebounceTimer = null;
  let selectedPreviewSheetId = null;

  function init(deps) {
    languagePackEngine = deps.languagePackEngine;
    storageEngine = deps.storageEngine;
  }

  function mount() {
    dialog = mountDialog('lang-pack-editor', 'lang-pack-editor', `
      <div class="lang-pack-editor-topbar">
        <input type="text" class="lang-pack-editor-name" placeholder="Pack name">
        <button type="button" class="btn-action lang-pack-editor-save">Save</button>
        <button type="button" class="dialog-close-btn" aria-label="Close" title="Close">&times;</button>
        <span class="lang-pack-editor-error"></span>
      </div>
      <div class="lang-pack-editor-layout">
        <div class="lang-pack-editor-left">
          <div class="lang-pack-editor-tabs">
            <button type="button" class="lang-pack-editor-tab active" data-tab="syntax">Syntax</button>
            <button type="button" class="lang-pack-editor-tab" data-tab="functions">Functions</button>
            <button type="button" class="lang-pack-editor-tab" data-tab="overrides">Overrides</button>
            <button type="button" class="lang-pack-editor-tab" data-tab="settings">Settings</button>
            <button type="button" class="lang-pack-editor-tab" data-tab="reference">Reference</button>
          </div>
          <div class="lang-pack-sections-toolbar lang-pack-raw-toolbar" hidden>
            <button type="button" class="lang-pack-sections-view-btn">Sections view</button>
          </div>
          <textarea class="lang-pack-editor-textarea" spellcheck="false"></textarea>
          <div class="lang-pack-syntax-sections" hidden></div>
          <div class="lang-pack-reference" hidden></div>
          <div class="lang-pack-editor-settings" hidden>
            <label>Description<textarea class="lang-pack-settings-desc" rows="2"></textarea></label>
            <label>File Extension<input type="text" class="lang-pack-settings-ext" placeholder=".py"></label>
          </div>
        </div>
        <div class="lang-pack-editor-right">
          <div class="lang-pack-preview-header">
            <span>Preview:</span>
            <select class="lang-pack-preview-select">
              <option value="">Select a sheet...</option>
            </select>
          </div>
          <pre class="lang-pack-preview-code"></pre>
          <div class="lang-pack-preview-error" hidden></div>
        </div>
      </div>
      <div class="lang-pack-editor-footer">
        <span class="lang-pack-coverage"></span>
      </div>
    `, handleClose);

    // Wire refs
    nameInput = dialog.querySelector('.lang-pack-editor-name');
    saveBtn = dialog.querySelector('.lang-pack-editor-save');
    errorDisplay = dialog.querySelector('.lang-pack-editor-error');
    tabBtns = dialog.querySelectorAll('.lang-pack-editor-tab');
    textarea = dialog.querySelector('.lang-pack-editor-textarea');
    rawToolbar = dialog.querySelector('.lang-pack-raw-toolbar');
    sectionsContainer = dialog.querySelector('.lang-pack-syntax-sections');
    referencePanel = dialog.querySelector('.lang-pack-reference');
    settingsPanel = dialog.querySelector('.lang-pack-editor-settings');
    previewSelect = dialog.querySelector('.lang-pack-preview-select');
    previewCode = dialog.querySelector('.lang-pack-preview-code');
    previewError = dialog.querySelector('.lang-pack-preview-error');
    coverageDisplay = dialog.querySelector('.lang-pack-coverage');
    descInput = dialog.querySelector('.lang-pack-settings-desc');
    extInput = dialog.querySelector('.lang-pack-settings-ext');

    // Events
    dialog.querySelector('.dialog-close-btn')?.addEventListener('click', handleClose);
    saveBtn.addEventListener('click', handleSave);
    textarea.addEventListener('input', handleTextareaInput);
    textarea.addEventListener('keydown', handleTabKey);
    rawToolbar.querySelector('.lang-pack-sections-view-btn')
      .addEventListener('click', () => setSyntaxViewMode('sections'));
    previewSelect.addEventListener('change', handlePreviewChange);
    descInput?.addEventListener('input', () => { dirty = true; meta.description = descInput.value; });
    extInput?.addEventListener('input', () => { dirty = true; meta.fileExtension = extInput.value; });
    nameInput.addEventListener('input', () => { dirty = true; meta.name = nameInput.value; });

    for (const btn of tabBtns) {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    }
  }

  function unmount() {
    clearTimeout(previewDebounceTimer);
    dialog = null;
    sectionsContainer = null;
  }

  async function open(packId, readOnly = false) {
    if (!dialog) return;
    currentPackId = packId;
    isReadOnly = readOnly;

    const packData = await languagePackEngine.loadPack(packId);
    syntaxSource = packData.syntax;
    syntaxSections = languagePackEngine.parseSections(syntaxSource);
    const funcsData = typeof packData.functions === 'string'
      ? JSON.parse(packData.functions)
      : packData.functions;
    functionsJson = JSON.stringify(funcsData, null, 2);
    overridesSource = packData.overrides;
    meta = { ...packData.meta };

    dirty = false;
    nameInput.value = meta.name;
    nameInput.readOnly = readOnly;
    saveBtn.hidden = readOnly;
    descInput.value = meta.description || '';
    descInput.readOnly = readOnly;
    extInput.value = meta.fileExtension || '.txt';
    extInput.readOnly = readOnly;
    errorDisplay.textContent = '';

    // Reset to sections view and force re-render
    syntaxViewMode = 'sections';
    sectionsContainer.innerHTML = '';
    switchTab('syntax');
    await populatePreviewSheets();
    updateCoverage();

    dialog.showModal();
  }

  function handleClose() {
    if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    clearTimeout(previewDebounceTimer);
    if (dialog) dialog.close();
  }

  // ── Syntax sections ───────────────────────────────────────────────

  function buildSectionHeader(title) {
    const pad = '─'.repeat(Math.max(1, 60 - title.length));
    return `\n  // ── ${title} ${pad}\n`;
  }

  function syncSectionsToSource() {
    dirty = true;
    syntaxSource = languagePackEngine.joinSections(syntaxSections);
    schedulePreview();
  }

  function addSection() {
    if (isReadOnly) return;
    const title = prompt('Section name:');
    if (!title?.trim()) return;

    syntaxSections.push({
      title: title.trim(),
      header: buildSectionHeader(title.trim()),
      content: ''
    });
    syncSectionsToSource();
    renderSyntaxSections();

    // Open the new section
    const allDetails = sectionsContainer.querySelectorAll('details');
    const last = allDetails[allDetails.length - 1];
    if (last) last.open = true;
  }

  function renameSection(index) {
    if (isReadOnly) return;
    const section = syntaxSections[index];
    const newTitle = prompt('Rename section:', section.title);
    if (!newTitle?.trim() || newTitle.trim() === section.title) return;

    syntaxSections[index] = {
      ...section,
      title: newTitle.trim(),
      header: buildSectionHeader(newTitle.trim())
    };
    syncSectionsToSource();
    renderSyntaxSections();
  }

  function deleteSection(index) {
    if (isReadOnly) return;
    if (index === 0 && syntaxSections.length === 1) return; // can't delete the only section

    const section = syntaxSections[index];
    if (!confirm(`Remove section "${section.title}"? Its code will be merged into the ${index > 0 ? 'previous' : 'next'} section.`)) return;

    if (index > 0) {
      // Merge content into previous section
      const prev = syntaxSections[index - 1];
      syntaxSections[index - 1] = {
        ...prev,
        content: prev.content + '\n' + section.content
      };
      syntaxSections.splice(index, 1);
    } else {
      // First section — merge into next
      const next = syntaxSections[1];
      syntaxSections[1] = {
        ...next,
        content: section.content + '\n' + next.content
      };
      syntaxSections.splice(0, 1);
    }
    syncSectionsToSource();
    renderSyntaxSections();
  }

  function renderSyntaxSections() {
    sectionsContainer.innerHTML = '';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'lang-pack-sections-toolbar';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.textContent = 'Expand all';
    expandBtn.title = 'Expand all sections';
    expandBtn.addEventListener('click', () => {
      for (const d of sectionsContainer.querySelectorAll('details')) d.open = true;
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.textContent = 'Collapse all';
    collapseBtn.title = 'Collapse all sections';
    collapseBtn.addEventListener('click', () => {
      for (const d of sectionsContainer.querySelectorAll('details')) d.open = false;
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add section';
    addBtn.addEventListener('click', addSection);
    if (isReadOnly) addBtn.hidden = true;

    const rawBtn = document.createElement('button');
    rawBtn.type = 'button';
    rawBtn.textContent = 'Raw view';
    rawBtn.addEventListener('click', () => setSyntaxViewMode('raw'));

    toolbar.appendChild(expandBtn);
    toolbar.appendChild(collapseBtn);
    toolbar.appendChild(addBtn);
    toolbar.appendChild(rawBtn);
    sectionsContainer.appendChild(toolbar);

    for (let i = 0; i < syntaxSections.length; i++) {
      const section = syntaxSections[i];
      const details = document.createElement('details');
      details.className = 'lang-pack-section';

      const summary = document.createElement('summary');
      const titleSpan = document.createElement('span');
      titleSpan.className = 'lang-pack-section-title';
      titleSpan.textContent = section.title || 'Preamble';
      summary.appendChild(titleSpan);

      if (!isReadOnly && section.title) {
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'lang-pack-section-action';
        renameBtn.textContent = 'rename';
        renameBtn.title = 'Rename this section';
        renameBtn.addEventListener('click', (e) => {
          e.preventDefault(); // don't toggle the <details>
          renameSection(i);
        });
        summary.appendChild(renameBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'lang-pack-section-action';
        deleteBtn.textContent = 'remove';
        deleteBtn.title = 'Remove this section';
        deleteBtn.addEventListener('click', (e) => {
          e.preventDefault();
          deleteSection(i);
        });
        summary.appendChild(deleteBtn);
      }

      details.appendChild(summary);

      const ta = document.createElement('textarea');
      ta.className = 'lang-pack-section-textarea';
      ta.value = section.content;
      ta.readOnly = isReadOnly;
      ta.spellcheck = false;
      ta.rows = section.content.split('\n').length;
      ta.dataset.sectionIndex = i;

      ta.addEventListener('input', () => {
        syntaxSections[i] = { ...syntaxSections[i], content: ta.value };
        ta.rows = ta.value.split('\n').length;
        syncSectionsToSource();
      });

      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
          ta.selectionStart = ta.selectionEnd = start + 2;
          syntaxSections[i] = { ...syntaxSections[i], content: ta.value };
          syncSectionsToSource();
        }
      });

      details.appendChild(ta);
      sectionsContainer.appendChild(details);
    }
  }

  // ── Reference tab ────────────────────────────────────────────────

  function renderReference() {
    referencePanel.innerHTML = '';

    const sections = languagePackEngine.getReferenceContent();

    // Toolbar with expand/collapse
    const toolbar = document.createElement('div');
    toolbar.className = 'lang-pack-sections-toolbar';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.textContent = 'Expand all';
    expandBtn.title = 'Expand all sections';
    expandBtn.addEventListener('click', () => {
      for (const d of referencePanel.querySelectorAll('details')) d.open = true;
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.textContent = 'Collapse all';
    collapseBtn.title = 'Collapse all sections';
    collapseBtn.addEventListener('click', () => {
      for (const d of referencePanel.querySelectorAll('details')) d.open = false;
    });

    toolbar.appendChild(expandBtn);
    toolbar.appendChild(collapseBtn);
    referencePanel.appendChild(toolbar);

    for (const section of sections) {
      const details = document.createElement('details');
      details.className = 'lang-pack-section';

      const summary = document.createElement('summary');
      summary.textContent = section.title;
      details.appendChild(summary);

      const pre = document.createElement('pre');
      pre.className = 'lang-pack-reference-content';
      pre.textContent = section.content;
      details.appendChild(pre);

      referencePanel.appendChild(details);
    }
  }

  function setSyntaxViewMode(mode) {
    syntaxViewMode = mode;

    if (mode === 'raw') {
      // Switch to raw textarea
      sectionsContainer.hidden = true;
      rawToolbar.hidden = false;
      textarea.hidden = false;
      textarea.value = syntaxSource;
      textarea.readOnly = isReadOnly;
    } else {
      // Switch to sections — re-parse from current source
      syntaxSections = languagePackEngine.parseSections(syntaxSource);
      sectionsContainer.innerHTML = '';
      renderSyntaxSections();
      rawToolbar.hidden = true;
      textarea.hidden = true;
      sectionsContainer.hidden = false;
    }
  }

  // ── Tab switching ──────────────────────────────────────────────────

  function switchTab(tab) {
    activeTab = tab;
    for (const btn of tabBtns) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }

    const isSyntax = tab === 'syntax';
    const isSettings = tab === 'settings';
    const isReference = tab === 'reference';

    settingsPanel.hidden = !isSettings;
    referencePanel.hidden = !isReference;

    if (isReference) {
      textarea.hidden = true;
      rawToolbar.hidden = true;
      sectionsContainer.hidden = true;
      if (referencePanel.children.length === 0) {
        renderReference();
      }
      return;
    }

    if (isSyntax) {
      if (syntaxViewMode === 'raw') {
        rawToolbar.hidden = false;
        textarea.hidden = false;
        textarea.value = syntaxSource;
        textarea.readOnly = isReadOnly;
        sectionsContainer.hidden = true;
      } else {
        rawToolbar.hidden = true;
        textarea.hidden = true;
        sectionsContainer.hidden = false;
        if (sectionsContainer.children.length === 0) {
          renderSyntaxSections();
        }
      }
    } else {
      rawToolbar.hidden = true;
      textarea.hidden = isSettings;
      sectionsContainer.hidden = true;
      if (tab === 'functions') {
        textarea.value = functionsJson;
        textarea.readOnly = isReadOnly;
      } else if (tab === 'overrides') {
        textarea.value = overridesSource;
        textarea.readOnly = isReadOnly;
      }
    }
  }

  function handleTextareaInput() {
    dirty = true;
    if (activeTab === 'syntax') {
      syntaxSource = textarea.value;
    } else if (activeTab === 'functions') {
      functionsJson = textarea.value;
      updateCoverage();
    } else if (activeTab === 'overrides') {
      overridesSource = textarea.value;
    }
    schedulePreview();
  }

  function handleTabKey(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      handleTextareaInput();
    }
  }

  async function populatePreviewSheets() {
    previewSelect.innerHTML = '<option value="">Select a sheet...</option>';
    try {
      const sheets = await storageEngine.listSheets();
      for (const sheet of sheets) {
        if (sheet.publishedVersion) {
          const opt = document.createElement('option');
          opt.value = sheet.id;
          opt.textContent = sheet.name;
          previewSelect.appendChild(opt);
        }
      }
    } catch {
      // listSheets may not be available yet
    }
  }

  function handlePreviewChange() {
    selectedPreviewSheetId = previewSelect.value;
    runPreview();
  }

  function schedulePreview() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(runPreview, 500);
  }

  async function runPreview() {
    if (!selectedPreviewSheetId) {
      previewCode.textContent = '';
      previewError.hidden = true;
      return;
    }

    previewCode.textContent = 'Transpiling...';
    previewError.hidden = true;

    try {
      const syntaxObj = languagePackEngine.reconstructSyntax(syntaxSource);
      const functionsData = languagePackEngine.parseFunctions(functionsJson);
      functionsData.customFunctionOverrides = languagePackEngine.reconstructOverrides(overridesSource);

      // Load the published XML for the selected sheet
      const xml = await storageEngine.loadPublishedXml(selectedPreviewSheetId);
      const customFunctions = await storageEngine.collectDependenciesFromXml(xml);

      const result = languagePackEngine.transpileWithPackData(
        syntaxObj, functionsData, xml, customFunctions
      );

      if (result.error) {
        previewError.textContent = result.error;
        previewError.hidden = false;
        previewCode.textContent = '';
      } else {
        previewCode.textContent = result.code;
      }
    } catch (e) {
      previewError.textContent = e.message;
      previewError.hidden = false;
      previewCode.textContent = '';
    }
  }

  function updateCoverage() {
    try {
      const functionsData = languagePackEngine.parseFunctions(functionsJson);
      const sigs = functionsData.signatures || {};
      const funcCount = Object.keys(sigs).length;
      const sigCount = Object.values(sigs).reduce((sum, arr) => sum + arr.length, 0);
      coverageDisplay.textContent = `${funcCount} functions, ${sigCount} signatures mapped`;
    } catch {
      coverageDisplay.textContent = 'Invalid functions data';
    }
  }

  async function handleSave() {
    errorDisplay.textContent = '';

    // Validate syntax
    try {
      languagePackEngine.reconstructSyntax(syntaxSource);
    } catch (e) {
      errorDisplay.textContent = `Syntax error: ${e.message}`;
      return;
    }

    // Validate functions JSON
    let functionsData;
    try {
      functionsData = JSON.parse(functionsJson);
    } catch (e) {
      errorDisplay.textContent = `Functions JSON error: ${e.message}`;
      return;
    }

    // Validate overrides
    let overridesData;
    try {
      overridesData = languagePackEngine.reconstructOverrides(overridesSource);
    } catch (e) {
      errorDisplay.textContent = `Overrides error: ${e.message}`;
      return;
    }
    if (typeof overridesData !== 'object' || overridesData === null) {
      errorDisplay.textContent = 'Overrides must be an object';
      return;
    }
    for (const [key, value] of Object.entries(overridesData)) {
      if (typeof value !== 'string') {
        errorDisplay.textContent = `Override for "${key}" must be a string`;
        return;
      }
    }

    // Validate functions data with overrides merged in (on a copy — don't
    // embed overrides into the functionsData that gets saved separately)
    const functionsForValidation = { ...functionsData, customFunctionOverrides: overridesData };
    if (!languagePackEngine.isValidFunctionsData(functionsForValidation)) {
      errorDisplay.textContent = 'Functions data failed validation';
      return;
    }

    if (!meta.name.trim()) {
      errorDisplay.textContent = 'Name is required';
      return;
    }

    try {
      await languagePackEngine.savePack(currentPackId, {
        syntax: syntaxSource,
        functions: functionsData,
        overrides: overridesSource,
        meta
      });
      dirty = false;
      errorDisplay.textContent = 'Saved!';
      setTimeout(() => {
        if (errorDisplay) errorDisplay.textContent = '';
      }, 1500);
      updateCoverage();
    } catch (e) {
      errorDisplay.textContent = `Save failed: ${e.message}`;
    }
  }

  return {
    init,
    mount,
    unmount,
    open
  };
}
