import { deepEqual } from '@core/util/compareUtils';
import type { NetworkOptimisticUpdate } from '@graphql-cache/exchange/network-revalidation-exchange';
import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import type {
  SetEntityPropertyMutationVariables,
  SoupPropertyFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { getOperationName, type Operation } from '@urql/core';
import { propertyParentTypename } from './assignment-links';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Patches existing parents only; this cannot infer list membership or ordering. */
function projectProperties(
  data: unknown,
  typename: string,
  entityId: string,
  properties: readonly SoupPropertyFieldsFragment[]
): unknown {
  if (Array.isArray(data)) {
    const next = data.map((item) =>
      projectProperties(item, typename, entityId, properties)
    );
    return next.some((item, index) => item !== data[index]) ? next : data;
  }
  if (!isObject(data)) return data;
  if (
    data.__typename === typename &&
    data.id === entityId &&
    Array.isArray(data.properties)
  ) {
    let next = data.properties;
    for (const property of properties) {
      const index = next.findIndex(
        (entry) =>
          isObject(entry) &&
          entry.propertyDefinitionId === property.propertyDefinitionId
      );
      const previous = next[index];
      if (
        isObject(previous) &&
        Object.entries(property).every(([key, value]) =>
          deepEqual(previous[key], value)
        )
      )
        continue;
      next = [...next];
      if (index < 0) next.push(property);
      else next[index] = property;
    }
    return next === data.properties ? data : { ...data, properties: next };
  }
  let next = data;
  for (const [key, value] of Object.entries(data)) {
    const projected = projectProperties(value, typename, entityId, properties);
    if (projected === value) continue;
    if (next === data) next = { ...data };
    next[key] = projected;
  }
  return next;
}

/** Reuses mutation payloads for active network readers, without another cache. */
export function createPropertyNetworkOptimism(
  operation: Operation
): NetworkOptimisticUpdate | undefined {
  const name = getOperationName(operation.query);
  if (name !== 'SetEntityProperty' && name !== 'UpdateEntityPropertyOptions')
    return undefined;
  const optimistic = optimisticContextOf(operation)?.optimisticResponse;
  if (!isObject(optimistic)) return undefined;
  // Both generated inputs carry the same target identity.
  const { input } = operation.variables as SetEntityPropertyMutationVariables;
  const typename = propertyParentTypename(input.entityType);
  if (!typename) return undefined;
  const field =
    name === 'SetEntityProperty'
      ? 'setEntityProperty'
      : 'updateEntityPropertyOptions';
  const readProperties = (data: unknown): SoupPropertyFieldsFragment[] => {
    if (!isObject(data)) return [];
    const value = data[field];
    const values = Array.isArray(value) ? value : [value];
    return values.filter(
      (property): property is SoupPropertyFieldsFragment =>
        isObject(property) &&
        typeof property.id === 'string' &&
        typeof property.propertyDefinitionId === 'string' &&
        'value' in property
    );
  };
  const properties = readProperties(optimistic);
  if (!properties.length) return undefined;
  const keys = properties.map((property) =>
    JSON.stringify([typename, input.entityId, property.propertyDefinitionId])
  );
  const makeUpdate = (
    properties: readonly SoupPropertyFieldsFragment[]
  ): NetworkOptimisticUpdate => ({
    keys,
    project: (data) =>
      projectProperties(data, typename, input.entityId, properties),
    commit: (data) => {
      const confirmed = readProperties(data);
      return confirmed.length ? makeUpdate(confirmed) : undefined;
    },
  });
  return makeUpdate(properties);
}
