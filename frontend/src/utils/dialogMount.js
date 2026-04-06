/**
 * Shared helper for mounting <dialog> elements.
 *
 * Finds an existing dialog by ID, or creates one and appends it to document.body.
 * Attaches a mousedown listener for backdrop-close (mousedown rather than click
 * so that dragging a text selection outside the dialog doesn't trigger close).
 *
 * @param {string} id - Dialog element ID
 * @param {string} className - CSS class(es) after 'dialog-base'
 * @param {string} innerHTML - Dialog inner HTML
 * @param {Function} onBackdropClose - Called when clicking the backdrop
 * @returns {HTMLDialogElement}
 */
/**
 * Returns standardized header HTML for a dialog (title + close button).
 * @param {string} title - Dialog title text
 * @returns {string} HTML string
 */
export function dialogHeaderHTML(title) {
  return `
    <div class="dialog-header">
      <h3>${title}</h3>
      <button type="button" class="dialog-close-btn" aria-label="Close">&times;</button>
    </div>`;
}

export function mountDialog(id, className, innerHTML, onBackdropClose) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('dialog');
    el.id = id;
    el.className = `dialog-base ${className}`;
    el.innerHTML = innerHTML;
    document.body.appendChild(el);
  }
  if (!el.dataset.hasBackdropListener) {
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) onBackdropClose();
    });
    el.dataset.hasBackdropListener = 'true';
  }
  return el;
}
