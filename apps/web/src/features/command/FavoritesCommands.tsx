import { FavoriteIcon } from '@app/component/FavoriteIcon';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { favoriteDisplayName, favoriteSplitContent } from '@app/util/favorites';
import { registerScope } from '@core/hotkey/utils';
import Star from '@phosphor/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createHotkeyGroup, registerHotkey } from 'core/hotkey/hotkeys';
import { createEffect, onCleanup } from 'solid-js';
import { CommandState } from './state';

/** Command scope for the favorites sub-view of the command menu. */
export const FAVORITES_COMMAND_SCOPE = 'command-scope-favorites';

registerScope({
  parentScopeId: 'global',
  scopeId: FAVORITES_COMMAND_SCOPE,
  type: 'command',
});

const FAVORITES_KEYWORDS = ['favorites', 'favorite', 'starred', 'pinned'];

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
    // Close the menu and clear the query once a favorite is opened.
    CommandState.close();
    CommandState.setQuery('');
  };

  const staticGroup = createHotkeyGroup();
  const dynamicGroup = createHotkeyGroup();

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
      // An empty sub-view is a dead end, so hide the command until the user
      // has favorites.
      condition: () => (favoritesData()?.favorites.length ?? 0) > 0,
      keyDownHandler: () => true,
      activateCommandScopeId: FAVORITES_COMMAND_SCOPE,
      keywords: FAVORITES_KEYWORDS,
      icon: Star,
    })
  );

  const registerFavorites = (list: Favorite[]) => {
    // Registered without a hotkey: bare digits would fight type-to-filter in
    // the sub-view's search input. The entries are still listed and openable
    // via arrow/enter or click (the handler runs with `e` undefined).
    // `runWithInputFocused` is required even without a hotkey: entering the
    // sub-view captures its commands while the menu's search input has focus,
    // and the capture filter drops commands without this flag.
    list.forEach((favorite) => {
      dynamicGroup.add(
        registerHotkey({
          scopeId: FAVORITES_COMMAND_SCOPE,
          // A callback so each render re-reads the preview cache, where
          // names resolve (and renames land), warmed by the sidebar's
          // favorite rows.
          description: () => favoriteDisplayName(favorite),
          keyDownHandler: () => {
            openFavorite(favorite);
            return true;
          },
          commandPaletteIcon: (props) => (
            <FavoriteIcon favorite={favorite} class={props.class} />
          ),
          runWithInputFocused: true,
        })
      );
    });
  };

  // Hotkey registrations are non-reactive, so sync them with the favorites
  // data: dispose and re-register the per-favorite commands on every change.
  createEffect(() => {
    const data = favoritesData();
    dynamicGroup.dispose();
    if (!data) return;
    registerFavorites(data.favorites);
  });

  onCleanup(() => {
    dynamicGroup.dispose();
    staticGroup.dispose();
  });

  return null;
}
