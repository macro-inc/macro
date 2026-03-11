import type { ExpandedEntityType } from '@entity';
import type { PropertyDefinitionDomain } from '../types';

/**
 * Get suggested properties for a given entity type filter.
 * Returns a static list of 4-5 properties.
 *
 * TODO: Add scoring system to dynamically select best properties
 *
 * @param entityTypes - Array of entity types from the filter (e.g., ['document', 'chat'])
 * @returns Array of PropertyDefinitionDomain objects for quick selection
 */
export function getSuggestedProperties(
  _entityTypes: ExpandedEntityType[]
): PropertyDefinitionDomain[] {
  return [];
}
