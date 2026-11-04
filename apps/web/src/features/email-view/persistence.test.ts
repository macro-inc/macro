import { INBOX_FILTER_ENTRY_KEY } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import type { EntryPersistenceHandle } from '@components/app/split-layout/entry-persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
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
      handle: {
        currentEntryState: () => ({}),
        registerEntryStateCaptor: () => () => {},
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
});
