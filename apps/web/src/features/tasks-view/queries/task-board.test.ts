import {
  createSoupEntityRow,
  createSoupGroupHeaderRow,
  createSoupLoadMoreRow,
} from '@app/features/soup/collection/rows';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { describe, expect, it } from 'vitest';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import {
  filterTaskBoardColumns,
  taskBoardColumns,
  taskBoardMoveValue,
} from './task-board';

describe('board query projection', () => {
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
      createSoupEntityRow(boardEntity('second'), { groupId: allowed }),
      createSoupLoadMoreRow({
        scopeId: allowed,
        groupId: allowed,
        isLoading: true,
      }),
    ];

    const columns = filterTaskBoardColumns(
      taskBoardColumns(rows, 'status', false),
      'status',
      { status: ['in-progress'] }
    );

    expect(columns.map((column) => column.id)).toEqual([allowed]);
    expect(columns[0]).toMatchObject({
      count: 23,
      hasMore: true,
      loadingMore: true,
      tasks: [{ id: 'visible' }, { id: 'second' }],
    });
  });

  it('deduplicates multi-assignee search placements and preserves hit order when filtering', () => {
    const first = boardEntity('first', [
      boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
        type: 'EntityReference',
        value: [
          { entity_id: 'alice', entity_type: 'USER' },
          { entity_id: 'bob', entity_type: 'USER' },
        ],
      }),
    ]);
    const rows = [
      createSoupEntityRow(first),
      createSoupEntityRow(first),
      createSoupEntityRow(
        boardEntity('second', [
          boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
            type: 'EntityReference',
            value: [{ entity_id: 'bob', entity_type: 'USER' }],
          }),
        ])
      ),
    ];
    const columns = taskBoardColumns(rows, 'assignee', true);

    expect(
      columns.find((column) => column.id === 'alice')?.tasks
    ).toMatchObject([{ id: 'first' }]);
    expect(columns.find((column) => column.id === 'bob')).toMatchObject({
      count: undefined,
      tasks: [{ id: 'first' }, { id: 'second' }],
    });
    expect(
      filterTaskBoardColumns(columns, 'assignee', {
        assignees: ['bob'],
      }).map((column) => column.id)
    ).toEqual(['bob']);
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
});
