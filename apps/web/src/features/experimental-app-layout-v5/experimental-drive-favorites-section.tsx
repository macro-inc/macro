import StarIcon from '@phosphor/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { cn } from '@ui';
import { Show } from 'solid-js';

/** Opens all favorited entities in the Drive list. */
export function ExperimentalDriveFavoritesSection(props: {
  active: boolean;
  onSelectRoot: (favorites: Favorite[]) => void;
}) {
  const favoritesData = useFavoritesData();
  const favorites = () => favoritesData()?.favorites ?? [];

  return (
    <Show when={favorites().length > 0}>
      <button
        type="button"
        class={cn(
          'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
          props.active
            ? 'bg-active text-ink'
            : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
        )}
        aria-current={props.active ? 'page' : undefined}
        onClick={() => props.onSelectRoot(favorites())}
      >
        <StarIcon class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">Favorites</span>
      </button>
    </Show>
  );
}
