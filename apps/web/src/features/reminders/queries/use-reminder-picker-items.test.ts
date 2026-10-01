import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: {
    isSuccess: true,
    isPlaceholderData: true,
    data: [{ id: 'old', type: 'email', name: 'Old result' }],
    hasNextPage: true,
    fetchNextPage: vi.fn(),
  },
  browse: {
    isSuccess: true,
    data: [{ id: 'recent', type: 'email', name: 'Project recent' }],
    hasNextPage: true,
    fetchNextPage: vi.fn(),
  },
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({ items: () => [], hasMore: () => false }),
  }),
}));
vi.mock('@entity', () => ({ createEmailsInfiniteQuery: () => mocks.browse }));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => mocks.search,
}));
vi.mock('@queries/reminders/reminders', () => ({ reminderTarget: () => true }));

import { useReminderPickerItems } from './use-reminder-picker-items';

beforeEach(() => vi.clearAllMocks());
it('excludes retained old-query results while keeping locally matched emails', () =>
  createRoot((dispose) => {
    mocks.search.isPlaceholderData = true;
    const source = useReminderPickerItems(
      () => 'Project',
      () => 'Project'
    );
    expect(source.items().map((item) => item.data.id)).toEqual(['recent']);
    dispose();
  }));
it('paginates matching email results while searching', async () => {
  const source = createRoot(() =>
    useReminderPickerItems(
      () => 'Project',
      () => 'Project'
    )
  );
  expect(source.hasMore()).toBe(true);
  await source.loadMore();
  expect(mocks.search.fetchNextPage).toHaveBeenCalledOnce();
  expect(mocks.browse.fetchNextPage).not.toHaveBeenCalled();
});
