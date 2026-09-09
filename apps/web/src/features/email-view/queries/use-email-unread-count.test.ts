import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailUnreadCount as createCount } from './use-email-unread-count';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function useEmailUnreadCount() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createCount();
  });
}

const mocks = vi.hoisted(() => ({
  query: {
    isLoading: false,
    error: null as Error | null,
    isPlaceholderData: false,
    isEnabled: false,
    hasNextPage: false,
    data: {
      entities: [{ id: 'email-1', type: 'email', isRead: false }],
    },
  },
  buildEmailQuery: vi.fn(() => ({
    params: { limit: 100, sort_method: 'updated_at' },
    body: { emailView: 'inbox' },
  })),
  args: undefined as SoupAstItemsQueryArgs | undefined,
}));

vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: (args: () => SoupAstItemsQueryArgs) => {
    mocks.args = args();
    return mocks.query;
  },
}));

vi.mock('./email-query', () => ({
  buildEmailQuery: mocks.buildEmailQuery,
}));

describe('useEmailUnreadCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.isLoading = false;
    mocks.query.error = null;
    mocks.query.isPlaceholderData = false;
    mocks.query.hasNextPage = false;
    mocks.query.data = {
      entities: [{ id: 'email-1', type: 'email', isRead: false }],
    };
  });

  it('reuses unread Signal eligibility across all inboxes and allows either transport', () => {
    useEmailUnreadCount();
    expect(mocks.buildEmailQuery).toHaveBeenCalledWith({
      tab: 'important',
      inboxIds: undefined,
      facets: { read: ['unread'] },
    });
    expect(mocks.args).toEqual({
      params: { limit: 100, sort_method: 'updated_at' },
      body: { emailView: 'inbox' },
    });
    expect(mocks.args?.transport).toBeUndefined();
  });

  it('counts a complete result and responds to cached read changes', () => {
    const count = useEmailUnreadCount();
    expect(count()).toBe(1);
    mocks.query.data.entities[0].isRead = true;
    expect(count()).toBe(0);
    mocks.query.data.entities = [];
    expect(count()).toBe(0);
  });

  it('does not claim an exact count for an incomplete page', () => {
    mocks.query.hasNextPage = true;
    expect(useEmailUnreadCount()()).toBeUndefined();
  });

  it('displays 99+ only after confirming 100 distinct unread threads', () => {
    mocks.query.hasNextPage = true;
    mocks.query.data.entities = Array.from({ length: 100 }, (_, i) => ({
      id: `email-${i}`,
      type: 'email',
      isRead: false,
    }));
    const count = useEmailUnreadCount();
    expect(count()).toBe('99+');
    mocks.query.data.entities[0].isRead = true;
    expect(count()).toBeUndefined();
    mocks.query.hasNextPage = false;
    expect(count()).toBe(99);
  });

  it('excludes duplicate threads and non-email rows', () => {
    mocks.query.data.entities.push(
      { id: 'email-1', type: 'email', isRead: false },
      { id: 'document-1', type: 'document', isRead: false }
    );
    expect(useEmailUnreadCount()()).toBe(1);
  });

  it('does not read data or suspend while pending', () => {
    mocks.query.isLoading = true;
    const descriptor = Object.getOwnPropertyDescriptor(mocks.query, 'data')!;
    Object.defineProperty(mocks.query, 'data', {
      configurable: true,
      get() {
        throw new Error('pending resource read');
      },
    });
    try {
      expect(useEmailUnreadCount()()).toBeUndefined();
    } finally {
      Object.defineProperty(mocks.query, 'data', descriptor);
    }
  });

  it('does not present errors or placeholder totals as an authoritative count', () => {
    const count = useEmailUnreadCount();
    mocks.query.error = new Error('unavailable');
    expect(count()).toBeUndefined();
    mocks.query.error = null;
    mocks.query.isPlaceholderData = true;
    expect(count()).toBeUndefined();
  });
});
