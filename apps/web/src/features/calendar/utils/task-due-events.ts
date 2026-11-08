import { formatLocalDate } from '@core/util/local-date';
import type { TaskEntity, TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
  TASKS_CALENDAR_COLOR,
  TASKS_SOURCE_ID,
} from '../types';

const TASKS_CALENDAR = {
  id: TASKS_SOURCE_ID,
  name: 'Tasks',
  color: TASKS_CALENDAR_COLOR,
};

/** Local calendar day a due timestamp belongs to, matching other due-date labels. */
export function taskDueDay(due: Date): string | undefined {
  if (Number.isNaN(due.getTime())) return undefined;
  return formatLocalDate(due);
}

function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return formatLocalDate(new Date(year, month - 1, date + 1));
}

/** Whether a due day falls on a visible calendar page. The end day is exclusive. */
export function isTaskDueInRange(
  day: string,
  range: Pick<CalendarOccurrenceQueryRange, 'startDate' | 'endDate'>
) {
  return day >= range.startDate && day < range.endDate;
}

function dueInstant(task: TaskEntityWithProperties): Date | undefined {
  const value = task.properties?.find(
    (property) => property.definition.id === SYSTEM_PROPERTY_IDS.DUE_DATE
  )?.value;
  if (!value || value.type !== 'Date') return undefined;
  const due = new Date(value.value);
  return Number.isNaN(due.getTime()) ? undefined : due;
}

/**
 * An all-day calendar chip for a task's due date. Tasks without a due date
 * are omitted. The time of day does not move the chip: due dates are dates.
 */
export function taskDueCalendarEvent(
  task: TaskEntity & Pick<TaskEntityWithProperties, 'properties'>
): CalendarEvent | undefined {
  const due = dueInstant(task);
  const day = due ? taskDueDay(due) : undefined;
  if (!day) return undefined;

  const title = task.name.trim() || 'Untitled';
  return {
    id: `task-due:${task.id}`,
    eventId: task.id,
    occurrenceKey: day,
    isCancelled: false,
    isReadOnly: true,
    attendees: [],
    guestPolicy: DEFAULT_GUEST_POLICY,
    viewerCan: NO_VIEWER_CAPABILITIES,
    recurrenceLines: [],
    sourceCalendarIds: [TASKS_SOURCE_ID],
    title,
    start: day,
    end: nextDay(day),
    allDay: true,
    calendar: TASKS_CALENDAR,
    visibleCalendars: [TASKS_CALENDAR],
    taskDue: {
      taskId: task.id,
      completed: task.subType.is_completed === true,
    },
  };
}
