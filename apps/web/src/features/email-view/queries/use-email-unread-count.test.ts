import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailUnreadCount } from './use-email-unread-count';

const mocks = vi.hoisted(() => ({
  query: {
    isLoading: false,
    error: null as Error | null,
    isPlaceholderData: false,
    data: {
      groups: [{ totalCount: 120, itemIds: ['one-loaded-row'] }],
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
    mocks.query.data = {
      groups: [{ totalCount: 120, itemIds: ['one-loaded-row'] }],
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
      params: { limit: 1, sort_method: 'updated_at' },
      body: { emailView: 'inbox' },
      groupBy: { type: 'entity_type' },
    });
    expect(mocks.args?.transport).toBeUndefined();
  });

  it('counts all server rows, not just hydrated rows, and reads updated totals', () => {
    const count = useEmailUnreadCount();
    expect(count()).toBe(120);
    mocks.query.data.groups[0].totalCount = 119;
    expect(count()).toBe(119);
    mocks.query.data.groups = [];
    expect(count()).toBe(0);
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
