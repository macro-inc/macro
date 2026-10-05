/** A snapshot of `node` at its exact size, inert and hidden from assistive technology. */
export function cloneDragPreview(node: HTMLElement, marker: string) {
  const bounds = node.getBoundingClientRect();
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
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute(marker, '');
  return copy;
}
