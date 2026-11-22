import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import { expect, it, vi } from 'vitest';
import { taskDuplicatesArgs } from './TaskDuplicateList';

vi.mock('@app/features/next-soup/soup-view/views/tasks/TaskListEntity', () => ({
  TaskListEntity: () => null,
}));

it('reads the matched tasks over GraphQL, not the REST soup list', () => {
  expect(soupRestFallback(taskDuplicatesArgs(['task-1']))).toBeUndefined();
});
