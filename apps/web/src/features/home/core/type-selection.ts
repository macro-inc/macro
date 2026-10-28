/** Soup's empty selection means all; `none` explicitly hides every type. */
export function selectedHomeTypes(
  selection: readonly string[] | undefined,
  available: readonly string[]
): string[] {
  return selection?.length
    ? available.filter((id) => selection.includes(id))
    : [...available];
}

export function setHomeTypeSelected(
  selection: readonly string[] | undefined,
  available: readonly string[],
  id: string,
  selected: boolean
): string[] {
  const next = new Set(selectedHomeTypes(selection, available));
  if (selected) next.add(id);
  else next.delete(id);
  if (next.size === available.length) return [];
  return next.size ? [...next] : ['none'];
}
