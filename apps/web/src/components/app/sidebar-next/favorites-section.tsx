import { ViewSidebar } from '@app/components/view-shell';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { FavoriteUnreadIndicator } from '@app/features/favorites/FavoriteUnreadIndicator';
import { t } from '@app/lib/i18n';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { For, Show } from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';

/** The single sidebar lists this many favorites, in the user's order. */
const FAVORITES_LIMIT = 8;

function FavoriteRow(props: { favorite: Favorite }) {
  const layout = useSplitLayout();
  const name = useFavoriteDisplayName(props.favorite);
  return (
    <FavoriteContextMenu favorite={props.favorite}>
      <ViewSidebar.Item
        class="cursor-default"
        onClick={(event) =>
          layout.openWithSplit(favoriteSplitContent(props.favorite), {
            preferNewSplit: event.shiftKey,
            referredFrom: 'sidebar',
          })
        }
      >
        <ViewSidebar.Icon>
          <FavoriteIcon favorite={props.favorite} />
        </ViewSidebar.Icon>
        <span class="min-w-0 flex-1 truncate">{name()}</span>
        <FavoriteUnreadIndicator favorite={props.favorite} />
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

/** The user's first favorites across apps, below the app list. */
export function FavoritesSection() {
  const favorites = useFavoritesData();
  const listed = () => (favorites()?.favorites ?? []).slice(0, FAVORITES_LIMIT);
  return (
    <Show when={listed().length > 0}>
      <ViewSidebar.Nav aria-label={t('nav.favorites')} class="pt-4">
        <h3 class="flex h-6 shrink-0 items-center px-(--sidebar-item-inset) text-xs font-medium text-ink-muted">
          {t('nav.favorites')}
        </h3>
        <For each={listed()}>
          {(favorite) => <FavoriteRow favorite={favorite} />}
        </For>
      </ViewSidebar.Nav>
    </Show>
  );
}
