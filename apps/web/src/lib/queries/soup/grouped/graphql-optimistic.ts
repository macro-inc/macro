import {
  type OptimisticUpdate,
  prependUnique,
  type QueryRevalidation,
  remove,
  select,
  update,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import { stringifyDocument } from '@urql/core';
import {
  type GroupedSoupInput,
  GroupSoupMembershipDocument,
  type GroupSoupMembershipQuery,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import { groupedSoupLogicalViewKey } from './graphql-operation-registry';
import { NOT_SET_GROUP_KEY } from './types';

const VIEWER_QUERY = `query OptimisticGroupSoupViewer { user { id } }`;

type BuildArgs = {
  host: CacheHost;
  entityId: string;
  propertyDefinitionId: string;
  oldGroupKeys: readonly string[];
  newGroupKeys: readonly string[];
  /** Unsupported/date values still discover and revalidate relevant fields. */
  revalidateOnly?: boolean;
};

export type OptimisticGroupedPropertyUpdates = {
  updates: OptimisticUpdate[];
  revalidations: QueryRevalidation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertyGroupingId(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const page = isRecord(input.initial)
    ? input.initial
    : isRecord(input.continuation)
      ? input.continuation
      : undefined;
  if (!page || !isRecord(page.groupBy)) return undefined;
  return page.groupBy.field === 'PROPERTY' &&
    typeof page.groupBy.propertyDefinitionId === 'string'
    ? page.groupBy.propertyDefinitionId
    : undefined;
}

function isInitialInput(input: unknown): input is GroupedSoupInput {
  return isRecord(input) && isRecord(input.initial);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Discovers every cached property-grouped field and creates constrained link
 * recipes only where the loaded membership proves the move is applicable.
 * Missing bins/pages are left untouched and revalidated after success.
 */
export async function buildOptimisticGroupedPropertyUpdates(
  args: BuildArgs
): Promise<OptimisticGroupedPropertyUpdates> {
  const viewer = await args.host.readQuery({
    query: VIEWER_QUERY,
    operationName: 'OptimisticGroupSoupViewer',
  });
  if (viewer.kind !== 'hit' || !isRecord(viewer.data)) {
    return { updates: [], revalidations: [] };
  }
  const user = isRecord(viewer.data.user) ? viewer.data.user : undefined;
  if (!user || typeof user.id !== 'string') {
    return { updates: [], revalidations: [] };
  }

  const fields = await args.host.inspectFields(`GraphqlUser:${user.id}`);
  const oldKeys = new Set(unique(args.oldGroupKeys));
  const newKeys = new Set(unique(args.newGroupKeys));
  const removed = [...oldKeys].filter((key) => !newKeys.has(key));
  const added = [...newKeys].filter((key) => !oldKeys.has(key));
  if (removed.length === 0 && added.length === 0 && !args.revalidateOnly) {
    return { updates: [], revalidations: [] };
  }

  const updates: OptimisticUpdate[] = [];
  const revalidations: QueryRevalidation[] = [];
  const membershipQuery = stringifyDocument(GroupSoupMembershipDocument);
  const views = new Map<
    string,
    Array<{
      input: GroupedSoupInput;
      bins: GroupSoupMembershipQuery['user']['groupSoup']['bins'];
    }>
  >();

  for (const field of fields) {
    if (field.fieldName !== 'groupSoup') continue;
    const input = field.arguments?.input;
    if (propertyGroupingId(input) !== args.propertyDefinitionId) continue;

    const revalidate: QueryRevalidation = {
      document: GroupSoupMembershipDocument,
      variables: { input: input as GroupedSoupInput },
    };
    revalidations.push(revalidate);

    const membership = await args.host.readQuery({
      query: membershipQuery,
      operationName: 'GroupSoupMembership',
      variables: { input: input as GroupedSoupInput },
    });
    if (membership.kind !== 'hit') continue;
    const data = membership.data as GroupSoupMembershipQuery;
    const bins = data.user?.groupSoup?.bins;
    const logicalView = groupedSoupLogicalViewKey(input);
    if (!bins || !logicalView) continue;
    const pages = views.get(logicalView) ?? [];
    pages.push({
      input: input as GroupedSoupInput,
      bins,
    });
    views.set(logicalView, pages);
  }

  if (args.revalidateOnly) return { updates, revalidations };

  const itemEntityKey = `GraphqlSoupItem:${args.entityId}`;
  for (const pages of views.values()) {
    const sourcePages = pages.filter((page) =>
      removed.some((key) =>
        page.bins
          .find((bin) => bin.key === key)
          ?.items.some((item) => item.id === args.entityId)
      )
    );
    if (sourcePages.length === 0) continue;

    const destinationPages = pages.filter(
      (page) =>
        isInitialInput(page.input) &&
        added.every((key) => page.bins.some((bin) => bin.key === key))
    );
    // Never expose a source-only move when this logical view has nowhere to
    // show the destination. Revalidation will recover absent/new groups.
    if (added.length > 0 && destinationPages.length === 0) continue;

    for (const page of sourcePages) {
      for (const key of removed) {
        const source = page.bins.find((bin) => bin.key === key);
        if (!source?.items.some((item) => item.id === args.entityId)) continue;
        const items = select(GroupSoupMembershipDocument, {
          input: page.input,
        })
          .field('user')
          .field('groupSoup')
          .field('bins')
          .item('key', key)
          .field('items');
        updates.push(update(items, remove(itemEntityKey)));
      }
    }
    for (const page of destinationPages) {
      for (const key of added) {
        const items = select(GroupSoupMembershipDocument, {
          input: page.input,
        })
          .field('user')
          .field('groupSoup')
          .field('bins')
          .item('key', key)
          .field('items');
        updates.push(update(items, prependUnique(itemEntityKey)));
      }
    }
  }

  return { updates, revalidations };
}

/** Group keys reproducible for the first optimistic implementation. */
export function groupedPropertyKeys(value: {
  valueType: string;
  values?: readonly string[] | null;
  refs?: readonly { entity_id: string }[] | null;
  value?: unknown;
}): string[] | undefined {
  switch (value.valueType) {
    case 'SELECT_STRING':
    case 'SELECT_NUMBER': {
      const values =
        value.values ??
        (Array.isArray(value.value) ? (value.value as string[]) : []);
      return values.length > 0 ? [...values] : [NOT_SET_GROUP_KEY];
    }
    case 'ENTITY': {
      const refs = 'refs' in value ? value.refs : undefined;
      if (refs) {
        return refs.length > 0
          ? refs.map((reference) => reference.entity_id)
          : [NOT_SET_GROUP_KEY];
      }
      const existing = Array.isArray(value.value)
        ? (value.value as { entity_id: string }[])
        : null;
      return existing && existing.length > 0
        ? existing.map((reference) => reference.entity_id)
        : [NOT_SET_GROUP_KEY];
    }
    default:
      return undefined;
  }
}
