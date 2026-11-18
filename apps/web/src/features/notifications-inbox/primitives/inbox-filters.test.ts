import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
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
      filters.setShown('email', false);
      expect(filters.scope()).toEqual({
        rowTypes: filters.rowTypes(),
        unreadOnly: true,
      });
      dispose();
    });
  });

  it('resets the kinds shown and leaves the All or Unread choice', () => {
    createRoot((dispose) => {
      const filters = createInboxFilters(memoryStorage());
      filters.setStatus('unread');
      filters.setShown('email', false);
      expect(filters.isShown('email')).toBe(false);

      filters.reset();
      expect(filters.isShown('email')).toBe(true);
      expect(filters.filters().status).toBe('unread');
      dispose();
    });
  });
});
