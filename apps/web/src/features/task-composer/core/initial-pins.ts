/** Snapshot the visible, writable definitions and existing task defaults at submit. */
export function initialTaskPinDefinitionIds(
  visibleIds: readonly string[],
  writableIds: ReadonlySet<string>,
  defaultIds: readonly string[]
): string[] {
  return [
    ...new Set([
      ...defaultIds,
      ...visibleIds.filter((id) => writableIds.has(id)),
    ]),
  ];
}
