import { createListController } from '@app/components/list';
import {
  CollapsibleSection,
  SearchBar,
  useViewControlHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { DOCS_BASE } from '@app/constants/docs-links';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import {
  type EntityActionViewContext,
  toEntityActionListState,
} from '@app/features/next-soup/actions';
import { SoupEntityContextMenu } from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useFavoriteDisplayName } from '@app/util/favorites';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import EmptyStateAiGraphic from '@design/empty-state-ai.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { Entity, EntityRowIcon } from '@entity';
import BookOpenIcon from '@phosphor/book-open.svg';
import ClockIcon from '@phosphor/clock-clockwise.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import SkillIcon from '@phosphor/sparkle.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  type FavoritesFilter,
  useFavoritesData,
} from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Key } from '@solid-primitives/keyed';
import { Button, cn, EmptyStatePanel, Scroll } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { AgentsPage } from '../core/pages';
import type {
  AgentConversationEntity,
  AgentConversationTarget,
} from '../core/recent-conversations';

const PAGES = [
  { id: 'new', label: 'New Chat', icon: PlusIcon },
  { id: 'routines', label: 'Routines', icon: ClockIcon },
  { id: 'agents', label: 'Agents', icon: RobotIcon },
  { id: 'connections', label: 'Connections', icon: PlugsIcon },
  { id: 'skills', label: 'Skills', icon: SkillIcon },
] satisfies {
  id: AgentsPage;
  label: string;
  icon: typeof PlusIcon;
}[];

const AGENT_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  senderBucket: undefined,
};

const AGENT_FAVORITES_FILTER = {
  entityType: ['agent_session', 'chat'],
} satisfies FavoritesFilter;

function FavoriteRow(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);

  return (
    <FavoriteContextMenu favorite={props.favorite} triggerClass="block">
      <ViewSidebar.Item
        class="font-normal"
        title={name()}
        onClick={() => props.onOpen(props.favorite)}
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <FavoriteIcon favorite={props.favorite} class="size-4" />
        </span>
        <span class="truncate">{name()}</span>
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

function AgentFavorites(props: {
  onOpenConversation: (conversation: AgentConversationTarget) => void;
}) {
  const favoritesData = useFavoritesData(AGENT_FAVORITES_FILTER);
  const [open, setOpen] = createSignal(true);
  const favorites = createMemo(() =>
    (favoritesData()?.favorites ?? []).toSorted(
      (left, right) => left.sortOrder - right.sortOrder
    )
  );

  const openFavorite = (favorite: Favorite) => {
    if (
      favorite.entityType !== 'agent_session' &&
      favorite.entityType !== 'chat'
    ) {
      return;
    }

    props.onOpenConversation({
      id: favorite.entityId,
      type: favorite.entityType,
    });
  };

  return (
    <Show when={favorites().length > 0}>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Trigger class="text-xs">
          <span class="min-w-0 truncate">Favorites</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label="Favorite agent chats">
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

function ConversationRow(props: {
  conversation: AgentConversationEntity;
  active: boolean;
  onOpen: () => void;
}) {
  const timestamp = () =>
    props.conversation.updatedAt ?? props.conversation.createdAt;

  return (
    <ViewSidebar.Item
      active={props.active}
      class="group/recent-chat relative font-normal"
      title={props.conversation.name || 'Untitled chat'}
      onClick={props.onOpen}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <EntityRowIcon entity={props.conversation} class="size-4" />
      </span>
      <span class="min-w-0 flex-1 truncate text-left group-hover/recent-chat:pr-12">
        {props.conversation.name || 'Untitled chat'}
      </span>
      <Show when={timestamp()}>
        {(value) => (
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-light text-ink-extra-muted opacity-0 transition-opacity group-hover/recent-chat:opacity-100 touch:hidden">
            <Entity.Timestamp
              entity={props.conversation}
              overrideTimeStamp={value()}
            />
          </span>
        )}
      </Show>
    </ViewSidebar.Item>
  );
}

function RecentChatsEmptyState(props: {
  search: string;
  onStartChat: () => void;
}) {
  const search = () => props.search.trim();

  return (
    <EmptyStatePanel
      centered
      graphic={search() ? EmptyStateNoSearchMatchGraphic : EmptyStateAiGraphic}
      graphicClass="aspect-square h-auto w-[clamp(12rem,70%,18rem)] self-center"
      title={search() ? `No results for "${search()}"` : 'No recent chats'}
      description={
        search()
          ? 'Try a different search.'
          : 'Your latest agent conversations will appear here.'
      }
      descriptionClass="mt-1 text-balance"
      actionsClass="mt-5 flex-row @max-sm:flex-row"
      topSpacerClass="basis-0"
      titleClass={search() ? 'w-full break-words' : undefined}
      primaryAction={
        search()
          ? undefined
          : {
              label: 'Start a chat',
              icon: PlusIcon,
              onClick: props.onStartChat,
            }
      }
      documentationUrl={`${DOCS_BASE}/product/${search() ? 'search' : 'agents'}`}
      documentationIcon={BookOpenIcon}
      class="h-auto overflow-visible px-2 pt-4 @4xl:px-2"
    />
  );
}

export type AgentsSidebarProps = {
  page: AgentsPage;
  activeConversationId: string | undefined;
  search: string;
  conversations: AgentConversationEntity[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  loadMoreError: boolean;
  onNavigate: (page: AgentsPage) => void;
  onSearchChange: (search: string) => void;
  onOpenConversation: (conversation: AgentConversationTarget) => void;
  onRetry: () => void;
  onLoadMore: () => void;
};

export function AgentsSidebar(props: AgentsSidebarProps) {
  const panel = useSplitPanelOrThrow();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [recentChatsOpen, setRecentChatsOpen] = createSignal(true);
  const [scrollRoot, setScrollRoot] = createSignal<HTMLElement>();
  const [loadMoreSentinel, setLoadMoreSentinel] =
    createSignal<HTMLDivElement>();
  let searchInput: HTMLInputElement | undefined;
  const visibleConversations = () =>
    forceEmptyState() ? [] : props.conversations;
  const actionController = createListController({
    items: visibleConversations,
    getKey: (conversation) => conversation.id,
    isSelectable: () => false,
  });
  const actionList = toEntityActionListState({
    controller: actionController,
    getEntity: (conversation) => conversation,
  });

  const openSearch = () => {
    setRecentChatsOpen(true);
    setSearchOpen(true);
    queueMicrotask(() => searchInput?.focus());
  };

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search agent chats',
      run: () => {
        openSearch();
        return true;
      },
    },
  });

  createEffect(() => {
    const root = scrollRoot();
    const sentinel = loadMoreSentinel();
    if (
      !root ||
      !sentinel ||
      forceEmptyState() ||
      !props.hasNextPage ||
      props.loadingNextPage ||
      props.loadMoreError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (
          forceEmptyState() ||
          !props.hasNextPage ||
          props.loadingNextPage ||
          props.loadMoreError
        ) {
          return;
        }
        props.onLoadMore();
      },
      { root, rootMargin: '0px 0px 200px' }
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  return (
    <ViewSidebar.Root aria-label="Agents navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <SplitPanel.CloseButton />
          <ViewSidebar.Title>Agents</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>

      <ViewSidebar.Content class="flex flex-col gap-6 overflow-hidden pt-4">
        <ViewSidebar.Nav aria-label="Agent views">
          <For each={PAGES}>
            {(item) => (
              <ViewSidebar.Item
                active={props.page === item.id && !props.activeConversationId}
                class="font-normal"
                onClick={() => props.onNavigate(item.id)}
              >
                <Dynamic
                  component={item.icon}
                  aria-hidden="true"
                  class="size-4 shrink-0"
                />
                <span class="truncate">{item.label}</span>
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>

        <Show when={!forceEmptyState()}>
          <AgentFavorites onOpenConversation={props.onOpenConversation} />
        </Show>

        <CollapsibleSection.Root
          open={recentChatsOpen()}
          onOpenChange={setRecentChatsOpen}
          class={cn(
            'flex min-h-0 flex-col gap-1',
            recentChatsOpen() ? 'flex-1' : 'shrink-0'
          )}
        >
          <div class="flex h-7 shrink-0 items-center gap-1 pr-1">
            <CollapsibleSection.Trigger class="h-7 min-w-0 flex-1 py-1 text-xs">
              <span class="min-w-0 truncate">Recent chats</span>
              <CollapsibleSection.Indicator />
            </CollapsibleSection.Trigger>
            <Button
              variant="ghost"
              size="icon-sm"
              label={
                searchOpen() ? 'Close agent chat search' : 'Search agent chats'
              }
              aria-pressed={searchOpen()}
              class={cn(
                'size-7 rounded-lg',
                searchOpen() && 'bg-active text-ink'
              )}
              onClick={() => {
                if (searchOpen()) {
                  props.onSearchChange('');
                  setSearchOpen(false);
                } else {
                  openSearch();
                }
              }}
            >
              <MagnifyingGlassIcon class="size-3.5" />
            </Button>
          </div>
          <CollapsibleSection.Content class="flex min-h-0 flex-1 flex-col gap-1">
            <Show when={searchOpen()}>
              <SearchBar
                label="Search agent chats"
                placeholder="Search chats"
                ref={(element) => {
                  searchInput = element;
                }}
                value={props.search}
                onValueChange={props.onSearchChange}
                onEscape={() => {
                  if (!props.search) setSearchOpen(false);
                }}
                class="h-9 shrink-0 rounded-xl"
              />
            </Show>
            <div class="relative min-h-0 flex-1">
              <Scroll scrollRef={setScrollRoot}>
                <ViewSidebar.Nav aria-label="Recent agent chats">
                  {/* Soup cache updates replace entity objects. Key rows by id so
                      those updates preserve the list DOM and scroll position. */}
                  <Key each={visibleConversations()} by="id">
                    {(conversation) => (
                      <SoupEntityContextMenu
                        entity={conversation()}
                        list={actionList}
                        selectedEntities={() => []}
                        viewContext={AGENT_ACTION_VIEW_CONTEXT}
                        class="block w-full"
                        onOpenChange={(open) => {
                          if (!open) return;
                          actionController.focus.set(conversation().id, {
                            reason: 'pointer',
                            force: true,
                          });
                        }}
                      >
                        <ConversationRow
                          conversation={conversation()}
                          active={
                            props.activeConversationId === conversation().id
                          }
                          onOpen={() =>
                            props.onOpenConversation(conversation())
                          }
                        />
                      </SoupEntityContextMenu>
                    )}
                  </Key>
                  <Show when={!forceEmptyState() && props.loading}>
                    <p class="px-3 py-2 text-xs text-ink-muted">
                      Loading chats…
                    </p>
                  </Show>
                  <Show when={!forceEmptyState() && props.error}>
                    <Button variant="ghost" onClick={props.onRetry}>
                      Retry loading chats
                    </Button>
                  </Show>
                  <Show
                    when={
                      forceEmptyState() ||
                      (!props.loading &&
                        !props.error &&
                        props.conversations.length === 0)
                    }
                  >
                    <RecentChatsEmptyState
                      search={forceEmptyState() ? '' : props.search}
                      onStartChat={() => props.onNavigate('new')}
                    />
                  </Show>
                  <Show when={!forceEmptyState() && props.hasNextPage}>
                    <div
                      ref={setLoadMoreSentinel}
                      role={props.loadingNextPage ? 'status' : undefined}
                      aria-label={
                        props.loadingNextPage ? 'Loading more chats' : undefined
                      }
                      class="grid h-9 shrink-0 place-items-center text-ink-muted"
                    >
                      <Show when={props.loadMoreError}>
                        <Button variant="ghost" onClick={props.onLoadMore}>
                          Retry loading more chats
                        </Button>
                      </Show>
                      <Show
                        when={!props.loadMoreError && props.loadingNextPage}
                      >
                        <SpinnerIcon class="size-4 animate-spin" />
                      </Show>
                    </div>
                  </Show>
                </ViewSidebar.Nav>
              </Scroll>
              <ScrollIndicators
                scrollRef={scrollRoot}
                appearance="gradient"
                gradientColor="panel"
              />
            </div>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
