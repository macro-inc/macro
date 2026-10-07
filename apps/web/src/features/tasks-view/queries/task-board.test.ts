import {
  createSoupEntityRow,
  createSoupGroupHeaderRow,
  createSoupLoadMoreRow,
} from '@app/features/soup/collection/rows';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { describe, expect, it } from 'vitest';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import { taskBoardColumns, taskBoardMoveValue } from './task-board';

describe('board query projection', () => {
  it.each(['status', 'priority'] as const)(
    'retains allowed empty %s destinations after filtering',
    (grouping) => {
      const columns = taskBoardColumns([], grouping, false, {
        [grouping]: ['high', 'not-started'],
      });

      const expectedIds =
        grouping === 'status'
          ? [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]
          : [PROPERTY_OPTION_IDS.PRIORITY.HIGH];

      expect(columns.map((column) => column.id)).toEqual(expectedIds);
      expect(columns[0]).toMatchObject({ tasks: [], count: 0 });
    }
  );

  it('restricts server groups and pagination to selected statuses', () => {
    const allowed = PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS;
    const excluded = PROPERTY_OPTION_IDS.STATUS.COMPLETED;
    const rows = [
      createSoupGroupHeaderRow({ id: excluded, label: 'Completed', count: 10 }),
      createSoupEntityRow(boardEntity('hidden'), { groupId: excluded }),
      createSoupLoadMoreRow({ scopeId: excluded, groupId: excluded }),
      createSoupGroupHeaderRow({
        id: allowed,
        label: 'In progress',
        count: 23,
      }),
      createSoupEntityRow(boardEntity('visible'), { groupId: allowed }),
      createSoupLoadMoreRow({
        scopeId: allowed,
        groupId: allowed,
        isLoading: true,
      }),
    ];

    const columns = taskBoardColumns(rows, 'status', false, {
      status: ['in-progress'],
    });

    expect(columns.map((column) => column.id)).toEqual([allowed]);
    expect(columns[0]).toMatchObject({
      count: 23,
      hasMore: true,
      loadingMore: true,
      tasks: [{ id: 'visible' }],
    });
  });

  it('restricts multi-assignee search expansion without changing hit order', () => {
    const alice = boardEntity('first', [
      boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
        type: 'EntityReference',
        value: [
          { entity_id: 'alice', entity_type: 'USER' },
          { entity_id: 'bob', entity_type: 'USER' },
        ],
      }),
    ]);

    const columns = taskBoardColumns(
      [
        createSoupEntityRow(alice),
        createSoupEntityRow(
          boardEntity('second', [
            boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
              type: 'EntityReference',
              value: [{ entity_id: 'bob', entity_type: 'USER' }],
            }),
          ])
        ),
      ],
      'assignee',
      true,
      { assignees: ['bob'] }
    );

    expect(columns.map((column) => column.id)).toEqual(['bob']);
    expect(columns[0]).toMatchObject({
      count: undefined,
      tasks: [{ id: 'first' }, { id: 'second' }],
    });
  });

  it('restricts project groups and includes selected no-value destinations', () => {
    const rows = [
      createSoupGroupHeaderRow({ id: 'excluded', label: 'Excluded', count: 3 }),
      createSoupGroupHeaderRow({ id: 'included', label: 'Included', count: 4 }),
    ];

    expect(
      taskBoardColumns(rows, 'project', false, {
        project: ['included', ''],
      }).map((column) => column.id)
    ).toEqual(['', 'included']);
    expect(
      taskBoardColumns([], 'priority', false, { priority: [''] }).map(
        (column) => column.id
      )
    ).toEqual(['']);
    expect(
      taskBoardColumns([], 'assignee', false, { assignees: [''] }).map(
        (column) => column.id
      )
    ).toEqual(['']);
  });

  it('preserves server ordering, total counts, and continuation state', () => {
    const id = PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS;
    const rows = [
      createSoupGroupHeaderRow({ id, label: 'In progress', count: 23 }),
      createSoupEntityRow(boardEntity('second'), { groupId: id }),
      createSoupEntityRow(boardEntity('first'), { groupId: id }),
      createSoupLoadMoreRow({ scopeId: id, groupId: id, isLoading: true }),
    ];

    const columns = taskBoardColumns(rows, 'status', false);

    expect(columns.find((column) => column.id === id)).toMatchObject({
      count: 23,
      hasMore: true,
      loadingMore: true,
      tasks: [{ id: 'second' }, { id: 'first' }],
    });
    expect(
      columns.find(
        (column) => column.id === PROPERTY_OPTION_IDS.STATUS.COMPLETED
      )?.tasks
    ).toEqual([]);
  });

  it('duplicates search hits by membership, not identity, and has no claimed total', () => {
    const entity = boardEntity('shared', [
      boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
        type: 'EntityReference',
        value: [
          { entity_id: 'alice', entity_type: 'USER' },
          { entity_id: 'bob', entity_type: 'USER' },
        ],
      }),
    ]);

    const columns = taskBoardColumns(
      [createSoupEntityRow(entity), createSoupEntityRow(entity)],
      'assignee',
      true
    );

    expect(columns.find((column) => column.id === 'alice')).toMatchObject({
      count: undefined,
      tasks: [{ id: 'shared' }],
    });
    expect(columns.find((column) => column.id === 'bob')?.tasks).toHaveLength(
      1
    );
    expect(columns.find((column) => column.id === '')?.tasks).toHaveLength(0);
  });

  it('uses initiative references, never a legacy folder id', () => {
    const entity = {
      ...boardEntity('task', [
        boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, {
          type: 'EntityReference',
          value: [{ entity_id: 'initiative', entity_type: 'INITIATIVE' }],
        }),
      ]),
      projectId: 'legacy-folder',
    };

    const columns = taskBoardColumns(
      [createSoupEntityRow(entity)],
      'project',
      true
    );

    expect(
      columns.find((column) => column.id === 'initiative')?.tasks
    ).toHaveLength(1);
    expect(columns.some((column) => column.id === 'legacy-folder')).toBe(false);
  });
});

describe('board property writes', () => {
  const entity = boardEntity('task', [
    boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
      type: 'EntityReference',
      value: [
        { entity_id: 'alice', entity_type: 'USER' },
        { entity_id: 'agent', entity_type: 'USER' },
      ],
    }),
  ]);

  it('preserves other assignees when replacing one', () => {
    expect(
      taskBoardMoveValue(entity, 'assignee', {
        id: 'task',
        fromLane: 'alice',
        toLane: 'bob',
      })
    ).toEqual({
      valueType: 'ENTITY',
      refs: [
        { entity_id: 'agent', entity_type: 'USER' },
        { entity_id: 'bob', entity_type: 'USER' },
      ],
    });
  });

  it('writes a single status or initiative and can clear an optional value', () => {
    expect(
      taskBoardMoveValue(entity, 'status', {
        id: 'task',
        fromLane: 'todo',
        toLane: 'done',
      })
    ).toEqual({
      valueType: 'SELECT_STRING',
      values: ['done'],
    });
    expect(
      taskBoardMoveValue(entity, 'project', {
        id: 'task',
        fromLane: '',
        toLane: 'initiative',
      })
    ).toEqual({
      valueType: 'ENTITY',
      refs: [{ entity_id: 'initiative', entity_type: 'INITIATIVE' }],
    });
    expect(
      taskBoardMoveValue(entity, 'priority', {
        id: 'task',
        fromLane: 'high',
        toLane: '',
      })
    ).toEqual({
      valueType: 'SELECT_STRING',
      values: null,
    });
  });
});
