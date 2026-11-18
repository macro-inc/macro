import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSidebarSectionOrder,
  createSidebarSectionOrderStorage,
} from './create-sidebar-section-order';

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sidebar section preferences', () => {
  it('saves and restores independently for each account and view', () => {
    createRoot((dispose) => {
      disposers.push(dispose);
      const [userId, setUserId] = createSignal<string | undefined>('viewer-a');
      const [view, setView] = createSignal('mail');
      const state = createSidebarSectionOrder({ userId, view });
      state.setOrder(['saved', 'library']);
      const firstOwner = state.account();
      setView('drive');
      expect(state.order()).toEqual([]);
      state.setOrder(['folders', 'favorites']);
      setUserId('viewer-b');
      expect(state.order()).toEqual([]);
      state.setOrder(['favorites', 'folders']);
      setUserId('viewer-a');
      expect(state.order()).toEqual(['folders', 'favorites']);
      setView('mail');
      expect(state.order()).toEqual(['saved', 'library']);
      expect(state.account()).not.toBe(firstOwner);
    });
  });

  it.each([
    'not json',
    '{"version":2,"order":["library"]}',
    '{"version":1,"order":[1]}',
    '{"version":1}',
    'null',
  ])('rejects invalid persisted data: %s', (raw) => {
    localStorage.setItem('sidebar-section-order:mail:viewer', raw);
    expect(
      createSidebarSectionOrderStorage('mail', 'viewer').restore([])
    ).toBeUndefined();
  });

  it('deduplicates persisted keys and skips storage without an account', () => {
    localStorage.setItem(
      'sidebar-section-order:mail:viewer',
      '{"version":1,"order":["saved","saved","library"]}'
    );
    expect(
      createSidebarSectionOrderStorage('mail', 'viewer').restore([])
    ).toEqual(['saved', 'library']);
    const anonymous = createSidebarSectionOrderStorage('mail', undefined);
    anonymous.write(['library']);
    expect(anonymous.restore([])).toBeUndefined();
    expect(localStorage.length).toBe(1);
  });

  it('keeps the in-memory order when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    createRoot((dispose) => {
      disposers.push(dispose);
      const state = createSidebarSectionOrder({
        userId: () => 'viewer',
        view: () => 'mail',
      });
      expect(state.order()).toEqual([]);
      state.setOrder(['saved', 'library']);
      expect(state.order()).toEqual(['saved', 'library']);
    });
  });
});
