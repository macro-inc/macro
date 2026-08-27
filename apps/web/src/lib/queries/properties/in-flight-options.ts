/**
 * Read side of an in-flight option selection, kept free of any transport
 * import. List rows read this on every render, and pulling the mutation module
 * in would drag the REST and GraphQL clients (and the Soup websocket) into
 * every consumer that only wants to display a pending tag.
 */

import type { Property, PropertyDefinitionDomain } from '@property/types';
// The concrete module, not the `@property/utils` barrel, which pulls UI and
// side-effecting imports along with it.
import { isInstantiatedProperty } from '@property/utils/typeGuards';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { useMutationState } from '@tanstack/solid-query';

/** One tag-picker selection, as submitted to the option-update mutation. */
export type BulkUpdateEntityPropertyOptionsParams = {
  entityId: string;
  entityType: EntityType;
  properties: Array<{
    property: Property | PropertyDefinitionDomain;
    currentOptionIds: string[];
    nextOptionIds: string[];
  }>;
};

/**
 * Mutation-cache key for an entity's bulk option updates. Used both as the
 * mutation's serialization scope and to read its in-flight variables for
 * optimistic display.
 */
export function bulkEntityPropertyOptionsKey(entityId: string) {
  return ['bulkEntityPropertyOptions', entityId] as const;
}

function propertyDefinitionIdOf(
  property: Property | PropertyDefinitionDomain
): string {
  return isInstantiatedProperty(property)
    ? property.propertyDefinitionId
    : property.id;
}

/**
 * Optimistic overlay for a tag source a mutation cannot write through: query
 * results, and soup rows whose property record does not exist yet (an entity's
 * first tag from a set has no assignment id until the server answers). Returns
 * the option ids an in-flight update is applying, or `undefined` when nothing is
 * in flight for the property, so callers fall back to the persisted value. On
 * settle the mutation leaves `pending` and the overlay disappears — no manual
 * rollback.
 */
export function useInFlightEntityPropertyOptions(entityId: string) {
  const inFlight = useMutationState(() => ({
    filters: {
      mutationKey: bulkEntityPropertyOptionsKey(entityId),
      status: 'pending' as const,
    },
    select: (mutation) =>
      mutation.state.variables as
        | BulkUpdateEntityPropertyOptionsParams
        | undefined,
  }));

  return (propertyDefinitionId: string): string[] | undefined => {
    const pending = inFlight();
    // Latest in-flight update targeting this property wins.
    for (let index = pending.length - 1; index >= 0; index--) {
      const match = pending[index]?.properties.find(
        (update) =>
          propertyDefinitionIdOf(update.property) === propertyDefinitionId
      );
      if (match) return match.nextOptionIds;
    }
    return undefined;
  };
}
