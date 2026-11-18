import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { ALL_INBOX_ROW_TYPES, INBOX_CATEGORIES } from '../core/inbox-filters';
import { createInboxFilters } from './inbox-filters';

const memoryStorage = () => {
  let saved: string | null = null;
  return {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
};

describe('createInboxFilters', () => {
  it('opens at the choice saved on the last visit', () => {
    createRoot((dispose) => {
      const storage = memoryStorage();
      expect(createInboxFilters(storage).filters().status).toBe('all');

      createInboxFilters(storage).setStatus('unread');
      expect(createInboxFilters(storage).filters().status).toBe('unread');

      createInboxFilters(storage).setStatus('all');
      expect(createInboxFilters(storage).filters().status).toBe('all');
      dispose();
    });
  });

  it('asks the feed for unread rows only under Unread', () => {
    createRoot((dispose) => {
      const filters = createInboxFilters(memoryStorage());
      expect(filters.scope().unreadOnly).toBe(false);

      filters.setStatus('unread');
      expect(filters.scope().unreadOnly).toBe(true);
      filters.setSelected('email', true);
      expect(filters.scope()).toEqual({
        rowTypes: filters.rowTypes(),
        allKinds: false,
        unreadOnly: true,
      });
      dispose();
    });
  });

  it('starts unchecked, narrows selections, and restores everything after the last is removed', () => {
    createRoot((dispose) => {
      const filters = createInboxFilters(memoryStorage());
      expect(filters.isSelected('mentions')).toBe(false);
      expect(filters.isShown('mentions')).toBe(true);
      expect(filters.rowTypes()).toEqual(ALL_INBOX_ROW_TYPES);
      expect(filters.activeCount()).toBe(0);

      filters.setSelected('mentions', true);
      expect(filters.isSelected('mentions')).toBe(true);
      expect(filters.isShown('email')).toBe(false);
      expect(filters.rowTypes()).toEqual([
        'channel_mention',
        'discussion_mention',
      ]);
      expect(filters.activeCount()).toBe(1);

      filters.setSelected('email', true);
      filters.setSelected('email', true);
      expect(filters.rowTypes()).toEqual([
        'email',
        'channel_mention',
        'discussion_mention',
      ]);
      expect(filters.activeCount()).toBe(2);

      filters.setSelected('mentions', false);
      expect(filters.rowTypes()).toEqual(['email']);
      filters.setSelected('email', false);
      expect(filters.rowTypes()).toEqual(ALL_INBOX_ROW_TYPES);
      expect(filters.isSelected('email')).toBe(false);
      expect(filters.isShown('email')).toBe(true);
      expect(filters.activeCount()).toBe(0);
      dispose();
    });
  });

  it('resets selected kinds without changing All or Unread', () => {
    createRoot((dispose) => {
      const storage = memoryStorage();
      const filters = createInboxFilters(storage);
      filters.setStatus('unread');
      filters.setSelected('email', true);
      expect(filters.isSelected('email')).toBe(true);

      filters.reset();
      expect(filters.isSelected('email')).toBe(false);
      expect(filters.isShown('email')).toBe(true);
      expect(filters.scope()).toEqual({
        rowTypes: ALL_INBOX_ROW_TYPES,
        allKinds: true,
        unreadOnly: true,
      });
      expect(JSON.parse(storage.read()!)).toEqual({
        status: 'unread',
        selectedCategories: [],
      });
      dispose();
    });
  });

  it('distinguishes an empty selection from explicitly selecting every known kind', () => {
    createRoot((dispose) => {
      const filters = createInboxFilters(memoryStorage());
      expect(filters.scope().allKinds).toBe(true);
      for (const category of INBOX_CATEGORIES)
        filters.setSelected(category, true);
      expect(filters.rowTypes()).toEqual(ALL_INBOX_ROW_TYPES);
      expect(filters.scope().allKinds).toBe(false);
      filters.reset();
      expect(filters.scope().allKinds).toBe(true);
      dispose();
    });
  });

  it('writes converted filters immediately and reopens the new selection', () => {
    createRoot((dispose) => {
      const storage = memoryStorage();
      storage.write(
        JSON.stringify({ status: 'unread', hiddenCategories: ['email'] })
      );
      const filters = createInboxFilters(storage);
      expect(filters.isSelected('mentions')).toBe(true);
      expect(filters.isShown('email')).toBe(false);
      expect(filters.activeCount()).toBe(9);
      expect(JSON.parse(storage.read()!)).toEqual({
        status: 'unread',
        selectedCategories: [
          'mentions',
          'replies',
          'messages',
          'comments',
          'tasks',
          'pull_requests',
          'calendar',
          'access',
          'agents',
        ],
      });
      expect(createInboxFilters(storage).filters()).toEqual(filters.filters());
      filters.setSelected('email', true);
      expect(createInboxFilters(storage).isSelected('email')).toBe(true);
      dispose();
    });
  });
});
