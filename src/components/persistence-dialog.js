/**
 * @file Persistence Instructions Dialog
 * @description Reachable from the viewer-mode banner and from Settings →
 * Save to in other modes. Explains the three ways to run the app (hosted,
 * disk-backed local server, OPFS local server) and marks the current one.
 * Embeds the server.py / start.sh / start.ps1 sources for copy or download.
 */

import { mountDialog, dialogHeaderHTML } from '../utils/dialogMount.js';
import { escapeHtml } from '../utils/htmlUtils.js';
import { DISK_PERSIST_PORT, getAppMode } from '../utils/appMode.js';

// `import.meta.env` is injected by Vite at build time. In headless tooling
// (eval.mjs, rebuild.mjs, etc.) the file is loaded by plain Node where
// `import.meta.env` is undefined — so guard the reads. The dialog itself
// only renders in the browser, where Vite has populated these.
const SERVER_PY_CONTENT = import.meta.env?.SC_SELF_HOST_SERVER_PY ?? '';
const START_SH_CONTENT = import.meta.env?.SC_SELF_HOST_START_SH ?? '';
const START_PS1_CONTENT = import.meta.env?.SC_SELF_HOST_START_PS1 ?? '';

// Port shown in the OPFS-option instructions. Must differ from
// DISK_PERSIST_PORT so appMode doesn't detect this as disk-persistence mode
// and route storage to /persist/ endpoints that a plain http.server
// (or the PowerShell OPFS listener) doesn't serve.
const OPFS_PORT = DISK_PERSIST_PORT + 1;

// SetCurrentDirectory: PowerShell's $PWD and the .NET process cwd can differ
// (the latter often stays at C:\WINDOWS\system32). Test-Path uses $PWD, but
// [IO.File]::ReadAllBytes uses the .NET cwd — so without this, the existence
// check passes and the read fails.
const PS_OPFS_COMMAND = `[IO.Directory]::SetCurrentDirectory($PWD.Path);$l=[Net.HttpListener]::new();$l.Prefixes.Add('http://localhost:${OPFS_PORT}/');$l.Start();while($l.IsListening){$c=$l.GetContext();$p=$c.Request.Url.LocalPath.TrimStart('/');if(!$p){$p=(ls *.html)[0].Name};if(Test-Path $p){$c.Response.ContentType='text/html';$b=[IO.File]::ReadAllBytes($p);$c.Response.OutputStream.Write($b,0,$b.Length)}else{$c.Response.StatusCode=404};$c.Response.Close()}`;

function detectOS() {
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'win';
  return 'unix';
}

let singleton = null;

export function createPersistenceDialog() {
  if (singleton) return singleton;

  let dialog = null;

  function open() {
    if (!dialog) mount();
    dialog.showModal();
  }

  function mount() {
    dialog = mountDialog(
      'persistence-dialog',
      'persistence-dialog',
      buildDialogHTML(),
      () => dialog.close()
    );
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', handleClick);
    selectInitialTabs(dialog, detectOS());
  }

  function handleClick(e) {
    const tabBtn = e.target.closest('.persist-tab');
    if (tabBtn) {
      activateTab(tabBtn.dataset.tabGroup, tabBtn.dataset.tab);
      return;
    }
    handleFileAction(e);
  }

  function handleFileAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const fileId = btn.dataset.file;
    const code = dialog.querySelector(`[data-file-content="${fileId}"]`);
    if (!code) return;

    if (action === 'copy') {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    } else if (action === 'download') {
      const blob = new Blob([code.textContent], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileId;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  function activateTab(group, tab) {
    dialog.querySelectorAll(`.persist-tab[data-tab-group="${group}"]`).forEach(b => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    dialog.querySelectorAll(`.persist-tab-panel[data-tab-group="${group}"]`).forEach(p => {
      p.hidden = p.dataset.tab !== tab;
    });
  }

  singleton = { open };
  return singleton;
}

function selectInitialTabs(root, os) {
  const groups = new Set();
  root.querySelectorAll('.persist-tab').forEach(b => groups.add(b.dataset.tabGroup));
  groups.forEach(group => {
    root.querySelectorAll(`.persist-tab[data-tab-group="${group}"]`).forEach(b => {
      const active = b.dataset.tab === os;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    root.querySelectorAll(`.persist-tab-panel[data-tab-group="${group}"]`).forEach(p => {
      p.hidden = p.dataset.tab !== os;
    });
  });
}

function currentBadge(isCurrent) {
  return isCurrent ? `<span class="persist-current-badge">Currently in use</span>` : '';
}

const EXPORT_HTML_STEP = `<li>If you don't already have the <code>.html</code> file, export it via <strong>File menu → Export as HTML</strong>. Then put it in its own folder</li>`;

function buildDialogHTML() {
  const mode = getAppMode();
  const isViewer = mode === 'viewer';
  const title = isViewer ? 'Set up auto-save' : 'Save to...';
  const baseIntro = `There are multiple ways to run this app. Option 1 works in the browser without setup.
       The other options are run from your machine and don't require internet access. No install required.`;
  const intro = isViewer
    ? `This file is currently running in viewer mode — edits are lost when you close the tab.
       ${baseIntro}`
    : baseIntro;

  return `
    ${dialogHeaderHTML(title)}
    <div class="dialog-body">
      <div class="persist-instructions">
        <p>${intro}</p>
        <p>To move your work between any of these options, export it via <strong>File menu → Export (.zip)</strong> and import that file in your new setup.</p>

        <details class="persist-option">
          <summary>Option 1 — Run online, browser storage ${currentBadge(mode === 'hosted')}</summary>
          <p>Go to <a href="https://asatch.github.io/spreadsheetApp" target="_blank" rel="noopener">asatch.github.io/spreadsheetApp</a> to always access the latest version. This will store data in the browser; if you clear the site's data, it will be deleted.</p>
        </details>

        <details class="persist-option">
          <summary>Option 2 — Run offline, file storage ${currentBadge(mode === 'disk-persistence')}</summary>
          <p>Runs on your own machine and saves to disk in a subfolder named <code>persist/</code>.</p>
          <ol>
            ${EXPORT_HTML_STEP}
            <li>Save the file(s) below into the same folder</li>
          </ol>
          ${osTabsHTML('opt2')}
          <div class="persist-tab-panel" data-tab-group="opt2" data-tab="unix">
            ${persistenceFileBlock('server.py', 'Python server — serves the HTML and persists data', SERVER_PY_CONTENT)}
            ${persistenceFileBlock('start.sh', 'Launcher for macOS / Linux', START_SH_CONTENT)}
            <ol start="3">
              <li>Right-click the folder and choose <strong>Open in Terminal</strong></li>
              <li>Run this command in the terminal:</li>
            </ol>
            <div class="persist-command-block">
              <code>chmod +x start.sh &amp;&amp; ./start.sh</code>
              <button class="btn-action" data-action="copy" data-file="start-sh-command">Copy</button>
            </div>
            <pre class="persist-file-code" hidden><code data-file-content="start-sh-command">chmod +x start.sh &amp;&amp; ./start.sh</code></pre>
            <ol start="5">
              <li>Your browser opens to <code>localhost:${DISK_PERSIST_PORT}</code></li>
            </ol>
          </div>
          <div class="persist-tab-panel" data-tab-group="opt2" data-tab="win">
            ${persistenceFileBlock('start.ps1', 'Launcher for Windows — standalone PowerShell server', START_PS1_CONTENT, { showDownload: false })}
            <ol start="3">
              <li>Click <strong>Copy</strong> above, then open Notepad and paste</li>
              <li>Save it into your folder as <code>start.ps1</code>. In the Save dialog, change <strong>Save as type</strong> to <strong>All Files</strong> so Notepad doesn't add <code>.txt</code></li>
              <li>Right-click <code>start.ps1</code> → Run with PowerShell</li>
              <li>Your browser opens to <code>localhost:${DISK_PERSIST_PORT}</code></li>
            </ol>
          </div>
        </details>

        <details class="persist-option">
          <summary>Option 3 — Run offline, browser storage ${currentBadge(mode === 'local')}</summary>
          <p>Runs on your own machine and saves to the browser's built-in storage. No internet needed. One command, nothing to install beyond what ships with your OS.</p>
          ${osTabsHTML('opt3')}
          <div class="persist-tab-panel" data-tab-group="opt3" data-tab="unix">
            <ol>
              ${EXPORT_HTML_STEP}
              <li>Right-click the folder and choose <strong>Open in Terminal</strong></li>
              <li>Run:</li>
            </ol>
            <div class="persist-command-block">
              <code>python3 -m http.server ${OPFS_PORT} -b 127.0.0.1</code>
              <button class="btn-action" data-action="copy" data-file="opfs-cmd-unix">Copy</button>
            </div>
            <pre class="persist-file-code" hidden><code data-file-content="opfs-cmd-unix">python3 -m http.server ${OPFS_PORT} -b 127.0.0.1</code></pre>
            <ol start="4">
              <li>Open <code>http://localhost:${OPFS_PORT}</code> in your browser, then click the <code>.html</code> file name in the listing</li>
            </ol>
          </div>
          <div class="persist-tab-panel" data-tab-group="opt3" data-tab="win">
            <ol>
              ${EXPORT_HTML_STEP}
              <li>Right-click the folder → <strong>Open in Terminal</strong></li>
              <li>Paste this command and press Enter:</li>
            </ol>
            <div class="persist-command-block">
              <code class="persist-long-cmd">${escapeHtml(PS_OPFS_COMMAND)}</code>
              <button class="btn-action" data-action="copy" data-file="opfs-cmd-win">Copy</button>
            </div>
            <pre class="persist-file-code" hidden><code data-file-content="opfs-cmd-win">${escapeHtml(PS_OPFS_COMMAND)}</code></pre>
            <ol start="4">
              <li>Open <code>http://localhost:${OPFS_PORT}</code> in your browser</li>
            </ol>
          </div>
          <p class="persist-note">Data lives in the browser — cleared if you clear site data. Tied to the browser and port you use.</p>
        </details>
      </div>
    </div>`;
}

function osTabsHTML(group) {
  return `
    <div class="persist-tabs" role="tablist">
      <button class="persist-tab" role="tab" data-tab-group="${group}" data-tab="unix">macOS / Linux</button>
      <button class="persist-tab" role="tab" data-tab-group="${group}" data-tab="win">Windows</button>
    </div>`;
}

function persistenceFileBlock(filename, description, content, { showDownload = true } = {}) {
  const downloadBtn = showDownload
    ? `<button class="btn-action" data-action="download" data-file="${filename}">Download</button>`
    : '';
  return `
    <div class="persist-file-block">
      <div class="persist-file-header">
        <div>
          <strong>${filename}</strong>
          <span class="persist-file-desc">${description}</span>
        </div>
        <div class="persist-file-actions">
          <button class="btn-action" data-action="copy" data-file="${filename}">Copy</button>
          ${downloadBtn}
        </div>
      </div>
      <pre class="persist-file-code"><code data-file-content="${filename}">${escapeHtml(content)}</code></pre>
    </div>`;
}
