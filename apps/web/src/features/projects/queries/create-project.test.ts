import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Property } from '@property/types';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { createInitiativeInput, createProjectMutation } from './create-project';

const mock = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: mock.refetch }));
afterEach(() => vi.clearAllMocks());

const status = {
  propertyId: 'status',
  propertyDefinitionId: 'status',
  displayName: 'Status',
  valueType: 'SELECT_STRING',
  value: null,
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
} satisfies Property;
const assignees = {
  ...status,
  propertyId: 'assignees',
  propertyDefinitionId: 'assignees',
  displayName: 'Assignees',
  valueType: 'ENTITY',
  isMultiSelect: true,
} satisfies Property;
const due = {
  ...status,
  propertyId: 'due',
  propertyDefinitionId: 'due',
  displayName: 'Due date',
  valueType: 'DATE',
} satisfies Property;

const detail = {
  id: 'project',
  name: 'Launch',
  updatedAt: '2026-09-30T12:00:00Z',
  userAccessLevel: 'owner' as const,
  taskCount: 0,
  completedTaskCount: 0,
  properties: [],
  ownerId: 'viewer',
  memberIds: [],
  taskIds: [],
  createdAt: '2026-09-30T12:00:00Z',
  sharePermission: {} as never,
};

it('sends drafted values with the create and leaves unset ones to the server', () => {
  expect(
    createInitiativeInput({
      name: 'Launch',
      description: '  Ship it  ',
      shareWithTeam: false,
      properties: [
        {
          property: status,
          value: { valueType: 'SELECT_STRING', values: ['in-progress'] },
        },
        {
          property: assignees,
          value: {
            valueType: 'ENTITY',
            refs: [{ entity_type: 'USER', entity_id: 'macro|a@macro.com' }],
          },
        },
        { property: due, value: { valueType: 'DATE', value: null } },
      ],
    })
  ).toEqual({
    name: 'Launch',
    description: 'Ship it',
    shareWithTeam: false,
    propertyValues: [
      {
        propertyDefinitionId: 'status',
        value: { selectOption: 'in-progress' },
      },
      {
        propertyDefinitionId: 'assignees',
        value: {
          multiEntityReference: [
            {
              entityType: 'USER',
              entityId: 'macro|a@macro.com',
              specificMessageId: null,
            },
          ],
        },
      },
    ],
  });
});

it('resolves as soon as the server answers and refreshes lists in the background', async () => {
  const cache = new QueryClient();
  const create = vi.fn(async () => ok(detail));
  // A list refresh that never settles must not hold the create.
  mock.refetch.mockReturnValue(new Promise(() => {}));
  const mutation = createRoot((dispose) => {
    onTestFinished(dispose);
    return createProjectMutation({ create }, cache, () => 'viewer');
  });

  const project = await mutation.mutateAsync({
    name: 'Launch',
    description: '  ',
    shareWithTeam: true,
    properties: [],
  });

  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: true,
    propertyValues: [],
  });
  expect(project).toMatchObject({ id: 'project', name: 'Launch' });
  expect(mock.refetch).toHaveBeenCalledWith('project', 'initiative', {
    ownTouch: true,
    refreshGraphql: true,
  });
  cache.clear();
});

it('rejects without refreshing when the server refuses the create', async () => {
  const cache = new QueryClient();
  const create = vi.fn(async () =>
    err([{ code: 'BAD_REQUEST', message: 'option not found' }])
  );
  const mutation = createRoot((dispose) => {
    onTestFinished(dispose);
    return createProjectMutation({ create }, cache, () => 'viewer');
  });

  await expect(
    mutation.mutateAsync({
      name: 'Launch',
      description: '',
      shareWithTeam: true,
      properties: [],
    })
  ).rejects.toThrow();
  expect(mock.refetch).not.toHaveBeenCalled();
});

it('seeds the live query edge from an authoritative create without overwriting its fields', async () => {
  const cache = new QueryClient();
  const host = { ...createNoopCacheHost(), disabled: false };
  const write = vi.spyOn(host, 'writeQuery');
  const mutation = createRoot((dispose) => {
    onTestFinished(dispose);
    return createProjectMutation(
      { create: async () => ok(detail) },
      cache,
      () => 'viewer',
      () => host
    );
  });
  await mutation.mutateAsync({
    name: 'Launch',
    description: '',
    shareWithTeam: true,
    properties: [],
  });
  expect(write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationName: 'Initiative',
      variables: { initiativeId: 'project' },
      data: {
        user: {
          id: 'viewer',
          initiative: { __typename: 'GraphqlSoupInitiative', id: 'project' },
        },
      },
    })
  );
  cache.clear();
});

it('does not seed or refresh a create response after a storage reset', async () => {
  const cache = new QueryClient();
  let reset!: Parameters<CacheHost['onCacheGenerationChanged']>[0];
  const unsubscribe = vi.fn();
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    onCacheGenerationChanged: (callback) => {
      reset = callback;
      return unsubscribe;
    },
  };
  const write = vi.spyOn(host, 'writeQuery');
  let finish!: () => void;
  const create = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return ok(detail);
  });
  const mutation = createRoot((dispose) => {
    onTestFinished(dispose);
    return createProjectMutation(
      { create },
      cache,
      () => 'viewer',
      () => host
    );
  });
  const pending = mutation.mutateAsync({
    name: 'Launch',
    description: '',
    shareWithTeam: true,
    properties: [],
  });
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  reset({ storage: 'reset' });
  finish();
  await pending;
  expect(write).not.toHaveBeenCalled();
  expect(cache.getQueryCache().getAll()).toHaveLength(0);
  expect(mock.refetch).not.toHaveBeenCalled();
  expect(unsubscribe).toHaveBeenCalledOnce();
  cache.clear();
});
