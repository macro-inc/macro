import { describe, expect, it } from 'vitest';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { SoupProperty } from '@service-storage/generated/schemas';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import { matchesTaskSubFilters, NO_ASSIGNEE } from './task-sub-filter-matcher';

const createSoupProperty = (
  definitionId: string,
  value: unknown
): SoupProperty => {
  return {
    definition: { id: definitionId },
    value,
  } as unknown as SoupProperty;
};

const createTask = (props?: {
  properties?: SoupProperty[];
}): TaskEntityWithProperties => {
  return {
    id: 'task-1',
    name: 'Task',
    ownerId: 'owner-1',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task' },
    ...(props?.properties ? { properties: props.properties } : {}),
  };
};

describe('matchesTaskSubFilters', () => {
  it('keeps tasks without properties when sub-filters are active', () => {
    const task = createTask();

    expect(
      matchesTaskSubFilters(task, {
        statusFilter: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
      })
    ).toBe(true);

    expect(
      matchesTaskSubFilters(task, {
        assigneeFilter: ['user-1'],
      })
    ).toBe(true);
  });

  it('filters out tasks with non-matching status when properties exist', () => {
    const task = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW],
        }),
      ],
    });

    expect(
      matchesTaskSubFilters(task, {
        statusFilter: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
      })
    ).toBe(false);
  });

  it('filters out tasks with non-matching assignee when properties exist', () => {
    const task = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-2' }],
        }),
      ],
    });

    expect(
      matchesTaskSubFilters(task, {
        assigneeFilter: ['user-1'],
      })
    ).toBe(false);
  });

  it('keeps tasks when status and assignee both match', () => {
    const task = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        }),
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-1' }],
        }),
      ],
    });

    expect(
      matchesTaskSubFilters(task, {
        statusFilter: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        assigneeFilter: ['user-1'],
      })
    ).toBe(true);
  });

  it('matches any status when multiple statuses are in filter', () => {
    const taskInProgress = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        }),
      ],
    });

    const taskInReview = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW],
        }),
      ],
    });

    const taskDone = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
        }),
      ],
    });

    const multiStatusFilter = [
      PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
    ];

    expect(
      matchesTaskSubFilters(taskInProgress, { statusFilter: multiStatusFilter })
    ).toBe(true);
    expect(
      matchesTaskSubFilters(taskInReview, { statusFilter: multiStatusFilter })
    ).toBe(true);
    expect(
      matchesTaskSubFilters(taskDone, { statusFilter: multiStatusFilter })
    ).toBe(false);
  });

  it('matches any assignee when multiple assignees are in filter', () => {
    const taskUser1 = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-1' }],
        }),
      ],
    });

    const taskUser2 = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-2' }],
        }),
      ],
    });

    const taskUser3 = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-3' }],
        }),
      ],
    });

    const multiAssigneeFilter = ['user-1', 'user-2'];

    expect(
      matchesTaskSubFilters(taskUser1, { assigneeFilter: multiAssigneeFilter })
    ).toBe(true);
    expect(
      matchesTaskSubFilters(taskUser2, { assigneeFilter: multiAssigneeFilter })
    ).toBe(true);
    expect(
      matchesTaskSubFilters(taskUser3, { assigneeFilter: multiAssigneeFilter })
    ).toBe(false);
  });

  it('treats empty arrays the same as undefined filters', () => {
    const task = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        }),
      ],
    });

    expect(
      matchesTaskSubFilters(task, { statusFilter: [], assigneeFilter: [] })
    ).toBe(true);
  });

  it('matches unassigned tasks when NO_ASSIGNEE filter is active', () => {
    const taskWithNoAssignees = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [],
        }),
      ],
    });

    const taskWithAssignee = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-1' }],
        }),
      ],
    });

    expect(
      matchesTaskSubFilters(taskWithNoAssignees, {
        assigneeFilter: [NO_ASSIGNEE],
      })
    ).toBe(true);

    expect(
      matchesTaskSubFilters(taskWithAssignee, { assigneeFilter: [NO_ASSIGNEE] })
    ).toBe(false);
  });

  it('matches both unassigned and specific assignees when both filters are active', () => {
    const taskWithNoAssignees = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [],
        }),
      ],
    });

    const taskWithUser1 = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-1' }],
        }),
      ],
    });

    const taskWithUser2 = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'user-2' }],
        }),
      ],
    });

    const combinedFilter = [NO_ASSIGNEE, 'user-1'];

    expect(
      matchesTaskSubFilters(taskWithNoAssignees, {
        assigneeFilter: combinedFilter,
      })
    ).toBe(true);

    expect(
      matchesTaskSubFilters(taskWithUser1, { assigneeFilter: combinedFilter })
    ).toBe(true);

    expect(
      matchesTaskSubFilters(taskWithUser2, { assigneeFilter: combinedFilter })
    ).toBe(false);
  });
});
