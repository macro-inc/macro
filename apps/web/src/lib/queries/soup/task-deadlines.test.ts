import { expect, it, vi } from 'vitest';
import { soupKeys } from './keys';
import { refreshTaskDeadlineQueries } from './task-deadlines';

const fixture = vi.hoisted(() => ({
  invalidate: vi.fn(
    async (_options: {
      predicate(query: { queryKey: readonly unknown[] }): boolean;
    }) => {}
  ),
  refresh: vi.fn(async (_options: { where(body: unknown): boolean }) => {}),
}));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: fixture.invalidate },
}));
vi.mock('./graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: fixture.refresh,
}));

it('refreshes due-dependent lists even when the edited task was absent', async () => {
  await refreshTaskDeadlineQueries();
  const { predicate } = fixture.invalidate.mock.calls[0][0];
  expect(
    predicate({
      queryKey: soupKeys.astItems({
        params: { sort_method: 'due_date_earliest' },
        body: {},
      }).queryKey,
    })
  ).toBe(true);
  expect(
    predicate({
      queryKey: soupKeys.astItems({
        params: {},
        body: {
          propf: { l: { pd: '00000001-0000-0000-0000-000000000004', v: 'dp' } },
        },
      }).queryKey,
    })
  ).toBe(true);
  expect(
    predicate({
      queryKey: soupKeys.search({
        params: {},
        body: {
          query: 'launch',
          match_type: 'partial',
          filters: {
            property_filters: [
              {
                property_definition_id: '00000001-0000-0000-0000-000000000004',
                has_date: false,
              },
            ],
          },
        },
      }).queryKey,
    })
  ).toBe(true);
  expect(
    predicate({
      queryKey: soupKeys.astItems({
        params: { sort_method: 'updated_at' },
        body: {},
      }).queryKey,
    })
  ).toBe(false);
  const { where } = fixture.refresh.mock.calls[0][0];
  expect(where({ df: { l: { dst: 'task' } } })).toBe(true);
  expect(where({ df: { l: { dst: 'snippet' } } })).toBe(false);
});
