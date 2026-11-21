import type { EntityData } from '../entity/types/entity';
import type { EntityAppearance } from './core/appearance';

/** Saved definitions have appearance without becoming searchable Soup entities. */
export type SavedViewAppearanceEntity = {
  type: 'saved_view';
  id: string;
  name: string;
  ownerId: string;
  appearance?: EntityAppearance | null;
};

export type AppearanceEntity = EntityData | SavedViewAppearanceEntity;
