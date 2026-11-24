import type { GanttTimedEnd } from '@app/components/gantt/gantt-time';
import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { DateField } from '@property/utils/start-due';

function dateValue(task: TaskEntityWithProperties, definitionId: string) {
  const value = task.properties?.find(
    (property) => property.definition.id === definitionId
  )?.value;
  return value?.type === 'Date' ? value : undefined;
}

/**
 * Timeline dates come from the existing task payload, not another query. With
 * start dates on, a bar starts at the Start Date, or at the created date for a
 * task without one.
 */
export function taskGanttDates(
  task: TaskEntityWithProperties,
  startDates = false
) {
  const start = startDates
    ? dateValue(task, SYSTEM_PROPERTY_IDS.START_DATE)
    : undefined;
  return {
    start: start?.value ?? task.createdAt,
    end: dateValue(task, SYSTEM_PROPERTY_IDS.DUE_DATE)?.value,
  };
}

function hasTime(task: TaskEntityWithProperties, definitionId: string) {
  const value = dateValue(task, definitionId);
  return !!value && 'has_time' in value && value.has_time === true;
}

/** Whether the task's Start Date or Due Date has its time of day set. */
export function taskGanttTimed(task: TaskEntityWithProperties): boolean {
  return (
    hasTime(task, SYSTEM_PROPERTY_IDS.START_DATE) ||
    hasTime(task, SYSTEM_PROPERTY_IDS.DUE_DATE)
  );
}

/** With both ends set and only one of them timed, the end saved as a day. */
export function taskGanttWholeDay(
  task: TaskEntityWithProperties
): DateField | undefined {
  if (
    !dateValue(task, SYSTEM_PROPERTY_IDS.START_DATE) ||
    !dateValue(task, SYSTEM_PROPERTY_IDS.DUE_DATE)
  )
    return undefined;
  const start = hasTime(task, SYSTEM_PROPERTY_IDS.START_DATE);
  const due = hasTime(task, SYSTEM_PROPERTY_IDS.DUE_DATE);
  if (start === due) return undefined;
  return start ? 'due' : 'start';
}

/** `taskGanttWholeDay` as a timeline bar names its ends. */
export function taskGanttWholeDayEnd(
  task: TaskEntityWithProperties
): GanttTimedEnd | undefined {
  const end = taskGanttWholeDay(task);
  return end === 'due' ? 'end' : end;
}
