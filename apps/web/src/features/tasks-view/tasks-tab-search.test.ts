import { expect, it } from 'vitest';
import { tasksTabSearchCodec } from './tasks-tab-search';

it('round-trips tab, sort direction, list grouping, and board grouping', () => {
  const value = {
    tab: 'team-tasks' as const,
    sort: 'created_at' as const,
    sortReversed: 'true' as const,
    groupBy: 'date' as const,
    boardGroupBy: 'project' as const,
  };
  const serialized = tasksTabSearchCodec.serialize(value);
  expect(serialized).toEqual({
    tab: ['team-tasks'],
    sort: ['created_at'],
    sortReversed: ['true'],
    groupBy: ['date'],
    boardGroupBy: ['project'],
  });
  expect(tasksTabSearchCodec.parse(serialized)).toEqual({ value, valid: true });
});

it('keeps missing preferences optional and rejects unsupported values', () => {
  expect(tasksTabSearchCodec.parse(undefined)).toMatchObject({
    value: {
      tab: 'my-tasks',
      sort: undefined,
      groupBy: undefined,
      boardGroupBy: undefined,
    },
    valid: true,
  });
  expect(tasksTabSearchCodec.parse({ boardGroupBy: ['date'] }).valid).toBe(
    false
  );
  expect(tasksTabSearchCodec.parse({ sort: ['unknown'] }).valid).toBe(false);
  expect(tasksTabSearchCodec.parse({ sortReversed: ['invalid'] }).valid).toBe(
    false
  );
});
