import { describe, expect, it } from 'vitest';
import type { TaskBoardColumn, TaskBoardTask } from './task-board';
import {
  movedTask,
  placementMatches,
  projectTaskBoardPlacements,
} from './task-board-optimism';

const task: TaskBoardTask = {
  id: 'moving',
  name: 'Moving',
  statusId: 'todo',
  priorityId: 'low',
  assigneeIds: ['alice', 'carol'],
  projectIds: ['old-project'],
};

function column(id: string, tasks: TaskBoardTask[] = []): TaskBoardColumn {
  return {
    id,
    label: id,
    tasks,
    count: tasks.length,
    hasMore: false,
    loadingMore: false,
  };
}

describe('optimistic task placements', () => {
  it.each([
    ['status', 'todo', 'done', { statusId: 'done' }],
    ['priority', 'low', '', { priorityId: undefined }],
    ['project', 'old-project', 'new-project', { projectIds: ['new-project'] }],
    ['assignee', 'alice', 'bob', { assigneeIds: ['carol', 'bob'] }],
    ['assignee', 'alice', '', { assigneeIds: [] }],
  ] as const)(
    'projects %s values without mutating the shared task',
    (grouping, fromLane, toLane, expected) => {
      const updated = movedTask(task, grouping, {
        id: task.id,
        fromLane,
        toLane,
      });
      expect(updated).toMatchObject(expected);
      expect(task.assigneeIds).toEqual(['alice', 'carol']);
      expect(task.statusId).toBe('todo');
    }
  );

  it('preserves other assignees, deduplicates destinations, and adjusts loaded counts once', () => {
    const placement = {
      task: movedTask(task, 'assignee', {
        id: task.id,
        fromLane: 'alice',
        toLane: 'carol',
      }),
      grouping: 'assignee' as const,
      previousGroupKeys: ['alice', 'carol'],
      scope: 'test',
      confirmed: false,
    };
    const columns = [column('alice', [task]), column('carol', [task])];
    const result = projectTaskBoardPlacements(columns, [placement]);
    expect(result[0].tasks).toEqual([]);
    expect(result[0].count).toBe(0);
    expect(result[1].tasks).toEqual([placement.task]);
    expect(result[1].count).toBe(1);
    expect(placementMatches(result, placement)).toBe(true);
    expect(columns[0].tasks).toEqual([task]);
  });

  it('inserts in host-provided order without reordering existing tasks or creating hidden columns', () => {
    const earlier = { ...task, id: 'earlier' };
    const later = { ...task, id: 'later' };
    const placement = {
      task: movedTask(task, 'status', {
        id: task.id,
        fromLane: 'todo',
        toLane: 'done',
      }),
      grouping: 'status' as const,
      previousGroupKeys: ['todo'],
      scope: 'test',
      confirmed: false,
    };
    const rank = ['earlier', 'moving', 'later'];
    const result = projectTaskBoardPlacements(
      [column('todo', [task]), column('done', [earlier, later])],
      [placement],
      (left, right) => rank.indexOf(left) - rank.indexOf(right)
    );
    expect(result[1].tasks.map((task) => task.id)).toEqual(rank);
    const hidden = projectTaskBoardPlacements(
      [column('todo', [task])],
      [placement]
    );
    expect(hidden).toHaveLength(1);
    expect(hidden[0].tasks).toEqual([]);
  });

  it('does not increase an existing assignee count when its task is outside the loaded page', () => {
    const placement = {
      task: movedTask(task, 'assignee', {
        id: task.id,
        fromLane: 'alice',
        toLane: 'carol',
      }),
      previousGroupKeys: ['alice', 'carol'],
      grouping: 'assignee' as const,
      scope: 'test',
      confirmed: false,
    };
    const destination = { ...column('carol'), count: 25, hasMore: true };
    const result = projectTaskBoardPlacements(
      [column('alice', [task]), destination],
      [placement]
    );

    expect(result[0].count).toBe(0);
    expect(result[1].tasks).toEqual([placement.task]);
    expect(result[1].count).toBe(25);
  });
});
