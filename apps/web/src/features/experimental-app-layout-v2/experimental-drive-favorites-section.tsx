import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { SidebarOpenInSplitMenu } from '@components/app/app-sidebar/sidebar-open-in-split-menu';
import { useSplitLayout } from '@components/app/split-layout/layout';
import CaretRightIcon from '@phosphor/caret-right.svg';
import StarIcon from '@phosphor/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { makePersisted } from '@solid-primitives/storage';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';

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
    <SidebarOpenInSplitMenu content={content} triggerClass="w-full">
      <button
      type="button"
      class={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium outline-none transition-colors',
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
    </SidebarOpenInSplitMenu>
  );
}

/** Collapsible shortcuts to favorited entities. */
export function ExperimentalDriveFavoritesSection(props: {
  active: boolean;
  onSelectRoot: (favorites: Favorite[]) => void;
  onOpen?: () => void;
}) {
  const favoritesData = useFavoritesData();
  const favorites = () => favoritesData()?.favorites ?? [];
  const [expanded, setExpanded] = makePersisted(createSignal(true), {
    name: 'experimental-v2-drive-favorites-expanded',
  });

  return (
    <Show when={favorites().length > 0}>
      <section class="w-full">
        <div
          class={cn(
            'flex h-9 w-full items-center rounded-xl pl-3 pr-1.5 text-sm font-medium transition-colors',
            props.active
              ? 'bg-active text-ink'
              : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
          )}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:underline"
            aria-current={props.active ? 'page' : undefined}
            onClick={() => props.onSelectRoot(favorites())}
          >
            <StarIcon class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">Favorites</span>
          </button>
          <button
            type="button"
            class="flex size-6 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-ink/7 focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={`${expanded() ? 'Collapse' : 'Expand'} Favorites`}
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            <CaretRightIcon
              class={cn(
                'size-3 transition-transform',
                expanded() && 'rotate-90'
              )}
            />
          </button>
        </div>
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
