import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchState } from './mobileSearchState';
import { useMobileSearchText } from './use-mobile-search-text';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: vi.fn() }));
vi.mock('./mobileSearchState', async () => {
  const { createSignal } = await import('solid-js');
  const [isOpen, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  return {
    SearchState: {
      isOpen,
      query,
      setQuery,
      open: () => setOpen(true),
      close: () => {
        setOpen(false);
        setQuery('');
      },
    },
  };
});

describe('mobile view search text', () => {
  beforeEach(() => {
    SearchState.close();
    vi.mocked(isTouchDevice).mockReturnValue(true);
  });

  it('carries the query between scopes and restores each view on close', () => {
    createRoot((dispose) => {
      const [scope, setScope] = createSignal('tasks');
      const [savedTasks, setSavedTasks] = createSignal('saved task search');
      const tasks = useMobileSearchText(savedTasks, () => scope() === 'tasks');
      const email = useMobileSearchText(
        () => 'saved email search',
        () => scope() === 'mail'
      );
      SearchState.open();
      SearchState.setQuery('project');
      expect(tasks()).toBe('project');
      expect(email()).toBe('saved email search');
      setScope('mail');
      expect(email()).toBe('project');
      expect(tasks()).toBe('saved task search');
      SearchState.setQuery('');
      expect(email()).toBe('');
      SearchState.close();
      expect(email()).toBe('saved email search');
      expect(savedTasks()).toBe('saved task search');
      setSavedTasks('updated desktop search');
      expect(tasks()).toBe('updated desktop search');
      dispose();
    });
  });

  it('keeps desktop search independent of an open dock session', () => {
    vi.mocked(isTouchDevice).mockReturnValue(false);
    SearchState.open();
    SearchState.setQuery('mobile query');
    expect(
      useMobileSearchText(
        () => 'desktop query',
        () => true
      )()
    ).toBe('desktop query');
  });
});
