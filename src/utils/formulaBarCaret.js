/**
 * Viewport-coordinate DOMRect for the caret position at the given character
 * offset in a contentEditable input. Returns null if the input is empty or
 * the offset is otherwise unmeasurable.
 */
export function getCaretClientRect(input, charOffset) {
  if (!input) return null;
  const textNode = input.firstChild;
  if (!textNode) return null;

  const len = textNode.textContent.length;
  const offset = Math.max(0, Math.min(charOffset, len));

  const range = document.createRange();
  range.setStart(textNode, offset);
  range.setEnd(textNode, offset);

  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0];

  // Collapsed range at end of text returns no rects in some browsers; fall back
  // to a 1-char-wide range ending at the offset.
  if (offset > 0) {
    range.setStart(textNode, offset - 1);
    range.setEnd(textNode, offset);
    const fallback = range.getClientRects();
    if (fallback.length > 0) {
      const r = fallback[fallback.length - 1];
      return new DOMRect(r.right, r.top, 0, r.height);
    }
  }

  return null;
}

export function anchorRectToContainer(rect, containerRect) {
  return {
    left: rect.left - containerRect.left,
    top: rect.top - containerRect.top,
    height: rect.height
  };
}
