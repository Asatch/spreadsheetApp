/**
 * @file Popover controller.
 *
 * Lightweight helper for trigger-button popovers (menus, dropdowns) — handles
 * toggle, outside-click dismissal, Escape dismissal, and listener cleanup.
 *
 * Usage:
 *   const popover = createPopover({ trigger, popover, onOpen });
 *   // … inside a handler that selects an option:
 *   popover.close();
 *   // … on component unmount:
 *   popover.destroy();
 */

/**
 * @param {Object} options
 * @param {HTMLElement} options.trigger - Element that toggles the popover on click.
 * @param {HTMLElement} options.popover - Element shown/hidden via its `hidden` property.
 * @param {Function} [options.onOpen] - Called synchronously whenever the popover is opened.
 * @returns {{open: Function, close: Function, toggle: Function, isOpen: Function, destroy: Function}}
 */
export function createPopover({ trigger, popover, onOpen }) {
  if (!trigger || !popover) {
    throw new Error('createPopover: trigger and popover are required');
  }

  let outsideClickHandler = null;
  let escapeHandler = null;

  function open() {
    if (!popover.hidden) return;
    popover.hidden = false;
    onOpen?.();

    outsideClickHandler = (e) => {
      if (!popover.contains(e.target) && !trigger.contains(e.target)) {
        close();
      }
    };
    escapeHandler = (e) => {
      if (e.key === 'Escape') close();
    };

    // Defer attaching outside-click so the current click (which may have
    // bubbled to document) doesn't immediately close the popover.
    requestAnimationFrame(() => {
      document.addEventListener('click', outsideClickHandler);
      document.addEventListener('keydown', escapeHandler);
    });
  }

  function close() {
    if (popover.hidden) return;
    popover.hidden = true;
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = null;
    }
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
  }

  function toggle() {
    if (popover.hidden) open();
    else close();
  }

  function handleTriggerClick(e) {
    // Stop bubbling so the just-installed outside-click listener (if any)
    // doesn't see this click as "outside".
    e.stopPropagation();
    toggle();
  }

  trigger.addEventListener('click', handleTriggerClick);

  return {
    open,
    close,
    toggle,
    isOpen: () => !popover.hidden,
    destroy() {
      close();
      trigger.removeEventListener('click', handleTriggerClick);
    },
  };
}
