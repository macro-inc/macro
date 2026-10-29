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
