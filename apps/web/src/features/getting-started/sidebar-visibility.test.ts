import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGettingStartedSidebarVisibility,
  type GettingStartedSidebarStore,
  localStorageGettingStartedSidebarStore,
} from './sidebar-visibility';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
}));

describe('localStorageGettingStartedSidebarStore', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('loads null when the user never removed the link', async () => {
    await expect(
      localStorageGettingStartedSidebarStore.load('user-1')
    ).resolves.toBeNull();
  });

  it('round-trips the hidden flag', async () => {
    await localStorageGettingStartedSidebarStore.save('user-1', true);
    await expect(
      localStorageGettingStartedSidebarStore.load('user-1')
    ).resolves.toBe(true);
    await localStorageGettingStartedSidebarStore.save('user-1', false);
    await expect(
      localStorageGettingStartedSidebarStore.load('user-1')
    ).resolves.toBe(false);
  });
});

describe('createGettingStartedSidebarVisibility', () => {
  const withVisibility = (store: GettingStartedSidebarStore) =>
    createRoot((dispose) => ({
      visibility: createGettingStartedSidebarVisibility(store),
      dispose,
    }));

  it('starts visible and flips once a stored hidden flag loads', async () => {
    const { visibility, dispose } = withVisibility({
      load: () => Promise.resolve(true),
      save: () => Promise.resolve(),
    });
    expect(visibility.hidden()).toBe(false);
    await vi.waitFor(() => expect(visibility.hidden()).toBe(true));
    dispose();
  });

  it('stays visible when nothing is stored', async () => {
    const { visibility, dispose } = withVisibility({
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(visibility.hidden()).toBe(false);
    dispose();
  });

  it('hide applies optimistically before the load resolves and persists', () => {
    const save = vi.fn(() => Promise.resolve());
    const { visibility, dispose } = withVisibility({
      load: () => new Promise<never>(() => {}),
      save,
    });
    visibility.hide();
    expect(visibility.hidden()).toBe(true);
    expect(save).toHaveBeenCalledWith('user-1', true);
    dispose();
  });
});
