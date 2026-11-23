/** Acts on the highlighted row for the text on screen. The list trails the
 * typed text by the query debounce, so the query is brought up to date
 * before the row is read; the action then runs in the same keypress, because
 * a deferred action is lost if the person keeps typing. Returns whether there
 * was a row to act on. */
export function actOnCurrentSelection<T>(options: {
  flushQuery: () => void;
  selectedItem: () => T | undefined;
  act: (item: T) => void;
}): boolean {
  options.flushQuery();
  const item = options.selectedItem();
  if (!item) return false;
  options.act(item);
  return true;
}
