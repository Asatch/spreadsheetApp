/**
 * @file Drop Zone Component
 * @description Drag and drop overlay for importing files.
 * Supports zip packages and single XML files.
 */

/**
 * Create a drop zone component.
 * @returns {Object} Drop zone interface
 */
export function createDropZone() {
  let container = null;
  let dragCounter = 0;

  // Dependencies (injected)
  let onZipDrop = null;
  let onXmlDrop = null;
  let onFolderDrop = null;
  let onHtmlDrop = null;

  function init(deps) {
    onZipDrop = deps.onZipDrop;
    onXmlDrop = deps.onXmlDrop;
    onFolderDrop = deps.onFolderDrop;
    onHtmlDrop = deps.onHtmlDrop;
  }

  function mount(parentElement) {
    container = document.createElement('div');
    container.className = 'drop-zone-overlay';
    container.innerHTML = `
      <div class="drop-zone-content">
        <div class="drop-zone-icon">📦</div>
        <div class="drop-zone-text">Drop to import</div>
        <div class="drop-zone-hint">Supports .zip packages, .xml spreadsheets, .html exports, and folders</div>
      </div>
    `;
    parentElement.appendChild(container);

    // Bind document-level drag events
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
  }

  function unmount() {
    document.removeEventListener('dragenter', handleDragEnter);
    document.removeEventListener('dragleave', handleDragLeave);
    document.removeEventListener('dragover', handleDragOver);
    document.removeEventListener('drop', handleDrop);

    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
    container = null;
  }

  function handleDragEnter(e) {
    e.preventDefault();
    dragCounter++;

    // Check if files are being dragged
    if (e.dataTransfer?.types?.includes('Files')) {
      show();
    }
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCounter--;

    if (dragCounter === 0) {
      hide();
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    // Required to allow drop
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCounter = 0;
    hide();

    // Check for folder drop via webkitGetAsEntry
    const items = e.dataTransfer?.items;
    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
      const entry = items[0].webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        console.log('[DropZone] Folder dropped:', entry.name);
        if (onFolderDrop) {
          onFolderDrop(entry);
        }
        return;
      }
    }

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;

    // Process the first valid file
    for (const file of files) {
      const name = file.name.toLowerCase();

      if (name.endsWith('.zip')) {
        console.log('[DropZone] Zip file dropped:', file.name);
        if (onZipDrop) {
          onZipDrop(file);
        }
        return;
      }

      if (name.endsWith('.xml')) {
        console.log('[DropZone] XML file dropped:', file.name);
        if (onXmlDrop) {
          onXmlDrop(file);
        }
        return;
      }

      if (name.endsWith('.html') || name.endsWith('.htm')) {
        console.log('[DropZone] HTML file dropped:', file.name);
        if (onHtmlDrop) {
          onHtmlDrop(file);
        }
        return;
      }
    }

    console.warn('[DropZone] No valid files found in drop');
  }

  function show() {
    if (container) {
      container.classList.add('visible');
    }
  }

  function hide() {
    if (container) {
      container.classList.remove('visible');
    }
  }

  return {
    init,
    mount,
    unmount
  };
}
