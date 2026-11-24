// The real Notifications view over a synthetic in-memory feed, on touch (its
// swipe rows) or with a pointer as the device has: its list, stacks and done
// paths, with no network.
import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { SplitRouter } from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import {
  SplitLayoutContext,
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { BlockOrchestrator } from '@core/orchestrator';
import { EntityProvider } from '@entity';
import type { NotificationSource } from '@notifications';
import type { UnifiedNotification } from '@notifications/types';
import { authKeys } from '@queries/auth/keys';
import { staticChannelDirectory } from '@queries/channel/directory';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { MutationUndoProvider, useMutationUndoContext } from '@queries/undo';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type {
  InboxDoneResult,
  InboxFeedSource,
  NotificationInboxRow,
  NotificationsInboxContext,
} from '../context/notifications-inbox-context';
import { NotificationsInboxProvider } from '../context/notifications-inbox-context';
import { withoutDoneNotifications } from '../core/inbox-row';
import type { InboxShownRow } from '../primitives/inbox-selection';
import { NotificationsView } from '../views/notifications-view';

declare global {
  interface Window {
    /** Each done the feed took, in order, with when it took it. */
    __inboxDone: { id: string; at: number }[];
  }
}
window.__inboxDone = [];

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|viewer@example.test',
  email: 'viewer@example.test',
  authenticated: true,
});

document.documentElement.dataset.touchDevice = String(isTouchDevice());
document.documentElement.dataset.themeLight = 'true';
for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const PEOPLE = ['Ana', 'Leo', 'Mara', 'Noor', 'Sam', 'Theo', 'Uma', 'Vic'];
const idOf = (name: string) => `macro|${name.toLowerCase()}@example.test`;

// Every row lands in one date section, so a done takes no divider with it.
const NOW = Date.now();
// `?keep=<row id>`: the feed keeps that row through a done, as the real one
// does when the row changed while the done was on its way.
const KEPT = new URLSearchParams(location.search).get('keep');

const message = (id: string, sender: string, at: number, text: string) =>
  ({
    id,
    entity_type: 'channel',
    entity_id: id,
    sender_id: idOf(sender),
    created_at: new Date(at).toISOString(),
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        senderDisplayName: sender,
        channelType: 'directMessage',
        channelName: sender,
        messageContent: text,
      },
    },
  }) as unknown as UnifiedNotification;

const dmRow = (
  id: string,
  sender: string,
  at: number,
  texts: readonly string[]
): NotificationInboxRow => {
  queryClient.setQueryData(channelKeys.picture(id).queryKey, null);
  return {
    id,
    type: 'channel_messages',
    alsoListedAs: [],
    revision: 'rev',
    latestAt: at,
    actor: { kind: 'user', id: idOf(sender) },
    actions: [],
    unseen: true,
    count: texts.length,
    content: {
      entity: {
        type: 'channel',
        id,
        name: sender,
        channelType: 'directMessage',
      } as never,
      notifications: texts.map((text, index) =>
        message(`${id}-${index + 1}`, sender, at - index, text)
      ),
    },
  };
};

// A two-notification stack first, then one row per person.
const ROWS: NotificationInboxRow[] = [
  dmRow('dm-stack', 'Ana', NOW, ['First of two', 'Second of two']),
  ...PEOPLE.map((sender, index) =>
    dmRow(`dm-${sender.toLowerCase()}`, sender, NOW - (index + 1) * 1_000, [
      `Hello from ${sender}`,
    ])
  ),
];

/** A feed over `ROWS` that hides done rows at once, as the real one does. */
function createFixtureFeed(): InboxFeedSource {
  // Hidden row and notification ids.
  const [hidden, setHidden] = createSignal<readonly string[]>([]);
  const hide = (ids: readonly string[]): InboxDoneResult => {
    setHidden((current) => [...current, ...ids]);
    return {
      undo: async () => {
        setHidden((current) => current.filter((id) => !ids.includes(id)));
      },
    };
  };
  return {
    rows: () =>
      withoutDoneNotifications(
        ROWS.filter((row) => !hidden().includes(row.id)),
        hidden()
      ),
    isLoading: () => false,
    error: () => undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {},
    markDone: async (rows) => {
      for (const row of rows) {
        window.__inboxDone.push({ id: row.id, at: performance.now() });
      }
      return hide(rows.map((row) => row.id).filter((id) => id !== KEPT));
    },
    markNotificationDone: async (_row, notification) => {
      window.__inboxDone.push({ id: notification.id, at: performance.now() });
      return hide([notification.id]);
    },
    clear: async () => ({ count: 0, complete: true, undo: async () => {} }),
    markSeen: async () => {},
  };
}

const inboxContext: NotificationsInboxContext = {
  requests: {
    resolveAccessRequest: async () => {},
    answerJoinRequest: async () => {},
  },
  createFeed: createFixtureFeed,
  userName: (userId) => PEOPLE.find((name) => idOf(name) === userId),
  senderName: () => undefined,
  openUrl: () => {},
  filterStorage: { read: () => null, write: () => {} },
  displayStorage: { read: () => null, write: () => {} },
};

const ROUTER = { href: () => '', panes: () => [] } as unknown as SplitRouter;

function UndoButton() {
  const { undo } = useMutationUndoContext();
  return (
    <button
      type="button"
      class="fixed right-2 bottom-2 z-[100000] rounded bg-ink px-2 py-1 text-surface"
      onClick={() => undo()}
    >
      Undo last done
    </button>
  );
}

function Fixture() {
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('notifications-split');
  const [shown, setShown] = createSignal<InboxShownRow>({ row: '', item: '' });
  // The view reads only these parts of its split.
  const panel = {
    handle: {
      id: 'notifications-split',
      content: () => ({ type: 'component', id: 'unified-list' }),
      setDisplayName: () => {},
      isFirst: () => true,
      isPopover: () => false,
    },
    splitHotkeyScope: scopeId,
    isPanelActive: () => true,
    contentOffsetTop: () => 0,
    setContentOffsetTop: () => {},
    panelSize: { width: window.innerWidth, height: window.innerHeight },
    layoutRefs: {},
  } as unknown as SplitPanelContextType;
  // The preview guard registers what it shows; the fixture opens nothing.
  const layout = {
    manager: {
      registerOpenViews: () => () => {},
      findOpenView: () => undefined,
      splits: () => [],
      getVisibleSplitCount: () => 1,
    } as unknown as SplitManager,
  };
  return (
    <div
      ref={(element) => attachGlobalDOMScope(element)}
      class="fixed inset-0 bg-panel text-ink"
    >
      <div ref={attachSplit} class="size-full">
        <SplitLayoutContext.Provider value={layout}>
          <SplitPanelContext.Provider value={panel}>
            <NotificationsInboxProvider value={inboxContext}>
              <NotificationsView
                onOpen={() => {}}
                onOpenSettings={() => {}}
                shownRow={{
                  shown,
                  show: (next) => setShown(next),
                }}
                calendarPreview={{
                  open: () => false,
                  isOpen: () => false,
                  refocus: () => 0,
                }}
              />
            </NotificationsInboxProvider>
          </SplitPanelContext.Provider>
        </SplitLayoutContext.Provider>
      </div>
      <UndoButton />
    </div>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          {/* The desktop preview and Condensed rows read these. */}
          <GlobalAppStateProvider
            // Condensed rows are Home's, which read who the viewer muted.
            notificationSource={
              { mutedEntities: () => [] } as unknown as NotificationSource
            }
            blockOrchestrator={{} as BlockOrchestrator}
          >
            <EntityProvider>
              <UserContextProvider>
                <ChannelDirectoryProvider
                  directory={staticChannelDirectory(() => [])}
                >
                  <EmailLinksContextProvider>
                    <MobileSettingsProvider>
                      <MutationUndoProvider>
                        {/* The split header's menu links to the split. */}
                        <SplitRouterProvider router={ROUTER}>
                          <MemoryRouter>
                            <Route path="*" component={Fixture} />
                          </MemoryRouter>
                        </SplitRouterProvider>
                      </MutationUndoProvider>
                    </MobileSettingsProvider>
                  </EmailLinksContextProvider>
                </ChannelDirectoryProvider>
              </UserContextProvider>
            </EntityProvider>
          </GlobalAppStateProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root') as HTMLElement
);
