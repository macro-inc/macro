import { enableSnippets, isFeatureEnabled } from '@core/constant/featureFlags';
import { compareDateDesc } from '@core/util/date';
import type { DocumentEntity, EntityData } from '@entity';
import type { DriveSelection } from '../context/drive-source';
import type { DriveScope, DriveTab } from '../core/types';

function documentMatchesTab(
  entity: DocumentEntity,
  tab: DriveTab,
  scope: DriveScope,
  userId: string | undefined
): boolean {
  if (entity.subType?.type === 'task') return false;
  if (entity.subType?.type === 'snippet' && !isFeatureEnabled(enableSnippets))
    return false;
  if (tab === 'shared') return Boolean(userId) && entity.ownerId !== userId;
  if (tab === 'owned' && scope === 'default') return entity.ownerId === userId;

  return true;
}

function entityMatchesFolder(
  entity: EntityData,
  projectId: string,
  trustMembership: boolean
): boolean {
  switch (entity.type) {
    case 'document':
    case 'chat':
    case 'project':
      return entity.projectId === projectId;
    case 'email':
      if (entity.projectId) return entity.projectId === projectId;
      // Only fetched, folder-scoped results may omit this metadata.
      return trustMembership;
    default:
      return false;
  }
}

/** Backstop location scoping for local search and normalized cache updates. */
export function driveEntityMatchesLocation(
  entity: EntityData,
  selection: DriveSelection,
  userId: string | undefined,
  options: { trustFolderMembership?: boolean } = {}
): boolean {
  const { location } = selection;

  if (location.kind === 'folder') {
    if (!location.id) return entity.type === 'project';

    return entityMatchesFolder(
      entity,
      location.id,
      options.trustFolderMembership ?? false
    );
  }

  if (entity.type !== 'document') return false;

  return documentMatchesTab(entity, location.tab, selection.scope, userId);
}

/** Preserve recency sorting and the local-search featured prefix. */
export function orderDriveEntities(
  entities: readonly EntityData[],
  selection: DriveSelection,
  featuredIds: readonly string[]
): EntityData[] {
  const { location, sort } = selection;

  if (location.kind === 'tab' && location.tab === 'recent')
    return [...entities];

  const timestamp = (entity: EntityData) => {
    if (sort === 'created_at') return entity.sortTs ?? entity.createdAt;
    if (sort === 'viewed_at') return entity.sortTs ?? entity.viewedAt;

    return entity.sortTs ?? entity.updatedAt;
  };

  const ordered = [...entities].sort((a, b) =>
    compareDateDesc(timestamp(a), timestamp(b))
  );

  if (featuredIds.length === 0) return ordered;

  const featured = new Set(featuredIds);

  const byId = new Map(ordered.map((entity) => [entity.id, entity]));

  const prefix = featuredIds.flatMap((id) => {
    const entity = byId.get(id);

    return entity ? [entity] : [];
  });

  return [...prefix, ...ordered.filter((entity) => !featured.has(entity.id))];
}
