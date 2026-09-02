import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import {
  makePersistedState,
  type PersistenceStorage,
} from './make-persisted-state';

function memoryStorage<T>(initial?: T) {
  let value = initial;
  const storage: PersistenceStorage<T> = {
    restore: () => value,
    write: (next) => {
      value = next;
    },
  };
  return { storage, value: () => value };
}

describe('makePersistedState', () => {
  it('restores sequentially and writes through the wrapped setter', () => {
    createRoot((dispose) => {
      const preference = memoryStorage('preference');
      const entry = memoryStorage('entry');
      const signal = createSignal('default');
      const [value, setValue, restored] = makePersistedState(signal, {
        storages: [preference.storage, entry.storage],
      });

      expect(value).toBe(signal[0]);
      expect(setValue).not.toBe(signal[1]);
      expect(restored).toBe('entry');
      expect(value()).toBe('entry');

      setValue('updated');
      expect(preference.value()).toBe('updated');
      expect(entry.value()).toBe('updated');
      dispose();
    });
  });

  it('lets storages merge the fields they own in precedence order', () => {
    createRoot((dispose) => {
      type State = { search: string; sort: string; tab: string };
      const preference: PersistenceStorage<State> = {
        restore: (current) => ({ ...current, sort: 'saved-sort' }),
        write: vi.fn(),
      };
      const entry: PersistenceStorage<State> = {
        restore: (current) => ({
          ...current,
          search: 'entry-search',
          tab: 'entry-tab',
        }),
        write: vi.fn(),
      };

      const [state] = makePersistedState(
        createStore<State>({
          search: 'default-search',
          sort: 'default-sort',
          tab: 'default-tab',
        }),
        { storages: [preference, entry] }
      );

      expect(state).toEqual({
        search: 'entry-search',
        sort: 'saved-sort',
        tab: 'entry-tab',
      });
      dispose();
    });
  });

  it('persists the canonical value after functional signal updates', () => {
    createRoot((dispose) => {
      const persisted = memoryStorage(1);
      const [value, setValue] = makePersistedState(createSignal(0), {
        storages: persisted.storage,
      });

      setValue((current) => current + 1);
      expect(value()).toBe(2);
      expect(persisted.value()).toBe(2);
      dispose();
    });
  });

  it('supports Solid stores and path setters', () => {
    createRoot((dispose) => {
      const persisted = memoryStorage({ count: 2, label: 'restored' });
      const source = createStore({ count: 0, label: 'default' });
      const [state, setState, restored] = makePersistedState(source, {
        storages: persisted.storage,
      });

      expect(state).toBe(source[0]);
      expect(restored).toEqual({ count: 2, label: 'restored' });

      setState('count', 3);
      expect(state.count).toBe(3);
      expect(persisted.value()).toMatchObject({
        count: 3,
        label: 'restored',
      });
      dispose();
    });
  });

  it('initializes and disposes storage-owned capture state', () => {
    createRoot((dispose) => {
      const initialize = vi.fn();
      const storageDispose = vi.fn();
      const storage: PersistenceStorage<string> = {
        restore: () => undefined,
        write: vi.fn(),
        initialize,
        dispose: storageDispose,
      };

      makePersistedState(createSignal('default'), { storages: storage });
      expect(initialize).toHaveBeenCalledWith('default');

      dispose();
      expect(storageDispose).toHaveBeenCalledOnce();
    });
  });

  it('continues when one storage throws', () => {
    createRoot((dispose) => {
      const healthy = memoryStorage('restored');
      const broken: PersistenceStorage<string> = {
        restore: () => {
          throw new Error('unavailable');
        },
        write: () => {
          throw new Error('unavailable');
        },
      };
      const [value, setValue] = makePersistedState(createSignal('default'), {
        storages: [broken, healthy.storage],
      });

      expect(value()).toBe('restored');
      setValue('updated');
      expect(healthy.value()).toBe('updated');
      dispose();
    });
  });
});
