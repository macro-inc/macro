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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type InboxViewContext,
  InboxViewProvider,
  useInboxView,
} from './inbox-view-context';
import { INBOX_ENTRY_STATE_KEY } from './persistence';
import type { InboxViewStateOptions } from './types';

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

const entry = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
}));
const user = vi.hoisted(() => ({ id: 'alice' }));
const guard = vi.hoisted(() => ({
  selections: [] as unknown[],
  preflights: [] as unknown[],
  allow: true,
}));
const blocks = vi.hoisted(() => {
  const aliases: Record<string, string> = {
    task: 'md',
    snippet: 'md',
    skill: 'md',
    csv: 'code',
  };
  return {
    aliases,
    resolve: (type: string) => aliases[type] ?? type,
    aliasContext: (kind: string | undefined) =>
      kind && kind in aliases
        ? { alias: kind, baseType: aliases[kind] }
        : undefined,
  };
});
vi.mock('@core/context/user', () => ({ useUserId: () => () => user.id }));
vi.mock('@components/app/previewTarget', () => ({
  previewCalendarTarget: (selection: {
    id: string;
    occurrenceKey?: string;
  }) => ({
    eventId: selection.id,
    occurrenceKey: selection.occurrenceKey,
    range: {
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-02T00:00:00.000Z',
      startDate: '2025-01-01',
      endDate: '2025-01-02',
    },
  }),
  previewBlockTarget: (selection: {
    type: string;
    id: string;
    channelId?: string;
    messageId?: string;
    threadId?: string;
    target?: { messageId: string; threadId?: string };
    fileType?: string;
    subType?: { type: string };
    occurrenceKey?: string;
    referencedEntity?: {
      id: string;
      type: string;
      fileType?: string;
      subType?: string;
    };
  }) => {
    if (selection.type === 'reminder') {
      const reference = selection.referencedEntity;
      const kind =
        reference?.subType ??
        reference?.fileType ??
        reference?.type ??
        'unknown';
      return {
        blockType: blocks.resolve(kind),
        blockId: reference?.id ?? selection.id,
        aliasContext: blocks.aliasContext(kind),
      };
    }
    if (
      selection.type === 'channel' ||
      selection.type === 'channel_message' ||
      selection.type === 'channel_thread'
    ) {
      const messageId = selection.target?.messageId ?? selection.messageId;
      const threadId = selection.target?.threadId ?? selection.threadId;
      return {
        blockType: 'channel',
        blockId: selection.channelId ?? selection.id,
        aliasContext: undefined,
        params: messageId
          ? {
              channel_message_id: messageId,
              ...(threadId ? { channel_thread_id: threadId } : {}),
            }
          : undefined,
      };
    }
    if (selection.type === 'document') {
      return {
        blockType: blocks.resolve(selection.fileType ?? 'unknown'),
        blockId: selection.id,
        aliasContext: blocks.aliasContext(selection.subType?.type),
      };
    }
    return {
      blockType: selection.type === 'foreign' ? 'unknown' : selection.type,
      blockId: selection.id,
      aliasContext: undefined,
    };
  },
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToResolvedBlockName: (type: string) => blocks.resolve(type),
  isBlockAlias: (type: string) => type in blocks.aliases,
  resolveBlockAlias: (type: string) => blocks.resolve(type),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => true,
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () => {
    const select = (selection: unknown) => {
      guard.selections.push(selection);
      return selection === undefined || guard.allow;
    };
    return Object.assign(select, {
      canSelect: (selection: unknown) => {
        guard.preflights.push(selection);
        return selection === undefined || guard.allow;
      },
    });
  },
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => entry.state,
      registerEntryStateCaptor: (key: string, capture: () => unknown) => {
        entry.captors.set(key, capture);
        return () => entry.captors.delete(key);
      },
    },
  }),
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

function mountProvider(initialState?: InboxViewStateOptions, path = '/inbox') {
  let context!: InboxViewContext;
  let router!: ReturnType<typeof useSplitRouter<string>>;
  const location = createMemorySplitRouterLocation(path);
  function ReadContext() {
    context = useInboxView();
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
        <InboxViewProvider initialState={initialState}>
          <ReadContext />
        </InboxViewProvider>
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  return { ...view, context, location, router };
}

beforeEach(() => {
  localStorage.clear();
  user.id = 'alice';
  entry.state = {};
  entry.captors.clear();
  guard.selections = [];
  guard.preflights = [];
  guard.allow = true;
});
afterEach(cleanup);

describe('InboxViewProvider initialization', () => {
  it('honors explicit fields except the URL-owned tab', () => {
    entry.state = { [INBOX_ENTRY_STATE_KEY]: { version: 1, tab: 'signal' } };
    const initial: InboxViewStateOptions = {
      tab: 'noise',
      search: 'release notes',
      groupBy: 'type',
      facets: { type: ['email'], read: ['unread'] },
    };

    expect(mountProvider(initial).context.state).toEqual({
      ...initial,
      tab: 'signal',
      groupBy: 'date',
    });
  });

  it.each([
    { tab: 'signal', groupBy: 'date' },
    { tab: 'noise', groupBy: 'date' },
    { tab: 'reminders', groupBy: 'none' },
  ] as const)('defaults omitted fields for $tab', ({ tab, groupBy }) => {
    expect(
      mountProvider({ tab }, `/inbox?s0.inbox.tab=${tab}`).context.state
    ).toEqual({
      tab,
      groupBy,
      search: '',
      facets: {},
    });
  });

  it('normalizes facet selections without mutating the caller', () => {
    const facets = { type: ['email', 'channel', 'email'], read: [] };
    const { context } = mountProvider({ facets });

    expect(context.state.facets).toEqual({ type: ['channel', 'email'] });
    expect(facets).toEqual({
      type: ['email', 'channel', 'email'],
      read: [],
    });
  });

  it('preserves explicit empty values and grouping', () => {
    entry.state = {
      [INBOX_ENTRY_STATE_KEY]: {
        version: 1,
        tab: 'noise',
        search: 'old search',
        groupBy: 'type',
        facets: { type: ['email'] },
      },
    };
    expect(
      mountProvider({ search: '', groupBy: 'none', facets: {} }).context.state
    ).toEqual({ tab: 'signal', search: '', groupBy: 'none', facets: {} });
  });

  it('restores filters while resetting entry navigation to Signal', () => {
    entry.state = {
      [INBOX_ENTRY_STATE_KEY]: {
        version: 1,
        tab: 'noise',
        search: 'old search',
        groupBy: 'type',
        facets: { read: ['unread'] },
      },
    };

    expect(mountProvider().context.state).toEqual({
      tab: 'signal',
      search: '',
      groupBy: 'date',
      facets: { read: ['unread'] },
    });
  });

  it('restores filter changes when returning through split history', () => {
    const view = mountProvider({ tab: 'noise', search: 'explicit search' });
    view.context.setState('groupBy', 'type');
    view.context.setFacets({ type: ['email'] });
    const stored = entry.captors.get(INBOX_ENTRY_STATE_KEY)?.();
    expect(stored).toEqual({
      version: 1,
      tab: 'signal',
      facets: { type: ['email'] },
    });

    view.unmount();
    entry.state = { [INBOX_ENTRY_STATE_KEY]: stored };
    expect(mountProvider().context.state).toEqual({
      tab: 'signal',
      search: '',
      groupBy: 'date',
      facets: { type: ['email'] },
    });
  });

  it('persists type and status filters across a full reload with no entry state', () => {
    const view = mountProvider();
    view.context.setFacets({ type: ['none'], read: ['unread'] });
    view.unmount();
    entry.state = {};
    expect(mountProvider().context.state.facets).toEqual({
      type: ['none'],
      read: ['unread'],
    });
  });

  it('uses saved preferences for a fresh Home navigation, but honors explicit facets', () => {
    const view = mountProvider();
    view.context.setFacets({ type: ['channels'] });
    view.unmount();
    const next = mountProvider({ tab: 'signal' });
    expect(next.context.state.facets).toEqual({ type: ['channels'] });
    next.unmount();
    expect(mountProvider({ facets: {} }).context.state.facets).toEqual({});
  });

  it('keeps filters scoped to the signed-in user', () => {
    const view = mountProvider();
    view.context.setFacets({ type: ['none'] });
    view.unmount();
    user.id = 'bob';
    expect(mountProvider().context.state.facets).toEqual({});
  });

  it('restores read-only filters with their entity types', () => {
    localStorage.setItem(
      'macro:home:filters:v1:alice',
      JSON.stringify({
        version: 1,
        facets: { type: ['channels'], read: ['read'] },
      })
    );
    entry.state = {
      [INBOX_ENTRY_STATE_KEY]: {
        version: 1,
        facets: { type: ['channels'], read: ['read'] },
      },
    };
    expect(mountProvider().context.state.facets).toEqual({
      type: ['channels'],
      read: ['read'],
    });
  });

  it('keeps Read and Unread mutually exclusive and normalizes both to All', () => {
    const { context } = mountProvider();
    context.setFacets({ read: ['read'] });
    expect(context.state.facets).toEqual({ read: ['read'] });
    context.setFacets({ read: ['unread'] });
    expect(context.state.facets).toEqual({ read: ['unread'] });
    context.setFacets({ read: ['unread', 'read'] });
    expect(context.state.facets).toEqual({});
  });

  it('persists resetting all filters and tolerates corrupt stored preferences', () => {
    const view = mountProvider();
    view.context.setFacets({ type: ['none'], read: ['unread'] });
    view.context.setFacets({});
    view.unmount();
    const restored = mountProvider();
    expect(restored.context.state.facets).toEqual({});
    restored.unmount();
    localStorage.setItem('macro:home:filters:v1:alice', '{broken');
    expect(mountProvider().context.state.facets).toEqual({});
  });
});

describe('InboxViewProvider route selection', () => {
  it('takes the tab from pane search ahead of explicit and restored state', () => {
    entry.state = { [INBOX_ENTRY_STATE_KEY]: { version: 1, tab: 'signal' } };
    const { context } = mountProvider(
      { tab: 'signal' },
      '/inbox?s0.inbox.tab=noise'
    );
    expect(context.state.tab).toBe('noise');
  });

  it('normalizes invalid URL tabs without restoring an old selection', async () => {
    const { context, location, router } = mountProvider(
      undefined,
      '/inbox?s0.inbox.tab=unknown'
    );
    await router.settled();
    expect(context.state.tab).toBe('signal');
    expect(location.read().search).toBe('');
  });

  it('writes the tab to the URL and follows browser Back/Forward', async () => {
    const { context, location, router } = mountProvider();
    context.setTab('noise');
    await router.settled();
    expect(location.read().search).toBe('?s0.inbox.tab=noise');
    expect(location.back()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('signal');
    expect(location.forward()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('noise');
  });

  it('keeps the URL tab when opening and closing a preview', async () => {
    const { context, location, router } = mountProvider(
      undefined,
      '/inbox?s0.inbox.tab=noise'
    );
    context.openPreview({ type: 'email', id: 'thread-1' });
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/email/thread-1');
    expect(location.read().search).toContain('s0.inbox.tab=noise');
    context.closePreview();
    await router.settled();
    expect(location.read().pathname).toBe('/inbox');
    expect(location.read().search).toBe('?s0.inbox.tab=noise');
  });

  it('rebuilds a targeted channel preview from a direct URL', () => {
    const { context } = mountProvider(
      undefined,
      '/inbox/channel/channel-1?s0.channel-detail.messageId=message-1&s0.channel-detail.threadId=thread-1'
    );

    expect(context.previewTarget()).toEqual({
      blockType: 'channel',
      blockId: 'channel-1',
      aliasContext: undefined,
      params: {
        channel_message_id: 'message-1',
        channel_thread_id: 'thread-1',
      },
    });
    expect(guard.selections.at(-1)).toEqual(context.previewTarget());
  });

  it('serializes a live selection to its block path and closes it through the root route', async () => {
    const { context, location, router } = mountProvider();

    expect(
      context.openPreview({
        type: 'document',
        id: 'task-1',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      })
    ).toBe(true);
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/task/task-1');
    expect(location.read().search).toBe('');
    expect(context.previewTarget()).toEqual({
      blockType: 'md',
      blockId: 'task-1',
      aliasContext: { alias: 'task', baseType: 'md' },
      params: undefined,
    });

    context.closePreview();
    await router.settled();
    expect(location.read().pathname).toBe('/inbox');
    expect(context.previewTarget()).toBeUndefined();
  });

  it('opens calendar events inline at the Calendar route with the locator in search', async () => {
    const { context, location, router } = mountProvider();

    expect(
      context.openPreview({
        type: 'calendar_event',
        id: 'event-1',
        occurrenceKey: 'occurrence-1',
        time: {
          kind: 'timed',
          startsAt: '2025-01-01T12:00:00.000Z',
          endsAt: '2025-01-01T13:00:00.000Z',
        },
      })
    ).toBe(true);
    await router.settled();
    expect(location.read().pathname).toMatch(
      /^\/inbox\/calendar\/(month|week|day)$/
    );
    const search = location.read().search;
    expect(search).toContain('s0.calendar.eventId=event-1');
    expect(search).toContain('s0.calendar.occurrenceKey=occurrence-1');
    expect(search).toContain('s0.calendar.startDate=2025-01-01');
    expect(search).toContain('s0.calendar.endDate=2025-01-02');
    expect(context.calendarOpen()).toBe(true);
    expect(context.previewTarget()).toBeUndefined();

    // The same event again re-aims in place instead of navigating.
    const committed = location.history().length;
    const refocus = context.calendarRefocus();
    expect(
      context.openPreview({
        type: 'calendar_event',
        id: 'event-1',
        occurrenceKey: 'occurrence-1',
      })
    ).toBe(true);
    await router.settled();
    expect(location.history()).toHaveLength(committed);
    expect(location.read().search).toBe(search);
    expect(context.calendarRefocus()).toBe(refocus + 1);

    // Leaving the calendar for a block clears its locator.
    context.openPreview({ type: 'email', id: 'email-1' });
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/email/email-1');
    expect(location.read().search).not.toContain('s0.calendar.');
    expect(context.calendarOpen()).toBe(false);
  });

  it('carries only block identity and location params for other row kinds', async () => {
    const { context, location, router } = mountProvider();

    context.openPreview({
      type: 'reminder',
      id: 'reminder-1',
      referencedEntity: {
        id: 'task-2',
        type: 'document',
        fileType: 'md',
        subType: 'task',
      },
    });
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/task/task-2');
    expect(context.previewTarget()).toMatchObject({
      blockType: 'md',
      blockId: 'task-2',
      aliasContext: { alias: 'task' },
    });

    context.openPreview({
      type: 'foreign',
      id: 'foreign-1',
      foreignSource: 'unknown',
    });
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/unknown/foreign-1');
    expect(context.previewTarget()).toEqual({
      blockType: 'unknown',
      blockId: 'foreign-1',
      aliasContext: undefined,
      params: undefined,
    });

    context.openPreview({
      type: 'channel_message',
      id: 'row-1',
      channelId: 'channel-1',
      messageId: 'message-1',
      threadId: 'thread-1',
    });
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/channel/channel-1');
    expect(location.read().search).toContain(
      's0.channel-detail.messageId=message-1'
    );
    expect(location.read().search).toContain(
      's0.channel-detail.threadId=thread-1'
    );
    expect(context.previewTarget()).toMatchObject({
      params: {
        channel_message_id: 'message-1',
        channel_thread_id: 'thread-1',
      },
    });

    // A previous item's location must not linger on the next one.
    context.openPreview({ type: 'email', id: 'email-1' });
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/email/email-1');
    expect(location.read().search).toBe('');
  });

  it('keeps the accepted preview when compatibility preflight blocks selection', async () => {
    const { context, location, router } = mountProvider(
      undefined,
      '/inbox/email/current'
    );
    guard.allow = false;

    expect(context.openPreview({ type: 'email', id: 'blocked' })).toBe(false);
    await router.settled();
    expect(location.read().pathname).toBe('/inbox/email/current');
    expect(context.previewTarget()).toMatchObject({
      blockType: 'email',
      blockId: 'current',
    });
  });

  it('replaces an incompatible direct preview and closes previews on tab change', async () => {
    guard.allow = false;
    const blocked = mountProvider(undefined, '/inbox/email/blocked');
    await blocked.router.settled();
    expect(blocked.location.read().pathname).toBe('/inbox');
    blocked.unmount();

    guard.allow = true;
    const accepted = mountProvider(undefined, '/inbox/email/open');
    accepted.context.setTab('noise');
    await accepted.router.settled();
    expect(accepted.location.read().pathname).toBe('/inbox');
    expect(accepted.context.state.tab).toBe('noise');
  });
});
