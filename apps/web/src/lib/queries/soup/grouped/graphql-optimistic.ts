import { inspect, selectAll } from '@graphql-cache/exchange/inspection';
import {
  type OptimisticUpdate,
  prependUnique,
  type QueryRevalidation,
  remove,
  select,
  update,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  type GroupedSoupInput,
  GroupSoupMembershipDocument,
  type GroupSoupMembershipQuery,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import { groupedSoupLogicalViewKey } from './graphql-operation-registry';
import { NOT_SET_GROUP_KEY } from './types';

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

type GroupPage = {
  input: GroupedSoupInput;
  bins: GroupSoupMembershipQuery['user']['groupSoup']['bins'];
};

type GroupKeyDiff = {
  removed: string[];
  added: string[];
};

/** Returns changed group keys, or nothing when both sets are equivalent. */
export function diffGroupKeys(
  oldGroupKeys: readonly string[],
  newGroupKeys: readonly string[]
): GroupKeyDiff | undefined {
  const oldKeys = new Set(oldGroupKeys);
  const newKeys = new Set(newGroupKeys);
  const removed = [...oldKeys].filter((key) => !newKeys.has(key));
  const added = [...newKeys].filter((key) => !oldKeys.has(key));
  return removed.length > 0 || added.length > 0
    ? { removed, added }
    : undefined;
}

/** True when one generated grouped input targets the changed property. */
export function isRelevantPropertyGrouping(
  input: GroupedSoupInput,
  propertyDefinitionId: string
): boolean {
  const page = input.initial ?? input.continuation;
  return (
    page.groupBy.field === 'PROPERTY' &&
    String(page.groupBy.propertyDefinitionId) === propertyDefinitionId
  );
}

function isInitialInput(
  input: GroupedSoupInput
): input is Extract<GroupedSoupInput, { initial: object }> {
  return input.initial !== undefined;
}

/** Associates loaded initial/continuation pages by frontend logical view. */
export function groupPagesByLogicalView(
  pages: readonly GroupPage[]
): Map<string, GroupPage[]> {
  const views = new Map<string, GroupPage[]>();
  for (const page of pages) {
    const logicalView = groupedSoupLogicalViewKey(page.input);
    if (!logicalView) continue;
    const grouped = views.get(logicalView) ?? [];
    grouped.push(page);
    views.set(logicalView, grouped);
  }
  return views;
}

/**
 * Discovers every cached property-grouped field and creates constrained link
 * recipes only where the loaded membership proves the move is applicable.
 * Missing bins/pages are left untouched and revalidated after success.
 */
export async function buildOptimisticGroupedPropertyUpdates(
  args: BuildArgs
): Promise<OptimisticGroupedPropertyUpdates> {
  const changes = diffGroupKeys(args.oldGroupKeys, args.newGroupKeys);
  if (!changes && !args.revalidateOnly) {
    return { updates: [], revalidations: [] };
  }

  const cachedViews = await inspect(
    args.host,
    selectAll(GroupSoupMembershipDocument).field('user').field('groupSoup')
  );
  const relevantViews = cachedViews.filter(({ variables }) =>
    isRelevantPropertyGrouping(variables.input, args.propertyDefinitionId)
  );
  const revalidations: QueryRevalidation[] = relevantViews.map(
    ({ variables }) => ({
      document: GroupSoupMembershipDocument,
      variables,
    })
  );
  if (args.revalidateOnly || !changes) {
    return { updates: [], revalidations };
  }

  const views = groupPagesByLogicalView(
    relevantViews.flatMap(({ variables, value }) =>
      value ? [{ input: variables.input, bins: value.bins }] : []
    )
  );
  const { removed, added } = changes;
  const updates: OptimisticUpdate[] = [];
  const itemEntityKey = `GraphqlSoupItem:${args.entityId}`;
  for (const pages of views.values()) {
    const sourceGroupKeys = removed.length > 0 ? removed : args.oldGroupKeys;
    const sourcePages = pages.filter((page) =>
      sourceGroupKeys.some((key) =>
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
