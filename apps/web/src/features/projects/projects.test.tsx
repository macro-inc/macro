import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import {
  type Client,
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
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';

const mocks = vi.hoisted(() => ({
  enabled: (): boolean => false,
  page: vi.fn(),
  soup: vi.fn(),
  graphql: undefined as Client | undefined,
  get: vi.fn(),
  taskReferences: vi.fn(),
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
vi.mock('./primitives/project-collection', () => ({}));
vi.mock('./project-collection-persistence', () => ({}));
vi.mock('./project-share', () => ({}));
vi.mock('./views/project-assignment', () => ({}));
vi.mock('./views/projects-collection', () => ({}));
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
vi.mock('./queries/create-project-task', () => ({
  createProjectTaskMutation: () => vi.fn(),
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
import {
  type ProjectsContext,
  useProjectsContext,
} from './context/projects-context';
import { Projects } from './projects';
import { createProjectSources } from './queries/project-sources';

const project = {
  id: 'launch',
  name: 'Launch',
  descriptionDocumentId: 'description',
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
    descriptionDocumentId: project.descriptionDocumentId,
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
  mocks.soup.mockImplementation(async (operation) => ({
    operation,
    stale: false,
    hasNext: false,
    data: {
      user: {
        id: 'viewer',
        ...(getOperationName(operation.query) === 'Initiative'
          ? { initiative }
          : getOperationName(operation.query) === 'TaskInitiativeReferences'
            ? {
                taskInitiativeReferences: [
                  { taskId: 'task', state: 'VISIBLE', initiative },
                ],
              }
            : { soup: { nextCursor: 'next', items: [initiative] } }),
      },
    },
  }));
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

it('keeps retained query sources gated after their view owner is disposed', async () => {
  vi.useFakeTimers();
  const [enabled, setEnabled] = createSignal(true);
  mocks.enabled = enabled;
  setupGraphql();

  // The context belongs to a view, but split-owned queries are constructed
  // under a separate owner that survives view unmount.
  let context: ProjectsContext | undefined;
  function CaptureContext() {
    context = useProjectsContext();
    return null;
  }
  const view = render(() => (
    <Projects>
      <CaptureContext />
    </Projects>
  ));
  if (!context) throw new Error('Projects provider did not mount');
  const retainedContext = context;
  view.unmount();
  setEnabled(false);
  const sources = createRoot((dispose) => {
    disposeSource = dispose;
    return {
      collection: retainedContext.createCollectionSource(),
      detail: retainedContext.createProjectSource(() => 'launch'),
      references: retainedContext.createReferencesSource(() => ['task']),
    };
  });
  await vi.advanceTimersByTimeAsync(60_000);
  for (const request of [mocks.get, mocks.taskReferences])
    expect(request).not.toHaveBeenCalled();

  setEnabled(true);
  await vi.waitFor(() => expect(sources.detail.project()?.name).toBe('Launch'));
  await vi.waitFor(() => expect(sources.collection.rows()).toHaveLength(1));
  expect(mocks.page).not.toHaveBeenCalled();
  expect(mocks.soup).toHaveBeenCalledTimes(3);
  expect(sources.references.references().size).toBe(1);
  await vi.advanceTimersByTimeAsync(30_000);
  for (const name of ['Initiative', 'TaskInitiativeReferences'])
    expect(callsFor(name)).toHaveLength(2);

  setEnabled(false);
  const soupRequests = mocks.soup.mock.calls.length;
  expect(sources.collection.rows()).toBeUndefined();
  expect(sources.detail.project()).toBeUndefined();
  expect(sources.references.references().size).toBe(0);
  await Promise.all([
    sources.collection.loadMore(),
    sources.collection.refresh(),
    sources.detail.refresh(),
    queryClient.invalidateQueries(),
  ]);
  await vi.advanceTimersByTimeAsync(60_000);
  for (const name of ['Initiative', 'TaskInitiativeReferences'])
    expect(callsFor(name)).toHaveLength(2);

  expect(mocks.soup).toHaveBeenCalledTimes(soupRequests);
  setEnabled(true);
  await vi.waitFor(() =>
    expect(mocks.soup.mock.calls.length).toBeGreaterThan(soupRequests)
  );
  expect(sources.detail.project()?.name).toBe('Launch');
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
      { client: () => mocks.graphql!, cacheHost: () => undefined },
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
} from '@urql/core';
import { makeSubject, takeUntil } from 'wonka';
import { projectKeys } from './queries/keys';
import { captureProjectCacheScope } from './queries/project-cache-scope';
import { createProjectDetailQuery } from './queries/project-identity';
import { createProjectReferences } from './queries/project-references';

function controlledClient() {
  const requests: {
    operation: Operation;
    next: (data?: unknown, error?: CombinedError, cached?: boolean) => void;
  }[] = [];
  const exchange: Exchange = () => (source) =>
    pipe(
      source,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => {
        const subject = makeSubject<OperationResult>();
        requests.push({
          operation,
          next: (data, error, cached = false) =>
            subject.next({
              operation,
              data,
              error,
              stale: false,
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
    return createProjectDetailQuery(() => client, queryClient, viewer, id);
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
  expect(query.data?.project.name).toBe('Launch');
  setViewer(undefined);
  expect(query.data).toBeUndefined();
  expect(query.isSuccess).toBe(false);
  setViewer('viewer');
  setId('');
  expect(query.data).toBeUndefined();
  expect(query.isSuccess).toBe(false);
});

it('keeps pending membership when an unrelated full project response omits the temporary task', async () => {
  setupGraphql();
  const data = (
    await mocks.soup({
      query: (
        await import('@service-storage/graphql/generated/graphql')
      ).InitiativeDocument,
    })
  ).data;
  const { client, requests } = controlledClient();
  const query = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectDetailQuery(
      () => client,
      queryClient,
      () => 'viewer',
      () => 'launch'
    );
  });
  requests[0].next(data);
  const [membershipId, setMembershipId] = createSignal<string | undefined>(
    'temporary'
  );
  const scope = captureProjectCacheScope(
    () => 'viewer',
    () => undefined
  );
  let finish!: () => void;
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: projectKeys.createTask._def,
    onMutate: () => ({ membershipId, setMembershipId }),
    mutationFn: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const pending = mutation.execute({
    id: 'temporary',
    ownerId: 'viewer',
    projectId: 'launch',
    scope,
  });
  await vi.waitFor(() =>
    expect(query.data?.project.taskIds).toEqual(['task', 'temporary'])
  );
  // Model the normalized full entity response from UpdateInitiative.
  requests.at(-1)!.next({
    user: {
      id: 'viewer',
      initiative: {
        ...data.user.initiative,
        displayName: 'Renamed',
        taskIds: ['task'],
      },
    },
  });
  expect(query.data?.project.name).toBe('Renamed');
  expect(query.data?.project.taskIds).toEqual(['task', 'temporary']);
  // Publish the already-seeded canonical task before removing its temporary record.
  setMembershipId('saved');
  expect(query.data?.project.taskIds).toEqual(['task', 'saved']);
  requests.at(-1)!.next({
    user: {
      id: 'viewer',
      initiative: {
        ...data.user.initiative,
        displayName: 'Renamed',
        taskIds: ['task', 'saved'],
      },
    },
  });
  finish();
  await pending;
  expect(query.data?.project.taskIds).toEqual(['task', 'saved']);
  scope.dispose();
});

it('retains existing live reference batches while new task IDs load', async () => {
  const { client, requests } = controlledClient();
  const [ids, setIds] = createSignal(['a']);
  const source = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectReferences(
      () => client,
      queryClient,
      () => 'viewer',
      ids,
      () => true
    );
  });
  source.references();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0].next({
    user: {
      id: 'viewer',
      taskInitiativeReferences: [
        {
          taskId: 'a',
          state: 'VISIBLE',
          initiative: {
            __typename: 'GraphqlSoupInitiative',
            id: 'project',
            displayName: 'Launch',
          },
        },
      ],
    },
  });
  expect(source.references().get('a')).toEqual({
    state: 'visible',
    id: 'project',
    name: 'Launch',
  });
  setIds(['a', 'b']);
  expect(source.references().get('a')).toEqual({
    state: 'visible',
    id: 'project',
    name: 'Launch',
  });
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].operation.variables).toEqual({ taskIds: ['b'] });
});

it('keeps a created task reference during the pending canonical-ID handoff', async () => {
  const { client } = controlledClient();
  queryClient.setQueryData(projectKeys.detail('viewer', 'launch').queryKey, {
    project: { id: 'launch', name: 'Launch', taskIds: ['temporary'] },
    properties: [],
  });
  const [membershipId, setMembershipId] = createSignal<string | undefined>(
    'temporary'
  );
  const [ids, setIds] = createSignal(['temporary']);
  let finish!: () => void;
  const scope = captureProjectCacheScope(
    () => 'viewer',
    () => undefined
  );
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: projectKeys.createTask._def,
    onMutate: () => ({ membershipId, setMembershipId }),
    mutationFn: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const pending = mutation.execute({
    id: 'temporary',
    ownerId: 'viewer',
    projectId: 'launch',
    scope,
  });
  const source = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectReferences(
      () => client,
      queryClient,
      () => 'viewer',
      ids,
      () => true
    );
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await vi.waitFor(() =>
    expect(source.references().get('temporary')).toMatchObject({
      id: 'launch',
      name: 'Launch',
    })
  );
  setMembershipId('saved');
  setIds(['saved']);
  expect(source.references().get('saved')).toMatchObject({
    id: 'launch',
    name: 'Launch',
  });
  finish();
  await pending;
  scope.dispose();
});

it('uses temporary membership only for our created task and never overwrites authorized references', async () => {
  const { client, requests } = controlledClient();
  queryClient.setQueryData(projectKeys.detail('viewer', 'old').queryKey, {
    project: {
      id: 'old',
      name: 'Old',
      taskIds: ['visible', 'none', 'denied', 'temporary'],
    },
    properties: [],
  });
  let finish!: () => void;
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: projectKeys.createTask._def,
    mutationFn: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const pending = mutation.execute({
    id: 'temporary',
    ownerId: 'viewer',
    projectId: 'old',
  });
  const source = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectReferences(
      () => client,
      queryClient,
      () => 'viewer',
      () => ['visible', 'none', 'denied', 'temporary'],
      () => true
    );
  });
  source.references();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0].next({
    user: {
      id: 'viewer',
      taskInitiativeReferences: [
        {
          taskId: 'visible',
          state: 'VISIBLE',
          initiative: {
            __typename: 'GraphqlSoupInitiative',
            id: 'new',
            displayName: 'New',
          },
        },
        { taskId: 'none', state: 'NONE', initiative: null },
        { taskId: 'denied', state: 'UNAVAILABLE', initiative: null },
      ],
    },
  });
  expect(source.references().get('visible')).toEqual({
    state: 'visible',
    id: 'new',
    name: 'New',
  });
  expect(source.references().get('none')).toEqual({ state: 'none' });
  expect(source.references().get('denied')).toEqual({ state: 'unavailable' });
  // A complete authorized response omitted the temporary ID; do not invent it.
  expect(source.references().has('temporary')).toBe(false);
  requests[0].next(
    undefined,
    new CombinedError({
      graphQLErrors: [{ message: 'Denied', extensions: { code: 'FORBIDDEN' } }],
    })
  );
  expect(
    [...source.references().values()].every(
      (reference) => reference.state === 'unavailable'
    )
  ).toBe(true);
  finish();
  await pending;
});

it('moves reference subscriptions to a replacement client even when IDs are unchanged', async () => {
  const first = controlledClient();
  const second = controlledClient();
  const [client, setClient] = createSignal(first.client);
  const source = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectReferences(
      client,
      queryClient,
      () => 'viewer',
      () => ['a'],
      () => true
    );
  });
  const data = (name: string) => ({
    user: {
      id: 'viewer',
      taskInitiativeReferences: [
        {
          taskId: 'a',
          state: 'VISIBLE',
          initiative: {
            __typename: 'GraphqlSoupInitiative',
            id: 'project',
            displayName: name,
          },
        },
      ],
    },
  });
  source.references();
  await vi.waitFor(() => expect(first.requests).toHaveLength(1));
  first.requests[0].next(data('First'));
  expect(source.references().get('a')).toMatchObject({ name: 'First' });
  setClient(() => second.client);
  expect(source.references().has('a')).toBe(false);
  await vi.waitFor(() => expect(second.requests).toHaveLength(1));
  first.requests[0].next(data('Late old client'));
  expect(source.references().has('a')).toBe(false);
  second.requests[0].next(data('Second'));
  expect(source.references().get('a')).toMatchObject({ name: 'Second' });
});
