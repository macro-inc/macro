import { AppProviders } from '@components/app/AppProviders';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { createBlockOrchestrator } from '@core/orchestrator';
import { render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { createSignal, Show } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { Permissions } from '../SharePermissions';
import { openShareModal, useShareModal } from './shareModal';

let observedOrchestrator:
  | ReturnType<typeof useGlobalBlockOrchestrator>
  | undefined;

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
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'test-user',
  useUserInfo: () => () => ({ userId: 'test-user' }),
  useIsAuthenticated: () => () => true,
}));
vi.mock('@core/orchestrator', () => ({
  createBlockOrchestrator: vi.fn(() => ({})),
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
vi.mock('@service-connection/websocket', () => ({
  ws: {},
  createConnectionWebsocketEffect: () => {},
}));

vi.mock('./ShareButton', () => ({
  ShareModal: (props: {
    id: string;
    name: string;
    onOpenChange: (open: boolean) => void;
  }) => {
    if (props.id === 'regression-doc') {
      observedOrchestrator = useGlobalBlockOrchestrator();
    }
    return (
      <button
        type="button"
        data-testid="share-modal"
        onClick={() => props.onOpenChange(false)}
      >
        {props.name}
      </button>
    );
  },
}));
vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentAccessLevelQuery: vi.fn(),
  useDocumentMetadataQuery: vi.fn(),
}));

describe('useShareModal', () => {
  it('waits for share data before opening', async () => {
    const [ready, setReady] = createSignal(false);
    let openShare!: () => void;
    render(() => {
      openShare = useShareModal(() =>
        ready()
          ? {
              id: 'doc-1',
              blockAlias: 'md',
              itemType: 'document',
              name: 'Plan',
              userPermissions: Permissions.OWNER,
            }
          : undefined
      );
      return <ImperativeDialogHost />;
    });

    openShare();
    expect(screen.queryByTestId('share-modal')).toBeNull();

    setReady(true);
    expect((await screen.findByTestId('share-modal')).textContent).toBe('Plan');
  });

  it('reports when the person closes an opened modal', async () => {
    const onClose = vi.fn();
    const [owned, setOwned] = createSignal(true);
    let openShare!: () => void;
    function Opener() {
      openShare = useShareModal(
        () => ({
          id: 'doc-1',
          blockAlias: 'md',
          itemType: 'document',
          name: 'Plan',
          userPermissions: Permissions.OWNER,
        }),
        { onClose }
      );
      return null;
    }
    render(() => (
      <>
        <Show when={owned()}>
          <Opener />
        </Show>
        <ImperativeDialogHost />
      </>
    ));

    openShare();
    (await screen.findByTestId('share-modal')).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('share-modal')).toBeNull();

    // Unmounting the owner closes the modal without reporting it.
    openShare();
    await screen.findByTestId('share-modal');
    setOwned(false);
    await vi.waitFor(() =>
      expect(screen.queryByTestId('share-modal')).toBeNull()
    );
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps an app-owned share dialog across menu disposal and clears it on app disposal', async () => {
    const [showMenu, setShowMenu] = createSignal(true);
    const [showApp, setShowApp] = createSignal(true);
    const orchestratorFactory = vi.mocked(createBlockOrchestrator);
    const firstCall = orchestratorFactory.mock.calls.length;

    function Menu() {
      return (
        <button
          type="button"
          data-testid="open-share"
          onClick={() =>
            openShareModal({
              id: 'regression-doc',
              blockAlias: 'md',
              itemType: 'document',
              name: 'Regression',
              userPermissions: Permissions.OWNER,
            })
          }
        >
          Share
        </button>
      );
    }

    const view = render(() => (
      <Show when={showApp()}>
        <AppProviders>
          <Show when={showMenu()}>
            <Menu />
          </Show>
        </AppProviders>
      </Show>
    ));

    screen.getByTestId('open-share').click();
    expect((await screen.findByTestId('share-modal')).textContent).toBe(
      'Regression'
    );
    const firstOrchestrator = orchestratorFactory.mock.results[firstCall].value;
    expect(observedOrchestrator).toBe(firstOrchestrator);

    setShowMenu(false);
    expect(screen.queryByTestId('open-share')).toBeNull();
    expect(screen.getByTestId('share-modal').textContent).toBe('Regression');

    setShowApp(false);
    await vi.waitFor(() =>
      expect(screen.queryByTestId('share-modal')).toBeNull()
    );

    setShowMenu(true);
    setShowApp(true);
    screen.getByTestId('open-share').click();
    await screen.findByTestId('share-modal');
    const nextOrchestrator =
      orchestratorFactory.mock.results[firstCall + 1].value;
    expect(nextOrchestrator).not.toBe(firstOrchestrator);
    expect(observedOrchestrator).toBe(nextOrchestrator);
    view.unmount();
  });
});
