import type { PropertyDefinitionDomain } from '@core/component/Properties/types';
import { toPropertyDefinitionDomain } from '@core/component/Properties/utils';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { createMemo } from 'solid-js';

export function useAllProperties() {
  const query = useListPropertiesQuery(() => ({
    scope: 'all',
    includeOptions: true,
  }));

  return createMemo<PropertyDefinitionDomain[]>(() => {
    if (query.isLoading || query.isError || !query.data) {
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
