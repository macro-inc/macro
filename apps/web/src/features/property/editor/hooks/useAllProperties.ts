import type { PropertyDefinitionDomain } from '@property/types';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo } from 'solid-js';

/**
 * Every property definition the user can see. With `forEntityType`, only the
 * ones the server lets an entity of that type take.
 */
export function useAllProperties(
  enabled: Accessor<boolean> = () => true,
  forEntityType: Accessor<EntityType | undefined> = () => undefined
) {
  const query = useListPropertiesQuery(
    () => ({
      scope: 'all',
      includeOptions: true,
      forEntityType: forEntityType(),
    }),
    enabled
  );

  return createMemo<PropertyDefinitionDomain[]>(() => {
    if (!query.isSuccess) {
      return [];
    }

    const data = query.data;

    const properties = Array.isArray(data) ? data : [];
    return properties.map((item) => {
      if ('definition' in item) {
        return toPropertyDefinitionDomain(
          item.definition,
          item.property_options || []
        );
      }
      return toPropertyDefinitionDomain(item);
    });
  });
}
