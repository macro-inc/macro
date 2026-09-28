import {
  inspect,
  type OptimisticUpdate,
  select,
  selectAll,
  upsertByField,
} from '@graphql-cache/index';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  EntityPropertiesDocument,
  GroupEntityPropertiesDocument,
  GroupSoupMembershipDocument,
  SoupMembershipDocument,
} from '@service-storage/graphql/generated/graphql';

/**
 * One path to the normalized parent suffices for every mounted list/detail
 * query. Discover through ID-only documents so unrelated partial rows cannot
 * hide an otherwise usable path. No new query is fetched before the edit.
 */
export async function buildPropertyAssignmentLinks(
  host: CacheHost,
  entityId: string,
  propertyId: string,
  propertyDefinitionId: string
): Promise<OptimisticUpdate[]> {
  const identity = {
    entity: { __typename: 'GraphqlProperty', id: propertyId },
    whereField: 'propertyDefinitionId' as const,
    equals: propertyDefinitionId,
  };
  const pages = await inspect(
    host,
    selectAll(SoupMembershipDocument).field('user').field('soup')
  );
  const page = pages.find(({ value }) =>
    value?.items.some((item) => item.id === entityId)
  );
  if (page) {
    return [upsertByField(
      select(EntityPropertiesDocument, page.variables)
        .field('user').field('soup').field('items')
        .item('id', entityId).field('properties'),
      identity
    )];
  }
  const groupedPages = await inspect(
    host,
    selectAll(GroupSoupMembershipDocument).field('user').field('groupSoup')
  );
  for (const { variables, value } of groupedPages) {
    const bin = value?.bins.find((bin) =>
      bin.items.some((item) => item.id === entityId)
    );
    if (!bin) continue;
    return [upsertByField(
      select(GroupEntityPropertiesDocument, variables)
        .field('user').field('groupSoup').field('bins')
        .item('key', bin.key).field('items')
        .item('id', entityId).field('properties'),
      identity
    )];
  }
  return [];
}
