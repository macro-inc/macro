/** A saved definition grants access to its filters, never to matching items. */
export type SavedView = {
  id: string;
  ownerId: string;
  name: string;
  config: unknown;
  sharedTeamId: string | null;
  revision: number;
};

export type SavedViewError = { code: string; message: string };
export type CreateSavedView = {
  id: string;
  name: string;
  config: unknown;
  sharedTeamId: string | null;
};
export type UpdateSavedView = Omit<CreateSavedView, 'sharedTeamId'> & {
  sharedTeamId?: string | null;
  expectedRevision: number;
};

/** A local definition has a stable identity before its first server write. */
export type NewSavedView = {
  id: string;
  kind: string;
  name: string;
  sharedTeamId: string | null;
  config: unknown;
};
export type SavedViewEntry =
  | { kind: 'saved'; record: SavedView }
  | { kind: 'draft'; draft: NewSavedView };

/** Keeps local creation at the end of the owning list without inventing a server record. */
export function appendSavedViewDraft(
  records: readonly SavedView[],
  draft?: NewSavedView
): SavedViewEntry[] {
  const entries: SavedViewEntry[] = records
    .filter((record) => record.id !== draft?.id)
    .map((record) => ({
      kind: 'saved',
      record,
    }));
  if (draft) entries.push({ kind: 'draft', draft });
  return entries;
}
