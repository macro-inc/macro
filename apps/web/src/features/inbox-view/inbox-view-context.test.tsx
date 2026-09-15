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

  it('still resets restored entries to the unfiltered Signal defaults', () => {
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
      facets: {},
    });
  });

  it('keeps the persistence reset when returning from an explicitly initialized view', () => {
    const view = mountProvider({ tab: 'noise', search: 'explicit search' });
    view.context.setState('groupBy', 'type');
    view.context.setFacets({ type: ['email'] });
    const stored = entry.captors.get(INBOX_ENTRY_STATE_KEY)?.();
    expect(stored).toEqual({ version: 1, tab: 'signal' });

    view.unmount();
    entry.state = { [INBOX_ENTRY_STATE_KEY]: stored };
    expect(mountProvider().context.state).toEqual({
      tab: 'signal',
      search: '',
      groupBy: 'date',
      facets: {},
    });
  });
});
