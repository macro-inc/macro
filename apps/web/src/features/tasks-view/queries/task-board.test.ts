import {
  createSoupEntityRow,
  createSoupGroupHeaderRow,
  createSoupLoadMoreRow,
} from '@app/features/soup/collection/rows';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { propertySortKey } from '@property/utils/sort';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { makeGroupComparator } from '@queries/soup/grouped/api';
import type { GroupMeta } from '@queries/soup/grouped/types';
import { describe, expect, it } from 'vitest';
import { sortTasks } from '../constants';
import {
  createDateBucketBoundaries,
  TASK_DUE_DATE_BUCKETS,
  taskDueDateBucket,
  taskDueDateUrgency,
} from '../core/task-due-date';
import { taskBoardComposerContext } from '../task-composer';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import {
  filterTaskBoardColumns,
  taskBoardColumns,
  taskBoardMoveValue,
  toBoardTask,
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

  it('places the undated column first even when grouped rows arrive later', () => {
    const columns = taskBoardColumns(
      [
        createSoupGroupHeaderRow({ id: 'overdue', label: 'Overdue', count: 1 }),
        createSoupEntityRow(boardEntity('task'), { groupId: 'overdue' }),
      ],
      'due_date',
      false
    );
    expect(columns.map((column) => column.id)).toEqual([
      'no_due_date',
      'overdue',
      'today',
      'tomorrow',
      'next_7_days',
      'later',
    ]);
  });

  it('uses local calendar boundaries and ignores urgency for closed tasks', () => {
    const calendar = createDateBucketBoundaries(
      new Date('2025-03-09T12:00:00Z'),
      'America/New_York'
    );
    expect(taskDueDateUrgency('2025-03-09T04:59:59Z', false, calendar)).toBe(
      'danger'
    );
    expect(taskDueDateUrgency('2025-03-09T05:00:00Z', false, calendar)).toBe(
      'warning'
    );
    expect(taskDueDateUrgency('2025-03-10T04:00:00Z', false, calendar)).toBe(
      'warning'
    );
    expect(taskDueDateUrgency('2025-03-11T03:59:59Z', false, calendar)).toBe(
      'warning'
    );
    expect(
      taskDueDateUrgency('2025-03-11T04:00:00Z', false, calendar)
    ).toBeUndefined();
    expect(
      taskDueDateUrgency('2025-03-17T03:59:59Z', false, calendar)
    ).toBeUndefined();
    expect(
      taskDueDateUrgency('2025-03-09T04:59:59Z', true, calendar)
    ).toBeUndefined();
    expect(taskDueDateUrgency(undefined, false, calendar)).toBeUndefined();
  });

  it('keeps completed and canceled board tasks neutral', () => {
    for (const status of [
      PROPERTY_OPTION_IDS.STATUS.COMPLETED,
      PROPERTY_OPTION_IDS.STATUS.CANCELED,
    ]) {
      const task = boardEntity('closed', [
        boardProperty(
          SYSTEM_PROPERTY_IDS.STATUS,
          { type: 'SelectOption', value: [status] },
          'SELECT_STRING'
        ),
        boardProperty(
          SYSTEM_PROPERTY_IDS.DUE_DATE,
          { type: 'Date', value: '2025-03-08T12:00:00Z' },
          'DATE'
        ),
      ]);
      const projected = toBoardTask(task);
      expect(projected.closed).toBe(true);
    }
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

describe('board task drafts', () => {
  it('keeps host presets and seeds dates within the chosen bucket across DST', () => {
    const calendar = createDateBucketBoundaries(
      new Date('2025-03-09T12:00:00Z'),
      'America/New_York'
    );
    const project = {
      valueType: 'ENTITY' as const,
      refs: [{ entity_id: 'project', entity_type: 'INITIATIVE' as const }],
    };
    for (const { id } of TASK_DUE_DATE_BUCKETS) {
      const draft = taskBoardComposerContext({
        grouping: 'due_date',
        columnId: id,
        calendar,
        context: {
          key: 'project-view',
          visiblePropertyIds: [SYSTEM_PROPERTY_IDS.PROJECT],
          initialPropertyValues: {
            [SYSTEM_PROPERTY_IDS.PROJECT]: project,
            [SYSTEM_PROPERTY_IDS.DUE_DATE]: {
              valueType: 'DATE',
              value: new Date('2025-03-01T05:00:00Z'),
            },
          },
        },
      });
      const dueDate =
        draft.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.DUE_DATE];
      expect(dueDate?.valueType).toBe('DATE');
      if (dueDate?.valueType !== 'DATE') throw new Error('Missing date preset');
      expect(taskDueDateBucket(dueDate.value?.toISOString(), calendar)).toBe(
        id
      );
      expect(
        draft.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.PROJECT]
      ).toEqual(project);
      expect(draft.visiblePropertyIds).toContain(SYSTEM_PROPERTY_IDS.DUE_DATE);
      if (id === 'tomorrow') {
        expect(dueDate.value?.toISOString()).toBe('2025-03-10T04:00:00.000Z');
      }
      if (id === 'no_due_date') expect(dueDate.value).toBeNull();
    }
  });

  it('scopes dated drafts to their local day and timezone', () => {
    const before = createDateBucketBoundaries(
      new Date('2025-03-09T04:59:59Z'),
      'America/New_York'
    );
    const after = createDateBucketBoundaries(
      new Date('2025-03-09T05:00:00Z'),
      'America/New_York'
    );
    const later = createDateBucketBoundaries(
      new Date('2025-03-09T18:00:00Z'),
      'America/New_York'
    );
    const utc = createDateBucketBoundaries(
      new Date('2025-03-09T18:00:00Z'),
      'UTC'
    );
    for (const { id } of TASK_DUE_DATE_BUCKETS) {
      if (id === 'no_due_date') continue;
      const draft = (calendar: typeof before) =>
        taskBoardComposerContext({
          grouping: 'due_date',
          columnId: id,
          scopeKey: 'project-view',
          calendar,
        });
      expect(draft(after).key).not.toBe(draft(before).key);
      expect(draft(after).key).toBe(draft(later).key);
      expect(draft(utc).key).not.toBe(draft(later).key);
    }
    for (const grouping of ['due_date', 'status', 'assignee'] as const) {
      const draft = (calendar: typeof before) =>
        taskBoardComposerContext({
          grouping,
          columnId: grouping === 'due_date' ? 'no_due_date' : '',
          scopeKey: 'project-view',
          calendar,
        });
      expect(draft(after).key).toBe(draft(before).key);
      expect(draft(utc).key).toBe(draft(later).key);
    }
  });
});

describe('property sorting', () => {
  it('keeps missing and wrong-type dates last and breaks date ties by update then descending id', () => {
    const property = (date: string) =>
      boardProperty(
        SYSTEM_PROPERTY_IDS.DUE_DATE,
        { type: 'Date', value: date },
        'DATE'
      );
    const older = {
      ...boardEntity('a', [property('2026-10-28T00:00:00Z')]),
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const newer = {
      ...boardEntity('b', older.properties),
      updatedAt: '2026-10-02T00:00:00Z',
    };
    const tied = { ...newer, id: 'c' };
    const later = {
      ...boardEntity('later', [property('2026-10-29T00:00:00Z')]),
      updatedAt: '2026-10-03T00:00:00Z',
    };
    const absent = {
      ...boardEntity('missing'),
      updatedAt: '2026-10-02T00:00:00Z',
    };
    const wrongType = {
      ...boardEntity('wrong', [
        boardProperty(
          SYSTEM_PROPERTY_IDS.DUE_DATE,
          { type: 'Number', value: 0 },
          'DATE'
        ),
      ]),
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const rows = [absent, older, wrongType, later, newer, tied];
    expect(
      sortTasks(rows, [{ id: 'due_date_earliest' }]).map((row) => row.id)
    ).toEqual(['c', 'b', 'a', 'later', 'missing', 'wrong']);
    expect(
      sortTasks(rows, [{ id: 'due_date_latest' }]).map((row) => row.id)
    ).toEqual(['later', 'c', 'b', 'a', 'missing', 'wrong']);
    expect(propertySortKey(property('2026-10-28T00:00:00.000001Z'))).toBe(
      1793145600000001
    );
    expect(propertySortKey(property('1969-12-31T23:59:59.999999Z'))).toBe(-1);
    expect(propertySortKey(property('2026-02-30T00:00:00Z'))).toBeUndefined();
  });

  it('uses cached option display order rather than option labels or identifiers', () => {
    const id = SYSTEM_PROPERTY_IDS.PRIORITY;
    const high = boardProperty(
      id,
      { type: 'SelectOption', value: ['custom-first', 'custom-second'] },
      'SELECT_STRING'
    );
    const low = boardProperty(
      id,
      { type: 'SelectOption', value: ['custom-first'] },
      'SELECT_STRING'
    );
    const definition = toPropertyDefinitionDomain(high.definition, [
      {
        id: 'custom-first',
        property_definition_id: id,
        display_order: 0,
        value: { type: 'string', value: 'Urgent' },
        color: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'custom-second',
        property_definition_id: id,
        display_order: 3,
        value: { type: 'string', value: 'Low' },
        color: null,
        created_at: '',
        updated_at: '',
      },
    ]);
    // Multi-select uses the lowest option order, not the highest.
    expect(propertySortKey(high, definition.options)).toBe(0);
    expect(
      propertySortKey(
        high,
        definition.options?.map((option) => ({
          ...option,
          property_definition_id: 'another-definition',
        }))
      )
    ).toBeUndefined();
    const second = boardProperty(
      id,
      { type: 'SelectOption', value: ['custom-second'] },
      'SELECT_STRING'
    );
    const rows = [
      boardEntity('a', [low]),
      boardEntity('b', [second]),
      boardEntity('missing'),
    ];
    const definitions = new Map([[id, definition]]);
    expect(
      sortTasks(rows, [{ id: 'priority' }], definitions).map((row) => row.id)
    ).toEqual(['b', 'a', 'missing']);
    expect(
      sortTasks(rows, [{ id: 'priority', reversed: true }], definitions).map(
        (row) => row.id
      )
    ).toEqual(['a', 'b', 'missing']);
  });

  it('uses server option display order for groups and leaves missing values last', () => {
    for (const propertyDefinitionId of [
      SYSTEM_PROPERTY_IDS.STATUS,
      SYSTEM_PROPERTY_IDS.PRIORITY,
    ]) {
      const groups: GroupMeta[] = [
        {
          key: '',
          label: 'Not Set',
          displayOrder: null,
          itemIds: [],
          totalCount: 0,
          nextCursor: null,
        },
        {
          key: 'later',
          label: 'A',
          displayOrder: 3,
          itemIds: [],
          totalCount: 0,
          nextCursor: null,
        },
        {
          key: 'earlier',
          label: 'Z',
          displayOrder: 0,
          itemIds: [],
          totalCount: 0,
          nextCursor: null,
        },
      ];
      expect(
        groups
          .sort(makeGroupComparator({ type: 'property', propertyDefinitionId }))
          .map((group) => group.key)
      ).toEqual(['earlier', 'later', '']);
    }
  });
});
