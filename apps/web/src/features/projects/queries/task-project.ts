import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';

/** A task's project is its Project system property: one project reference. */
export const TASK_PROJECT_PROPERTY: PropertyDefinitionDomain = {
  id: SYSTEM_PROPERTY_IDS.PROJECT,
  displayName: 'Project',
  valueType: 'ENTITY',
  isMultiSelect: false,
  isMetadata: false,
  isSystem: true,
  owner: { scope: 'system' },
  specificEntityType: 'INITIATIVE',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** The Project property value naming `projectId`, or clearing it. */
export const taskProjectValue = (projectId?: string): PropertyApiValues => ({
  valueType: 'ENTITY',
  refs: projectId
    ? [{ entity_id: projectId, entity_type: 'INITIATIVE' }]
    : null,
});

/** The project a task's properties name, if any. */
export function taskProjectId(
  properties: readonly Property[]
): string | undefined {
  const property = properties.find(
    (property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
  );
  if (property?.valueType !== 'ENTITY') return undefined;
  return property.value?.find(
    (reference) => reference.entity_type === 'INITIATIVE'
  )?.entity_id;
}
