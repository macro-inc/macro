/** Restore legacy multi-selections as one inbox; an empty selection means all. */
export function normalizeInboxSelection(
  ids: readonly string[] | undefined
): string[] | undefined {
  return ids?.length ? ids.slice(0, 1) : undefined;
}
