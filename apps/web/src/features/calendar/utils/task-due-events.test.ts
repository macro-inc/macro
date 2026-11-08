import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { describe, expect, it } from 'vitest';
import {
  isTaskDueInRange,
  taskDueCalendarEvent,
  taskDueDay,
} from './task-due-events';

function task(
  overrides: Partial<TaskEntityWithProperties> = {}
): TaskEntityWithProperties {
  return {
    id: 'task-1',
    name: 'Ship the notes',
    ownerId: 'user-1',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    properties: [
      {
        id: 'assignment-1',
        definition: {
          id: SYSTEM_PROPERTY_IDS.DUE_DATE,
          display_name: 'Due date',
          data_type: 'DATE',
          is_metadata: false,
          is_multi_select: false,
          is_system: true,
          owner: { scope: 'system' },
          specific_entity_type: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        value: {
          type: 'Date',
          value: new Date(2026, 10, 6, 15, 30).toISOString(),
        },
      },
    ],
    ...overrides,
  };
}

describe('task due dates on the calendar', () => {
  it('places a due date on its local day, ignoring the time of day', () => {
    const due = new Date(2026, 10, 6, 15, 30);
    expect(taskDueDay(due)).toBe('2026-11-06');

    const event = taskDueCalendarEvent(task());
    expect(event).toMatchObject({
      id: 'task-due:task-1',
      title: 'Ship the notes',
      allDay: true,
      start: '2026-11-06',
      end: '2026-11-07',
      isReadOnly: true,
      taskDue: { taskId: 'task-1', completed: false },
    });
  });

  it('omits tasks that have no due date', () => {
    expect(taskDueCalendarEvent(task({ properties: [] }))).toBeUndefined();
  });

  it('marks a completed task and keeps it on its due day', () => {
    const event = taskDueCalendarEvent(
      task({ subType: { type: 'task', is_completed: true } })
    );
    expect(event?.taskDue?.completed).toBe(true);
    expect(event?.start).toBe('2026-11-06');
  });

  it('keeps a due day only when the visible page includes it', () => {
    expect(
      isTaskDueInRange('2026-11-06', {
        startDate: '2026-11-02',
        endDate: '2026-11-09',
      })
    ).toBe(true);
    expect(
      isTaskDueInRange('2026-11-09', {
        startDate: '2026-11-02',
        endDate: '2026-11-09',
      })
    ).toBe(false);
    expect(
      isTaskDueInRange('2026-11-01', {
        startDate: '2026-11-02',
        endDate: '2026-11-09',
      })
    ).toBe(false);
  });
});
