import { describe, expect, it } from 'vitest';
import {
  isTaskBoardMove,
  moveTaskAssignees,
  type TaskBoardTask,
  taskBoardGroupKeys,
} from './task-board';

const task: TaskBoardTask = {
  id: 'task',
  name: 'Task',
  statusId: 'todo',
  priorityId: 'high',
  assigneeIds: ['alice', 'bob'],
  projectIds: ['launch'],
};

describe('board membership', () => {
  it('supports each grouping and every assignee occurrence', () => {
    expect(taskBoardGroupKeys(task, 'status')).toEqual(['todo']);
    expect(taskBoardGroupKeys(task, 'priority')).toEqual(['high']);
    expect(taskBoardGroupKeys(task, 'assignee')).toEqual(['alice', 'bob']);
    expect(taskBoardGroupKeys(task, 'project')).toEqual(['launch']);
    expect(taskBoardGroupKeys({ ...task, projectIds: [] }, 'project')).toEqual([
      '',
    ]);
  });

  it('rejects stale sources, removed tasks, and same-column drops', () => {
    expect(
      isTaskBoardMove(task, 'status', {
        id: 'task',
        fromLane: 'todo',
        toLane: 'done',
      })
    ).toBe(true);
    expect(
      isTaskBoardMove(task, 'status', {
        id: 'task',
        fromLane: 'doing',
        toLane: 'done',
      })
    ).toBe(false);
    expect(
      isTaskBoardMove(task, 'status', {
        id: 'task',
        fromLane: 'todo',
        toLane: 'todo',
      })
    ).toBe(false);
    expect(
      isTaskBoardMove(undefined, 'status', {
        id: 'task',
        fromLane: 'todo',
        toLane: 'done',
      })
    ).toBe(false);
  });
});

describe('assignee moves', () => {
  it('replaces only the source and deduplicates an existing destination', () => {
    expect(moveTaskAssignees(['alice', 'bob'], 'alice', 'charlie')).toEqual([
      'bob',
      'charlie',
    ]);
    expect(moveTaskAssignees(['alice', 'bob'], 'alice', 'bob')).toEqual([
      'bob',
    ]);
  });

  it('assigns from unassigned and explicitly clears every assignment', () => {
    expect(moveTaskAssignees([], '', 'alice')).toEqual(['alice']);
    expect(moveTaskAssignees(['alice', 'bob'], 'alice', '')).toEqual([]);
  });
});
