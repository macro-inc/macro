import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  page: vi.fn(),
  projectFlag: (): boolean | undefined => true,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'enable-projects' && fixtures.projectFlag() === true,
    loading: fixtures.projectFlag() === undefined,
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@macro.com',
}));
vi.mock('@service-storage/initiative', () => ({
  initiativeClient: { page: fixtures.page },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

import { queryClient } from '@queries/client';
import { useProjectCommandItems } from './project-items';

beforeEach(() => {
  fixtures.projectFlag = () => true;
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  fixtures.page.mockReset();
});

it('does not search until enabled and hides cached results when disabled', async () => {
  const [enabled, setEnabled] = createSignal<boolean | undefined>(undefined);
  fixtures.projectFlag = enabled;
  fixtures.page.mockResolvedValue(
    ok({
      initiatives: [
        { id: 'first', name: 'Launch', updatedAt: '2026-09-22T12:00:00Z' },
      ],
      nextCursor: 'next',
    })
  );
  let source!: ReturnType<typeof useProjectCommandItems>;
  render(() => {
    source = useProjectCommandItems(
      () => '',
      () => true
    );
    return <div>{source.items().length}</div>;
  });
  expect(source.enabled()).toBe(false);
  expect(fixtures.page).not.toHaveBeenCalled();
  setEnabled(false);
  await source.loadMore();
  expect(fixtures.page).not.toHaveBeenCalled();
  setEnabled(true);
  await waitFor(() => expect(source.items()).toHaveLength(1));
  expect(source.hasMore()).toBe(true);
  setEnabled(false);
  expect(source.enabled()).toBe(false);
  expect(source.items()).toEqual([]);
  expect(source.hasMore()).toBe(false);
  await source.loadMore();
  expect(fixtures.page).toHaveBeenCalledTimes(1);
});

it('pages authorized results and clears prior results when the search changes', async () => {
  fixtures.page
    .mockResolvedValueOnce(
      ok({
        initiatives: [
          { id: 'first', name: 'Launch', updatedAt: '2026-09-22T12:00:00Z' },
        ],
        nextCursor: 'next',
      })
    )
    .mockResolvedValueOnce(
      ok({
        initiatives: [
          { id: 'second', name: 'Launch 2', updatedAt: '2026-09-22T11:00:00Z' },
        ],
        nextCursor: null,
      })
    )
    .mockImplementation(() => new Promise(() => {}));
  const [query, setQuery] = createSignal('Launch');
  let source!: ReturnType<typeof useProjectCommandItems>;
  const view = render(() => (
    <Suspense fallback={<div>Suspended</div>}>
      <Probe />
    </Suspense>
  ));
  function Probe() {
    source = useProjectCommandItems(query, () => true);
    return <div>Results: {source.items().length}</div>;
  }
  await waitFor(() => expect(source.items()).toHaveLength(1));
  await source.loadMore();
  await waitFor(() => expect(source.items()).toHaveLength(2));
  expect(fixtures.page.mock.calls[1][0]).toMatchObject({
    query: 'Launch',
    cursor: 'next',
  });
  setQuery('Other');
  await waitFor(() => expect(fixtures.page).toHaveBeenCalledTimes(3));
  expect(source.items()).toEqual([]);
  expect(view.queryByText('Suspended')).toBeNull();
});

it('hides cached names when project access is revoked', async () => {
  fixtures.page
    .mockResolvedValueOnce(
      ok({
        initiatives: [
          {
            id: 'private',
            name: 'Private project',
            updatedAt: '2026-09-22T12:00:00Z',
          },
        ],
        nextCursor: null,
      })
    )
    .mockResolvedValue(err([{ code: 'FORBIDDEN', message: 'Access revoked' }]));
  let source!: ReturnType<typeof useProjectCommandItems>;
  render(() => {
    source = useProjectCommandItems(
      () => '',
      () => true
    );
    return <div>{source.items().length}</div>;
  });
  await waitFor(() => expect(source.items()).toHaveLength(1));
  await queryClient.invalidateQueries({ queryKey: ['initiatives'] });
  await waitFor(() => expect(source.items()).toEqual([]));
});
