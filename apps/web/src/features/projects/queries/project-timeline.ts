import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { DateProperty, Property } from '@property/types';
import type { DateField } from '@property/utils/start-due';
import type { Project } from '../core/project';

type ProjectTimelineRow = {
  project: Project;
  properties: readonly Property[];
};

function dateProperty(
  row: ProjectTimelineRow,
  definitionId: string
): DateProperty | undefined {
  const property = row.properties.find(
    (property) => property.propertyDefinitionId === definitionId
  );
  return property?.valueType === 'DATE' ? property : undefined;
}

/**
 * With start dates on, a bar starts at the Start Date, or at the created date
 * for a project without one.
 */
export function projectTimelineDates(
  row: ProjectTimelineRow,
  startDates = false
) {
  const start = startDates
    ? dateProperty(row, SYSTEM_PROPERTY_IDS.START_DATE)?.value
    : undefined;
  return {
    start: start ?? row.project.createdAt,
    end: dateProperty(row, SYSTEM_PROPERTY_IDS.DUE_DATE)?.value,
  };
}

function hasTime(row: ProjectTimelineRow, definitionId: string) {
  return dateProperty(row, definitionId)?.hasTime === true;
}

/** Whether the project's Start Date or Due Date has its time of day set. */
export function projectTimelineTimed(row: ProjectTimelineRow): boolean {
  return (
    hasTime(row, SYSTEM_PROPERTY_IDS.START_DATE) ||
    hasTime(row, SYSTEM_PROPERTY_IDS.DUE_DATE)
  );
}

/** With both ends set and only one of them timed, the end saved as a day. */
export function projectTimelineWholeDay(
  row: ProjectTimelineRow
): DateField | undefined {
  if (
    dateProperty(row, SYSTEM_PROPERTY_IDS.START_DATE)?.value == null ||
    dateProperty(row, SYSTEM_PROPERTY_IDS.DUE_DATE)?.value == null
  )
    return undefined;
  const start = hasTime(row, SYSTEM_PROPERTY_IDS.START_DATE);
  if (start === hasTime(row, SYSTEM_PROPERTY_IDS.DUE_DATE)) return undefined;
  return start ? 'due' : 'start';
}
