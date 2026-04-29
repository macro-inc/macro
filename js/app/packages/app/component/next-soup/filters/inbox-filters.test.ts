import { describe, expect, it } from 'vitest';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { SoupProperty } from '@service-storage/generated/schemas';
import type { TaskEntityWithProperties } from '@entity';
import { isSignalTask } from './inbox-filters';

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
  ownerId?: string;
  isCompleted?: boolean;
  properties?: SoupProperty[];
}): TaskEntityWithProperties => {
  return {
    id: 'task-1',
    name: 'Task',
    ownerId: props?.ownerId ?? 'owner-1',
    type: 'document',
    fileType: 'md',
    subType: {
      type: 'task',
      is_completed: props?.isCompleted,
    },
    properties: props?.properties ?? [],
  };
};

describe('isSignalTask', () => {
  it('returns false when the task is completed via subtype flag', () => {
    expect(isSignalTask(createTask({ isCompleted: true }))).toBe(false);
  });

  it('returns false when the task status is completed', () => {
    const entity = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
        }),
      ],
    });
    expect(isSignalTask(entity)).toBe(false);
  });

  it('returns false when the task status is canceled', () => {
    const entity = createTask({
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.CANCELED],
        }),
      ],
    });
    expect(isSignalTask(entity)).toBe(false);
  });

  it('returns true for an open task regardless of assignees or ownership', () => {
    const entity = createTask({
      ownerId: 'owner-1',
      properties: [
        createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: 'someone-else' }],
        }),
      ],
    });
    expect(isSignalTask(entity)).toBe(true);
  });

  it('returns true for an open task with no assignees', () => {
    expect(isSignalTask(createTask())).toBe(true);
  });
});
