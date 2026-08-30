import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type { Property } from '../types';
import { isStringProperty } from './typeGuards';

type PreviewNameInput = {
  loading: boolean;
  access?: string;
  name?: string;
};

export function previewableEntityDisplayName(
  entityType: EntityType,
  preview: PreviewNameInput | undefined,
  _fallbackName?: string
): string {
  if (!preview || preview.loading) return 'Loading...';
  if (preview.access === 'access' && preview.name) return preview.name;
  return `Unknown ${entityType.toLowerCase()}`;
}

export function emailThreadSubjectFallback(
  entityType: EntityType,
  properties: readonly Property[]
): string | undefined {
  if (entityType !== 'THREAD') return undefined;
  const subject = properties.find(
    (property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.SUBJECT
  );
  if (!subject || !isStringProperty(subject) || !subject.value) {
    return undefined;
  }
  return subject.value;
}
