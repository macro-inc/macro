import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import CaretDownIcon from '@phosphor/caret-down.svg';
import StarIcon from '@phosphor/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { makePersisted } from '@solid-primitives/storage';
import { cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

const INITIAL_VISIBLE_FAVORITES = 5;

function ExperimentalFavoriteRow(props: { favorite: Favorite }) {
  const layout = useSplitLayout();
  const displayName = useFavoriteDisplayName(props.favorite);
  const content = () => favoriteSplitContent(props.favorite);

  const isActive = () => {
    const active = globalSplitManager()?.activeSplit()?.content();
    const target = content();
    return active?.type === target.type && active.id === target.id;
  };

  const open = (event: MouseEvent) => {
    layout.openWithSplit(content(), {
      referredFrom: 'sidebar',
      activate: true,
      preferNewSplit: event.shiftKey,
    });
    globalSplitManager()?.returnFocus();
  };

  return (
    <button
      type="button"
      class={cn(
        'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors',
        isActive()
          ? 'bg-active text-ink'
          : 'text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40'
      )}
      aria-current={isActive() ? 'page' : undefined}
      onMouseDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
      onClick={open}
    >
      <span class="flex size-5 shrink-0 items-center justify-center">
        <FavoriteIcon favorite={props.favorite} class="size-4" />
      </span>
      <span class="min-w-0 flex-1 truncate">{displayName()}</span>
    </button>
  );
}

/** Favorites navigation designed specifically for the experimental sidebar. */
export function ExperimentalFavoritesSection() {
  const favoritesData = useFavoritesData();
  const favorites = () => favoritesData()?.favorites ?? [];
  const [expanded, setExpanded] = makePersisted(createSignal(true), {
    name: 'experimental-sidebar-favorites-expanded',
  });
  const [showAllFavorites, setShowAllFavorites] = createSignal(false);
  const visibleFavorites = createMemo(() =>
    showAllFavorites()
      ? favorites()
      : favorites().slice(0, INITIAL_VISIBLE_FAVORITES)
  );
  const hasAdditionalFavorites = () =>
    favorites().length > INITIAL_VISIBLE_FAVORITES;
  const hiddenFavoriteCount = () =>
    Math.max(favorites().length - INITIAL_VISIBLE_FAVORITES, 0);

  return (
    <Show when={favorites().length > 0}>
      <section class="w-full">
        <button
          type="button"
          class="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-ink-extra-muted transition-colors hover:bg-ink/5 hover:text-ink"
          aria-expanded={expanded()}
          onClick={() => setExpanded((value) => !value)}
        >
          <StarIcon class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">Favorites</span>
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              !expanded() && '-rotate-90'
            )}
          />
        </button>
        <Show when={expanded()}>
          <div class="relative">
            <ul class="ml-2 mt-1 flex w-[calc(100%-0.5rem)] flex-col gap-0.5">
              <For each={visibleFavorites()}>
                {(favorite) => (
                  <li>
                    <ExperimentalFavoriteRow favorite={favorite} />
                  </li>
                )}
              </For>
            </ul>
            <Show when={hasAdditionalFavorites()}>
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-page via-page/85 to-transparent" />
              <div class="relative z-10 -mt-1 flex justify-center">
                <button
                  type="button"
                  class="flex h-6 items-center rounded-full border border-edge bg-surface px-3 text-[11px] font-medium text-ink-muted shadow-sm transition-colors hover:bg-hover hover:text-ink"
                  aria-expanded={showAllFavorites()}
                  onClick={() => setShowAllFavorites((value) => !value)}
                >
                  {showAllFavorites()
                    ? 'See less'
                    : `View ${hiddenFavoriteCount()} more`}
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </section>
    </Show>
  );
}
