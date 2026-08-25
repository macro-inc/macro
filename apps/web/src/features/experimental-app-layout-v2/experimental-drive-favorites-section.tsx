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

const DRIVE_FAVORITE_ENTITY_TYPES = new Set<Favorite['entityType']>([
  'document',
  'project',
  'static_file',
]);

function DriveFavoriteRow(props: {
  favorite: Favorite;
  onOpen?: () => void;
}) {
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
    props.onOpen?.();
    globalSplitManager()?.returnFocus();
  };

  return (
    <button
      type="button"
      class={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors',
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
      <span class="flex size-4 shrink-0 items-center justify-center">
        <FavoriteIcon favorite={props.favorite} class="size-4" />
      </span>
      <span class="min-w-0 flex-1 truncate">{displayName()}</span>
    </button>
  );
}

/** Collapsible shortcuts to Drive-compatible favorites. */
export function ExperimentalDriveFavoritesSection(props: {
  onOpen?: () => void;
}) {
  const favoritesData = useFavoritesData();
  const favorites = createMemo(() =>
    (favoritesData()?.favorites ?? []).filter((favorite) =>
      DRIVE_FAVORITE_ENTITY_TYPES.has(favorite.entityType)
    )
  );
  const [expanded, setExpanded] = makePersisted(createSignal(true), {
    name: 'experimental-v2-drive-favorites-expanded',
  });

  return (
    <Show when={favorites().length > 0}>
      <section class="mt-5 w-full">
        <button
          type="button"
          class="flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-extra-muted transition-colors hover:bg-ink/5 hover:text-ink"
          aria-expanded={expanded()}
          onClick={() => setExpanded((value) => !value)}
        >
          <StarIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">Favorites</span>
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              !expanded() && '-rotate-90'
            )}
          />
        </button>
        <Show when={expanded()}>
          <ul class="ml-4 mt-1 flex w-[calc(100%-1rem)] flex-col gap-0.5">
            <For each={favorites()}>
              {(favorite) => (
                <li>
                  <DriveFavoriteRow
                    favorite={favorite}
                    onOpen={props.onOpen}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}
