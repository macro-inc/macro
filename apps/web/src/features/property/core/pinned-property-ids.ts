import type { Property } from '../types';

/** Resolve implicit defaults and placeholder pins using already-loaded properties. */
export function resolvePinnedPropertyIds(
  properties: readonly Pick<Property, 'propertyId' | 'propertyDefinitionId'>[],
  storedIds: readonly string[] | undefined,
  defaultDefinitionIds: readonly string[] = []
): string[] {
  const selected =
    storedIds ??
    defaultDefinitionIds.flatMap((definitionId) => {
      const property = properties.find(
        (property) => property.propertyDefinitionId === definitionId
      );
      return property ? [property.propertyId] : [];
    });
  const resolved = selected.map((id) => {
    if (!id.startsWith('pending:')) return id;
    const definitionId = id.slice('pending:'.length);
    return (
      properties.find(
        (property) =>
          property.propertyDefinitionId === definitionId &&
          !property.propertyId.startsWith('pending:')
      )?.propertyId ?? id
    );
  });
  return resolved.filter((id, index) => resolved.indexOf(id) === index);
}
