import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button, cn } from '@ui';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { FavoriteIcon } from './FavoriteIcon';
import { favoriteMatchesView } from './favorite-matches-view';

function FavoriteRow(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);
  return (
    <Button
      variant="ghost"
      class="h-9 min-h-9 w-full shrink-0 justify-start gap-3 rounded-xl px-3 font-normal"
      title={name()}
      onClick={() => props.onOpen(props.favorite)}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <FavoriteIcon favorite={props.favorite} class="size-4" />
      </span>
      <span class="truncate">{name()}</span>
    </Button>
  );
}

/** Shared, entity-scoped favorites; five 36px rows before internal scrolling. */
export function ViewFavorites(props: {
  view: string;
  class?: string;
  hideHeading?: boolean;
  onOpen?: (favorite: Favorite) => void;
}) {
  const data = useFavoritesData();
  const layout = useSplitLayout();
  const [expanded, setExpanded] = createSignal(true);
  const id = createUniqueId();
  const favorites = createMemo(() =>
    (data()?.favorites ?? [])
      .filter((favorite) => favoriteMatchesView(favorite, props.view))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const open = (favorite: Favorite) =>
    props.onOpen
      ? props.onOpen(favorite)
      : layout.openWithSplit(favoriteSplitContent(favorite));
  return (
    <section aria-label="Favorites" class={cn('min-h-0 shrink-0', props.class)}>
      <Show when={!props.hideHeading}>
        <h2 class="mb-1 h-7 text-xs font-medium text-ink-subtle">
          <button
            type="button"
            class="flex h-full w-full items-center gap-2 rounded-lg px-3 py-1 text-left hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            aria-expanded={expanded()}
            aria-controls={id}
            onClick={() => setExpanded((value) => !value)}
          >
            <CaretDownIcon
              class={cn('size-3 shrink-0', !expanded() && '-rotate-90')}
            />
            Favorites
          </button>
        </h2>
      </Show>
      <div id={id} hidden={!expanded()}>
        <div class="max-h-45 overflow-y-auto overscroll-contain">
          <For each={favorites()}>
            {(favorite) => <FavoriteRow favorite={favorite} onOpen={open} />}
          </For>
          <Show when={favorites().length === 0}>
            <p class="px-3 py-2 text-xs text-ink-extra-muted">
              No favorites yet
            </p>
          </Show>
        </div>
      </div>
    </section>
  );
}
