import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { expect, it } from 'vitest';
import type { TaskEntityWithProperties } from '../types/entity';
import { isTaskCompleted } from './task-properties';

it.each([
  {
    status: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    stored: false,
    expected: true,
  },
  {
    status: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
    stored: true,
    expected: false,
  },
  {
    status: PROPERTY_OPTION_IDS.STATUS.CANCELED,
    stored: true,
    expected: false,
  },
  { status: null, stored: true, expected: false },
  { status: undefined, stored: true, expected: true },
  { status: undefined, stored: false, expected: false },
])(
  'resolves completion from Status $status before subtype $stored',
  ({ status, stored, expected }) => {
    const properties: SoupProperty[] = [];
    if (status !== undefined) {
      properties.push({
        id: 'status-assignment',
        definition: {
          id: SYSTEM_PROPERTY_IDS.STATUS,
          display_name: 'Status',
          data_type: 'SELECT_STRING',
          is_multi_select: false,
          specific_entity_type: null,
          is_metadata: false,
          is_system: true,
          owner: { scope: 'system' },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        value:
          status === null
            ? undefined
            : { type: 'SelectOption', value: [status] },
      });
    }
    const task: TaskEntityWithProperties = {
      id: 'task',
      name: 'Task',
      ownerId: 'viewer',
      type: 'document',
      fileType: 'md',
      subType: { type: 'task', is_completed: stored },
      properties,
    };
    expect(isTaskCompleted(task)).toBe(expected);
  }
);
