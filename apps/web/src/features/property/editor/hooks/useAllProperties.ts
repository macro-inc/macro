import type { PropertyDefinitionDomain } from '@property/types';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { type Accessor, createMemo } from 'solid-js';

export function useAllProperties(enabled: Accessor<boolean> = () => true) {
  const query = useListPropertiesQuery(
    () => ({ scope: 'all', includeOptions: true }),
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
