import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { PropertyDefinitionDomain } from '../types';

export function usePropertySelection(
  existingPropertyIds: () => string[],
  availableProperties: Accessor<PropertyDefinitionDomain[]>,
  searchQuery?: () => string
) {
  const [selectedPropertyIds, setSelectedPropertyIds] = createSignal<
    Set<string>
  >(new Set());

  const existingPropertyIdsSet = createMemo(
    () => new Set(existingPropertyIds())
  );

  const filteredProperties = createMemo(() => {
    const query = searchQuery ? searchQuery().toLowerCase().trim() : '';
    const existingIds = existingPropertyIdsSet();

    const filtered = availableProperties().filter(
      (property) =>
        property &&
        property.id &&
        !existingIds.has(property.id) &&
        // COMPANY entity properties not yet implemented
        property.specificEntityType !== 'COMPANY'
    );

    // Then apply search filter
    if (!query) return filtered;

    return filtered.filter((property) => {
      const name = property.displayName.toLowerCase();
      if (name.includes(query)) {
        return true;
      }

      const dataType = property.valueType;
      let typeDisplay = dataType;

      if (dataType === 'ENTITY' && property.specificEntityType) {
        typeDisplay += ` ${property.specificEntityType}`;
      }

      return typeDisplay.toLowerCase().includes(query);
    });
  });

  const togglePropertySelection = (propertyId: string) => {
    setSelectedPropertyIds((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(propertyId)) {
        newSelected.delete(propertyId);
      } else {
        newSelected.add(propertyId);
      }
      return newSelected;
    });
  };

  const clearSelection = () => {
    setSelectedPropertyIds(new Set<string>());
  };

  return {
    filteredProperties,
    selectedPropertyIds,
    togglePropertySelection,
    clearSelection,
  };
}
