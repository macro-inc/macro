import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type InboxViewContext,
  InboxViewProvider,
  useInboxView,
} from './inbox-view-context';
import { INBOX_ENTRY_STATE_KEY } from './persistence';
import type { InboxViewStateOptions } from './types';

const entry = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
}));
const user = vi.hoisted(() => ({ id: 'alice' }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => user.id }));

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

function mountProvider(initialState?: InboxViewStateOptions) {
  let context!: InboxViewContext;
  function ReadContext() {
    context = useInboxView();
    return null;
  }
  const view = render(() => (
    <InboxViewProvider initialState={initialState}>
      <ReadContext />
    </InboxViewProvider>
  ));
  return { ...view, context };
}

beforeEach(() => {
  localStorage.clear();
  user.id = 'alice';
  entry.state = {};
  entry.captors.clear();
});
afterEach(cleanup);

describe('InboxViewProvider initialization', () => {
  it('honors all explicit fields instead of restoring the split entry', () => {
    entry.state = { [INBOX_ENTRY_STATE_KEY]: { version: 1, tab: 'signal' } };
    const initial: InboxViewStateOptions = {
      tab: 'noise',
      search: 'release notes',
      groupBy: 'type',
      facets: { type: ['email'], read: ['unread'] },
    };

    expect(mountProvider(initial).context.state).toEqual(initial);
  });

  it.each([
    { tab: 'signal', groupBy: 'date' },
    { tab: 'noise', groupBy: 'date' },
    { tab: 'reminders', groupBy: 'none' },
  ] as const)('defaults omitted fields for $tab', ({ tab, groupBy }) => {
    expect(mountProvider({ tab }).context.state).toEqual({
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

  it('migrates saved read-only filters to All while preserving entity types', () => {
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
    });
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
