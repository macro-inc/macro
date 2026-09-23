import {
  SplitRouter,
  type SplitRouterEntry,
  type SplitRouterLayout,
  type SplitRouterSettledChange,
  useSplitRouter,
} from '@app/lib/split-router';
import { createMemorySplitRouterLocation } from '@app/lib/split-router/integrations/memory';
import { appSplitRoutes } from '@components/app/split-layout/split-router/app-routes';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailViewProvider, useEmailView } from './email-view-context';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@property/tags/tag-sets-context', () => ({
  useTagSets: () => () => [],
  useTagSetsReady: () => () => true,
}));
vi.mock('@app/features/soup/collection/list-navigation-source', () => ({
  registerListNavigationSource: () => () => {},
}));
vi.mock('@app/features/next-soup/soup-view/inbox-filter-controllers', () => ({
  registerInboxFilterSplit: () => () => {},
  INBOX_FILTER_ENTRY_KEY: 'inbox.filter',
}));
vi.mock('./queries/use-email-query', () => ({
  useEmailDataSource: () => ({ items: () => [] }),
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () =>
    Object.assign(() => true, { canSelect: () => true }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      id: 'split',
      currentEntryState: () => ({}),
      registerEntryStateCaptor: () => () => {},
    },
  }),
  withSplitPanelOwner: (_name: string, factory: () => unknown) => factory(),
}));

function createLayout(): SplitRouterLayout<string> {
  let current: (SplitRouterEntry & { splitId: string }) | undefined;
  const listeners = new Set<(change: SplitRouterSettledChange) => void>();
  const notify = () => {
    for (const listener of listeners) listener({ history: 'push' });
  };
  return {
    snapshot: () => ({ entries: current ? [current] : [] }),
    updateCurrentEntry(_splitId, update) {
      if (!current) return;
      current = { splitId: current.splitId, ...update(current) };
      notify();
    },
    open: () => {},
    reconcile(entries) {
      const next = entries[0];
      current = next ? { splitId: 'split', ...next } : undefined;
      notify();
    },
    activate: () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function mountProvider(path = '/mail') {
  let context!: ReturnType<typeof useEmailView>;
  let router!: ReturnType<typeof useSplitRouter<string>>;
  const location = createMemorySplitRouterLocation(path);
  function ReadContext() {
    context = useEmailView();
    router = useSplitRouter<string>();
    return null;
  }
  const view = render(() => (
    <SplitRouter.Root
      layout={createLayout()}
      routes={appSplitRoutes}
      location={location}
    >
      <SplitRouter.Scope splitId="split">
        <EmailViewProvider>
          <ReadContext />
        </EmailViewProvider>
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  return { ...view, context, location, router };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('EmailViewProvider URL tabs', () => {
  it('initializes from the pane-local URL and survives inline detail navigation', async () => {
    const { context, location, router } = mountProvider(
      '/mail?s0.mail.tab=sent'
    );
    expect(context.state.tab).toBe('sent');
    expect(context.openThread({ id: 'thread-1' })).toBe(true);
    await router.settled();
    expect(location.read().pathname).toBe('/mail/thread-1');
    expect(location.read().search).toContain('s0.mail.tab=sent');
    context.closeThread();
    await router.settled();
    expect(location.read().pathname).toBe('/mail');
    expect(location.read().search).toBe('?s0.mail.tab=sent');

    context.openThread({ id: 'thread-2' });
    await router.settled();
    context.setTab('drafts');
    await router.settled();
    expect(location.read().pathname).toBe('/mail');
    expect(location.read().search).toBe('?s0.mail.tab=drafts');
  });

  it('switches tabs in one URL navigation and follows browser history', async () => {
    const { context, location, router } = mountProvider();
    context.setTab('noise');
    await router.settled();
    expect(location.read().search).toBe('?s0.mail.tab=noise');
    expect(location.back()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('important');
    expect(location.forward()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('noise');
    context.showTags(['tag-1']);
    await router.settled();
    expect(context.state.tab).toBe('all');
    expect(location.read().search).toBe('?s0.mail.tab=all');
  });
});
