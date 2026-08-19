import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { registerScope } from '@core/hotkey/utils';
import Star from '@phosphor/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { For, onCleanup } from 'solid-js';
import { CommandState } from './state';

/** Command scope for the favorites sub-view of the command menu. */
export const FAVORITES_COMMAND_SCOPE = 'command-scope-favorites';

registerScope({
  parentScopeId: 'global',
  scopeId: FAVORITES_COMMAND_SCOPE,
  type: 'command',
});

const FAVORITES_KEYWORDS = ['favorites', 'favorite', 'starred', 'pinned'];

type FavoriteCommandProps = {
  favorite: Favorite;
  openFavorite: (favorite: Favorite) => void;
};

function FavoriteCommand(props: FavoriteCommandProps) {
  const displayName = useFavoriteDisplayName(props.favorite);
  const registration = registerHotkey({
    scopeId: FAVORITES_COMMAND_SCOPE,
    description: () => displayName(),
    keyDownHandler: () => {
      props.openFavorite(props.favorite);
      return true;
    },
    commandPaletteIcon: (iconProps) => (
      <FavoriteIcon favorite={props.favorite} class={iconProps.class} />
    ),
    // These entries intentionally have no bare-digit hotkey, so typing in the
    // command search remains available while this scope is active.
    runWithInputFocused: true,
  });
  onCleanup(registration.dispose);
  return null;
}

/**
 * Registers the "Favorites" command-menu command and keeps the per-favorite
 * commands in its sub-view scope in sync with the favorites data. Renders
 * nothing.
 */
export function FavoritesCommands() {
  // Non-suspending accessor: command `condition()`s are evaluated during the
  // command menu's setup under a Suspense boundary, where a pending or failed
  // favorites query must not suspend or throw.
  const favoritesData = useFavoritesData();
  const { openWithSplit } = useSplitLayout();

  const openFavorite = (favorite: Favorite) => {
    openWithSplit(favoriteSplitContent(favorite), {
      referredFrom: 'kommand-menu',
    });
    CommandState.close();
    CommandState.setQuery('');
  };

  const staticGroup = createHotkeyGroup();
  staticGroup.addDisposer(
    CommandState.registerCommandScopePlaceholder(
      FAVORITES_COMMAND_SCOPE,
      'Open favorite...'
    )
  );
  staticGroup.add(
    registerHotkey({
      scopeId: 'global',
      description: 'Favorites',
      condition: () => (favoritesData()?.favorites.length ?? 0) > 0,
      keyDownHandler: () => true,
      activateCommandScopeId: FAVORITES_COMMAND_SCOPE,
      keywords: FAVORITES_KEYWORDS,
      icon: Star,
    })
  );

  onCleanup(staticGroup.dispose);

  return (
    <For each={favoritesData()?.favorites ?? []}>
      {(favorite) => (
        <FavoriteCommand favorite={favorite} openFavorite={openFavorite} />
      )}
    </For>
  );
}
