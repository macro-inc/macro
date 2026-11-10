import '@fontsource-variable/inter';
// The app's styles: lane controls show and hide by its touch and width rules.
import '../../../src/index.css';
import { createPriorityCollapseController } from '@app/components/priority-collapse/PriorityCollapseOverflowSensor';
import {
  type InboxFeedSource,
  type InboxScope,
  type NotificationInboxRow,
  type NotificationsInboxContext,
  NotificationsInboxProvider,
} from '@app/features/notifications-inbox/context/notifications-inbox-context';
import { NotificationsView } from '@app/features/notifications-inbox/views/notifications-view';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  defineRoutes,
  type Entry,
  type SplitLocation,
  type SplitPanePolicy,
  SplitRouter,
} from '@app/lib/split-router';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import {
  type SplitFileMenuActionGroups,
  SplitLayoutContext,
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import {
  createSplitLayout,
  paneOf,
  type SplitContent,
  type SplitHandle,
} from '@components/app/split-layout/layoutManager';
import { createOwnedSlots } from '@components/app/split-layout/utils/createOwnedSlots';
import { useHotKeyRoot, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createBlockOrchestrator } from '@core/orchestrator';
import type { NotificationSource } from '@notifications';
import { MutationUndoProvider } from '@queries/undo';
import { createElementSize } from '@solid-primitives/resize-observer';
import { macroDarkTheme } from '@theme/themes/macro-dark';
import { macroLightTheme } from '@theme/themes/macro-light';
import { themeCssVars } from '@theme/utils/themeCssVars';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createMutable } from 'solid-js/store';
import { render } from 'solid-js/web';

// As the app's entry does: `touch:` styles follow this attribute.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const DEPLOYS_CHANNEL_ID = '0197a4c2-6f0e-7d31-9a55-3c1f0e8b7a01';
const RANDOM_CHANNEL_ID = '0197a4c2-6f0e-7d31-9a55-3c1f0e8b7a02';
const BUDGET_THREAD_ID = '0197a4c2-6f0e-7d31-9a55-3c1f0e8b7a03';

/** An email that reached the reader: the Signal lane's row. */
const SIGNAL_ROW: NotificationInboxRow = {
  id: `email_thread:${BUDGET_THREAD_ID}#email`,
  type: 'email',
  revision: 'rev-budget-1',
  latestAt: Date.parse('2026-03-02T15:04:00Z'),
  actions: [],
  unseen: true,
  count: 1,
  content: {
    entity: {
      type: 'email',
      id: BUDGET_THREAD_ID,
      name: 'Q3 budget review',
      ownerId: 'macro|viewer@example.com',
      isRead: false,
      isDraft: false,
      isImportant: true,
      done: false,
    },
    notifications: [
      {
        id: 'notification-budget-1',
        entity_id: BUDGET_THREAD_ID,
        entity_type: 'email_thread',
        lane: 'signal',
        state: 'unseen',
        sent: true,
        viewed_at: null,
        created_at: '2026-03-02T15:04:00Z',
        updated_at: '2026-03-02T15:04:00Z',
        notification_event_type: 'new_email',
        notification_metadata: {
          tag: 'new_email',
          content: {
            sender: 'Dana Whitfield',
            subject: 'Q3 budget review',
            snippet: 'Can you look over the numbers before Thursday?',
            threadId: BUDGET_THREAD_ID,
            toEmail: 'viewer@example.com',
          },
        },
      },
    ],
  },
};

/** A bot's post a stack captured, still unread. */
const UNSEEN_NOISE_ROW: NotificationInboxRow = {
  id: `channel:${DEPLOYS_CHANNEL_ID}#noise#top_level`,
  type: 'channel_messages',
  revision: 'rev-deploys-1',
  latestAt: Date.parse('2026-03-02T14:40:00Z'),
  actions: [],
  unseen: true,
  count: 1,
  content: {
    entity: {
      type: 'channel',
      id: DEPLOYS_CHANNEL_ID,
      name: 'deploys',
      ownerId: 'macro|viewer@example.com',
      channelType: 'public',
    },
    notifications: [
      {
        id: 'notification-deploys-1',
        entity_id: DEPLOYS_CHANNEL_ID,
        entity_type: 'channel',
        lane: 'noise',
        state: 'unseen',
        sent: true,
        viewed_at: null,
        created_at: '2026-03-02T14:40:00Z',
        updated_at: '2026-03-02T14:40:00Z',
        notification_event_type: 'channel_message_send',
        notification_metadata: {
          tag: 'channel_message_send',
          content: {
            channelType: 'public',
            channelName: 'deploys',
            messageId: 'message-deploys-1',
            messageContent: 'web-app 412 is live in production',
            senderDisplayName: 'Deploy Bot',
          },
        },
      },
    ],
  },
};

/** A captured post the reader already saw. */
const SEEN_NOISE_ROW: NotificationInboxRow = {
  id: `channel:${RANDOM_CHANNEL_ID}#noise#top_level`,
  type: 'channel_messages',
  revision: 'rev-random-1',
  latestAt: Date.parse('2026-03-02T13:15:00Z'),
  actions: [],
  unseen: false,
  count: 1,
  content: {
    entity: {
      type: 'channel',
      id: RANDOM_CHANNEL_ID,
      name: 'random',
      ownerId: 'macro|viewer@example.com',
      channelType: 'public',
    },
    notifications: [
      {
        id: 'notification-random-1',
        entity_id: RANDOM_CHANNEL_ID,
        entity_type: 'channel',
        lane: 'noise',
        state: 'seen',
        sent: true,
        viewed_at: '2026-03-02T13:20:00Z',
        created_at: '2026-03-02T13:15:00Z',
        updated_at: '2026-03-02T13:20:00Z',
        notification_event_type: 'channel_message_send',
        notification_metadata: {
          tag: 'channel_message_send',
          content: {
            channelType: 'public',
            channelName: 'random',
            messageId: 'message-random-1',
            messageContent: 'Friday lunch poll closes at noon',
            senderDisplayName: 'Lunch Bot',
          },
        },
      },
    ],
  },
};

/**
 * The feed a scope reads, as the server would answer it: each lane holds its
 * own rows, and Unread leaves only the unseen ones.
 */
function createFixtureFeed(
  scope: Accessor<InboxScope>,
  noiseRows: readonly NotificationInboxRow[]
): InboxFeedSource {
  const rows = () => {
    const laneRows = scope().lane === 'noise' ? noiseRows : [SIGNAL_ROW];
    return scope().unreadOnly ? laneRows.filter((row) => row.unseen) : laneRows;
  };

  return {
    rows,
    isLoading: () => false,
    error: () => undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {},
    markDone: async () => ({ undo: async () => {} }),
    markNotificationDone: async () => ({ undo: async () => {} }),
    clear: async () => ({ count: 0, undo: async () => {} }),
    markSeen: async () => {},
  };
}

function createFixtureInboxContext(
  noiseRows: readonly NotificationInboxRow[]
): NotificationsInboxContext {
  let savedFilters: string | null = null;

  return {
    requests: {
      resolveAccessRequest: async () => {},
      answerJoinRequest: async () => {},
    },
    createFeed: (scope) => createFixtureFeed(scope, noiseRows),
    userName: () => undefined,
    senderName: (notification) => {
      const { content } = notification.notification_metadata;
      return 'senderDisplayName' in content
        ? (content.senderDisplayName ?? undefined)
        : undefined;
    },
    openUrl: () => {},
    filterStorage: {
      read: () => savedFilters,
      write: (value) => {
        savedFilters = value;
      },
    },
  };
}

/**
 * The split that shows the inbox: the app's panel context over the layout's
 * own handle, without the app's panel chrome.
 */
function InboxSplit(props: { handle: SplitHandle; children: JSX.Element }) {
  const [attachHotkeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.handle.id}`
  );
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const panelSize = createElementSize(panelRef);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [titleFileMenuRef, setTitleFileMenuRef] =
    createSignal<HTMLDivElement>();
  const [titleFileMenuTrigger, setTitleFileMenuTrigger] =
    createSignal<() => void>();
  const [titleFileMenuActions, setTitleFileMenuActions] =
    createSignal<SplitFileMenuActionGroups>();
  const layoutRefs = createMutable<SplitPanelContextType['layoutRefs']>({});
  const collapse = createPriorityCollapseController();
  const slots = createOwnedSlots();

  return (
    <SplitPanelContext.Provider
      value={{
        handle: props.handle,
        splitHotkeyScope,
        isPanelActive: props.handle.isActive,
        panelRef,
        panelSize,
        contentOffsetTop,
        setContentOffsetTop,
        bottomPanel: () => undefined,
        registerBottomPanel: () => () => {},
        layoutRefs,
        titleFileMenuRef,
        setTitleFileMenuRef,
        titleFileMenuTrigger,
        setTitleFileMenuTrigger,
        titleFileMenuActions,
        setTitleFileMenuActions,
        replaceOwnedSlot: slots.replace,
        headerCollapser: collapse.collapser,
        toolbarCollapser: collapse.collapser,
      }}
    >
      <div
        ref={(element) => {
          setPanelRef(element);
          attachHotkeys(element);
        }}
        class="relative h-dvh"
      >
        {props.children}
      </div>
    </SplitPanelContext.Provider>
  );
}

/**
 * `?mode=` picks what the page shows: `empty-noise` leaves the Noise lane
 * empty, and `no-lanes` renders the inbox as it is without stacks.
 */
function Inbox() {
  const mode = new URLSearchParams(location.search).get('mode');
  const noiseRows =
    mode === 'empty-noise' ? [] : [UNSEEN_NOISE_ROW, SEEN_NOISE_ROW];
  const [shown, setShown] = createSignal({ row: '', item: '' });
  const [settingsOpens, setSettingsOpens] = createSignal(0);

  return (
    <>
      <NotificationsInboxProvider value={createFixtureInboxContext(noiseRows)}>
        <NotificationsView
          lanes={() => mode !== 'no-lanes'}
          onOpen={() => {}}
          onOpenSettings={() => setSettingsOpens((count) => count + 1)}
          shownRow={{ shown, show: (next) => setShown(next) }}
          calendarPreview={{
            open: () => false,
            isOpen: () => false,
            refocus: () => 0,
          }}
        />
      </NotificationsInboxProvider>
      {/* Outside the view, so a test reads what the view asked its host for. */}
      <output class="sr-only" aria-label="Settings opened">
        {settingsOpens()}
      </output>
    </>
  );
}

const NOTIFICATIONS_ROUTE = defineRoute({
  id: 'notifications',
  path: 'notifications',
});
const NOTIFICATIONS_LOCATION: SplitLocation = {
  route: { matches: [{ id: NOTIFICATIONS_ROUTE.id, params: {} }] },
};
const NOTIFICATIONS_CONTENT: SplitContent = {
  type: 'component',
  id: 'notifications',
};

const SINGLE_PANE_POLICY: SplitPanePolicy = {
  placeNewPane: ({ panes }) => ({ insertAt: panes.length }),
  closeAction: () => ({ type: 'keep' }),
  activate: () => {},
};

// The view never reads the app's notification source.
const NO_NOTIFICATION_SOURCE = {} as NotificationSource;

/**
 * The app's split layout and router with one pane on the Notifications route,
 * so the view's panel, preview guard and outlet are the app's own.
 */
function Page() {
  useHotKeyRoot();
  onMount(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = themeCssVars(dark ? macroDarkTheme : macroLightTheme);
    for (const [key, token] of Object.entries(theme)) {
      document.documentElement.style.setProperty(key, token);
    }
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeLight = String(!dark);
  });
  const router = createSplitRouter({
    routes: defineRoutes({
      definitions: [NOTIFICATIONS_ROUTE],
      defaultRoute: () => NOTIFICATIONS_LOCATION.route,
    }),
    history: createMemoryHistory('/notifications'),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: SINGLE_PANE_POLICY,
  });
  onCleanup(router.dispose);
  const orchestrator = createBlockOrchestrator();
  const manager = createSplitLayout(orchestrator, {
    router,
    toLocation: () => NOTIFICATIONS_LOCATION,
    toContent: () => NOTIFICATIONS_CONTENT,
  });

  return (
    <GlobalAppStateProvider
      notificationSource={NO_NOTIFICATION_SOURCE}
      blockOrchestrator={orchestrator}
    >
      <MutationUndoProvider>
        <SplitRouter.Root router={router}>
          <SplitLayoutContext.Provider value={{ manager }}>
            <For each={manager.splits()}>
              {(split) => (
                <Show when={manager.getSplit(split.id)}>
                  {(handle) => (
                    <SplitRouter.Scope pane={paneOf(split.id)}>
                      <InboxSplit handle={handle()}>
                        <Inbox />
                      </InboxSplit>
                    </SplitRouter.Scope>
                  )}
                </Show>
              )}
            </For>
          </SplitLayoutContext.Provider>
        </SplitRouter.Root>
      </MutationUndoProvider>
    </GlobalAppStateProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
render(() => <Page />, root);
