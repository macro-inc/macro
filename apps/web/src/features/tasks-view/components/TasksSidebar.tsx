import {
  CollapsibleSection,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { reviewsSplitRoute } from '@app/features/reviews-view/route';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { enableTasksReviews } from '@core/constant/featureFlags';
import CheckSquareIcon from '@phosphor/check-square.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useTasksView } from '../tasks-view-context';
import type { TasksTab } from '../types';

const TASK_NAV_ITEMS = [
  { id: 'my-tasks', label: 'My Tasks', icon: CheckSquareIcon },
  { id: 'team-tasks', label: 'All Tasks', icon: ListChecksIcon },
  { id: 'created-by-me', label: 'Created by me', icon: NoteIcon },
] satisfies { id: TasksTab; label: string; icon: typeof NoteIcon }[];

export function TasksNavigation(props: {
  reviewsEnabled: boolean;
  onNavigate?: () => void;
}) {
  const { state, setTab } = useTasksView();
  const navigate = useNavigate();

  return (
    <ViewSidebar.Nav aria-label="Task views">
      <Show when={props.reviewsEnabled}>
        <ViewSidebar.Item
          class="mb-3"
          onClick={() => {
            navigate({ route: reviewsSplitRoute, params: {} });
            props.onNavigate?.();
          }}
        >
          <ViewSidebar.Icon>
            <GitPullRequestIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate">Reviews</span>
        </ViewSidebar.Item>
      </Show>
      <For each={TASK_NAV_ITEMS}>
        {(item) => (
          <ViewSidebar.Item
            active={state.tab === item.id}
            onClick={() => {
              setTab(item.id);
              props.onNavigate?.();
            }}
          >
            <ViewSidebar.Icon>
              <Dynamic component={item.icon} class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">{item.label}</span>
          </ViewSidebar.Item>
        )}
      </For>
    </ViewSidebar.Nav>
  );
}

function FavoriteRow(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite, name: string, event: MouseEvent) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);

  return (
    <FavoriteContextMenu favorite={props.favorite} triggerClass="block">
      <ViewSidebar.Item
        title={name()}
        onClick={(event) => props.onOpen(props.favorite, name(), event)}
      >
        <ViewSidebar.Icon>
          <FavoriteIcon favorite={props.favorite} class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">{name()}</span>
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

function TaskFavorites(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useFavoritesData();
  const layout = useSplitLayout();
  const { openTask } = useTasksView();
  const favorites = createMemo(() =>
    (data()?.favorites ?? [])
      .filter(
        (favorite) =>
          favorite.entityType === 'document' &&
          favorite.documentSubType === 'task'
      )
      .sort((left, right) => left.sortOrder - right.sortOrder)
  );
  const openFavorite = (
    favorite: Favorite,
    fallbackName: string,
    event: MouseEvent
  ) => {
    if (openTask({ id: favorite.entityId, fallbackName }, { event })) return;

    const result = layout.openWithSplit(favoriteSplitContent(favorite), {
      referredFrom: 'sidebar',
      preferNewSplit: event.shiftKey,
    });
    if (result.status === 'reused' && result.owner !== result.sourceOwner) {
      toast.alert('Content already open');
    }
  };

  return (
    <Show when={favorites().length > 0}>
      <CollapsibleSection.Root
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <CollapsibleSection.Trigger>
          <span class="min-w-0 truncate">Favorites</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label="Favorite tasks">
            <For each={favorites()}>
              {(favorite) => (
                <FavoriteRow favorite={favorite} onOpen={openFavorite} />
              )}
            </For>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

export function TasksSidebar() {
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const panel = useSplitPanelOrThrow();
  const reviewsFlag = useFeatureFlag(enableTasksReviews);
  const reviewsEnabled = () => reviewsFlag().enabled;
  const {
    state,
    setTab,
    setFacets,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useTasksView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () =>
      reviewsEnabled()
        ? ['reviews', ...TASK_NAV_ITEMS.map((tab) => tab.id)]
        : TASK_NAV_ITEMS.map((tab) => tab.id),
    activeId: () => state.tab,
    setActiveId: (id) => {
      if (id === 'reviews') navigate({ route: reviewsSplitRoute, params: {} });
      else setTab(id as TasksTab);
    },
  });

  return (
    <ViewSidebar.Root aria-label="Tasks navigation">
      <SidebarCreateHeader
        title="Tasks"
        label="New task"
        onCreate={() =>
          layout.popoverSplit({ type: 'component', id: 'task-compose' })
        }
      />

      <ViewSidebar.Content>
        <TasksNavigation reviewsEnabled={reviewsEnabled()} />

        <TaskFavorites
          open={isSidebarSectionOpen('favorites')}
          onOpenChange={(open) => setSidebarSectionOpen('favorites', open)}
        />
        <SidebarTagsSection
          activeIds={state.facets.tags ?? []}
          onActiveIdsChange={(ids) => setFacets({ ...state.facets, tags: ids })}
          open={isSidebarSectionOpen('tags')}
          onOpenChange={(open) => setSidebarSectionOpen('tags', open)}
        />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
