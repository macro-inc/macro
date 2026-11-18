import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import {
  type Client,
  cacheExchange,
  createClient,
  type Exchange,
  getOperationName,
} from '@urql/core';
import {
  createMemo,
  createRoot,
  createSignal,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';
import type { EntityData } from '../entity/types/entity';

const mocks = vi.hoisted(() => ({
  enabled: (): boolean => false,
  page: vi.fn(),
  soup: vi.fn(),
  graphql: undefined as Client | undefined,
  get: vi.fn(),
  changeIcon: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => createMemo(() => ({ enabled: mocks.enabled() })),
  ShowFeatureFlag: (props: ParentProps) => (
    <Show when={mocks.enabled()}>{props.children}</Show>
  ),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
// The list and assignment hosts are outside this provider/query lifecycle test.
vi.mock('@app/components/list/owned-slots', () => ({}));
vi.mock('@app/features/next-soup/actions', () => ({}));
vi.mock('@app/signal/splitLayout', () => ({}));
vi.mock('@components/app/split-layout/layout', () => ({}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({}));
vi.mock('@ui', () => ({
  Button: (props: ParentProps) => <button>{props.children}</button>,
}));
vi.mock('@app/components/view-shell', () => ({
  ViewBreadcrumbs: {
    Item: (props: {
      children: (item: { isActive(): boolean; onSelect(): void }) => unknown;
    }) => props.children({ isActive: () => true, onSelect: () => {} }),
    Button: (props: ParentProps) => <button>{props.children}</button>,
  },
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('./primitives/project-collection', () => ({}));
vi.mock('./project-collection-persistence', () => ({}));
vi.mock('./project-share', () => ({}));
vi.mock('./views/project-assignment', () => ({}));
vi.mock('./views/projects-collection', () => ({}));
vi.mock('../entity-appearance/entity-appearance', () => ({
  useChangeEntityIcon: () => vi.fn(),
  EntityAppearanceTrigger: (props: { entity: EntityData }) => (
    <button
      aria-label="Change icon"
      onClick={() => mocks.changeIcon(props.entity)}
    />
  ),
}));
vi.mock('@app/features/tasks-view/tasks-create-action', () => ({
  TasksCreateAction: () => null,
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: () => () => {},
  revalidateActivityQueries: async () => {},
}));
vi.mock('@service-storage/initiative', async (original) => ({
  ...(await original<typeof import('@service-storage/initiative')>()),
  initiativeClient: mocks,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: vi.fn(),
}));
// These independent property adapters are not used by this fixture.
vi.mock('@entity', () => ({ isTaskEntity: () => false }));
vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: vi.fn(),
}));
vi.mock('@queries/properties/definitions', () => ({}));
vi.mock('@queries/properties/graphql/entity', () => ({}));
vi.mock('@queries/soup/transform-utils', () => ({}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.graphql,
  getGraphqlSoupCacheHost: () => undefined,
  mapGraphqlProperties: () => [],
}));

import { queryClient } from '@queries/client';
import { ProjectBreadcrumb } from './project-breadcrumb';
import { createProjectSources } from './queries/project-sources';

const project = {
  id: 'launch',
  name: 'Launch',
  ownerId: 'viewer',
  memberIds: [],
  taskIds: ['task'],
  userAccessLevel: 'owner',
  updatedAt: '2026-09-22T12:00:00Z',
  createdAt: '2026-09-22T12:00:00Z',
  properties: [],
  taskCount: 1,
  completedTaskCount: 0,
  sharePermission: {},
};

function setupGraphql() {
  const initiative = {
    __typename: 'GraphqlSoupInitiative',
    id: project.id,
    displayName: project.name,
    metadata: {
      ownerId: project.ownerId,
      updatedAt: project.updatedAt,
      createdAt: project.createdAt,
    },
    viewerPermission: {
      __typename: 'GraphqlAccessLevelPermission',
      accessLevel: 'OWNER',
    },
    properties: [],
    memberIds: [],
    taskIds: ['task'],
    taskCount: 1,
    completedTaskCount: 0,
    sharePermission: { id: 'share', owner: 'viewer', linkShare: 'DISABLED' },
  };
  mocks.soup.mockImplementation(async (operation) => {
    const requestedProject =
      operation.variables?.initiativeId === 'other-project'
        ? { ...initiative, id: 'other-project', displayName: 'Another project' }
        : initiative;
    return {
      operation,
      stale: false,
      hasNext: false,
      data: {
        user: {
          id: 'viewer',
          ...(['Initiative', 'InitiativeIdentity'].includes(
            getOperationName(operation.query) ?? ''
          )
            ? { visibleInitiative: requestedProject }
            : { soup: { nextCursor: 'next', items: [initiative] } }),
        },
      },
    };
  });
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => fromPromise(mocks.soup(operation)))
    );
  mocks.graphql = createClient({
    url: 'http://test.invalid/graphql',
    exchanges: [exchange],
  });
  return exchange;
}
const callsFor = (name: string) =>
  mocks.soup.mock.calls.filter(([op]) => getOperationName(op.query) === name);

let disposeSource: (() => void) | undefined;
afterEach(() => {
  disposeSource?.();
  disposeSource = undefined;
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("names a route's project without the project's full read", async () => {
  mocks.enabled = () => true;
  setupGraphql();
  const view = render(() => (
    <ProjectBreadcrumb
      entry={{
        value: 'initiative:launch',
        data: { type: 'initiative', id: 'launch' },
      }}
      order={1}
    />
  ));
  await vi.waitFor(() =>
    expect(view.getByRole('button', { name: 'Launch' }).textContent).toBe(
      'Launch'
    )
  );
  expect(callsFor('Initiative')).toHaveLength(0);
  expect(callsFor('InitiativeIdentity')).toHaveLength(1);
  fireEvent.click(view.getByRole('button', { name: 'Change icon' }));
  expect(mocks.changeIcon).toHaveBeenCalledWith({
    type: 'initiative',
    id: 'launch',
    name: 'Launch',
    ownerId: 'viewer',
    appearance: null,
  });
});

it('keeps standalone source adapters enabled when no rollout gate is injected', async () => {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { initiativeClient } = await import('@service-storage/initiative');
  setupGraphql();
  const source = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectSources(
      initiativeClient,
      { client: () => mocks.graphql! },
      cache,
      () => 'viewer'
    ).createProjectSource(() => 'launch');
  });
  await vi.waitFor(() => expect(source.project()?.name).toBe('Launch'));
  cache.clear();
});

import {
  CombinedError,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { makeSubject, takeUntil } from 'wonka';
import {
  createProjectDetailQuery,
  createProjectIdentityQuery,
} from './queries/project-identity';

it('reads chip identity without the fields that check every task', async () => {
  setupGraphql();
  const query = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectIdentityQuery(
      () => mocks.graphql!,
      () => 'viewer',
      () => 'launch'
    );
  });
  await vi.waitFor(() =>
    expect(query.data).toEqual({
      id: 'launch',
      name: 'Launch',
      ownerId: 'viewer',
      access: 'owner',
      appearance: null,
    })
  );
  expect(callsFor('Initiative')).toHaveLength(0);
  const [[operation]] = callsFor('InitiativeIdentity');
  const selection = stringifyDocument(operation.query);
  for (const field of [
    'taskCount',
    'completedTaskCount',
    'taskIds',
    'memberIds',
    'sharePermission',
  ])
    expect(selection).not.toContain(field);
});

it('reuses cached chip identities when virtual rows remount but still fetches misses', async () => {
  const exchange = setupGraphql();
  const client = createClient({
    url: 'http://test.invalid/graphql',
    exchanges: [cacheExchange, exchange],
  });
  const mount = (id: string) =>
    createRoot((dispose) => {
      onTestFinished(dispose);
      return {
        dispose,
        query: createProjectIdentityQuery(
          () => client,
          () => 'viewer',
          () => id
        ),
      };
    });

  const first = mount('launch');
  await vi.waitFor(() => expect(first.query.data?.name).toBe('Launch'));
  first.dispose();
  expect(callsFor('InitiativeIdentity')).toHaveLength(1);

  const remounted = mount('launch');
  expect(remounted.query.data?.name).toBe('Launch');
  remounted.dispose();
  expect(callsFor('InitiativeIdentity')).toHaveLength(1);

  const missing = mount('other-project');
  await vi.waitFor(() =>
    expect(missing.query.data).toMatchObject({
      id: 'other-project',
      name: 'Another project',
    })
  );
  missing.dispose();
  expect(callsFor('InitiativeIdentity')).toHaveLength(2);
});

function controlledClient() {
  const requests: {
    operation: Operation;
    next: (
      data?: unknown,
      error?: CombinedError,
      cached?: boolean,
      stale?: boolean
    ) => void;
  }[] = [];
  const exchange: Exchange = () => (source) =>
    pipe(
      source,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => {
        const subject = makeSubject<OperationResult>();
        requests.push({
          operation,
          next: (data, error, cached = false, stale = false) =>
            subject.next({
              operation,
              data,
              error,
              stale,
              hasNext: false,
              ...(cached
                ? {
                    extensions: {
                      __macroNormalizedCache: {
                        source: 'normalized-cache-hit',
                      },
                    },
                  }
                : {}),
            }),
        });
        return pipe(
          subject.source,
          takeUntil(
            pipe(
              source,
              filter(
                (next) => next.kind === 'teardown' && next.key === operation.key
              )
            )
          )
        );
      })
    );
  return {
    client: createClient({ url: 'http://test.invalid', exchanges: [exchange] }),
    requests,
  };
}

it('keeps the list mounted while a cold identity read settles', async () => {
  setupGraphql();
  const data = (
    await mocks.soup({
      query: (
        await import('@service-storage/graphql/generated/graphql')
      ).InitiativeIdentityDocument,
    })
  ).data;
  const { client, requests } = controlledClient();
  function Row() {
    const query = createProjectIdentityQuery(
      () => client,
      () => 'viewer',
      () => 'launch'
    );
    return <span>{query.data?.name ?? 'Loading'}</span>;
  }
  const view = render(() => (
    <Suspense fallback={<span>Suspended</span>}>
      <div data-testid="scroller">
        <Row />
      </div>
    </Suspense>
  ));
  const scroller = view.getByTestId('scroller');
  scroller.scrollTop = 480;
  expect(view.queryByText('Suspended')).toBeNull();
  requests[0].next(data);
  expect(scroller.textContent).toBe('Launch');
  expect(view.getByTestId('scroller')).toBe(scroller);
  expect(scroller.scrollTop).toBe(480);
  expect(view.queryByText('Suspended')).toBeNull();
});

it('keeps permission denials latched across cache hits and hides disabled detail identities', async () => {
  setupGraphql();
  const data = (
    await mocks.soup({
      query: (
        await import('@service-storage/graphql/generated/graphql')
      ).InitiativeDocument,
    })
  ).data;
  const { client, requests } = controlledClient();
  const [viewer, setViewer] = createSignal<string | undefined>('viewer');
  const [id, setId] = createSignal('launch');
  const query = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectDetailQuery(() => client, viewer, id);
  });
  requests[0].next(data);
  expect(query.data?.project.name).toBe('Launch');
  const denial = new CombinedError({
    graphQLErrors: [{ message: 'Denied', extensions: { code: 'FORBIDDEN' } }],
  });
  requests[0].next(undefined, denial);
  expect(query.data).toBeUndefined();
  requests[0].next(data, undefined, true);
  expect(query.data).toBeUndefined();
  expect(query.error).toBe(denial);
  requests[0].next(data);
  expect(query.data).toBeUndefined();
  const recovery = query.refetch({ requestPolicy: 'network-only' });
  requests[1].next(data);
  await recovery;
  expect(query.data?.project.name).toBe('Launch');
  setViewer(undefined);
  expect(query.data).toBeUndefined();
  expect(query.isSuccess).toBe(false);
  setViewer('viewer');
  setId('');
  expect(query.data).toBeUndefined();
  expect(query.isSuccess).toBe(false);
});

it('settles a project the server cannot load as an error without data', () => {
  const { client, requests } = controlledClient();
  const reads = createRoot((dispose) => {
    disposeSource = dispose;
    return {
      identity: createProjectIdentityQuery(
        () => client,
        () => 'viewer',
        () => 'deleted'
      ),
      detail: createProjectDetailQuery(
        () => client,
        () => 'viewer',
        () => 'deleted'
      ),
    };
  });
  // The server omits an errored field next to its error instead of nulling it.
  const failed = new CombinedError({
    graphQLErrors: [
      {
        message: 'internal server error',
        path: ['user', 'visibleInitiative'],
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      },
    ],
  });
  expect(requests).toHaveLength(2);
  for (const request of requests)
    request.next({ user: { id: 'viewer' } }, failed);
  for (const query of [reads.identity, reads.detail]) {
    expect(query.data).toBeUndefined();
    expect(query.isPending).toBe(false);
    expect(query.isError).toBe(true);
  }
});

it('settles a project the server answers as missing without asking again', () => {
  const { client, requests } = controlledClient();
  const reads = createRoot((dispose) => {
    disposeSource = dispose;
    return {
      identity: createProjectIdentityQuery(
        () => client,
        () => 'viewer',
        () => 'deleted'
      ),
      detail: createProjectDetailQuery(
        () => client,
        () => 'viewer',
        () => 'deleted'
      ),
    };
  });
  expect(requests).toHaveLength(2);
  for (const request of requests)
    request.next({ user: { id: 'viewer', visibleInitiative: null } });
  for (const query of [reads.identity, reads.detail]) {
    expect(query.data).toBeUndefined();
    expect(query.isPending).toBe(false);
    expect(query.isError).toBe(false);
  }
  expect(requests).toHaveLength(2);
});

it('asks the server again before showing a cached missing project, so one shared since appears', async () => {
  setupGraphql();
  const data = (
    await mocks.soup({
      query: (
        await import('@service-storage/graphql/generated/graphql')
      ).InitiativeIdentityDocument,
    })
  ).data;
  const { client, requests } = controlledClient();
  const query = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectIdentityQuery(
      () => client,
      () => 'viewer',
      () => 'launch'
    );
  });
  requests[0].next(
    { user: { id: 'viewer', visibleInitiative: null } },
    undefined,
    true
  );
  expect(query.data).toBeUndefined();
  expect(query.isPending).toBe(true);
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].operation.context.requestPolicy).toBe('network-only');
  requests[1].next(data);
  expect(query.isPending).toBe(false);
  expect(query.data?.name).toBe('Launch');
});

it('shows a cached missing project as missing when asking the server fails', async () => {
  const { client, requests } = controlledClient();
  const query = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectIdentityQuery(
      () => client,
      () => 'viewer',
      () => 'deleted'
    );
  });
  requests[0].next(
    { user: { id: 'viewer', visibleInitiative: null } },
    undefined,
    true
  );
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  requests[1].next(
    undefined,
    new CombinedError({ networkError: new Error('Offline') })
  );
  await vi.waitFor(() => expect(query.isPending).toBe(false));
  expect(requests).toHaveLength(2);
});

it('waits for the in-flight network read instead of asking again for a cached missing project', async () => {
  const { client, requests } = controlledClient();
  const query = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectDetailQuery(
      () => client,
      () => 'viewer',
      () => 'deleted'
    );
  });
  // cache-and-network: the cached null arrives stale, with the network read
  // still in flight.
  requests[0].next(
    { user: { id: 'viewer', visibleInitiative: null } },
    undefined,
    true,
    true
  );
  expect(query.isPending).toBe(true);
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  requests[0].next({ user: { id: 'viewer', visibleInitiative: null } });
  expect(query.isPending).toBe(false);
  expect(query.data).toBeUndefined();
  expect(requests).toHaveLength(1);
});

it('reauthorizes a denied identity after remount without exposing cached data', async () => {
  setupGraphql();
  const data = (
    await mocks.soup({
      query: (
        await import('@service-storage/graphql/generated/graphql')
      ).InitiativeIdentityDocument,
    })
  ).data;
  const { client, requests } = controlledClient();
  const mount = () =>
    createRoot((dispose) => {
      onTestFinished(dispose);
      return {
        dispose,
        query: createProjectIdentityQuery(
          () => client,
          () => 'viewer',
          () => 'launch'
        ),
      };
    });
  const first = mount();
  requests[0].next(data);
  expect(first.query.data?.name).toBe('Launch');
  const denial = new CombinedError({
    graphQLErrors: [{ message: 'Denied', extensions: { code: 'FORBIDDEN' } }],
  });
  requests[0].next(undefined, denial);
  expect(first.query.data).toBeUndefined();
  first.dispose();

  const second = mount();
  expect(requests[1].operation.context.requestPolicy).toBe('network-only');
  requests[1].next(data, undefined, true);
  expect(second.query.data).toBeUndefined();
  expect(second.query.error).toBe(denial);
  requests[1].next(data);
  expect(second.query.data?.name).toBe('Launch');
});

it('immediately reauthorizes another viewer cache hit once per activation', async () => {
  setupGraphql();
  const data = (
    await mocks.soup({
      query: (
        await import('@service-storage/graphql/generated/graphql')
      ).InitiativeIdentityDocument,
    })
  ).data;
  const { client, requests } = controlledClient();
  const [viewer, setViewer] = createSignal('next-viewer');
  const [gate, setGate] = createSignal({ enabled: true });
  const query = createRoot((dispose) => {
    onTestFinished(dispose);
    return createProjectIdentityQuery(
      () => client,
      viewer,
      () => 'launch',
      () => gate().enabled
    );
  });
  requests[0].next(data, undefined, true);
  expect(query.data).toBeUndefined();
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].operation.context.requestPolicy).toBe('network-only');
  requests[1].next(data, undefined, true);
  expect(query.data).toBeUndefined();
  expect(requests).toHaveLength(2);
  setGate({ enabled: true });
  expect(requests).toHaveLength(2);
  requests[1].next({ user: { ...data.user, id: 'next-viewer' } });
  expect(query.data?.name).toBe('Launch');

  setViewer('last-viewer');
  expect(query.data).toBeUndefined();
  const recovery = requests.at(-1)!;
  expect(recovery.operation.context.requestPolicy).toBe('network-only');
  recovery.next(
    undefined,
    new CombinedError({ networkError: new Error('Offline') })
  );
  expect(query.data).toBeUndefined();
  expect(requests.at(-1)).toBe(recovery);
});
