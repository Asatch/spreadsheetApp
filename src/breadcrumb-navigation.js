/**
 * Breadcrumb Navigation Module
 *
 * Manages a navigation tree for in-view drilldown. Lives outside orchestrators
 * (survives orchestrator teardown/rebuild for cross-type swaps).
 *
 * The tree doesn't exist on page load. The root node is created lazily on the
 * first Ctrl+D. Clicking breadcrumbs navigates up; drilling down navigates
 * into children. Edits at each level are preserved in the tree via snapshots.
 */

import { isBreadcrumbMode } from './utils/appMode.js';

export function createBreadcrumbNavigation() {
  let root = null;
  let cursor = null;
  let navigating = null;
  let breadcrumbEl = null;

  // Set from main.js, updated on orchestrator swap
  let app = null;
  let currentSheetType = null;  // 'standard' or 'loop'

  // Injected from main.js — switches orchestrator type if needed (no-op if already correct)
  let swapHandler = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getChildKey(drilldownInfo) {
    return `${drilldownInfo.functionId}:${JSON.stringify(drilldownInfo.argValues)}`;
  }

  function createNode({ label, sheetType, drilldownInfo }) {
    return {
      label,
      sheetType,
      scratchpadMode: false,
      activeScenarioIndex: -1,
      spreadsheetId: null,
      drilldownInfo,
      xml: null,
      children: new Map(),
      parent: null
    };
  }

  function getTrail() {
    const trail = [];
    let node = cursor;
    while (node) {
      trail.unshift(node);
      node = node.parent;
    }
    return trail;
  }

  // ---------------------------------------------------------------------------
  // State save / restore
  // ---------------------------------------------------------------------------

  async function saveCurrentNode() {
    if (!cursor || !app) return;
    await app.saveBeforeNavigate();
    const state = app.getNavigationState();
    cursor.scratchpadMode = state.scratchpadMode;
    cursor.activeScenarioIndex = state.activeScenarioIndex;
    cursor.spreadsheetId = state.spreadsheetId;
    cursor.xml = state.xml;
  }

  // ---------------------------------------------------------------------------
  // Breadcrumb UI
  // ---------------------------------------------------------------------------

  function renderBreadcrumbs() {
    if (!breadcrumbEl) return;

    if (!root || cursor === root) {
      breadcrumbEl.hidden = true;
      breadcrumbEl.textContent = '';
      return;
    }

    breadcrumbEl.hidden = false;
    breadcrumbEl.textContent = '';

    const trail = getTrail();
    trail.forEach((node, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '\u203A'; // ›
        breadcrumbEl.appendChild(sep);
      }

      const item = document.createElement('span');
      item.className = 'breadcrumb-item';
      if (node === cursor) {
        item.classList.add('current');
      } else {
        item.classList.add('clickable');
        item.addEventListener('click', () => navigateTo(node));
      }
      item.textContent = node.label;
      breadcrumbEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation actions (serialized behind `navigating` promise guard)
  // ---------------------------------------------------------------------------

  async function navigateTo(targetNode) {
    if (navigating) return;
    navigating = (async () => {
      try {
        await saveCurrentNode();
        cursor = targetNode;

        await swapHandler(targetNode.sheetType);
        await app.restoreNavigationState(targetNode);

        // If we returned to root and breadcrumb mode is off, discard the tree
        if (cursor === root && !isBreadcrumbMode()) {
          root = null;
          cursor = null;
        }
        renderBreadcrumbs();
      } finally {
        navigating = null;
      }
    })();
    return navigating;
  }

  async function handleDrilldown(drilldownInfo) {
    if (navigating) return;
    navigating = (async () => {
      try {
        // Lazy root creation on first drilldown
        if (!root) {
          root = createNode({
            label: app.getTitle(),
            sheetType: currentSheetType,
            drilldownInfo: null
          });
          cursor = root;
        }

        await saveCurrentNode();

        // Look for existing child (same functionId + args)
        const key = getChildKey(drilldownInfo);
        let child = cursor.children.get(key);
        if (!child) {
          child = createNode({
            label: drilldownInfo.functionName || 'Function',
            sheetType: drilldownInfo.sheetType,
            drilldownInfo
          });
          child.parent = cursor;
          cursor.children.set(key, child);
        }
        cursor = child;

        await swapHandler(drilldownInfo.sheetType);

        // If revisiting a previously visited child, restore its state
        if (child.xml || child.spreadsheetId) {
          await app.restoreNavigationState(child);
        } else {
          await app.loadDrilldownSpreadsheet(drilldownInfo);
        }

        renderBreadcrumbs();
      } finally {
        navigating = null;
      }
    })();
    return navigating;
  }

  async function handleReset(drilldownInfo) {
    if (navigating) return;
    navigating = (async () => {
      try {
        // Discard entire tree, start fresh with new ephemeral root
        await swapHandler(drilldownInfo.sheetType);

        root = createNode({
          label: drilldownInfo.functionName || 'Function',
          sheetType: drilldownInfo.sheetType,
          drilldownInfo
        });
        cursor = root;

        await app.loadDrilldownSpreadsheet(drilldownInfo);
        renderBreadcrumbs();
      } finally {
        navigating = null;
      }
    })();
    return navigating;
  }

  async function navigateBack() {
    if (!cursor || !cursor.parent) return;
    return navigateTo(cursor.parent);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    mount(containerEl) {
      breadcrumbEl = document.createElement('div');
      breadcrumbEl.className = 'breadcrumb-trail';
      breadcrumbEl.hidden = true;
      // Insert after header, before toolbar
      const headerEl = containerEl.querySelector('.app-header');
      if (headerEl && headerEl.nextSibling) {
        containerEl.insertBefore(breadcrumbEl, headerEl.nextSibling);
      } else {
        containerEl.appendChild(breadcrumbEl);
      }
    },

    setApp(orchestrator, sheetType) {
      app = orchestrator;
      currentSheetType = sheetType;
    },

    setSwapHandler(handler) {
      swapHandler = handler;
    },

    handleDrilldown,
    handleReset,
    navigateBack,
    hasTree() { return root !== null; },

    /** Clear the breadcrumb tree (e.g., when navigating to a new sheet via the dialog). */
    clearTree() {
      root = null;
      cursor = null;
      renderBreadcrumbs();
    }
  };
}
