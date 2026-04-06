/**
 * CODE EXPORT DIALOG
 * ==================
 * Modal dialog for exporting spreadsheet logic as code in various languages.
 * Populated from language packs managed by the languagePackEngine.
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';

export function createCodeExportDialog() {
  let languagePackEngine = null;

  // DOM references
  let dialog = null;
  let langSelect = null;
  let codeBlock = null;
  let errorBanner = null;
  let copyBtn = null;
  let downloadBtn = null;

  // State
  let currentXml = null;
  let currentCustomFunctions = null;
  let currentCode = '';
  let currentPackId = null;
  let currentSheetName = null;
  let currentPacks = [];

  function init(deps) {
    languagePackEngine = deps.languagePackEngine;
  }

  function mount() {
    dialog = mountDialog('code-export-dialog', 'code-export-dialog', `
      ${dialogHeaderHTML('Export Code')}
      <div class="code-export-body">
        <div class="code-export-lang-row">
          <label>Language:</label>
          <select class="code-export-lang-select"></select>
        </div>
        <div class="code-export-error" hidden></div>
        <pre class="code-export-code"><code></code></pre>
        <div class="code-export-controls">
          <button type="button" class="btn-action code-export-copy">Copy to Clipboard</button>
          <button type="button" class="btn-action code-export-download">Download</button>
        </div>
      </div>
    `, handleClose);

    dialog.querySelector('.dialog-close-btn')?.addEventListener('click', handleClose);
    langSelect = dialog.querySelector('.code-export-lang-select');
    codeBlock = dialog.querySelector('.code-export-code code');
    errorBanner = dialog.querySelector('.code-export-error');
    copyBtn = dialog.querySelector('.code-export-copy');
    downloadBtn = dialog.querySelector('.code-export-download');

    langSelect.addEventListener('change', handleLangChange);
    copyBtn.addEventListener('click', handleCopy);
    downloadBtn.addEventListener('click', handleDownload);
  }

  function unmount() {
    langSelect?.removeEventListener('change', handleLangChange);
    copyBtn?.removeEventListener('click', handleCopy);
    downloadBtn?.removeEventListener('click', handleDownload);
    dialog = null;
    langSelect = null;
    codeBlock = null;
    errorBanner = null;
    copyBtn = null;
    downloadBtn = null;
  }

  async function open(xmlContent, customFunctions, sheetName) {
    if (!dialog) return;
    currentXml = xmlContent;
    currentCustomFunctions = customFunctions;
    currentSheetName = sheetName || null;

    // Populate language dropdown
    currentPacks = await languagePackEngine.listPacks();
    langSelect.innerHTML = '';
    for (const pack of currentPacks) {
      const opt = document.createElement('option');
      opt.value = pack.id;
      opt.textContent = pack.name;
      langSelect.appendChild(opt);
    }

    // Default to first pack (JavaScript)
    if (currentPacks.length > 0) {
      currentPackId = currentPacks[0].id;
      langSelect.value = currentPackId;
    }

    dialog.showModal();
    await transpileAndDisplay();
  }

  function handleClose() {
    if (dialog) dialog.close();
  }

  async function handleLangChange() {
    currentPackId = langSelect.value;
    await transpileAndDisplay();
  }

  async function transpileAndDisplay() {
    if (!currentPackId || !currentXml) return;

    errorBanner.hidden = true;
    codeBlock.textContent = 'Transpiling...';

    try {
      const result = await languagePackEngine.transpileWithPack(
        currentPackId, currentXml, currentCustomFunctions || {}
      );

      if (result.error) {
        errorBanner.textContent = result.error;
        errorBanner.hidden = false;
        codeBlock.textContent = '';
        currentCode = '';
      } else {
        currentCode = result.code;
        codeBlock.textContent = currentCode;
      }
    } catch (e) {
      errorBanner.textContent = e.message;
      errorBanner.hidden = false;
      codeBlock.textContent = '';
      currentCode = '';
    }
  }

  async function handleCopy() {
    if (!currentCode) return;
    try {
      await navigator.clipboard.writeText(currentCode);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch (e) {
      console.error('[CodeExportDialog] Failed to copy:', e);
    }
  }

  function handleDownload() {
    if (!currentCode || !currentPackId) return;

    const pack = currentPacks.find(p => p.id === currentPackId);
    const ext = pack?.fileExtension || '.txt';
    const baseName = currentSheetName
      ? currentSheetName.toLowerCase().replace(/\s+/g, '-')
      : 'export';
    const filename = `${baseName}${ext}`;

    const blob = new Blob([currentCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    init,
    mount,
    unmount,
    open
  };
}
