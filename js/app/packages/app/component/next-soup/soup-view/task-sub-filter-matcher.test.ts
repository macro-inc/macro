import { describe, expect, it } from 'vitest';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { SoupProperty } from '@service-storage/generated/schemas';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import { matchesTaskSubFilters } from './task-sub-filter-matcher';

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
        statusFilter: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      })
    ).toBe(true);

    expect(
      matchesTaskSubFilters(task, {
        assigneeFilter: 'user-1',
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
        statusFilter: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
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
        assigneeFilter: 'user-1',
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
        statusFilter: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
        assigneeFilter: 'user-1',
      })
    ).toBe(true);
  });
});
