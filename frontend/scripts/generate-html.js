#!/usr/bin/env node
/**
 * HTML Template Generator for index.html and loop.html
 *
 * Generates both HTML files from shared template code.
 * Run with --watch to regenerate on changes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');

// =============================================================================
// CONFIGURATION
// =============================================================================

const SHEET_CONFIGS = {
  standard: {
    title: 'SC Spreadsheet',
    appTitle: 'Spreadsheet',
    defaultCell: 'A1',
    grid: {
      columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
      startRow: 1,
      rowCount: 30,
      hasStopColumn: false,
      stickyRows: 0,
      hasRowWrapper: true,
      hasAddRowsBtn: true
    }
  },
  loop: {
    title: 'SC Loop Sheet',
    appTitle: 'Loop Sheet',
    defaultCell: 'A0',
    grid: {
      columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      startRow: 0,
      rowCount: 30,
      hasStopColumn: true,
      stickyRows: 2,
      hasRowWrapper: false,
      hasAddRowsBtn: false
    }
  }
};

// =============================================================================
// TEMPLATE SECTIONS
// =============================================================================

function renderHead(config) {
  return `  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${config.title}</title>
    <script>
      // Apply saved theme before first paint to prevent flash
      (function() {
        var theme = localStorage.getItem('sc-theme');
        if (theme) document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>
    <link rel="stylesheet" href="/src/index.css" />
  </head>`;
}

function renderHeader(config) {
  return `      <!-- ============================================ -->
      <!-- APPLICATION HEADER                          -->
      <!-- ============================================ -->
      <header class="app-header">
        <div class="app-title">${config.appTitle}</div>
        <div class="file-operations">
          <span class="dirty-indicator" hidden title="Unsaved changes">●</span>
          <div class="file-menu-wrapper">
            <button class="btn-file-menu" title="File menu">File</button>
            <div class="file-menu-popover" hidden>
              <button class="file-menu-item" data-action="rename">Rename</button>
              <button class="file-menu-item" data-action="copy">Copy...</button>
              <button class="file-menu-item" data-action="export">Export (.zip)</button>
              <button class="file-menu-item" data-action="export-html">Export as HTML</button>
              <button class="file-menu-item" data-action="export-code">Export Code...</button>
              <button class="file-menu-item" data-action="scenario-analysis">Scenario Analysis...</button>
              <div class="file-menu-divider"></div>
              <button class="file-menu-item" data-action="discard-to-published">Discard to Last Published</button>
              <button class="file-menu-item" data-action="overwrite-draft">Overwrite Current Draft</button>
              <button class="file-menu-item" data-action="discard-changes">Discard Changes</button>
              <div class="file-menu-divider"></div>
              <button class="file-menu-item file-menu-item-danger" data-action="delete">Delete</button>
            </div>
          </div>
          <button class="btn-open" title="Open spreadsheet navigator">Navigate</button>
          <button class="btn-publish" title="Publish as reusable function">Publish</button>
          <span class="save-status" hidden>Saved</span>
          <button class="btn-theme-toggle" title="Toggle theme">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          </button>
          <button class="btn-settings" title="Settings">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>`;
}

function renderToolbar() {
  return `      <!-- ============================================ -->
      <!-- TOOLBAR                                     -->
      <!-- ============================================ -->
      <div class="toolbar">
        <!-- Clipboard Group -->
        <div class="toolbar-group">
          <button class="toolbar-btn btn-copy" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 5H6a2 2 0 00-2 2v11a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-cut" title="Cut">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 1 1-4.243-4.243 3 3 0 0 1 4.243 4.243zm0-5.758a3 3 0 1 0-4.243-4.243 3 3 0 0 0 4.243 4.243z"/>
            </svg>
          </button>
          <div class="paste-split-btn">
            <button class="toolbar-btn btn-paste" title="Paste">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
            </button>
            <button class="toolbar-btn btn-paste-dropdown" title="Paste options">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,9 18,9 12,16"/>
              </svg>
            </button>
            <div class="paste-popover" hidden>
              <button class="paste-option btn-paste-values">
                <span class="paste-option-label">Paste values</span>
                <span class="paste-option-shortcut"></span>
              </button>
            </div>
          </div>
        </div>

        <!-- Alignment Group -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-align-left" title="Align left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M4 12h10M4 18h16"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-align-center" title="Align center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M7 12h10M4 18h16"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-align-right" title="Align right">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M10 12h10M4 18h16"/>
            </svg>
          </button>
        </div>

        <!-- Font Size Group -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-font-increase" title="Increase font size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 4v16m8-8H4"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-font-decrease" title="Decrease font size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 12H4"/>
            </svg>
          </button>
        </div>

        <!-- Text Style Group -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-bold" title="Bold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
              <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-italic" title="Italic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4h6M14 4L10 20M7 20h6"/>
            </svg>
          </button>
        </div>

        <!-- Highlight Group -->
        <div class="toolbar-group toolbar-group-bordered highlight-split-btn">
          <button class="toolbar-btn btn-highlight-apply" title="Apply highlight">
            <span class="highlight-swatch"></span>
          </button>
          <button class="toolbar-btn btn-highlight-dropdown" title="Choose highlight color">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <div class="highlight-popover" hidden>
            <button class="highlight-option highlight-option-none" data-highlight="" title="No highlight">&times;</button>
            <button class="highlight-option swatch-yellow" data-highlight="yellow" title="Yellow"></button>
            <button class="highlight-option swatch-blue" data-highlight="blue" title="Blue"></button>
            <button class="highlight-option swatch-green" data-highlight="green" title="Green"></button>
            <button class="highlight-option swatch-pink" data-highlight="pink" title="Pink"></button>
            <button class="highlight-option swatch-orange" data-highlight="orange" title="Orange"></button>
            <button class="highlight-option swatch-gray" data-highlight="gray" title="Gray"></button>
          </div>
        </div>

        <!-- Format Group -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-format" title="Number format">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-clear-format" title="Clear formatting">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>

        <!-- History Group -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-undo" title="Undo" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-redo" title="Redo" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"/>
            </svg>
          </button>
        </div>

        <!-- Cancel Cut (hidden by default) -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-cancel-cut" title="Cancel Cut" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span>Cancel</span>
          </button>
        </div>

        <!-- Panel Toggle & Named Ranges -->
        <div class="toolbar-group toolbar-group-bordered">
          <button class="toolbar-btn btn-named-ranges" title="Named Ranges">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button class="toolbar-btn btn-toggle-panels" title="Toggle Inputs & Output">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <text x="12" y="17" text-anchor="middle" font-size="16" font-weight="600" font-style="italic" font-family="Georgia, 'Times New Roman', serif">io</text>
            </svg>
          </button>
        </div>
      </div>`;
}

function renderFormulaBar(config) {
  return `      <!-- ============================================ -->
      <!-- FORMULA BAR                                 -->
      <!-- ============================================ -->
      <div class="formula-bar">
        <div class="cell-name-wrapper">
          <input type="text" class="cell-name-display" value="${config.defaultCell}" aria-label="Cell reference or name" />
          <button class="cell-name-delete-button" hidden aria-label="Delete named range">&times;</button>
        </div>
        <input type="text" class="formula-input" placeholder="Enter formula or value" aria-label="Cell value or formula" enterkeyhint="enter" />
      </div>`;
}

function renderInputsPanel() {
  return `      <!-- ============================================ -->
      <!-- INPUTS PANEL (hidden by default)            -->
      <!-- ============================================ -->
      <div class="inputs-panel" hidden>
        <div class="inputs-panel-left">
          <div class="inputs-panel-header">
            <div class="inputs-panel-label">Inputs</div>
            <button class="btn-add-input">+ Add Input</button>
          </div>
          <div class="inputs-panel-divider"></div>
          <!-- JS dynamically adds input rows here -->
        </div>
        <div class="inputs-panel-right">
          <!-- JS dynamically builds scenario section here -->
        </div>
      </div>`;
}

function renderLoopSettings() {
  return `      <!-- ============================================ -->
      <!-- LOOP SETTINGS (hidden by default)           -->
      <!-- ============================================ -->
      <div class="loop-settings" hidden>
        <label class="loop-settings-label">Max iterations:</label>
        <input type="number" class="max-iterations-input" min="1" placeholder="unlimited" />
        <span class="iteration-status"></span>
      </div>`;
}

function renderOutputsPanel() {
  return `      <!-- ============================================ -->
      <!-- OUTPUTS PANEL (hidden by default)           -->
      <!-- ============================================ -->
      <div class="outputs-panel" hidden>
        <div class="outputs-panel-label">Outputs:</div>
        <div class="outputs-container">
          <!-- Dynamic output columns added here by panels.js -->
        </div>
        <button class="btn-add-output" aria-label="Add output">+</button>
      </div>`;
}

function renderGridExpansionControls() {
  return `      <!-- ============================================ -->
      <!-- GRID EXPANSION CONTROLS                     -->
      <!-- ============================================ -->
      <div class="grid-expansion-controls">
        <button class="add-columns-btn" title="Add column">+</button>
      </div>`;
}

// =============================================================================
// GRID GENERATION
// =============================================================================

function generateGridHeader(gridConfig) {
  const { columns, hasStopColumn } = gridConfig;

  let headerCells = columns.map(col =>
    `              <th scope="col" class="grid-column-header" data-col="${col}">${col}</th>`
  ).join('\n');

  if (hasStopColumn) {
    headerCells += '\n              <th class="grid-separator-col-header"></th>';
    headerCells += '\n              <th scope="col" class="grid-column-header grid-sticky-right-header" data-col="_STOP">_STOP</th>';
  }

  return `          <thead>
            <tr>
              <th class="grid-corner-cell"></th>
${headerCells}
            </tr>
          </thead>`;
}

function generateGridRow(rowNum, gridConfig, isFirstRow) {
  const { columns, hasStopColumn, stickyRows, startRow } = gridConfig;
  const isLoopSheet = hasStopColumn;
  const isStickyRow = isLoopSheet && rowNum < stickyRows;
  const isGeneratedRow = isLoopSheet && rowNum >= stickyRows;

  // Build row attributes
  let rowAttrs = '';
  if (isStickyRow) {
    rowAttrs = ` data-sticky-row="${rowNum}"`;
  } else if (isGeneratedRow) {
    rowAttrs = ' class="generated-row"';
  }

  // Build cells
  let cells = columns.map(col =>
    `              <td role="gridcell" contenteditable="plaintext-only" id="${col}${rowNum}"></td>`
  ).join('\n');

  // Add separator column and _STOP column for loop sheets
  if (hasStopColumn) {
    // Only first row gets the separator column with rowspan
    if (isFirstRow) {
      cells += '\n              <td class="grid-separator-col" rowspan="10000"></td>';
    }
    cells += `\n              <td role="gridcell" class="grid-sticky-right-cell" contenteditable="plaintext-only" id="_STOP${rowNum}"></td>`;
  }

  return `            <tr${rowAttrs}>
              <th scope="row" class="grid-row-header">${rowNum}</th>
${cells}
            </tr>`;
}

function generateSeparatorRow() {
  return `            <tr class="grid-separator-row">
              <th colspan="1000"></th>
            </tr>`;
}

function generateGridRows(gridConfig) {
  const { startRow, rowCount, stickyRows, hasStopColumn } = gridConfig;
  const rows = [];

  for (let i = 0; i < rowCount; i++) {
    const rowNum = startRow + i;
    const isFirstRow = i === 0;

    rows.push(generateGridRow(rowNum, gridConfig, isFirstRow));

    // Insert separator row after sticky rows in loop sheets
    if (hasStopColumn && rowNum === stickyRows - 1) {
      rows.push(generateSeparatorRow());
    }
  }

  return rows.join('\n');
}

function renderGrid(config) {
  const { grid } = config;
  const isLoopSheet = grid.hasStopColumn;

  const comment = isLoopSheet
    ? `      <!-- ============================================ -->
      <!-- SPREADSHEET GRID CONTAINER                  -->
      <!-- Loop sheets use 0-indexed rows              -->
      <!-- ============================================ -->`
    : `      <!-- ============================================ -->
      <!-- SPREADSHEET GRID CONTAINER                  -->
      <!-- ============================================ -->`;

  const gridContent = `        <table class="spreadsheet-grid">
${generateGridHeader(grid)}
          <tbody>
${generateGridRows(grid)}
          </tbody>
        </table>`;

  if (grid.hasRowWrapper) {
    return `${comment}
      <div class="grid-area-wrapper">
      <div class="spreadsheet-grid-container">
${gridContent}
      </div>
      <button class="add-rows-btn" title="Add row">+</button>
      </div>`;
  } else {
    return `${comment}
      <div class="spreadsheet-grid-container">
${gridContent}
      </div>`;
  }
}

// =============================================================================
// MAIN ASSEMBLY
// =============================================================================

function generateHTML(sheetType) {
  const config = SHEET_CONFIGS[sheetType];

  return `<!DOCTYPE html>
<!--
  ============================================================================
  AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
  ============================================================================
  This file is generated by: frontend/scripts/generate-html.js
  To make changes, edit the generator script instead.
  ============================================================================
-->
<html lang="en">
${renderHead(config)}
  <body>
    <div id="root">
${renderHeader(config)}

${renderToolbar()}

${renderFormulaBar(config)}

${renderInputsPanel()}

${renderGrid(config)}

${renderGridExpansionControls()}

${sheetType === 'loop' ? renderLoopSettings() + '\n' : ''}${renderOutputsPanel()}
    </div>

    <div id="sc-embedded-data" hidden></div>

    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;
}

function generateScenarioHTML() {
  return `<!DOCTYPE html>
<!--
  ============================================================================
  AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
  ============================================================================
  This file is generated by: frontend/scripts/generate-html.js
  To make changes, edit the generator script instead.
  ============================================================================
-->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SC Scenario Analysis</title>
    <script>
      // Apply saved theme before first paint to prevent flash
      (function() {
        var theme = localStorage.getItem('sc-theme');
        if (theme) document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body>
    <div id="scenario-root"></div>

    <script type="module" src="/src/scenario-main.js"></script>
  </body>
</html>
`;
}

function generateGridTemplates() {
  const templates = {};
  for (const [sheetType, config] of Object.entries(SHEET_CONFIGS)) {
    // Strip HTML comments from the grid template — they're for source readability only
    const gridHtml = renderGrid(config).replace(/<!--[\s\S]*?-->\n?/g, '').trim();
    templates[sheetType] = {
      gridHtml,
      appTitle: config.appTitle,
    };
  }
  return `// AUTO-GENERATED by generate-html.js — do not edit
export const GRID_TEMPLATES = ${JSON.stringify(templates, null, 2)};
`;
}

function generateAll() {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  const loopPath = path.join(FRONTEND_DIR, 'loop.html');
  const scenarioPath = path.join(FRONTEND_DIR, 'scenario.html');
  const gridTemplatesPath = path.join(FRONTEND_DIR, 'src', 'generated', 'grid-templates.js');

  fs.writeFileSync(indexPath, generateHTML('standard'));
  fs.writeFileSync(loopPath, generateHTML('loop'));
  fs.writeFileSync(scenarioPath, generateScenarioHTML());

  fs.mkdirSync(path.dirname(gridTemplatesPath), { recursive: true });
  fs.writeFileSync(gridTemplatesPath, generateGridTemplates());

  console.log('Generated index.html, loop.html, scenario.html, and grid-templates.js');
}

// =============================================================================
// CLI
// =============================================================================

generateAll();

if (process.argv.includes('--watch')) {
  console.log('Watching for changes...');
  fs.watch(__filename, () => {
    console.log('Template changed, regenerating...');
    generateAll();
  });
  // Keep process alive
  setInterval(() => {}, 1000);
}
