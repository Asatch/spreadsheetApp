/**
 * FUNCTIONS DIALOG — PURE HELPERS
 * ================================
 *
 * Stateless helper functions extracted from functions-dialog.js.
 * Every function here is data-in, data-out — no closure state, no DOM mutation.
 */

/** Type order for grouping: standard first, then loop, then scenario */
export const TYPE_ORDER = ['standard', 'loop', 'scenario'];
export const TYPE_LABELS = { standard: 'Standard Sheets', loop: 'Loop Sheets', scenario: 'Scenarios' };

/** Format a function's signature for display. */
export function formatSignature(func) {
  if (func.signature?.inputs?.length > 0) {
    const params = func.signature.inputs.map(inp => `${inp.name} ${inp.type}`).join(', ');
    const returnType = func.signature.outputs?.[0]?.type || 'number';
    return `${func.name}(${params}) \u2192 ${returnType}`;
  }
  if (func.inputs && func.inputs.length > 0) {
    const params = func.inputs.map(inp => `${inp.name} ${inp.data_type}`).join(', ');
    const returnType = func.output_type || 'number';
    return `${func.name}(${params}) \u2192 ${returnType}`;
  }
  if (func.variants && func.variants.length > 0) {
    const variant = func.variants[0];
    const params = (variant.argTypes || []).map((type, i) => {
      const paramName = variant.paramNames?.[i] || `arg${i + 1}`;
      return `${paramName} ${type}`;
    }).join(', ');
    const returnType = variant.returnType || 'number';
    return `${func.name}(${params}) \u2192 ${returnType}`;
  }
  return `${func.name}(...)`;
}

/**
 * Sort sheets by dependency depth descending, unpublished first within same depth,
 * then by name as tiebreaker.
 */
export function sortByDependencyDepth(sheets, depthMap) {
  return [...sheets].sort((a, b) => {
    const da = depthMap.get(a.id) || 0;
    const db = depthMap.get(b.id) || 0;
    if (db !== da) return db - da;
    // Unpublished first within same depth
    const aPub = a.functionId && a.publishedVersion ? 1 : 0;
    const bPub = b.functionId && b.publishedVersion ? 1 : 0;
    if (aPub !== bPub) return aPub - bPub;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Render items grouped by type with collapsible section headers.
 * Each group preserves the existing sort order within it.
 * Returns HTML string. rowRenderer(item) should return the HTML for one row.
 */
export function renderGroupedItems(items, rowRenderer, collapsedGroups) {
  // Bucket items by type, preserving order within each bucket
  const groups = new Map();
  for (const item of items) {
    const type = item.type || 'standard';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(item);
  }

  // Render in canonical type order
  let html = '';
  for (const type of TYPE_ORDER) {
    const groupItems = groups.get(type);
    if (!groupItems || groupItems.length === 0) continue;
    const collapsed = collapsedGroups.has(type);
    const chevron = collapsed ? '\u25B6' : '\u25BC';
    const label = TYPE_LABELS[type] || type;
    html += `
        <div class="fn-type-group${collapsed ? ' fn-type-group-collapsed' : ''}" data-group-type="${type}">
          <button type="button" class="fn-type-group-header" data-group-type="${type}">
            <span class="fn-type-group-chevron">${chevron}</span>
            ${label}
            <span class="fn-type-group-count">${groupItems.length}</span>
          </button>
          <div class="fn-type-group-body">
            ${groupItems.map(rowRenderer).join('')}
          </div>
        </div>`;
  }
  return html;
}

/** Render the sort mode dropdown and group-by-type checkbox. */
export function renderSortToggle(sortMode, groupByType) {
  return `
      <select class="fn-sort-select">
        <option value="dependencies"${sortMode === 'dependencies' ? ' selected' : ''}>Sort: Dependency Depth</option>
        <option value="alphabetical"${sortMode === 'alphabetical' ? ' selected' : ''}>Sort: A–Z</option>
        <option value="recent"${sortMode === 'recent' ? ' selected' : ''}>Sort: Recent</option>
      </select>
      <label class="fn-group-type-label">
        <input type="checkbox" class="fn-group-type-checkbox"${groupByType ? ' checked' : ''}>
        Group by type
      </label>
    `;
}

/** Format folder content counts as a human-readable string. */
export function formatFolderContents({ sheets, subfolders }) {
  if (sheets === 0 && subfolders === 0) return 'Empty';
  const parts = [];
  if (sheets > 0) parts.push(`${sheets} sheet${sheets !== 1 ? 's' : ''}`);
  if (subfolders > 0) parts.push(`${subfolders} subfolder${subfolders !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

/** Recursively count sheets and subfolders under a folder. */
export async function countFolderContentsRecursive(folderId, listFolderContents) {
  const contents = await listFolderContents(folderId);
  let sheets = contents.items.length;
  let subfolders = contents.folders.length;
  const subResults = await Promise.all(
    contents.folders.map(subfolder => countFolderContentsRecursive(subfolder.id, listFolderContents))
  );
  for (const sub of subResults) {
    sheets += sub.sheets;
    subfolders += sub.subfolders;
  }
  return { sheets, subfolders };
}

/** Detect functions referenced in formulas that aren't loaded. */
export function detectMissingFunctions(getNodeCalcData) {
  if (!getNodeCalcData) return [];
  const nodeCalcData = getNodeCalcData();
  const missing = new Map();
  for (const [key, node] of nodeCalcData) {
    if (node.type === 'Error' && node.refValue === '#NAME!' && node.precedents) {
      const funcName = node.precedents[0];
      if (funcName && typeof funcName === 'string') {
        const funcNode = nodeCalcData.get(funcName);
        if (!funcNode || funcNode.type !== 'function') {
          if (!missing.has(funcName)) {
            missing.set(funcName, { name: funcName, usedIn: [] });
          }
          missing.get(funcName).usedIn.push(key);
        }
      }
    }
  }
  return Array.from(missing.values());
}

/** Format a signature from a sheet's published version or loaded function metadata. */
export function formatSignatureFromSheet(sheet, loadedFunctions) {
  // 1. Try stored signature from publishedVersion (available for all published sheets)
  const sig = sheet.publishedVersion?.signature;
  if (sig?.inputs?.length > 0) {
    const params = sig.inputs.map(inp => `${inp.name} ${inp.type}`).join(', ');
    const returnType = sig.outputs?.[0]?.type || 'number';
    return `${sheet.name}(${params}) \u2192 ${returnType}`;
  }

  // 2. Fall back to loaded function metadata (for functions loaded before signature storage)
  const loaded = loadedFunctions.find(f => f.id === sheet.functionId);
  if (loaded) return formatSignature(loaded);

  // 3. No signature info available
  return '';
}

/** Build folder path string for flat views. */
export async function buildFolderPathString(folderId, getFolderPath) {
  if (!folderId) return 'Home';
  const path = await getFolderPath(folderId);
  return path.map(p => p.name).join(' / ');
}

/** Resolve dependency functionIds to sheet display names. */
export function resolveDependencyNames(functionIds, sheets) {
  if (!functionIds?.length) return [];
  return functionIds.map(fid => {
    const sheet = sheets.find(s => s.functionId === fid);
    if (!sheet) return null;
    const name = sheet.publishedVersion?.publishedName || sheet.name;
    return { id: sheet.id, name, folderId: sheet.folderId };
  }).filter(Boolean);
}

/** Find sheets whose dependencies include a given functionId. */
export function findCalledBy(functionId, sheets) {
  if (!functionId) return [];
  return sheets
    .filter(s => s.dependencies?.includes(functionId))
    .map(s => ({
      id: s.id,
      name: s.publishedVersion?.publishedName || s.name,
      folderId: s.folderId
    }));
}

/** Find scenarios linked to a given functionId. */
export function findScenariosForFunction(functionId, allScenarios) {
  if (!functionId) return [];
  return allScenarios.filter(s => s.functionId === functionId);
}
