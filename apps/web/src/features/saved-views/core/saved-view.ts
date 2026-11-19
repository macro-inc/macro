import type { EntityAppearance } from '../../entity-appearance/core/appearance';
/** A saved definition grants access to its filters, never to matching items. */
export type SavedView = {
  id: string;
  ownerId: string;
  name: string;
  config: unknown;
  sharedTeamId: string | null;
  revision: number;
  appearance?: EntityAppearance | null;
};

export type SavedViewError = { code: string; message: string };
export type CreateSavedView = {
  id: string;
  name: string;
  config: unknown;
  sharedTeamId: string | null;
  appearance?: EntityAppearance | null;
};
export type UpdateSavedView = Omit<
  CreateSavedView,
  'sharedTeamId' | 'appearance'
> & {
  sharedTeamId?: string | null;
  expectedRevision: number;
};
