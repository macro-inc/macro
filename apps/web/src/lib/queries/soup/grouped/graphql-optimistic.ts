import { documentOperationName } from '@graphql-cache/exchange/generated-selection';
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
  GroupSoupDocument,
  GroupSoupMembershipDocument,
  type GroupSoupMembershipQuery,
  type GroupSoupQueryVariables,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import { getActiveGraphqlSoupRevalidations } from '../graphql/active-queries';
import {
  groupedSoupInputKey,
  groupedSoupLogicalViewKey,
} from './graphql-operation-registry';
import { NOT_SET_GROUP_KEY } from './types';

type BuildArgs = {
  host: CacheHost;
  entityId: string;
  propertyDefinitionId: string;
  oldGroupKeys: readonly string[];
  newGroupKeys: readonly string[];
  /** Unsupported/date values still revalidate relevant active fields. */
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

/** Only mounted, enabled readers participate; historical cache pages are irrelevant. */
function activePropertyGroupedInputs(
  propertyDefinitionId: string
): GroupedSoupInput[] {
  return getActiveGraphqlSoupRevalidations().flatMap((query) => {
    if (query.document !== GroupSoupDocument) return [];
    // This descriptor is registered by the generated GroupSoup readers.
    const { input } = query.variables as GroupSoupQueryVariables;
    return isRelevantPropertyGrouping(input, propertyDefinitionId)
      ? [input]
      : [];
  });
}

type ReadGroupPage = (input: GroupedSoupInput) => Promise<GroupPage | null>;
export type PrepareGroupedPropertyUpdates = (
  args: Omit<BuildArgs, 'host'>
) => Promise<OptimisticGroupedPropertyUpdates>;

/**
 * Share membership reads across distinct entities in one bulk edit. A repeat
 * edit to the same entity must read its newly installed optimistic membership,
 * not the earlier snapshot. This cache lives only for the bulk submission.
 * Revalidations remain on every durable mutation: moving them to the last one
 * would lose recovery if that mutation fails or the page closes during replay.
 */
export function createGroupedPropertyPreparation(
  host: CacheHost
): PrepareGroupedPropertyUpdates {
  const pages = new Map<string, Promise<GroupPage | null>>();
  const preparedEntities = new Set<string>();
  const readPage: ReadGroupPage = (input) => {
    const key = groupedSoupInputKey(input);
    let pending = pages.get(key);
    if (!pending) {
      pending = readGroupPage(host, input);
      pages.set(key, pending);
    }
    return pending;
  };
  return async (args) => {
    if (preparedEntities.has(args.entityId)) pages.clear();
    preparedEntities.add(args.entityId);
    try {
      return await prepareGroupedPropertyUpdates(args, readPage);
    } catch (error) {
      // A transient cache failure must not poison the rest of a bulk edit.
      pages.clear();
      throw error;
    }
  };
}

async function readGroupPage(
  host: CacheHost,
  input: GroupedSoupInput
): Promise<GroupPage | null> {
  const result = await host.readQuery({
    query: stringifyDocument(GroupSoupMembershipDocument),
    operationName: documentOperationName(GroupSoupMembershipDocument),
    variables: { input },
    priority: 'user-visible',
  });
  if (result.kind === 'miss') return null;
  const data = result.data as GroupSoupMembershipQuery;
  return { input, bins: data.user.groupSoup.bins };
}

/** Creates relation recipes from active grouped pages, never a cache-wide inspection. */
export function buildOptimisticGroupedPropertyUpdates(
  args: BuildArgs
): Promise<OptimisticGroupedPropertyUpdates> {
  return createGroupedPropertyPreparation(args.host)(args);
}

async function prepareGroupedPropertyUpdates(
  args: Omit<BuildArgs, 'host'>,
  readPage: ReadGroupPage
): Promise<OptimisticGroupedPropertyUpdates> {
  const changes = diffGroupKeys(args.oldGroupKeys, args.newGroupKeys);
  if (!changes && !args.revalidateOnly) {
    return { updates: [], revalidations: [] };
  }

  const inputs = activePropertyGroupedInputs(args.propertyDefinitionId);
  const revalidations: QueryRevalidation[] = inputs.map((input) => ({
    document: GroupSoupMembershipDocument,
    variables: { input },
  }));
  if (args.revalidateOnly || !changes) {
    return { updates: [], revalidations };
  }

  const loadedPages = await Promise.all(inputs.map(readPage));
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
