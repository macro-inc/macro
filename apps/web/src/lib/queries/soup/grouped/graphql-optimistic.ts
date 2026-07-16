import {
  prependGroupedSoupItemLink,
  type OptimisticLinkPatch,
  type QueryRevalidation,
  removeGroupedSoupItemLink,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import { stringifyDocument } from '@urql/core';
import {
  type GroupedSoupInput,
  type GroupSoupMembershipQuery,
  GroupSoupMembershipDocument,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
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

export type OptimisticGroupedPropertyLinkPatches = {
  patches: OptimisticLinkPatch[];
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
export async function buildOptimisticGroupedPropertyLinkPatches(
  args: BuildArgs
): Promise<OptimisticGroupedPropertyLinkPatches> {
  const viewer = await args.host.readQuery({
    query: VIEWER_QUERY,
    operationName: 'OptimisticGroupSoupViewer',
  });
  if (viewer.kind !== 'hit' || !isRecord(viewer.data)) {
    return { patches: [], revalidations: [] };
  }
  const user = isRecord(viewer.data.user) ? viewer.data.user : undefined;
  if (!user || typeof user.id !== 'string') {
    return { patches: [], revalidations: [] };
  }

  const parentEntityKey = `GraphqlUser:${user.id}`;
  const fields = await args.host.inspectFields(parentEntityKey);
  const oldKeys = new Set(unique(args.oldGroupKeys));
  const newKeys = new Set(unique(args.newGroupKeys));
  const removed = [...oldKeys].filter((key) => !newKeys.has(key));
  const added = [...newKeys].filter((key) => !oldKeys.has(key));
  if (
    removed.length === 0 &&
    added.length === 0 &&
    !args.revalidateOnly
  ) {
    return { patches: [], revalidations: [] };
  }

  const patches: OptimisticLinkPatch[] = [];
  const revalidations: QueryRevalidation[] = [];
  const membershipQuery = stringifyDocument(GroupSoupMembershipDocument);

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
    if (!bins) continue;

    // A destination prepend belongs only on an initial page. If any required
    // destination bin is absent, skip the complete move for this field.
    if (
      added.length > 0 &&
      (!isInitialInput(input) ||
        added.some((key) => !bins.some((bin) => bin.key === key)))
    ) {
      continue;
    }

    if (args.revalidateOnly) continue;

    const itemEntityKey = `GraphqlSoupItem:${args.entityId}`;
    for (const key of removed) {
      const source = bins.find((bin) => bin.key === key);
      if (!source?.items.some((item) => item.id === args.entityId)) continue;
      patches.push(
        removeGroupedSoupItemLink({
          parentEntityKey,
          fieldKey: field.fieldKey,
          binKey: key,
          itemEntityKey,
          revalidate,
        })
      );
    }
    for (const key of added) {
      patches.push(
        prependGroupedSoupItemLink({
          parentEntityKey,
          fieldKey: field.fieldKey,
          binKey: key,
          itemEntityKey,
          revalidate,
        })
      );
    }
  }

  return { patches, revalidations };
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
