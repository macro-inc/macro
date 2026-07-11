import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { SoupProperty } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import type { TaskEntityWithProperties } from '../src/types/entity';
import {
  getTaskAssigneeIds,
  getTaskStatusOptionId,
  isCurrentUserAssigned,
  isTaskClosed,
} from '../src/utils/task-properties';

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
  isCompleted?: boolean;
  properties?: SoupProperty[];
}): TaskEntityWithProperties => {
  return {
    id: 'task-1',
    name: 'Task',
    ownerId: 'owner-1',
    type: 'document',
    fileType: 'md',
    subType: {
      type: 'task',
      is_completed: props?.isCompleted,
    },
    properties: props?.properties ?? [],
  };
};

describe('task property helpers', () => {
  describe('getTaskAssigneeIds', () => {
    it('returns only USER entity ids from assignees property', () => {
      const entity = createTask({
        properties: [
          createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
            type: 'EntityReference',
            value: [
              { entity_type: 'USER', entity_id: 'user-1' },
              { entity_type: 'CHANNEL', entity_id: 'channel-1' },
              { entity_type: 'USER', entity_id: 'user-2' },
            ],
          }),
        ],
      });

      expect(getTaskAssigneeIds(entity)).toEqual(['user-1', 'user-2']);
    });

    it('returns empty array when assignees property is missing', () => {
      const entity = createTask();
      expect(getTaskAssigneeIds(entity)).toEqual([]);
    });
  });

  describe('getTaskStatusOptionId', () => {
    it('returns first selected status option id', () => {
      const entity = createTask({
        properties: [
          createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
            type: 'SelectOption',
            value: [
              PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
              PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
            ],
          }),
        ],
      });

      expect(getTaskStatusOptionId(entity)).toBe(
        PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS
      );
    });

    it('returns undefined when status property is missing', () => {
      const entity = createTask();
      expect(getTaskStatusOptionId(entity)).toBeUndefined();
    });
  });

  describe('isTaskClosed', () => {
    it('returns true when subtype is marked completed', () => {
      const entity = createTask({ isCompleted: true });
      expect(isTaskClosed(entity)).toBe(true);
    });

    it('returns true for completed status option', () => {
      const entity = createTask({
        properties: [
          createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
            type: 'SelectOption',
            value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
          }),
        ],
      });

      expect(isTaskClosed(entity)).toBe(true);
    });

    it('returns false for in-progress status option', () => {
      const entity = createTask({
        properties: [
          createSoupProperty(SYSTEM_PROPERTY_IDS.STATUS, {
            type: 'SelectOption',
            value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
          }),
        ],
      });

      expect(isTaskClosed(entity)).toBe(false);
    });
  });

  describe('isCurrentUserAssigned', () => {
    it('returns false when current user is undefined', () => {
      const entity = createTask();
      expect(isCurrentUserAssigned(entity, undefined)).toBe(false);
    });

    it('returns true when task has no assignees', () => {
      const entity = createTask();
      expect(isCurrentUserAssigned(entity, 'user-1')).toBe(true);
    });

    it('returns true when current user is assigned', () => {
      const entity = createTask({
        properties: [
          createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
            type: 'EntityReference',
            value: [{ entity_type: 'USER', entity_id: 'user-1' }],
          }),
        ],
      });

      expect(isCurrentUserAssigned(entity, 'user-1')).toBe(true);
    });

    it('returns false when current user is not assigned', () => {
      const entity = createTask({
        properties: [
          createSoupProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
            type: 'EntityReference',
            value: [{ entity_type: 'USER', entity_id: 'user-2' }],
          }),
        ],
      });

      expect(isCurrentUserAssigned(entity, 'user-1')).toBe(false);
    });
  });
});
