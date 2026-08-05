import {
  type Client,
  CombinedError,
  type GraphQLRequest,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createMemo, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, onEnd, pipe } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());
const mapGraphqlGroupedSoupPageMock = vi.hoisted(() =>
  vi.fn((data: { page: unknown }) => data.page)
);

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

vi.mock('@queries/soup/grouped/api', () => ({
  makeGroupComparator: () => (left: { key: string }, right: { key: string }) =>
    left.key.localeCompare(right.key),
  resolveGroupMetaForKey: (_field: unknown, key: string) => ({
    key,
    label: key,
    displayOrder: null,
  }),
}));

vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => ({})),
}));

vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: () => true,
  isInstructionsMdDoc: () => false,
  mapApiSoupItemToEntity: (item: unknown) => item,
  mapSoupPageToEntityList: (page: { items: unknown[] }) => page.items,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
  mapGraphqlGroupedSoupPage: mapGraphqlGroupedSoupPageMock,
}));

import { createGraphqlGroupedSoupAstItemsQuery } from '@queries/soup/graphql/grouped-items';
import {
  groupedSoupInputKey,
  groupedSoupLogicalViewKey,
} from '@queries/soup/grouped/graphql-operation-registry';
import type { GroupMeta } from '@queries/soup/grouped/types';
import type { GroupSoupQueryVariables } from '@service-storage/graphql/generated/graphql';
import { createGraphqlGroupedSoupQueries } from './create-graphql-grouped-soup-queries';

type TestItem = { id: string; name: string };
type TestPage = {
  items: Record<string, TestItem>;
  groups: Array<
    Pick<GroupMeta, 'key' | 'totalCount' | 'itemIds' | 'nextCursor'>
  >;
};

type FakeExecution = {
  variables: GroupSoupQueryVariables;
  next(
    page: TestPage,
    state?: Partial<Pick<OperationResult, 'hasNext' | 'stale'>>
  ): void;
  fail(error: CombinedError): void;
  readonly unsubscribed: boolean;
};

function makeFakeClient(): {
  client: Client;
  executions: FakeExecution[];
} {
  const executions: FakeExecution[] = [];
  const execute = (
    request: GraphQLRequest<unknown, GroupSoupQueryVariables>,
    context: Partial<OperationContext>
  ) => {
    const subject =
      makeSubject<OperationResult<unknown, GroupSoupQueryVariables>>();
    let unsubscribed = false;
    const operation = {
      kind: 'query',
      context,
    } as Operation<unknown, GroupSoupQueryVariables>;
    executions.push({
      variables: request.variables,
      next: (page, state) =>
        subject.next({ operation, data: { page }, ...state } as OperationResult<
          unknown,
          GroupSoupQueryVariables
        >),
      fail: (error) =>
        subject.next({ operation, error, stale: false, hasNext: false }),
      get unsubscribed() {
        return unsubscribed;
      },
    });
    return pipe(
      subject.source,
      onEnd(() => {
        unsubscribed = true;
      })
    );
  };

  return {
    executions,
    client: {
      executeQuery: execute,
    } as unknown as Client,
  };
}

const item = (id: string): TestItem => ({ id, name: id });
const group = (
  key: string,
  itemIds: string[],
  nextCursor: string | null
): TestPage['groups'][number] => ({
  key,
  totalCount: itemIds.length,
  itemIds,
  nextCursor,
});
const page = (groups: TestPage['groups'], items: TestItem[]): TestPage => ({
  groups,
  items: Object.fromEntries(items.map((entry) => [entry.id, entry])),
});
const entityIds = (query: {
  data: () => { entities: Array<{ id: string }> } | undefined;
}) => query.data()?.entities.map((entity) => entity.id);

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function setup() {
  const fake = makeFakeClient();
  getGraphqlSoupClientMock.mockReturnValue(fake.client);

  let grouped!: ReturnType<typeof createGraphqlGroupedSoupQueries>;
  const dispose = createRoot((rootDispose) => {
    const parent = createGraphqlGroupedSoupAstItemsQuery(
      () => ({
        params: { limit: 2, sort_method: 'updated_at' },
        body: {},
        groupBy: {
          type: 'property',
          propertyDefinitionId: 'status-definition',
        },
      }),
      () => ({ enabled: true })
    );
    const initialPage = createMemo(() => {
      const data = parent.data();
      if (!data?.groups || !data.itemsById) return;
      return { groups: data.groups, items: data.itemsById };
    });

    grouped = createGraphqlGroupedSoupQueries({
      initialPage,
      groupByField: () => ({
        type: 'property',
        propertyDefinitionId: 'status-definition',
      }),
      soupParams: () => ({ limit: 2, sort_method: 'updated_at' }),
      soupBody: () => ({}),
      enabled: () => true,
      itemFilter: () => undefined,
    });

    return rootDispose;
  });
  disposals.push(dispose);

  return { fake, grouped };
}

describe('createGraphqlGroupedSoupQueries', () => {
  it('uses only the parent initial subscription and reacts to parent group moves', () => {
    const { fake, grouped } = setup();

    expect(fake.executions).toHaveLength(1);
    expect(fake.executions[0]?.variables.input).toHaveProperty('initial');

    fake.executions[0]?.next(
      page(
        [group('a', ['a-1'], 'a-cursor'), group('b', ['b-1'], 'b-cursor')],
        [item('a-1'), item('b-1')]
      )
    );

    expect(fake.executions).toHaveLength(1);
    const a = grouped.map().get('a');
    const b = grouped.map().get('b');
    expect(a && entityIds(a)).toEqual(['a-1']);
    expect(b && entityIds(b)).toEqual(['b-1']);

    fake.executions[0]?.next(
      page(
        [group('a', [], 'a-cursor'), group('b', ['a-1', 'b-1'], 'b-cursor')],
        [item('a-1'), item('b-1')]
      )
    );

    expect(grouped.map().get('a')).toBe(a);
    expect(grouped.map().get('b')).toBe(b);
    expect(a && entityIds(a)).toEqual([]);
    expect(b && entityIds(b)).toEqual(['a-1', 'b-1']);
    expect(fake.executions).toHaveLength(1);
  });

  it('creates only independent continuation subscriptions when groups paginate', async () => {
    const { fake, grouped } = setup();
    fake.executions[0]?.next(
      page(
        [group('a', ['a-1'], 'a-cursor'), group('b', ['b-1'], 'b-cursor')],
        [item('a-1'), item('b-1')]
      )
    );
    const initialInput = fake.executions[0]?.variables.input;
    const a = grouped.map().get('a')!;
    const b = grouped.map().get('b')!;

    const firstA = a.fetchNextPage();
    expect(a.isFetchingNextPage()).toBe(true);
    expect(fake.executions).toHaveLength(2);
    expect(fake.executions[1]?.variables.input).toEqual({
      continuation: {
        groupBy: {
          field: 'PROPERTY',
          propertyDefinitionId: 'status-definition',
        },
        groupKey: 'a',
        cursor: 'a-cursor',
      },
    });
    expect(groupedSoupLogicalViewKey(fake.executions[1]?.variables.input)).toBe(
      groupedSoupInputKey(initialInput)
    );
    let firstASettled = false;
    void firstA.then(() => {
      firstASettled = true;
    });
    fake.executions[1]?.next(
      page([group('a', ['a-2'], 'a-cursor-2')], [item('a-2')]),
      { stale: true }
    );
    await Promise.resolve();
    expect(firstASettled).toBe(false);
    expect(a.isFetchingNextPage()).toBe(true);
    expect(entityIds(a)).toEqual(['a-1', 'a-2']);

    fake.executions[1]?.next(
      page([group('a', ['a-2'], 'a-cursor-2')], [item('a-2')])
    );
    await firstA;
    expect(a.isFetchingNextPage()).toBe(false);
    expect(entityIds(a)).toEqual(['a-1', 'a-2']);

    const firstB = b.fetchNextPage();
    expect(fake.executions).toHaveLength(3);
    expect(fake.executions[2]?.variables.input).toHaveProperty(
      'continuation.groupKey',
      'b'
    );
    expect(fake.executions[2]?.variables.input).toHaveProperty(
      'continuation.cursor',
      'b-cursor'
    );
    fake.executions[2]?.next(page([group('b', ['b-2'], null)], [item('b-2')]));
    await firstB;

    const secondA = a.fetchNextPage();
    expect(fake.executions).toHaveLength(4);
    expect(fake.executions[3]?.variables.input).toHaveProperty(
      'continuation.groupKey',
      'a'
    );
    expect(fake.executions[3]?.variables.input).toHaveProperty(
      'continuation.cursor',
      'a-cursor-2'
    );
    fake.executions[3]?.next(page([group('a', ['a-3'], null)], [item('a-3')]));
    await secondA;

    expect(entityIds(a)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(entityIds(b)).toEqual(['b-1', 'b-2']);
    expect(
      fake.executions.filter(({ variables }) => 'initial' in variables.input)
    ).toHaveLength(1);

    grouped.resetToInitialPage();
    expect(entityIds(a)).toEqual(['a-1']);
    expect(entityIds(b)).toEqual(['b-1']);
    expect(fake.executions[0]?.unsubscribed).toBe(false);
    expect(
      fake.executions.slice(1).every((execution) => execution.unsubscribed)
    ).toBe(true);
  });

  it('retains parent data and allows retry when the first continuation errors', async () => {
    const { fake, grouped } = setup();
    fake.executions[0]?.next(
      page([group('a', ['a-1'], 'a-cursor')], [item('a-1')])
    );
    const a = grouped.map().get('a')!;

    const failedFetch = a.fetchNextPage();
    fake.executions[1]?.fail(
      new CombinedError({ graphQLErrors: ['continuation failed'] })
    );
    await failedFetch;

    expect(entityIds(a)).toEqual(['a-1']);
    expect(a.hasNextPage()).toBe(true);
    expect(a.isFetchingNextPage()).toBe(false);

    const retry = a.fetchNextPage();
    expect(fake.executions).toHaveLength(3);
    expect(fake.executions[2]?.variables.input).toHaveProperty(
      'continuation.cursor',
      'a-cursor'
    );
    fake.executions[2]?.next(page([group('a', ['a-2'], null)], [item('a-2')]));
    await retry;

    expect(entityIds(a)).toEqual(['a-1', 'a-2']);
    expect(a.hasNextPage()).toBe(false);
  });

  it('adds and disposes group state with the reactive parent lifecycle', async () => {
    const { fake, grouped } = setup();
    fake.executions[0]?.next(
      page(
        [group('a', ['a-1'], null), group('b', ['b-1'], 'b-cursor')],
        [item('a-1'), item('b-1')]
      )
    );

    const b = grouped.map().get('b')!;
    const fetchB = b.fetchNextPage();
    fake.executions[1]?.next(page([group('b', ['b-2'], null)], [item('b-2')]));
    await fetchB;

    fake.executions[0]?.next(
      page(
        [group('a', ['a-1'], null), group('c', ['c-1'], 'c-cursor')],
        [item('a-1'), item('c-1')]
      )
    );

    expect(grouped.map().has('b')).toBe(false);
    expect(fake.executions[1]?.unsubscribed).toBe(true);
    expect(entityIds(grouped.map().get('c')!)).toEqual(['c-1']);
    expect(fake.executions).toHaveLength(2);
    expect(fake.executions[0]?.unsubscribed).toBe(false);
  });
});
