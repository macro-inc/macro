/** A snapshot of `node` at its exact size, inert and hidden from assistive technology. */
export function cloneDragPreview(node: HTMLElement, marker: string) {
  const bounds = node.getBoundingClientRect();
  const sourceStyle = getComputedStyle(node);
  const copy = node.cloneNode(true);
  if (!(copy instanceof HTMLElement))
    throw new Error('A drag preview clones an HTML element');
  copy.removeAttribute('id');
  copy
    .querySelectorAll('[id]')
    .forEach((element) => element.removeAttribute('id'));
  copy.style.width = `${bounds.width}px`;
  copy.style.height = `${bounds.height}px`;
  copy.style.margin = '0';
  copy.style.opacity = '1';
  copy.style.transform = 'none';
  copy.style.boxSizing = 'border-box';
  // The overlay does not inherit the source's Layer or surface overrides.
  copy.style.backgroundColor = sourceStyle.backgroundColor;
  for (const token of ['--color-surface', '--color-inset']) {
    copy.style.setProperty(token, sourceStyle.getPropertyValue(token));
  }
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute(marker, '');
  return copy;
}
