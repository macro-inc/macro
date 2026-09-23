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
  type ChannelsViewContext,
  ChannelsViewProvider,
  useChannelsView,
} from './channels-view-context';
import type { ChannelsViewStateOptions } from './types';

const entry = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
}));
const touch = vi.hoisted(() => ({ value: false }));
const guard = vi.hoisted(() => ({
  selections: [] as unknown[],
  preflights: [] as unknown[],
  allow: true,
}));

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@app/features/next-soup/utils', () => ({
  getChannelEntityTarget: (channel: {
    target?: { messageId: string; threadId?: string };
  }) =>
    channel.target
      ? { kind: 'message', ...channel.target }
      : { kind: 'latest' },
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToResolvedBlockName: (type: string) => type,
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.value,
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

function mountProvider(
  path = '/channels',
  initialState?: ChannelsViewStateOptions
) {
  let context!: ChannelsViewContext;
  let router!: ReturnType<typeof useSplitRouter<string>>;
  const location = createMemorySplitRouterLocation(path);
  function ReadContext() {
    context = useChannelsView();
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
        <ChannelsViewProvider initialState={initialState}>
          <ReadContext />
        </ChannelsViewProvider>
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  return { ...view, context, location, router };
}

beforeEach(() => {
  localStorage.clear();
  entry.state = {};
  entry.captors.clear();
  touch.value = false;
  guard.selections = [];
  guard.preflights = [];
  guard.allow = true;
});
afterEach(cleanup);

describe('ChannelsViewProvider route selection', () => {
  it('takes desktop and mobile tabs from pane search, ahead of saved state', () => {
    entry.state = { 'channels.view': { tab: 'browse', mobileTab: 'channels' } };
    const { context } = mountProvider(
      '/channels?s0.channels.tab=recents&s0.channels.mobileTab=direct_messages'
    );
    expect(context.state.tab).toBe('recents');
    expect(context.state.mobileTab).toBe('direct_messages');
  });

  it('normalizes invalid URL tabs to defaults without restoring stale tabs', async () => {
    const { context, location, router } = mountProvider(
      '/channels?s0.channels.tab=unknown'
    );
    await router.settled();
    expect(context.state.tab).toBe('browse');
    expect(location.read().search).toBe('');
  });

  it('writes each tab to pane search and follows browser Back/Forward', async () => {
    const { context, location, router } = mountProvider();
    context.setTab('recents');
    await router.settled();
    expect(location.read().search).toContain('s0.channels.tab=recents');

    context.setMobileTab('direct_messages');
    await router.settled();
    expect(location.read().search).toContain(
      's0.channels.mobileTab=direct_messages'
    );
    expect(location.back()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('recents');
    expect(context.state.mobileTab).toBe('channels');
    expect(location.forward()).toBe(true);
    await router.settled();
    expect(context.state.mobileTab).toBe('direct_messages');
  });

  it('keeps tab search when entering and leaving inline detail', async () => {
    const { context, location, router } = mountProvider(
      '/channels?s0.channels.tab=recents'
    );
    context.setSelectedChannel({ type: 'channel', id: 'c1' });
    await router.settled();
    expect(location.read().pathname).toBe('/channels/c1');
    expect(location.read().search).toContain('s0.channels.tab=recents');
    context.setSelectedChannel(undefined);
    await router.settled();
    expect(location.read().pathname).toBe('/channels');
    expect(location.read().search).toContain('s0.channels.tab=recents');
  });

  it('persists collapsed labels per user and restores them', () => {
    const storageKey = 'macro:channels:view-state:v1:alice';
    const first = mountProvider();
    first.context.setLabelOpen('enterprise', false);
    first.context.setLabelOpen('smb', false);
    first.context.setLabelOpen('enterprise', false);
    expect(first.context.state.collapsedLabels).toEqual(['enterprise', 'smb']);
    first.context.setLabelOpen('smb', true);
    expect(first.context.state.collapsedLabels).toEqual(['enterprise']);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
      collapsedLabels: ['enterprise'],
    });
    first.unmount();
    const second = mountProvider();
    expect(second.context.state.collapsedLabels).toEqual(['enterprise']);
  });
  it('derives accepted selection from a direct detail route', () => {
    const { context } = mountProvider(
      '/channels/c1?s0.channel-detail.messageId=m1&s0.channel-detail.threadId=t1'
    );

    expect(context.selectedChannel()).toEqual({
      type: 'channel',
      id: 'c1',
      target: { messageId: 'm1', threadId: 't1' },
    });
    expect(guard.selections.at(-1)).toEqual(context.selectedChannel());
  });

  it('navigates with typed target search and closes explicitly to the list', async () => {
    const { context, location, router } = mountProvider();

    expect(
      context.setSelectedChannel({
        type: 'channel',
        id: 'c1',
        target: { messageId: 'm1', threadId: 't1' },
      })
    ).toBe(true);
    await router.settled();
    expect(location.read()).toMatchObject({
      pathname: '/channels/c1',
      search: '?s0.channel-detail.messageId=m1&s0.channel-detail.threadId=t1',
    });
    expect(context.selectedChannel()?.id).toBe('c1');

    expect(context.setSelectedChannel(undefined)).toBe(true);
    await router.settled();
    expect(location.read().pathname).toBe('/channels');
    expect(context.selectedChannel()).toBeUndefined();
  });

  it('keeps the accepted route when compatibility preflight refuses a request', async () => {
    const { context, location, router } = mountProvider('/channels/current');
    guard.allow = false;

    expect(context.setSelectedChannel({ type: 'channel', id: 'blocked' })).toBe(
      false
    );
    await router.settled();
    expect(location.read().pathname).toBe('/channels/current');
    expect(context.selectedChannel()?.id).toBe('current');
  });

  it('replaces a directly loaded incompatible preview with the list route', async () => {
    guard.allow = false;
    const { context, location, router } = mountProvider('/channels/blocked');

    await router.settled();
    expect(location.read().pathname).toBe('/channels');
    expect(context.selectedChannel()).toBeUndefined();
  });

  it('does not route touch selections through the inline preview', async () => {
    touch.value = true;
    const { context, location, router } = mountProvider();

    expect(context.setSelectedChannel({ type: 'channel', id: 'c1' })).toBe(
      false
    );
    await router.settled();
    expect(context.mobileLayout()).toBe(true);
    expect(location.read().pathname).toBe('/channels');
    expect(guard.preflights).toEqual([]);
  });

  it('does not restore the removed selected-id preference', () => {
    const saved = {
      selectedChannelId: 'stale',
      expandedGroups: { channels: false },
    };
    entry.state = { 'channels.view': saved };
    localStorage.setItem(
      'macro:channels:view-state:v1:alice',
      JSON.stringify(saved)
    );
    const { context } = mountProvider();

    expect(context.selectedChannel()).toBeUndefined();
    expect(context.state.expandedGroups.channels).toBe(false);
    expect(entry.captors.get('channels.view')?.()).not.toHaveProperty(
      'selectedChannelId'
    );
  });
});
