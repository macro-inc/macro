import { INBOX_FILTER_ENTRY_KEY } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import type { EntryPersistenceHandle } from '@components/app/split-layout/entry-persistence';
import { describe, expect, it, vi } from 'vitest';
import { createEmailViewPersistence } from './persistence';
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
    const handle: EntryPersistenceHandle = {
      currentEntryState: () => ({
        'email.view': { version: 1, tab: 'all', aliasFilter },
        [INBOX_FILTER_ENTRY_KEY]: ['inbox'],
      }),
      registerEntryStateCaptor: () => () => {},
    };
    const { storages } = createEmailViewPersistence({
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
    const handle: EntryPersistenceHandle = {
      currentEntryState: () => ({
        'email.view': {
          version: 1,
          tab: 'archived',
          search: '',
          facets: {},
        },
      }),
      registerEntryStateCaptor: () => () => {},
    };
    const { storages } = createEmailViewPersistence({
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
    const handle: EntryPersistenceHandle = {
      currentEntryState: () => ({}),
      registerEntryStateCaptor: () => () => {},
    };
    const { storages } = createEmailViewPersistence({
      handle,
      userId: () => 'focus-sort-user',
      restoreEntryState: false,
      restorePreferences: false,
    });
    const list = Array.isArray(storages) ? storages : [storages];
    for (const storage of list) {
      storage.initialize?.(current(), current);
      storage.write({ ...current(), tab: 'focus', focusSort: 'recent' });
    }

    let state = current();
    for (const storage of list) {
      const next = storage.restore(state);
      if (next !== undefined) state = next;
    }

    expect(state.tab).toBe('focus');
    expect(state.focusSort).toBe('recent');
  });

  const restoreFrom = (stored: unknown) => {
    const handle: EntryPersistenceHandle = {
      currentEntryState: () => ({ 'email.view': stored }),
      registerEntryStateCaptor: () => () => {},
    };
    const { storages } = createEmailViewPersistence({
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
