import { NIL_UUID } from '@app/features/soup';
import { describe, expect, it, vi } from 'vitest';
import { type BuildTaskQueryOptions, buildTaskQuery } from './task-query';
import { buildTaskSearchRequest } from './task-search';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const options: BuildTaskQueryOptions = {
  tab: 'team-tasks',
  userId: 'user',
  facets: { status: ['in-progress'] },
  groupBy: 'status',
  sort: [{ id: 'updated_at', reversed: true }],
};

describe('project task membership scope', () => {
  it('intersects authorized IDs with task/facet filters before server grouping and paging', () => {
    const query = buildTaskQuery({ ...options, taskIds: ['first', 'second'] });
    expect(query.body.df).toEqual({
      '&': [
        { l: { dst: 'task' } },
        { '|': [{ l: { id: 'first' } }, { l: { id: 'second' } }] },
      ],
    });
    expect(query.body.propf).toBeDefined();
    expect(query.groupBy).toMatchObject({ type: 'property' });
    expect(query.params).toMatchObject({
      sort_method: 'updated_at',
      sort_direction: 'asc',
    });
  });
  it('makes an empty project match no tasks in both listing and content search', () => {
    expect(buildTaskQuery({ ...options, taskIds: [] }).body.df).toEqual({
      '&': [{ l: { dst: 'task' } }, { l: { id: NIL_UUID } }],
    });
    const search = buildTaskSearchRequest({
      ...options,
      taskIds: [],
      query: 'launch',
      matchType: 'partial',
    });
    expect(search.body.filters?.document_filters).toMatchObject({
      sub_types: ['task'],
      document_ids: [NIL_UUID],
    });
    expect(search.body.filters?.property_filters).toHaveLength(1);
  });
  it('keeps every task in large projects without exceeding JSON recursion depth', () => {
    const ids = Array.from({ length: 1024 }, (_, index) => `task-${index}`);
    const scope = buildTaskQuery({ ...options, taskIds: ids }).body.df;
    const leaves: string[] = [];
    const depth = (node: unknown): number => {
      if (!node || typeof node !== 'object') return 0;
      const record = node as Record<string, unknown>;
      if ('l' in record) {
        const leaf = record.l as { id?: string };
        if (leaf.id) leaves.push(leaf.id);
        return 1;
      }
      const branches = (record['&'] ?? record['|']) as unknown[];
      return 1 + Math.max(...branches.map(depth));
    };
    expect(depth(scope)).toBeLessThan(20);
    expect(leaves).toEqual(ids);
    const search = buildTaskSearchRequest({
      ...options,
      taskIds: ids,
      query: 'launch',
      matchType: 'partial',
    });
    expect(search.body.filters?.document_filters?.document_ids).toEqual(ids);
  });
});
