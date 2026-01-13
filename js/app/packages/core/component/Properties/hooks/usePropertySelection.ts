import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { PropertyDefinitionFlat } from '../types';

export function usePropertySelection(
  existingPropertyIds: () => string[],
  availableProperties: Accessor<PropertyDefinitionFlat[]>,
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
        property.specific_entity_type !== 'COMPANY'
    );

    // Then apply search filter
    if (!query) return filtered;

    return filtered.filter((property) => {
      const name = property.display_name.toLowerCase();
      if (name.includes(query)) {
        return true;
      }

      const dataType = property.data_type;
      let typeDisplay = dataType;

      if (dataType === 'ENTITY' && property.specific_entity_type) {
        typeDisplay += ` ${property.specific_entity_type}`;
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
