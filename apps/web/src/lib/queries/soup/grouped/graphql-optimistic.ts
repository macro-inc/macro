import { documentOperationName } from '@graphql-cache/exchange/generated-selection';
import { inspectVariants, selectAll } from '@graphql-cache/exchange/inspection';
import {
  type OptimisticUpdate,
  type QueryRevalidation,
  removeEmbeddedLink,
  select,
  upsertEmbeddedLink,
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
 * Missing destination bins are created on initial pages; missing pages are
 * left untouched and revalidated after success.
 */
export async function buildOptimisticGroupedPropertyUpdates(
  args: BuildArgs
): Promise<OptimisticGroupedPropertyUpdates> {
  const changes = diffGroupKeys(args.oldGroupKeys, args.newGroupKeys);
  if (!changes && !args.revalidateOnly) {
    return { updates: [], revalidations: [] };
  }

  const selection = selectAll(GroupSoupMembershipDocument)
    .field('user')
    .field('groupSoup');
  const variants = await inspectVariants(args.host, selection);
  const relevantVariants = variants.filter(({ variables }) =>
    isRelevantPropertyGrouping(variables.input, args.propertyDefinitionId)
  );
  const revalidations: QueryRevalidation[] = relevantVariants.map(
    ({ variables }) => ({
      document: GroupSoupMembershipDocument,
      variables,
    })
  );
  if (args.revalidateOnly || !changes) {
    return { updates: [], revalidations };
  }

  const query = stringifyDocument(selection.document);
  const operationName = documentOperationName(selection.document);
  const loadedPages = await Promise.all(
    relevantVariants.map(async ({ variables }): Promise<GroupPage | null> => {
      const result = await args.host.readQuery({
        query,
        operationName,
        variables,
        priority: 'user-visible',
      });
      if (result.kind === 'miss') return null;
      const data = result.data as GroupSoupMembershipQuery;
      return { input: variables.input, bins: data.user.groupSoup.bins };
    })
  );
  const views = groupPagesByLogicalView(
    loadedPages.filter((page): page is GroupPage => page !== null)
  );
  const { removed, added } = changes;
  const updates: OptimisticUpdate[] = [];
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

    const sourceItems = sourcePages.flatMap((page) =>
      page.bins
        .filter((bin) => sourceGroupKeys.includes(bin.key))
        .flatMap((bin) => bin.items.filter((item) => item.id === args.entityId))
    );
    const entity = sourceItems[0];
    if (
      !entity ||
      sourceItems.some((item) => item.__typename !== entity.__typename)
    ) {
      continue;
    }

    const destinationPages = pages.filter((page) => isInitialInput(page.input));
    // Never expose a source-only move when this logical view has no initial
    // page where the destination can be shown.
    if (added.length > 0 && destinationPages.length === 0) continue;

    for (const page of sourcePages) {
      for (const key of removed) {
        const source = page.bins.find((bin) => bin.key === key);
        if (!source?.items.some((item) => item.id === args.entityId)) continue;
        const bins = select(GroupSoupMembershipDocument, {
          input: page.input,
        })
          .field('user')
          .field('groupSoup')
          .field('bins');
        updates.push(
          removeEmbeddedLink(bins, {
            listItem: { whereField: 'key', equals: key },
            linkField: 'items',
            countField: 'totalCount',
            entity,
          })
        );
      }
    }
    for (const page of destinationPages) {
      for (const key of added) {
        const bins = select(GroupSoupMembershipDocument, {
          input: page.input,
        })
          .field('user')
          .field('groupSoup')
          .field('bins');
        updates.push(
          upsertEmbeddedLink(bins, {
            listItem: { whereField: 'key', equals: key },
            linkField: 'items',
            countField: 'totalCount',
            entity,
            insertFields: { nextCursor: null },
          })
        );
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
