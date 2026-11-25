import { createUrqlQuery } from '@app/lib/urql-solid';
import type { EntityData } from '@entity';
import {
  DriveShareProvenanceDocument,
  type DriveShareProvenanceQuery,
  type DriveShareProvenanceQueryVariables,
  type GraphqlEntityType,
  type GraphqlShareProvenanceKind,
  type ShareProvenanceEntityInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import {
  type DriveShareProvenance,
  type DriveShareProvenanceKind,
  driveShareProvenanceKey,
} from '../core/drive-share-provenance';

const MAX_SHARE_PROVENANCE_BATCH = 200;

function toGraphqlEntityType(
  type: EntityData['type']
): GraphqlEntityType | undefined {
  switch (type) {
    case 'document':
      return 'DOCUMENT';
    case 'project':
      return 'PROJECT';
    case 'database':
      return 'DATABASE';
    case 'form':
      return 'FORM';
    default:
      return undefined;
  }
}

function fromGraphqlProvenanceKind(
  kind: GraphqlShareProvenanceKind
): DriveShareProvenanceKind {
  switch (kind) {
    case 'DIRECT':
      return 'direct';
    case 'DM':
      return 'dm';
    case 'CHANNEL':
      return 'channel';
    case 'TEAM':
      return 'team';
  }
}

function fromGraphqlEntityType(type: GraphqlEntityType): string {
  return type.toLowerCase();
}

export type DriveShareProvenanceSource = {
  byKey: Accessor<ReadonlyMap<string, DriveShareProvenance>>;
  get: (
    entity: Pick<EntityData, 'type' | 'id'>
  ) => DriveShareProvenance | undefined;
  isLoading: Accessor<boolean>;
};

function selectProvenanceMap(
  data: DriveShareProvenanceQuery
): ReadonlyMap<string, DriveShareProvenance> {
  const map = new Map<string, DriveShareProvenance>();
  for (const entry of data.user.shareProvenance) {
    const entityType = fromGraphqlEntityType(entry.entityType);
    const key = driveShareProvenanceKey(entityType, entry.entityId);
    map.set(key, {
      entityType,
      entityId: entry.entityId,
      kind: fromGraphqlProvenanceKind(entry.kind),
      channelId: entry.channelId ?? null,
      channelName: entry.channelName ?? null,
      teamId: entry.teamId ?? null,
      teamName: entry.teamName ?? null,
    });
  }
  return map;
}

/**
 * Batched viewer-relative share provenance lookup for Drive's Shared with me
 * view. Only executes when `enabled()` is true and at least one eligible
 * shared entity is present, keeping cache keys stable via deterministic sorting.
 */
export function createDriveShareProvenanceSource(options: {
  enabled: Accessor<boolean>;
  entities: Accessor<readonly Pick<EntityData, 'type' | 'id'>[]>;
}): DriveShareProvenanceSource {
  const inputs = createMemo<ShareProvenanceEntityInput[]>(() => {
    if (!options.enabled()) return [];
    const unique = new Map<string, ShareProvenanceEntityInput>();
    for (const entity of options.entities()) {
      const entityType = toGraphqlEntityType(entity.type);
      if (!entityType) continue;
      const key = driveShareProvenanceKey(entity.type, entity.id);
      if (!unique.has(key)) {
        unique.set(key, { entityType, entityId: entity.id });
      }
      if (unique.size >= MAX_SHARE_PROVENANCE_BATCH) break;
    }
    return [...unique.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, value]) => value);
  });

  const query = createUrqlQuery<
    DriveShareProvenanceQuery,
    DriveShareProvenanceQueryVariables,
    ReadonlyMap<string, DriveShareProvenance>
  >(() => ({
    query: DriveShareProvenanceDocument,
    client: getGraphqlSoupClient(),
    variables: { entities: inputs() },
    enabled: options.enabled() && inputs().length > 0,
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: selectProvenanceMap,
  }));

  const byKey = createMemo<ReadonlyMap<string, DriveShareProvenance>>(
    () => query.data ?? new Map()
  );

  return {
    byKey,
    get: (entity) =>
      byKey().get(driveShareProvenanceKey(entity.type, entity.id)),
    isLoading: () => query.isPending,
  };
}
