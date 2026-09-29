import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';

const fixtures = vi.hoisted(() => ({
  reply:
    vi.fn<
      (operation: Operation) => Promise<Pick<OperationResult, 'data' | 'error'>>
    >(),
  client: undefined as unknown,
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
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixtures.client,
  mapGraphqlProperties: () => [],
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: () => () => {},
}));
vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: vi.fn(),
}));

import { useProjectCommandItems } from './project-items';

const page = (id: string, nextCursor: string | null = null) => ({
  data: {
    user: {
      soup: {
        nextCursor,
        items: [
          {
            __typename: 'GraphqlSoupInitiative',
            id,
            displayName: id,
            descriptionSurfaceId: 'description',
            metadata: { updatedAt: '2026-09-22T12:00:00Z' },
            viewerPermission: {
              __typename: 'GraphqlAccessLevelPermission',
              accessLevel: 'EDIT',
            },
            properties: [],
          },
        ],
      },
    },
  },
});

beforeEach(() => {
  fixtures.projectFlag = () => true;
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind !== 'teardown'),
      mergeMap((operation) =>
        fromPromise(
          (async () => ({
            operation,
            stale: false,
            hasNext: false,
            ...(await fixtures.reply(operation)),
          }))()
        )
      )
    );
  fixtures.client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
});
afterEach(() => {
  cleanup();
  fixtures.reply.mockReset();
});

it('does not search until enabled and hides cached results when disabled', async () => {
  const [enabled, setEnabled] = createSignal<boolean | undefined>(undefined);
  fixtures.projectFlag = enabled;
  fixtures.reply.mockResolvedValue(page('first', 'next'));
  let source!: ReturnType<typeof useProjectCommandItems>;
  render(() => {
    source = useProjectCommandItems(
      () => '',
      () => true
    );
    return <div>{source.items().length}</div>;
  });
  expect(source.enabled()).toBe(false);
  expect(source.isLoading()).toBe(false);
  expect(fixtures.reply).not.toHaveBeenCalled();
  setEnabled(false);
  await source.loadMore();
  expect(fixtures.reply).not.toHaveBeenCalled();
  setEnabled(true);
  expect(source.isLoading()).toBe(true);
  await waitFor(() => expect(source.items()).toHaveLength(1));
  expect(source.isLoading()).toBe(false);
  expect(source.hasMore()).toBe(true);
  setEnabled(false);
  expect(source.enabled()).toBe(false);
  expect(source.items()).toEqual([]);
  expect(source.hasMore()).toBe(false);
  expect(source.isLoading()).toBe(false);
  await source.loadMore();
  expect(fixtures.reply).toHaveBeenCalledTimes(1);
});

it('pages authorized Soup results and reports loading when the search changes', async () => {
  fixtures.reply
    .mockResolvedValueOnce(page('first', 'next'))
    .mockResolvedValueOnce(page('second'))
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
  expect(
    fixtures.reply.mock.calls[0][0].variables!.input.initial.filters
      .initiativeFilter
  ).toEqual({
    and: {
      left: { literal: { include: true } },
      right: { literal: { nameContains: 'Launch' } },
    },
  });
  await source.loadMore();
  await waitFor(() => expect(source.items()).toHaveLength(2));
  expect(fixtures.reply.mock.calls[1][0].variables).toMatchObject({
    input: { continuation: { cursor: 'next' } },
  });
  setQuery('Other');
  await waitFor(() => expect(fixtures.reply).toHaveBeenCalledTimes(3));
  expect(source.items()).toEqual([]);
  expect(source.isLoading()).toBe(true);
  expect(view.queryByText('Suspended')).toBeNull();
});

it('hides cached names when project access is revoked', async () => {
  fixtures.reply
    .mockResolvedValueOnce(page('Private project'))
    .mockResolvedValue({
      error: new CombinedError({
        graphQLErrors: [
          { message: 'Access revoked', extensions: { code: 'FORBIDDEN' } },
        ],
      }),
    });
  let source!: ReturnType<typeof useProjectCommandItems>;
  render(() => {
    source = useProjectCommandItems(
      () => '',
      () => true
    );
    return <div>{source.items().length}</div>;
  });
  await waitFor(() => expect(source.items()).toHaveLength(1));
  await refreshActiveGraphqlSoupQueries();
  await waitFor(() => expect(source.items()).toEqual([]));
});
