import { isCellReference } from '../utils/cellUtils.js';

export const POPUP_MAX_ROWS = 50;

function classifyKey(key, node) {
  if (node && node.type === 'function') return 'function';
  if (isCellReference(key)) return 'cell';
  return 'named';
}

export function createFormulaPopup({ onPick }) {
  let root = null;
  let headerEl = null;
  let bodyEl = null;
  let rows = [];

  function mount(parentEl) {
    root = document.createElement('div');
    root.className = 'formula-popup';
    root.hidden = true;

    headerEl = document.createElement('div');
    headerEl.className = 'formula-popup-header';
    headerEl.hidden = true;
    root.appendChild(headerEl);

    bodyEl = document.createElement('div');
    bodyEl.className = 'formula-popup-body';
    bodyEl.hidden = true;
    root.appendChild(bodyEl);

    parentEl.appendChild(root);
  }

  function renderHeader(header) {
    if (!header) {
      headerEl.hidden = true;
      headerEl.replaceChildren();
      return;
    }

    headerEl.replaceChildren();

    const name = document.createElement('span');
    name.className = 'formula-popup-func';
    name.textContent = header.funcName;
    headerEl.appendChild(name);

    headerEl.append('(');

    if (header.hasEarlierArgs) headerEl.append('…, ');
    if (header.prevType) headerEl.append(`${header.prevType}, `);

    if (header.nextLabel) {
      const next = document.createElement('span');
      next.className = 'formula-popup-next';
      next.textContent = header.nextLabel;
      headerEl.appendChild(next);
      if (header.hasMoreArgs) headerEl.append(', …');
    } else if (header.hasMoreArgs) {
      headerEl.append('…');
    }

    headerEl.append(')');

    if (header.returnType) {
      const ret = document.createElement('span');
      ret.className = 'formula-popup-return';
      ret.textContent = ` → ${header.returnType}`;
      headerEl.appendChild(ret);
    }

    headerEl.hidden = false;
  }

  function renderBody(candidates) {
    rows = candidates || [];
    bodyEl.replaceChildren();

    if (rows.length === 0) {
      bodyEl.hidden = true;
      return;
    }

    for (const cand of rows) {
      const kind = classifyKey(cand.name, cand.node);
      const row = document.createElement('div');
      row.className = `formula-popup-row formula-popup-row--${kind}`;
      row.dataset.name = cand.name;

      const name = document.createElement('span');
      name.className = 'formula-popup-row-name';
      name.textContent = cand.name;
      row.appendChild(name);

      const detail = document.createElement('span');
      detail.className = 'formula-popup-row-type';
      detail.textContent = cand.valuePreview || kind;
      row.appendChild(detail);

      // mousedown + preventDefault keeps formula input focused so the existing
      // blur-driven hide doesn't fire before the pick lands.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onPick(cand);
      });

      bodyEl.appendChild(row);
    }

    if (bodyEl.firstChild) bodyEl.firstChild.classList.add('is-highlighted');
    bodyEl.hidden = false;
  }

  function show(state) {
    renderHeader(state.header);
    renderBody(state.candidates);
    root.style.left = `${state.anchor.left}px`;
    root.style.top = `${state.anchor.top + state.anchor.height}px`;
    root.hidden = false;
  }

  function hide() {
    root.hidden = true;
    headerEl.hidden = true;
    headerEl.replaceChildren();
    bodyEl.hidden = true;
    bodyEl.replaceChildren();
    rows = [];
  }

  function hasCandidates() {
    return rows.length > 0;
  }

  function getTopCandidate() {
    return rows[0];
  }

  return { mount, show, hide, hasCandidates, getTopCandidate };
}
