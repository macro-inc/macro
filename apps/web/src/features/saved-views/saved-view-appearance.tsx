import { useUserId } from '@core/context/user';
import { Show } from 'solid-js';
import { EntityAppearanceMenu } from '../entity-appearance/appearance-menu';
import type { SavedViewAppearanceEntity } from '../entity-appearance/types';
import type { SavedView } from './core/saved-view';

export function savedViewAppearanceEntity(
  view: SavedView
): SavedViewAppearanceEntity {
  return {
    type: 'saved_view',
    id: view.id,
    name: view.name,
    ownerId: view.ownerId,
    appearance: view.appearance,
  };
}

/** Owner-only editing; shared-view readers still render the same appearance. */
export function SavedViewAppearanceMenu(props: {
  view: SavedView;
  defer: (action: () => void) => void;
}) {
  const userId = useUserId();
  return (
    <Show when={props.view.ownerId === userId()}>
      <EntityAppearanceMenu
        entity={savedViewAppearanceEntity(props.view)}
        defer={props.defer}
      />
    </Show>
  );
}
