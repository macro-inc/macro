export function getActualTarget(e: KeyboardEvent): HTMLElement | null {
  const path = e.composedPath();
  for (const node of path) {
    if (node instanceof HTMLElement) return node;
  }
  return null;
}
