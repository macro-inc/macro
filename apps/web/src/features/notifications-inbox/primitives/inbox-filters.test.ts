import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createInboxFilters, createInboxLane } from './inbox-filters';

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
        lane: 'signal',
        rowTypes: filters.rowTypes(),
        unreadOnly: true,
      });
      dispose();
    });
  });

  it('reads the lane the reader chose, and starts in Signal on the next visit', () => {
    createRoot((dispose) => {
      const storage = memoryStorage();
      const filters = createInboxFilters(storage);
      expect(filters.scope().lane).toBe('signal');

      filters.setLane('noise');
      expect(filters.scope().lane).toBe('noise');
      // Other choices are saved while in Noise; the lane is not.
      filters.setStatus('unread');
      const next = createInboxFilters(storage);
      expect(next.filters().status).toBe('unread');
      expect(next.scope().lane).toBe('signal');
      dispose();
    });
  });

  it('opens in the lane a linked row belongs to', () => {
    createRoot((dispose) => {
      const lane = createInboxLane();
      lane.setLane('noise');
      const filters = createInboxFilters(memoryStorage(), lane);
      expect(filters.scope().lane).toBe('noise');

      filters.setLane('signal');
      expect(lane.lane()).toBe('signal');
      expect(filters.filters().lane).toBe('signal');
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
