import { INBOX_FILTER_ENTRY_KEY } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import { makePersistedState } from '@app/lib/persistence';
import type { EntryState } from '@components/app/split-layout/layoutManager';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createRoot, createSignal, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import { emailTabFilterState } from './filters/email-saved-view';
import {
  type CreateEmailViewPersistenceOptions,
  createEmailViewPersistence,
} from './persistence';
import type { EmailViewState } from './types';

// The soup barrel persistence imports opens real sockets at module scope.
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

const current = (): EmailViewState => ({
  tab: 'important',
  search: '',
  inboxIds: undefined,
  facets: {},
  focusSort: 'importance',
  collapsedSidebarSectionIds: [],
});

describe('createEmailViewPersistence', () => {
  it('restores the alias together with its owning inbox', () => {
    const aliasFilter = {
      inboxId: 'inbox',
      emailAddress: 'resident@example.com',
    };
    const handle: CreateEmailViewPersistenceOptions['handle'] = {
      currentEntryState: () => ({
        'email.view': { version: 1, tab: 'all', aliasFilter },
        [INBOX_FILTER_ENTRY_KEY]: ['inbox'],
      }),
      registerEntryStateCaptor: () => () => {},
      captureEntryState: () => {},
    };
    const { storages } = createEmailViewPersistence({
      entryId: () => undefined,
      handle,
      userId: () => undefined,
      restoreLocalState: false,
      restorePreferences: false,
    });
    const list = Array.isArray(storages) ? storages : [storages];
    let state = current();
    for (const storage of list) state = storage.restore(state) ?? state;
    expect(state.aliasFilter).toEqual(aliasFilter);
    expect(state.inboxIds).toEqual(['inbox']);
  });
  it('restores a stored archived tab', () => {
    const handle: CreateEmailViewPersistenceOptions['handle'] = {
      currentEntryState: () => ({
        'email.view': {
          version: 1,
          tab: 'archived',
          search: '',
          facets: {},
        },
      }),
      registerEntryStateCaptor: () => () => {},
      captureEntryState: () => {},
    };
    const { storages } = createEmailViewPersistence({
      entryId: () => undefined,
      handle,
      userId: () => undefined,
      restoreLocalState: false,
      restorePreferences: false,
    });
    const list = Array.isArray(storages) ? storages : [storages];
    let state = current();
    for (const storage of list) {
      const next = storage.restore(state);
      if (next !== undefined) state = next;
    }

    expect(state.tab).toBe('archived');
  });

  it('keeps the Focus tab and its sort per user', () => {
    const handle: CreateEmailViewPersistenceOptions['handle'] = {
      currentEntryState: () => ({}),
      registerEntryStateCaptor: () => () => {},
      captureEntryState: () => {},
    };
    const { storages } = createEmailViewPersistence({
      entryId: () => undefined,
      handle,
      userId: () => 'focus-sort-user',
      restoreEntryState: false,
      restorePreferences: false,
    });
    const list = Array.isArray(storages) ? storages : [storages];
    for (const storage of list) {
      storage.initialize?.(current(), current);
      storage.write({ ...current(), tab: 'focus', focusSort: 'importance' });
    }

    let state: EmailViewState = { ...current(), focusSort: 'recent' };
    for (const storage of list) {
      const next = storage.restore(state);
      if (next !== undefined) state = next;
    }

    expect(state.tab).toBe('focus');
    expect(state.focusSort).toBe('importance');
  });

  it('lands a saved retired Priority sort on most recent, keeping the rest', () => {
    createUserScopedStorage('macro:email:view-state:v1').write(
      'priority-sort-user',
      JSON.stringify({ version: 1, tab: 'focus', focusSort: 'priority' })
    );
    const { storages } = createEmailViewPersistence({
      entryId: () => undefined,
      handle: {
        currentEntryState: () => ({}),
        registerEntryStateCaptor: () => () => {},
        captureEntryState: () => {},
      },
      userId: () => 'priority-sort-user',
      restoreEntryState: false,
      restorePreferences: false,
    });
    const list = Array.isArray(storages) ? storages : [storages];

    let state = current();
    for (const storage of list) {
      const next = storage.restore(state);
      if (next !== undefined) state = next;
    }

    expect(state.focusSort).toBe('recent');
    expect(state.tab).toBe('focus');
  });

  it('keeps the tab and inboxes from before an open view in the entry', () => {
    const captors = new Map<string, () => unknown>();
    const { storages } = createEmailViewPersistence({
      entryId: () => undefined,
      handle: {
        currentEntryState: () => ({}),
        registerEntryStateCaptor: (key, capture) => {
          captors.set(key, capture);
          return () => {};
        },
        captureEntryState: () => {},
      },
      userId: () => undefined,
      restoreLocalState: false,
      restorePreferences: false,
    });
    const aliasFilter = {
      inboxId: 'inbox',
      emailAddress: 'resident@example.com',
    };
    const viewOpen: EmailViewState = {
      ...current(),
      tab: 'all',
      inboxIds: ['view-inbox'],
      facets: { read: ['unread'] },
      conditions: {
        participants: [{ type: 'domain', domain: 'example.com' }],
        participantFields: ['from'],
        subject: [],
        starred: false,
      },
      beforeSavedView: { tab: 'important', inboxIds: ['inbox'], aliasFilter },
    };
    for (const storage of Array.isArray(storages) ? storages : [storages])
      storage.write(viewOpen);

    expect(captors.get('email.view')?.()).toEqual({
      version: 1,
      tab: 'important',
      search: '',
      aliasFilter,
      facets: {},
    });
    expect(captors.get(INBOX_FILTER_ENTRY_KEY)?.()).toEqual(['inbox']);
  });

  const restoreFrom = (stored: unknown) => {
    const handle: CreateEmailViewPersistenceOptions['handle'] = {
      currentEntryState: () => ({ 'email.view': stored }),
      registerEntryStateCaptor: () => () => {},
      captureEntryState: () => {},
    };
    const { storages } = createEmailViewPersistence({
      entryId: () => undefined,
      handle,
      userId: () => undefined,
      restoreLocalState: false,
      restorePreferences: false,
    });
    let state = current();
    for (const storage of Array.isArray(storages) ? storages : [storages]) {
      const next = storage.restore(state);
      if (next !== undefined) state = next;
    }
    return state;
  };

  it('lands filters saved before tabs kept conditions on the tab’s own', () => {
    const state = restoreFrom({
      version: 1,
      tab: 'important',
      search: '',
      facets: { read: ['unread'] },
    });

    expect(state.facets).toEqual({ done: ['not-done'], read: ['unread'] });
    expect(state.conditions?.importance).toBe('signal');
  });

  it('restores a tab’s changed conditions as they were', () => {
    const state = restoreFrom({
      version: 1,
      tab: 'favorites',
      search: '',
      facets: {},
      conditions: {
        participants: [{ type: 'domain', domain: 'Example.com' }],
        participantFields: ['from'],
        subject: [],
        starred: false,
      },
    });

    expect(state.facets).toEqual({});
    expect(state.conditions).toEqual({
      participants: [{ type: 'domain', domain: 'example.com' }],
      participantFields: ['from'],
      subject: [],
      starred: false,
    });
  });
});

/**
 * One pane of a browser tab and its router entries, kept in memory like the
 * split manager's: captors write the current entry only when asked, which the
 * manager also does right before a navigation leaves it.
 */
function splitPane() {
  const [entryId, setEntryId] = createSignal('list-entry');
  const entries = new Map<string, EntryState>();
  const captors = new Map<string, () => unknown>();
  const handle: CreateEmailViewPersistenceOptions['handle'] = {
    currentEntryState: () => entries.get(untrack(entryId)),
    registerEntryStateCaptor: (key, capture) => {
      captors.set(key, capture);
      return () => {
        if (captors.get(key) === capture) captors.delete(key);
      };
    },
    captureEntryState: () => {
      if (captors.size === 0) return;
      const id = untrack(entryId);
      const entry: EntryState = { ...entries.get(id) };
      for (const [key, capture] of captors) entry[key] = capture();
      entries.set(id, entry);
    },
  };
  const navigate = (id: string) => {
    handle.captureEntryState();
    setEntryId(id);
  };
  return { handle, entryId, navigate };
}

function mountInbox(pane: ReturnType<typeof splitPane>, userId: string) {
  return createRoot((dispose) => {
    const [state, setState] = makePersistedState(
      createStore<EmailViewState>({
        ...current(),
        ...emailTabFilterState('important'),
      }),
      createEmailViewPersistence({
        handle: pane.handle,
        entryId: pane.entryId,
        userId: () => userId,
        restorePreferences: false,
      })
    );
    return { state, setState, dispose };
  });
}

/** Tab B opens on All mail: its URL resets the filters it restored, and it
 * filters PDFs and one inbox there. Both save over the user-level copy. */
function openAllMailInAnotherTab(userId: string) {
  const tabB = mountInbox(splitPane(), userId);
  tabB.setState({ tab: 'all', ...emailTabFilterState('all') });
  tabB.setState('facets', 'attachments', ['attachment-pdf']);
  tabB.setState('inboxIds', ['inbox-b']);
  tabB.dispose();
}

describe('two tabs of one browser', () => {
  it('brings a view that mounts again in its entry back on its own filters', () => {
    const tabA = splitPane();
    const inboxInA = mountInbox(tabA, 'two-tabs-remount-user');
    inboxInA.setState('facets', 'attachments', ['attachment-pdf']);
    openAllMailInAnotherTab('two-tabs-remount-user');

    // A newer build takes the local cache over: tab A's view mounts again in
    // the same entry, without a navigation.
    inboxInA.dispose();
    const remounted = mountInbox(tabA, 'two-tabs-remount-user');

    expect(remounted.state.tab).toBe('important');
    expect(remounted.state.facets.attachments).toEqual(['attachment-pdf']);
    expect(remounted.state.conditions?.importance).toBe('signal');
    expect(remounted.state.inboxIds).toBeUndefined();
    remounted.dispose();
  });

  it('records the entries the view moves to while it stays mounted', () => {
    const tabA = splitPane();
    const inboxInA = mountInbox(tabA, 'two-tabs-thread-user');
    inboxInA.setState('facets', 'attachments', ['attachment-pdf']);
    // Opening a thread pushes an entry; the list stays mounted beside it.
    tabA.navigate('thread-entry');
    openAllMailInAnotherTab('two-tabs-thread-user');

    inboxInA.dispose();
    const remounted = mountInbox(tabA, 'two-tabs-thread-user');

    expect(remounted.state.tab).toBe('important');
    expect(remounted.state.facets.attachments).toEqual(['attachment-pdf']);
    remounted.dispose();
  });

  it('records the entry the view mounts in before anything changes', () => {
    // An earlier visit saved PDFs on Inbox; this tab restores it at load.
    const earlier = mountInbox(splitPane(), 'two-tabs-load-user');
    earlier.setState('facets', 'attachments', ['attachment-pdf']);
    earlier.dispose();
    const tabA = splitPane();
    const inboxInA = mountInbox(tabA, 'two-tabs-load-user');
    openAllMailInAnotherTab('two-tabs-load-user');

    inboxInA.dispose();
    const remounted = mountInbox(tabA, 'two-tabs-load-user');

    expect(remounted.state.tab).toBe('important');
    expect(remounted.state.facets.attachments).toEqual(['attachment-pdf']);
    remounted.dispose();
  });

  it('brings back the search the view had, not the one at its last filter', () => {
    const tabA = splitPane();
    const inboxInA = mountInbox(tabA, 'two-tabs-search-user');
    inboxInA.setState('search', 'invoice');
    inboxInA.setState('facets', 'attachments', ['attachment-pdf']);
    inboxInA.setState('search', '');

    inboxInA.dispose();
    const remounted = mountInbox(tabA, 'two-tabs-search-user');

    expect(remounted.state.search).toBe('');
    remounted.dispose();
  });

  it('starts a reloaded tab and a new tab from the copy the last tab saved', () => {
    const inboxInA = mountInbox(splitPane(), 'two-tabs-reload-user');
    inboxInA.setState('facets', 'attachments', ['attachment-pdf']);
    openAllMailInAnotherTab('two-tabs-reload-user');
    inboxInA.dispose();

    // A reload or a new tab has no entry yet: split entries live in memory.
    for (const pane of [splitPane(), splitPane()]) {
      const fresh = mountInbox(pane, 'two-tabs-reload-user');
      expect(fresh.state.tab).toBe('all');
      expect(fresh.state.facets).toEqual({ attachments: ['attachment-pdf'] });
      expect(fresh.state.inboxIds).toEqual(['inbox-b']);
      fresh.dispose();
    }
  });
});
