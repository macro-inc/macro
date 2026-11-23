import { makePersistedState } from '@app/lib/persistence';
import type { EntryPersistenceHandle } from '@components/app/split-layout/entry-persistence';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, it } from 'vitest';
import {
  createPasswordListViewStorage,
  defaultPasswordListView,
  PASSWORDS_LIST_VIEW_KEY,
  type PasswordListView,
} from '../persistence';

function entry(stored: unknown) {
  const captors = new Map<string, () => unknown>();
  const handle: EntryPersistenceHandle = {
    currentEntryState: () =>
      stored === undefined ? undefined : { [PASSWORDS_LIST_VIEW_KEY]: stored },
    registerEntryStateCaptor: (key, getter) => {
      captors.set(key, getter);
      return () => captors.delete(key);
    },
  };
  return { handle, captured: () => captors.get(PASSWORDS_LIST_VIEW_KEY)?.() };
}

function mount(stored: unknown) {
  const { handle, captured } = entry(stored);
  return createRoot((dispose) => {
    const [view, setView] = makePersistedState(
      createStore<PasswordListView>(defaultPasswordListView()),
      { storages: createPasswordListViewStorage(handle) }
    );
    return { view, setView, captured, dispose };
  });
}

it('restores the type filter and grouping a split entry kept, and keeps changes for the next visit', () => {
  const list = mount({ kinds: ['card', 'login'], groupBy: 'kind' });
  expect(list.view.kinds).toEqual(['card', 'login']);
  expect(list.view.groupBy).toBe('kind');

  list.setView('kinds', ['note']);
  list.setView('groupBy', 'none');
  expect(list.captured()).toEqual({ kinds: ['note'], groupBy: 'none' });
  list.dispose();
});

it('drops unknown types and groupings from a stored entry instead of failing', () => {
  const list = mount({ kinds: ['card', 'wifi', 'card'], groupBy: 'folder' });
  expect(list.view.kinds).toEqual(['card']);
  expect(list.view.groupBy).toBe('none');
  list.dispose();

  const fresh = mount(undefined);
  expect(fresh.view.kinds).toEqual([]);
  expect(fresh.view.groupBy).toBe('none');
  fresh.dispose();
});
