export type ClipboardScope = {
  /** The spreadsheet's block element. */
  block: Element | undefined;
  /** The split panel, when the sheet is its main content. */
  panel: Element | undefined;
  /** Header and toolbar slots the sheet renders its controls into. */
  chrome: (Element | undefined)[];
};

/**
 * Whether a clipboard event fired from `target` belongs to the sheet: from its
 * block, its header or toolbar controls, a container wrapping it (such as a
 * focused panel), or the body after focus was dropped.
 */
export function clipboardTargetInScope(
  target: EventTarget | null,
  scope: ClipboardScope
): boolean {
  if (!(target instanceof Element)) return false;
  if (target === target.ownerDocument.body) return true;
  if (scope.block?.contains(target)) return true;
  if (scope.panel?.contains(target)) return true;
  if (scope.chrome.some((slot) => slot?.contains(target))) return true;
  // A wrapper inside another block, like a canvas holding this sheet, keeps
  // the clipboard for that block.
  return (
    !!scope.block &&
    target.contains(scope.block) &&
    !target.closest('[data-block-type]')
  );
}
