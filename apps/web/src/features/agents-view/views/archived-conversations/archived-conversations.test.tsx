import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchivedConversations } from './archived-conversations';

vi.mock('@app/features/soup', () => ({
  MaybeSoupEntityActionDrawerManager: (props: { children: unknown }) =>
    props.children,
}));
vi.mock('@app/observability/flow', () => ({ usePending: vi.fn() }));

afterEach(cleanup);

it('keeps one Archived heading inside the list content padding', () => {
  render(() => (
    <ArchivedConversations
      conversations={[]}
      sort="updated"
      loading={false}
      error={false}
      loadingNextPage={false}
      hasNextPage={false}
      onLoadMore={vi.fn()}
      onRetry={vi.fn()}
      modeForConversation={() => 'chat'}
      onOpenConversation={vi.fn()}
      actions={{
        openPullRequest: vi.fn(),
        openBranch: vi.fn(),
        copyBranch: async () => true,
        unarchive: async () => true,
      }}
    />
  ));
  const list = screen.getByRole('region', { name: 'Archived' });
  const heading = screen.getByRole('heading', { name: 'Archived', level: 1 });
  expect(heading.closest('header')?.parentElement).toBe(list);
  expect(list.classList.contains('px-6')).toBe(true);
  expect(screen.getAllByRole('heading', { name: 'Archived' })).toHaveLength(1);
  expect(
    screen.getByRole('searchbox', { name: 'Search archived' })
  ).toBeTruthy();
  expect(screen.getByText('No archived conversations.')).toBeTruthy();
});
