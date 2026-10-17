import { analytics } from '@app/lib/analytics';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useDragOperation } from '@components/app/ItemDragAndDrop';
import { RootFrame } from '@components/app/RootFrame';
import { MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppShell,
  AuthShell,
  FocusedShell,
  withFormRespondShell,
  withMeetingShell,
} from './shells';

const [isAuthenticated, setIsAuthenticated] = createSignal<boolean>();

vi.mock('@app/lib/split-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/lib/split-router')>();
  return {
    ...actual,
    SplitRouter: { ...actual.SplitRouter, Outlet: () => <Page /> },
  };
});
vi.mock('@components/app/split-layout/SplitLayout', () => ({
  SplitLayout: () => <Page />,
}));
vi.mock('@components/app/Layout', () => ({
  AppChrome: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('./lazy-route-views', () => ({ LIKELY_NEXT_VIEWS: [] }));
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => isAuthenticated }));

vi.mock('@app/features/meetings/incoming-meeting-invitations', () => ({
  IncomingMeetingInvitationsProvider: (props: { children: unknown }) =>
    props.children,
}));
vi.mock(
  '@app/features/notifications/PendingNotificationNavigationEffect',
  () => ({
    usePendingNotificationNavigationEffect: () => {},
  })
);
vi.mock('@app/features/soup/search/context', () => ({
  SearchProvider: (props: { children: unknown }) => props.children,
}));
vi.mock('@app/lib/queries/calendar/graphql/use-calendar-cache', () => ({
  useCalendarCache: () => {},
}));
vi.mock('@app/lib/queries/invalidate-on-reconnect', () => ({
  useInvalidateQueriesOnReconnect: () => {},
}));
vi.mock('@app/lib/queries/soup/backfill', () => ({
  useSoupBackfills: () => {},
}));
vi.mock('@app/lib/tauri/notification', () => ({
  MacOSNotificationUpdateRequiredError: class extends Error {},
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/useReactiveFavicon', () => ({
  useReactiveFavicon: () => {},
}));
vi.mock('@core/component/AI/signal/globalAttachments', () => ({
  useGlobalAttachableHistory: () => {},
}));
vi.mock('@core/context/team', () => ({
  TeamContextProvider: (props: { children: unknown }) => props.children,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'test-user' }));
vi.mock('@core/orchestrator', () => ({
  createBlockOrchestrator: () => ({}),
}));
vi.mock('@notifications', () => ({
  createNotificationSource: () => ({}),
  useNotificationUpdates: () => {},
  usePlatformNotificationState: () => 'not-supported',
}));
vi.mock('@notifications/notification-platform', () => ({
  maybeHandlePlatformNotification: () => {},
}));
vi.mock('@queries/chat', () => ({ useChatRenameWebsocketSync: () => {} }));
vi.mock('@queries/sync/use-query-sync', () => ({ useQuerySync: () => {} }));
vi.mock('@queries/undo', () => ({
  MutationUndoProvider: (props: { children: unknown }) => props.children,
}));
vi.mock('@service-connection/client', () => ({
  useRefreshTrackedEntitiesOnFocus: () => {},
  useReopenTrackedEntitiesOnReconnect: () => {},
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: () => {} },
  createWebSocketJob: () => {},
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: () => {}, removeEventListener: () => {} },
  createConnectionWebsocketEffect: () => {},
}));

let pageThrows = false;

/** Stands in for any route's page: reads every context app views rely on. */
function Page() {
  if (pageThrows) throw new Error('page failed');
  useGlobalBlockOrchestrator();
  useGlobalNotificationSource();
  useDragOperation();
  return <p>page rendered</p>;
}

function renderInRootFrame(Shell: () => JSX.Element) {
  return render(() => (
    <MemoryRouter root={RootFrame}>
      <Route path="*" component={Shell} />
    </MemoryRouter>
  ));
}

const shells: [string, () => JSX.Element][] = [
  ['auth (sign-in, onboarding, invites)', AuthShell],
  ['focused (booking)', FocusedShell],
  ['form respond', withFormRespondShell(Page)],
  ['meeting', withMeetingShell(Page)],
  ['app', AppShell],
];

afterEach(() => {
  cleanup();
  pageThrows = false;
  setIsAuthenticated(undefined);
});

describe('route shells', () => {
  it.each(shells)('give %s pages the app providers', async (_, Shell) => {
    renderInRootFrame(Shell);

    expect(await screen.findByText('page rendered')).toBeTruthy();
  });

  it('give signed-in form respondents the app providers', async () => {
    setIsAuthenticated(true);
    renderInRootFrame(withFormRespondShell(Page));

    expect(await screen.findByText('page rendered')).toBeTruthy();
  });

  it('show a recoverable error instead of a blank page when a page throws', async () => {
    const reportError = vi
      .spyOn(analytics.posthog, 'captureException')
      .mockImplementation(() => undefined);
    pageThrows = true;
    renderInRootFrame(AuthShell);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      boundary: 'page',
    });
  });
});
