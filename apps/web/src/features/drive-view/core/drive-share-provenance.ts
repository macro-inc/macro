export type DriveShareScope = 'all' | 'direct' | 'team_or_channel';

export type DriveShareProvenanceKind = 'direct' | 'dm' | 'channel' | 'team';

export type DriveShareProvenance = {
  entityType: string;
  entityId: string;
  kind: DriveShareProvenanceKind;
  channelId?: string | null;
  channelName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
};

export const DRIVE_SHARE_SOURCE_FACET_ID = 'share-source';

export function isDriveShareSourceFilter(
  value: string | undefined
): value is Exclude<DriveShareScope, 'all'> {
  return value === 'direct' || value === 'team_or_channel';
}

export function driveShareScopeFromFacet(
  values: readonly string[] | undefined
): DriveShareScope {
  const first = values?.[0];
  return isDriveShareSourceFilter(first) ? first : 'all';
}

export function driveShareProvenanceKey(
  entityType: string,
  entityId: string
): string {
  return `${entityType.toLowerCase()}:${entityId.toLowerCase()}`;
}

export function isDirectShareProvenance(
  provenance: Pick<DriveShareProvenance, 'kind'>
): boolean {
  return provenance.kind === 'direct' || provenance.kind === 'dm';
}

export function isTeamOrChannelShareProvenance(
  provenance: Pick<DriveShareProvenance, 'kind'>
): boolean {
  return provenance.kind === 'channel' || provenance.kind === 'team';
}

/**
 * Checks whether an entity with optional resolved `provenance` matches the
 * requested `scope`. When `provenance` is still loading (`undefined`),
 * `fallbackWhenUnresolved` lets server-filtered documents remain visible while
 * client-synthesized items wait safely.
 */
export function matchesDriveShareScope(
  scope: DriveShareScope,
  provenance: DriveShareProvenance | undefined,
  fallbackWhenUnresolved = true
): boolean {
  if (scope === 'all') return true;
  if (!provenance) return fallbackWhenUnresolved;
  if (scope === 'direct') return isDirectShareProvenance(provenance);
  return isTeamOrChannelShareProvenance(provenance);
}

export type SharedSectionBucketId = 'direct' | 'team_or_channel';

export type SharedSectionGroup<T> = {
  bucket: SharedSectionBucketId;
  items: T[];
};

/**
 * Splits items on Shared with me ("All" scope) into two clear sections:
 * - `direct`: shared directly with the viewer, via `@mention`, or in a DM
 * - `team_or_channel`: shared with a team or non-DM channel
 *
 * Items whose provenance hasn't resolved yet stay in `team_or_channel` only
 * when at least one resolved item exists (otherwise caller renders flat to
 * avoid premature bucketing before provenance loads).
 */
export function partitionSharedByProvenance<T>(
  items: readonly T[],
  getProvenance: (item: T) => DriveShareProvenance | undefined
): {
  groups: SharedSectionGroup<T>[];
  hasResolvedProvenance: boolean;
} {
  const direct: T[] = [];
  const teamOrChannel: T[] = [];
  let hasResolvedProvenance = false;

  for (const item of items) {
    const provenance = getProvenance(item);
    if (provenance) {
      hasResolvedProvenance = true;
      if (isDirectShareProvenance(provenance)) {
        direct.push(item);
      } else {
        teamOrChannel.push(item);
      }
    } else {
      teamOrChannel.push(item);
    }
  }

  const groups: SharedSectionGroup<T>[] = [];
  if (direct.length > 0) {
    groups.push({ bucket: 'direct', items: direct });
  }
  if (teamOrChannel.length > 0) {
    groups.push({ bucket: 'team_or_channel', items: teamOrChannel });
  }

  return { groups, hasResolvedProvenance };
}
