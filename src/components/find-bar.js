/**
 * @file Find Bar
 * @description Floating find bar (browser-style) for searching canonical
 * values of cells. Owns its own DOM (created at mount), so it can persist
 * across orchestrator swaps without depending on shell HTML.
 */

export function createFindBar() {
  // Dependencies (injected via init, refreshed on each orchestrator swap)
  let onFindMatches = null;   // (query: string) => Array<{key, canonical}>
  let onRevealCell = null;    // (key: string) => void  -- preview, no focus steal
  let onClearReveal = null;   // () => void
  let onCommitMatch = null;   // (key: string) => void  -- final selection on close

  // DOM
  let container = null;
  let input = null;
  let counterEl = null;
  let keyEl = null;
  let prevBtn = null;
  let nextBtn = null;
  let closeBtn = null;

  // State
  let matches = [];
  let activeIndex = -1;
  let isOpen = false;
  let lastQuery = null;

  function refreshMatches({ reveal = true, force = false } = {}) {
    if (!onFindMatches) return;
    const query = input.value;
    if (!force && query === lastQuery) return;
    lastQuery = query;
    matches = onFindMatches(query);
    if (matches.length === 0) {
      activeIndex = -1;
      onClearReveal?.();
    } else {
      activeIndex = 0;
      if (reveal) onRevealCell?.(matches[0].key);
    }
    updateCounter();
  }

  function updateCounter() {
    if (!counterEl) return;
    if (!input.value) {
      counterEl.textContent = '';
    } else if (matches.length === 0) {
      counterEl.textContent = '0 of 0';
    } else {
      counterEl.textContent = `${activeIndex + 1} of ${matches.length}`;
    }
    if (keyEl) {
      keyEl.textContent = (activeIndex >= 0 && matches[activeIndex])
        ? matches[activeIndex].key
        : '';
    }
    const noMatches = matches.length === 0;
    if (prevBtn) prevBtn.disabled = noMatches;
    if (nextBtn) nextBtn.disabled = noMatches;
  }

  function navigate(delta) {
    if (matches.length === 0) return;
    activeIndex = (activeIndex + delta + matches.length) % matches.length;
    onRevealCell?.(matches[activeIndex].key);
    updateCounter();
  }

  function open() {
    if (!container) return;
    isOpen = true;
    container.hidden = false;
    input.focus();
    input.select();
    // Re-run search on open: cell values may have changed since last open.
    if (input.value) refreshMatches({ force: true });
  }

  function close() {
    if (!container) return;
    isOpen = false;
    container.hidden = true;
    // If we have a current match, commit selection to it; otherwise just
    // clear the preview overlay.
    if (activeIndex >= 0 && matches[activeIndex]) {
      onCommitMatch?.(matches[activeIndex].key);
    } else {
      onClearReveal?.();
    }
    matches = [];
    activeIndex = -1;
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (matches.length === 0) {
        refreshMatches({ force: true });
        return;
      }
      navigate(e.shiftKey ? -1 : 1);
    }
  }

  function mount(parentEl) {
    const parent = parentEl || document.body;
    container = document.createElement('div');
    container.className = 'find-bar';
    container.hidden = true;
    container.innerHTML = `
      <input type="text" class="find-bar-input" placeholder="Find in cells…" aria-label="Find in cells">
      <span class="find-bar-key" aria-live="polite" title="Current match cell"></span>
      <span class="find-bar-counter" aria-live="polite"></span>
      <button class="find-bar-btn find-bar-prev" type="button" title="Previous (Shift+Enter)" aria-label="Previous match">&#x25B2;</button>
      <button class="find-bar-btn find-bar-next" type="button" title="Next (Enter)" aria-label="Next match">&#x25BC;</button>
      <button class="find-bar-btn find-bar-close" type="button" title="Close (Esc)" aria-label="Close find">&#x2715;</button>
    `;
    parent.appendChild(container);

    input = container.querySelector('.find-bar-input');
    counterEl = container.querySelector('.find-bar-counter');
    keyEl = container.querySelector('.find-bar-key');
    prevBtn = container.querySelector('.find-bar-prev');
    nextBtn = container.querySelector('.find-bar-next');
    closeBtn = container.querySelector('.find-bar-close');

    input.addEventListener('input', () => refreshMatches());
    input.addEventListener('keydown', handleKeyDown);
    prevBtn.addEventListener('click', () => navigate(-1));
    nextBtn.addEventListener('click', () => navigate(1));
    closeBtn.addEventListener('click', () => close());

    updateCounter();
  }

  return {
    /**
     * @param {{onFindMatches: function, onRevealCell: function, onClearReveal: function, onCommitMatch: function}} deps
     */
    init(deps) {
      onFindMatches = deps.onFindMatches;
      onRevealCell = deps.onRevealCell;
      onClearReveal = deps.onClearReveal;
      onCommitMatch = deps.onCommitMatch;
    },
    mount,
    open,
    close,
    isOpen: () => isOpen,
    toggle() {
      if (isOpen) close(); else open();
    },
  };
}
