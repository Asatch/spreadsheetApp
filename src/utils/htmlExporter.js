/**
 * @file HTML Exporter
 * @description Exports a spreadsheet as a self-contained portable HTML file.
 *
 * Uses the single-copy bootstrap architecture: at export time, fetches the
 * running app's HTML, compresses it with CompressionStream('gzip'), and wraps
 * it in a small bootstrap shell that decompresses and loads the app.
 *
 * In dev mode, fetches the last production build from /__export/index.html
 * (served by a Vite plugin). Viewer mode is read-only — no export.
 */

import { getAppMode } from './appMode.js';
import { createExportPackage, downloadBlob } from './exportPackager.js';

/**
 * Export the current spreadsheet as a portable HTML file.
 *
 * @param {Object} options
 * @param {string} options.currentId - Current sheet ID
 * @param {Object} options.storageEngine - Storage engine instance
 * @param {Object} options.opfsService - OPFS service instance
 * @param {string} options.name - Spreadsheet name for the filename
 */
export async function exportAsHtml({ currentId, storageEngine, opfsService, name }) {
  const appMode = getAppMode();

  if (appMode === 'viewer') {
    throw new Error('Export is not available in viewer mode.');
  }

  // 1. Fetch the running app's HTML (production single-file build)
  const appHtml = await fetchAppHtml();

  // 2. Compress the app HTML with gzip
  const compressedAppBase64 = await compressToBase64(appHtml);

  // 3. Create the data zip
  const dataBlob = await createExportPackage({
    sheetIds: new Set([currentId]),
    storageEngine,
    opfsService,
    entrySheetId: currentId,
  });

  // 4. Base64-encode the data zip
  const dataBase64 = await blobToBase64(dataBlob);

  // 5. Build the bootstrap HTML
  const portableHtml = buildBootstrapHtml(compressedAppBase64, dataBase64);

  // 6. Download
  const filename = `${name || 'spreadsheet'}.html`;
  const htmlBlob = new Blob([portableHtml], { type: 'text/html' });
  downloadBlob(htmlBlob, filename);
}

/**
 * Fetch the app's self-contained HTML. In production the app itself is a
 * single-file build served at /index.html. In dev mode, the Vite plugin
 * serves the last production build at /__export/index.html instead.
 */
async function fetchAppHtml() {
  const url = import.meta.env.DEV ? '/__export/index.html' : `${import.meta.env.BASE_URL}export/index.html`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      import.meta.env.DEV
        ? 'No production build found for export. The dev server runs a build at startup, but if dist/ was deleted you may need to run `npm run build`.'
        : `Failed to fetch app HTML: ${resp.status} ${resp.statusText}`
    );
  }
  return resp.text();
}

/**
 * Compress a string with gzip using the browser-native CompressionStream,
 * then base64-encode the result.
 */
async function compressToBase64(text) {
  const encoded = new TextEncoder().encode(text);

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const compressed = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    compressed.set(c, offset);
    offset += c.length;
  }

  // Base64 encode in chunks to avoid call stack limits
  let binaryStr = '';
  const CHUNK = 8192;
  for (let i = 0; i < compressed.length; i += CHUNK) {
    binaryStr += String.fromCharCode.apply(null, compressed.subarray(i, i + CHUNK));
  }
  return btoa(binaryStr);
}

/**
 * Build the portable HTML file: a bootstrap shell that decompresses the app
 * and injects the embedded data.
 */
function buildBootstrapHtml(compressedAppBase64, dataBase64) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SC Spreadsheet</title></head>
<body>
  <div id="sc-app-bundle" hidden>${compressedAppBase64}</div>
  <div id="sc-embedded-data" hidden>${dataBase64}</div>
  <script>
    (async function bootstrap() {
      try {
        // 1. Read compressed app blob
        var base64 = document.getElementById('sc-app-bundle').textContent.trim();

        // 2. Decode base64 to bytes
        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        // 3. Decompress gzip using browser-native DecompressionStream
        var ds = new DecompressionStream('gzip');
        var writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();

        var reader = ds.readable.getReader();
        var chunks = [];
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          chunks.push(result.value);
        }
        var totalLen = chunks.reduce(function(s, c) { return s + c.length; }, 0);
        var merged = new Uint8Array(totalLen);
        var offset = 0;
        for (var j = 0; j < chunks.length; j++) {
          merged.set(chunks[j], offset);
          offset += chunks[j].length;
        }
        var html = new TextDecoder().decode(merged);

        // 4. Inject embedded data into the decompressed app HTML
        //    Use exact string match (not regex) to avoid matching JS template
        //    strings in the bundled code that also contain this div pattern.
        var dataContent = document.getElementById('sc-embedded-data').textContent.trim();
        if (dataContent) {
          html = html.replace(
            '<div id="sc-embedded-data" hidden></div>',
            '<div id="sc-embedded-data" hidden>' + dataContent + '</div>'
          );
        }

        // 5. Replace page with decompressed app
        document.open();
        document.write(html);
        document.close();
      } catch (e) {
        document.body.innerHTML = '<h1>Failed to load</h1>'
          + '<p>This file requires a modern browser with DecompressionStream support.</p>'
          + '<p>Supported: Chrome 80+, Firefox 113+, Safari 16.4+</p>'
          + '<pre>' + e.stack + '</pre>';
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Convert a Blob to a base64 string.
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Strip the data URL prefix (data:application/...;base64,)
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
