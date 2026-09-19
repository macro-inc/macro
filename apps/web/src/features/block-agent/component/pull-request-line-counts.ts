import type { ForeignEntity } from '@service-storage/generated/schemas';

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Added and deleted lines on a synced GitHub pull request, when GitHub sent them. */
export function pullRequestLineCounts(
  entity: ForeignEntity | undefined
): { additions: number; deletions: number } | undefined {
  if (!entity || entity.foreignEntitySource !== 'github_pull_request') {
    return undefined;
  }
  const metadata = metadataRecord(entity.metadata);
  const additions = optionalNumber(metadata.additions);
  const deletions = optionalNumber(metadata.deletions);
  if (additions == null && deletions == null) return undefined;
  const counts = { additions: additions ?? 0, deletions: deletions ?? 0 };
  if (counts.additions === 0 && counts.deletions === 0) return undefined;
  return counts;
}
