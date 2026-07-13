import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { CrmCompanyEntity, EntityWithProperties } from '../types/entity';

export type CrmCompanyEntityWithProperties =
  EntityWithProperties<CrmCompanyEntity>;

const getCompanyPropertyByDefinitionId = (
  entity: CrmCompanyEntityWithProperties,
  definitionId: string
) => {
  return entity.properties?.find(
    (property) => property.definition.id === definitionId
  );
};

/**
 * Gets the stage option id from company properties.
 */
export const getCompanyStageOptionId = (
  entity: CrmCompanyEntityWithProperties
): string | undefined => {
  const stageProperty = getCompanyPropertyByDefinitionId(
    entity,
    SYSTEM_PROPERTY_IDS.STAGE
  );

  const value = stageProperty?.value;
  if (value?.type !== 'SelectOption' || !Array.isArray(value.value)) {
    return undefined;
  }

  const optionId = value.value[0];
  return typeof optionId === 'string' ? optionId : undefined;
};

/**
 * Gets the owner user id from company properties.
 */
export const getCompanyOwnerId = (
  entity: CrmCompanyEntityWithProperties
): string | undefined => {
  const ownerProperty = getCompanyPropertyByDefinitionId(
    entity,
    SYSTEM_PROPERTY_IDS.COMPANY_OWNER
  );

  const value = ownerProperty?.value;
  if (value?.type !== 'EntityReference' || !Array.isArray(value.value)) {
    return undefined;
  }

  const reference = value.value[0];
  if (
    typeof reference !== 'object' ||
    reference === null ||
    !('entity_id' in reference) ||
    typeof reference.entity_id !== 'string'
  ) {
    return undefined;
  }

  return reference.entity_id;
};
