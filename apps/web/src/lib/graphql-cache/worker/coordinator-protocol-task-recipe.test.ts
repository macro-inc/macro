import { expect, it } from 'vitest';
import { isCacheRequest } from './coordinator-protocol';

const request = {
  id: 1,
  kind: 'enqueue-optimistic-mutation',
  uuid: '00000000-0000-4000-8000-000000000001',
  query: 'mutation SetTaskProperty { setTaskProperty { property { id } } }',
  data: {},
  createdAtMs: 0,
  owner: 'runner',
  nowMs: 0,
  leaseExpiresAtMs: 100,
};

it.each([
  undefined,
  { taskId: 'task', change: { kind: 'dependsOn', targetIds: ['blocker'] } },
  { taskId: 'task', change: { kind: 'blocking', targetIds: ['dependent'] } },
  { taskId: 'task', change: { kind: 'status', optionIds: [] } },
])(
  'routes optional authored task recipes without changing the enqueue contract',
  (taskDependencyRecipe) => {
    expect(isCacheRequest({ ...request, taskDependencyRecipe })).toBe(true);
  }
);

it.each([
  null,
  { taskId: 'task', change: { kind: 'dependsOn', targetIds: [1] } },
  { taskId: 'task', change: { kind: 'unknown', targetIds: [] } },
  { taskId: 'task', change: { kind: 'status', optionIds: [], tasks: [] } },
])(
  'rejects malformed task recipes at the coordinator boundary',
  (taskDependencyRecipe) => {
    expect(isCacheRequest({ ...request, taskDependencyRecipe })).toBe(false);
  }
);
