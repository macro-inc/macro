/** Restore a selection of inboxes without repeats; an empty one means all. */
export function normalizeInboxSelection(
  ids: readonly string[] | undefined
): string[] | undefined {
  return ids?.length ? [...new Set(ids)] : undefined;
}
