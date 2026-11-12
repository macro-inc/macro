import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PropertyApiValues } from '@property/types';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TASK_PROJECT_PROPERTY } from './task-project';

const mock = vi.hoisted(() => ({
  createTask: vi.fn(),
  saveProperty: vi.fn(),
}));
vi.mock('@block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: mock.createTask,
}));
vi.mock('@queries/properties/graphql/entity', () => ({
  createGraphqlBulkSaveEntityPropertiesMutation: () => ({
    isPending: false,
    mutateAsync: mock.saveProperty,
  }),
  refetchGraphqlInitiativeProperties: vi.fn(),
}));
vi.mock('@queries/properties/definitions', () => ({}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(async () => {}),
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: vi.fn(),
  revalidateActivityQueries: vi.fn(async () => {}),
}));
vi.mock('./create-project', () => ({ createProjectMutation: () => ({}) }));
vi.mock('./project-soup', () => ({}));
vi.mock('./project-identity', () => ({}));

import { soupKeys } from '@queries/soup/keys';
import { createProjectSources } from './project-sources';

afterEach(() => vi.clearAllMocks());

function commands() {
  const cache = new QueryClient();
  return createRoot((dispose) => {
    const sources = createProjectSources(
      {} as never,
      { client: () => ({}) as never },
      cache,
      () => 'viewer'
    );
    return { commands: sources.createCommands(), dispose };
  });
}

it("keeps the composer's Project and adds the project only when it's missing", async () => {
  mock.createTask.mockResolvedValue({ documentId: 'task' });
  const { commands: project, dispose } = commands();
  const history = vi.fn();
  const status: [string, PropertyApiValues] = [
    'status',
    { valueType: 'SELECT_STRING', values: ['done'] },
  ];
  const other: [string, PropertyApiValues] = [
    SYSTEM_PROPERTY_IDS.PROJECT,
    {
      valueType: 'ENTITY',
      refs: [{ entity_id: 'other', entity_type: 'INITIATIVE' }],
    },
  ];
  await project.createTask(
    'project',
    'Moved',
    '',
    [status, other],
    new Map(),
    history
  );
  expect(mock.createTask).toHaveBeenLastCalledWith(
    'Moved',
    '',
    [status, other],
    new Map(),
    history
  );

  await project.createTask(
    'project',
    'Ship it',
    '',
    [status],
    new Map(),
    history
  );
  expect(mock.createTask).toHaveBeenLastCalledWith(
    'Ship it',
    '',
    [
      status,
      [
        SYSTEM_PROPERTY_IDS.PROJECT,
        {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'project', entity_type: 'INITIATIVE' }],
        },
      ],
    ],
    new Map(),
    history
  );
  dispose();
});

it('sets and clears each task Project property, reporting failures per task', async () => {
  mock.saveProperty.mockImplementation(
    async ({ properties: [{ entityId }] }) => ({
      error: entityId === 'locked' ? new Error('forbidden') : undefined,
    })
  );
  const { commands: project, dispose } = commands();
  const assigned = await project.assignTasks('project', ['task', 'locked']);
  expect(mock.saveProperty).toHaveBeenCalledWith({
    properties: [
      {
        entityType: 'TASK',
        entityId: 'task',
        property: TASK_PROJECT_PROPERTY,
        apiValues: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'project', entity_type: 'INITIATIVE' }],
        },
      },
    ],
  });
  expect(assigned.map((result) => [result.taskId, !!result.error])).toEqual([
    ['task', false],
    ['locked', true],
  ]);

  mock.saveProperty.mockClear();
  await project.assignTasks(undefined, ['task']);
  expect(mock.saveProperty).toHaveBeenCalledWith({
    properties: [
      expect.objectContaining({
        entityId: 'task',
        apiValues: { valueType: 'ENTITY', refs: null },
      }),
    ],
  });
  dispose();
});

it.each([
  ['refreshes', undefined, true],
  ['leaves cache-maintained', { disabled: false }, false],
] as const)(
  '%s shared list rows after a rename',
  async (_, host, refetched) => {
    const cache = new QueryClient();
    const key = soupKeys.astItems({ body: 'home' } as never).queryKey;
    cache.setQueryData(key, { pages: [] });
    const search = soupKeys.search({ body: 'launch' } as never).queryKey;
    cache.setQueryData(search, { pages: [] });
    const { rename, dispose } = createRoot((dispose) => ({
      rename: createProjectSources(
        { update: async () => ok(undefined) } as never,
        { client: () => ({}) as never, cacheHost: () => host as never },
        cache,
        () => 'viewer'
      ).createCommands().rename,
      dispose,
    }));

    await rename('launch', 'Launch v2');

    expect(cache.getQueryState(key)?.isInvalidated).toBe(refetched);
    expect(cache.getQueryState(search)?.isInvalidated).toBe(true);
    dispose();
  }
);
