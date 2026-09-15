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
import BookOpenIcon from '@phosphor/book-open.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
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
import type { AgentsMode } from '../core/mode';
import type {
  AgentConversationEntity,
  AgentConversationTarget,
  ConversationGroup,
} from '../core/recent-conversations';
import { ConversationRow } from './ConversationRow';
import { ModeSwitch } from './ModeSwitch';

const AGENT_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  senderBucket: undefined,
};

const AGENT_FAVORITES_FILTER = {
  entityType: ['agent_session', 'chat'],
} satisfies FavoritesFilter;

/** The words that change with the mode. */
const MODE_COPY = {
  chat: {
    newAction: 'New chat',
    listTitle: 'Chats',
    searchLabel: 'Search agent chats',
    searchPlaceholder: 'Search chats',
    emptyTitle: 'No recent chats',
    emptyDescription: 'Your latest agent conversations will appear here.',
    emptyAction: 'Start a chat',
    loading: 'Loading chats…',
    retry: 'Retry loading chats',
    retryMore: 'Retry loading more chats',
    loadingMore: 'Loading more chats',
  },
  code: {
    newAction: 'New session',
    listTitle: 'Sessions',
    searchLabel: 'Search coder sessions',
    searchPlaceholder: 'Search sessions',
    emptyTitle: 'No coder sessions yet',
    emptyDescription: 'Work you hand to a coder will appear here.',
    emptyAction: 'Start a session',
    loading: 'Loading sessions…',
    retry: 'Retry loading sessions',
    retryMore: 'Retry loading more sessions',
    loadingMore: 'Loading more sessions',
  },
} as const satisfies Record<AgentsMode, Record<string, string>>;

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
          <CollapsibleSection.Indicator class="order-first ml-0" />
          <span class="truncate">Favorites</span>
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

function GroupHeading(props: { label: string; count: number }) {
  return (
    <h3 class="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] font-medium text-ink-placeholder first:pt-0">
      {props.label}
      <span class="tabular-nums text-ink-disabled">{props.count}</span>
    </h3>
  );
}

function RecentEmptyState(props: {
  mode: AgentsMode;
  search: string;
  onStart: () => void;
}) {
  const search = () => props.search.trim();
  const copy = () => MODE_COPY[props.mode];

  return (
    <EmptyStatePanel
      centered
      graphic={search() ? EmptyStateNoSearchMatchGraphic : EmptyStateAiGraphic}
      graphicClass="aspect-square h-auto w-[clamp(12rem,70%,18rem)] self-center"
      title={search() ? `No results for "${search()}"` : copy().emptyTitle}
      description={
        search() ? 'Try a different search.' : copy().emptyDescription
      }
      descriptionClass="mt-1 text-balance"
      actionsClass="mt-5 flex-row @max-sm:flex-row"
      topSpacerClass="basis-0"
      titleClass={search() ? 'w-full break-words' : undefined}
      primaryAction={
        search()
          ? undefined
          : {
              label: copy().emptyAction,
              icon: PlusIcon,
              onClick: props.onStart,
            }
      }
      documentationUrl={`${DOCS_BASE}/product/${search() ? 'search' : 'agents'}`}
      documentationIcon={BookOpenIcon}
      class="h-auto overflow-visible px-2 pt-4 @4xl:px-2"
    />
  );
}

export type AgentsSidebarProps = {
  mode: AgentsMode;
  /** Whether Code mode is offered. Off, the sidebar is the Chat half only. */
  modeSwitch: boolean;
  activeConversationId: string | undefined;
  search: string;
  /** The mode's conversations, already filtered and sectioned. */
  groups: ConversationGroup[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  loadMoreError: boolean;
  onModeChange: (mode: AgentsMode) => void;
  /** The New chat / New session button, and the empty state's action. */
  onNewConversation: () => void;
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
  const [scrollRoot, setScrollRoot] = createSignal<HTMLElement>();
  const [loadMoreSentinel, setLoadMoreSentinel] =
    createSignal<HTMLDivElement>();
  let searchInput: HTMLInputElement | undefined;
  const copy = () => MODE_COPY[props.mode];
  const visibleGroups = () => (forceEmptyState() ? [] : props.groups);
  const visibleConversations = (): AgentConversationEntity[] =>
    visibleGroups().flatMap((group) => group.conversations);
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

  const row = (conversation: AgentConversationEntity) => (
    <SoupEntityContextMenu
      entity={conversation}
      list={actionList}
      selectedEntities={() => []}
      viewContext={AGENT_ACTION_VIEW_CONTEXT}
      class="block w-full"
      onOpenChange={(open) => {
        if (!open) return;
        actionController.focus.set(conversation.id, {
          reason: 'pointer',
          force: true,
        });
      }}
    >
      <ConversationRow
        conversation={conversation}
        mode={props.mode}
        active={props.activeConversationId === conversation.id}
        onOpen={() => props.onOpenConversation(conversation)}
      />
    </SoupEntityContextMenu>
  );

  return (
    <ViewSidebar.Root aria-label="Agents navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <SplitPanel.CloseButton />
          <ViewSidebar.Title>Agents</ViewSidebar.Title>
        </div>
        <SplitPanel.ControlGroup>
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </ViewSidebar.Header>

      <Show when={props.modeSwitch}>
        <div class="shrink-0 px-4 pt-3.5">
          <ModeSwitch mode={props.mode} onChange={props.onModeChange} />
        </div>
      </Show>

      <ViewSidebar.Content class="flex flex-col gap-5 overflow-hidden pt-3.5">
        <Button
          variant="cta"
          size="md"
          fullWidth
          class="h-9 shrink-0 justify-start gap-2 rounded-xl px-3 text-sm"
          onClick={props.onNewConversation}
        >
          <PlusIcon class="size-4" />
          {copy().newAction}
        </Button>

        <Show when={!forceEmptyState()}>
          <AgentFavorites onOpenConversation={props.onOpenConversation} />
        </Show>

        <section class="flex min-h-0 flex-1 flex-col gap-1">
          <div class="flex h-7 shrink-0 items-center justify-between pr-1 pl-3 text-xs font-medium text-ink-subtle">
            <h2>{copy().listTitle}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              label={searchOpen() ? 'Close search' : copy().searchLabel}
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
          <Show when={searchOpen()}>
            <SearchBar
              label={copy().searchLabel}
              placeholder={copy().searchPlaceholder}
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
              <ViewSidebar.Nav
                aria-label={`Recent ${copy().listTitle.toLowerCase()}`}
              >
                <For each={visibleGroups()}>
                  {(group) => (
                    <>
                      <Show when={group.label}>
                        {(label) => (
                          <GroupHeading
                            label={label()}
                            count={group.conversations.length}
                          />
                        )}
                      </Show>
                      {/* Soup cache updates replace entity objects. Key rows by
                          id so those updates preserve the list DOM and scroll
                          position. */}
                      <Key each={group.conversations} by="id">
                        {(conversation) => row(conversation())}
                      </Key>
                    </>
                  )}
                </For>
                <Show when={!forceEmptyState() && props.loading}>
                  <p class="px-3 py-2 text-xs text-ink-muted">
                    {copy().loading}
                  </p>
                </Show>
                <Show when={!forceEmptyState() && props.error}>
                  <Button variant="ghost" onClick={props.onRetry}>
                    {copy().retry}
                  </Button>
                </Show>
                <Show
                  when={
                    forceEmptyState() ||
                    (!props.loading &&
                      !props.error &&
                      visibleConversations().length === 0)
                  }
                >
                  <RecentEmptyState
                    mode={props.mode}
                    search={forceEmptyState() ? '' : props.search}
                    onStart={props.onNewConversation}
                  />
                </Show>
                <Show when={!forceEmptyState() && props.hasNextPage}>
                  <div
                    ref={setLoadMoreSentinel}
                    role={props.loadingNextPage ? 'status' : undefined}
                    aria-label={
                      props.loadingNextPage ? copy().loadingMore : undefined
                    }
                    class="grid h-9 shrink-0 place-items-center text-ink-muted"
                  >
                    <Show when={props.loadMoreError}>
                      <Button variant="ghost" onClick={props.onLoadMore}>
                        {copy().retryMore}
                      </Button>
                    </Show>
                    <Show when={!props.loadMoreError && props.loadingNextPage}>
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
        </section>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
