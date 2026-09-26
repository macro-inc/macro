import {
  CollapsibleSection,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { globalSplitManager } from '@app/signal/splitLayout';
import { PrStatusIcon } from '@block-pr/component/PrStatus';
import {
  type PrForeignEntityData,
  prForeignEntityQueryOptions,
} from '@block-pr/data/queries';
import { prDisplayName } from '@block-pr/util/prKey';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import SplitIcon from '@phosphor/columns.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import StarIcon from '@phosphor/star.svg';
import UserIcon from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import {
  useFavoritesData,
  useRemoveFavoriteMutation,
} from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { makePersisted } from '@solid-primitives/storage';
import { useQueries } from '@tanstack/solid-query';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { ReviewsScope } from '../reviews-types';

function ReviewFavoriteRow(props: {
  favorite: Favorite;
  data: PrForeignEntityData;
  onOpenReview: (id: string, newSplit: boolean) => void;
  activeForeignEntityId?: string;
}) {
  const removeFavorite = useRemoveFavoriteMutation();
  const name = () =>
    props.data.pullRequest.name ?? prDisplayName(props.data.prRef);

  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" class="w-full">
        <ViewSidebar.Item
          title={name()}
          active={props.activeForeignEntityId === props.favorite.entityId}
          onClick={(event) =>
            props.onOpenReview(props.favorite.entityId, event.shiftKey)
          }
        >
          <ViewSidebar.Icon>
            <PrStatusIcon
              status={props.data.pullRequest.status ?? 'open'}
              class="size-4"
            />
          </ViewSidebar.Icon>
          <span class="truncate">{name()}</span>
        </ViewSidebar.Item>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="w-56 text-xs text-ink-muted">
          <MenuItem
            icon={SplitIcon}
            text="Open in new split"
            disabled={!globalSplitManager()?.canAppendSplit()}
            onClick={() => {
              if (globalSplitManager()?.canAppendSplit())
                props.onOpenReview(props.favorite.entityId, true);
            }}
          />
          <MenuItem
            icon={StarIcon}
            text="Remove from favorites"
            onClick={() =>
              removeFavorite.mutate({
                entityType: 'foreign_entity',
                entityId: props.favorite.entityId,
              })
            }
          />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

function ReviewFavorites(props: {
  onOpenReview: (id: string, newSplit: boolean) => void;
  activeForeignEntityId?: string;
}) {
  const favoritesData = useFavoritesData({ entityType: ['foreign_entity'] });
  const favorites = createMemo(() =>
    (favoritesData()?.favorites ?? [])
      .filter((favorite) => favorite.entityType === 'foreign_entity')
      .sort((left, right) => left.sortOrder - right.sortOrder)
  );
  const queries = useQueries(() => ({
    queries: favorites().map((favorite) =>
      prForeignEntityQueryOptions(favorite.entityId)
    ),
  }));
  const pullRequests = () =>
    favorites().flatMap((favorite, index) => {
      const query = queries[index];
      const data = query?.isPending ? undefined : query?.data;
      return data?.id === favorite.entityId ? [{ favorite, data }] : [];
    });
  const [open, setOpen] = makePersisted(createSignal(true), {
    name: 'reviews-favorites-open',
  });

  return (
    <Show when={pullRequests().length > 0}>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Trigger>
          <span class="min-w-0 truncate">Favorites</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label="Favorite pull requests">
            <For each={pullRequests()}>
              {({ favorite, data }) => (
                <ReviewFavoriteRow
                  favorite={favorite}
                  data={data}
                  onOpenReview={props.onOpenReview}
                  activeForeignEntityId={props.activeForeignEntityId}
                />
              )}
            </For>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

export function ReviewsSidebar(props: {
  scope: ReviewsScope;
  onScopeChange: (scope: ReviewsScope) => void;
  onOpenReview: (id: string, newSplit: boolean) => void;
  activeForeignEntityId?: string;
}) {
  const panel = useSplitPanelOrThrow();
  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => ['involving', 'all', 'authored'] as ReviewsScope[],
    activeId: () => props.scope,
    setActiveId: props.onScopeChange,
  });

  return (
    <ViewSidebar.Root aria-label="Reviews navigation">
      <ViewSidebar.Header>
        <ViewSidebar.Title>Reviews</ViewSidebar.Title>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <ViewSidebar.Nav aria-label="Pull request views">
          <ViewSidebar.Item
            active={props.scope === 'involving'}
            onClick={() => props.onScopeChange('involving')}
          >
            <ViewSidebar.Icon>
              <UsersThreeIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">Involving me</span>
          </ViewSidebar.Item>
          <ViewSidebar.Item
            active={props.scope === 'all'}
            onClick={() => props.onScopeChange('all')}
          >
            <ViewSidebar.Icon>
              <GitPullRequestIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">All PRs</span>
          </ViewSidebar.Item>
          <ViewSidebar.Item
            active={props.scope === 'authored'}
            onClick={() => props.onScopeChange('authored')}
          >
            <ViewSidebar.Icon>
              <UserIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">Authored by me</span>
          </ViewSidebar.Item>
        </ViewSidebar.Nav>
        <ReviewFavorites
          onOpenReview={props.onOpenReview}
          activeForeignEntityId={props.activeForeignEntityId}
        />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
