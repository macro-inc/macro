import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import type { Project } from '../core/project';

export function projectTimelineDates(row: {
  project: Project;
  properties: readonly Property[];
}) {
  const due = row.properties.find(
    (property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.DUE_DATE
  );

  return {
    start: row.project.createdAt,
    end: due?.valueType === 'DATE' ? due.value : undefined,
  };
}
