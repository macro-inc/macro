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

const unread = { id: 'a', unseen: true };
const read = { id: 'a', unseen: false };

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

  it('shows only unread rows under Unread, and every row under All', () => {
    createRoot((dispose) => {
      const filters = createInboxFilters(memoryStorage());
      expect(filters.includesRow(read)).toBe(true);

      filters.setStatus('unread');
      expect(filters.includesRow(unread)).toBe(true);
      expect(filters.includesRow(read)).toBe(false);
      dispose();
    });
  });

  it('keeps a row read under Unread until the reader next switches', () => {
    createRoot((dispose) => {
      const filters = createInboxFilters(memoryStorage());
      filters.setStatus('unread');

      filters.keepRead('a');
      expect(filters.includesRow(read)).toBe(true);
      expect(filters.includesRow({ id: 'b', unseen: false })).toBe(false);

      filters.setStatus('all');
      filters.setStatus('unread');
      expect(filters.includesRow(read)).toBe(false);
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
