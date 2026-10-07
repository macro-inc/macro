import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

/**
 * Experimental create-menu layouts, switchable from the command menu
 * ("Create menu variant") so they can be compared side by side. `list` is the
 * shipped launcher; the others are trial designs.
 */
export type CreateMenuVariant =
  | 'list'
  | 'carousel'
  | 'gallery'
  | 'shelves'
  | 'spotlight';

export const CREATE_MENU_VARIANTS: readonly {
  id: CreateMenuVariant;
  label: string;
  description: string;
}[] = [
  {
    id: 'list',
    label: 'Classic list',
    description: 'The current one-line list',
  },
  {
    id: 'carousel',
    label: 'Carousel',
    description: 'One strip of cards with the selection spotlighted',
  },
  {
    id: 'gallery',
    label: 'Gallery',
    description: 'Big animated tiles, grouped, with descriptions',
  },
  {
    id: 'shelves',
    label: 'Shelves',
    description: 'Outlined groups of related things side by side',
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'Search-first list with a large preview pane',
  },
];

export const [createMenuVariant, setCreateMenuVariant] = makePersisted(
  createSignal<CreateMenuVariant>('list'),
  { name: 'create-menu-variant-v1' }
);
