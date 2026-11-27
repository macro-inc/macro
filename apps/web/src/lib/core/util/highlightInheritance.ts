/** The class on <html> that turns on the per-element `::selection` rule. */
export const NO_HIGHLIGHT_INHERITANCE_CLASS = 'no-highlight-inheritance';

const PROBE_COLOR = 'rgb(1, 2, 3)';

/**
 * Whether a `::selection` style set on an element reaches its descendants
 * (CSS highlight inheritance; Chrome 134 and later). index.css sets the
 * selection tint only on the roots that define `--color-ink` and relies on it;
 * other engines (Safari, Firefox) need a rule every element matches.
 */
export function inheritsHighlights(doc: Document = document): boolean {
  const style = doc.createElement('style');
  style.textContent = `.highlight-inheritance-probe::selection{background-color:${PROBE_COLOR}}`;
  const parent = doc.createElement('div');
  parent.className = 'highlight-inheritance-probe';
  // Not `hidden`: Chrome computes no highlight styles under display: none.
  parent.style.cssText =
    'position:absolute;visibility:hidden;contain:strict;width:0;height:0';
  const child = doc.createElement('span');
  parent.append(child);
  doc.head.append(style);
  doc.body.append(parent);
  const inherited =
    getComputedStyle(child, '::selection').backgroundColor === PROBE_COLOR;
  parent.remove();
  style.remove();
  return inherited;
}

/**
 * Marks <html> when this engine lacks highlight inheritance, so the selection
 * tint falls back to the descendant rule. Run once at boot, before the first
 * render: the class changes which rules match every element.
 */
export function markHighlightInheritance(doc: Document = document) {
  doc.documentElement.classList.toggle(
    NO_HIGHLIGHT_INHERITANCE_CLASS,
    !inheritsHighlights(doc)
  );
}
