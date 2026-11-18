import { isGithubPullRequestUrl } from '@macro-inc/lexical-core';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { parseGithubKey, prHtmlUrl } from './prKey';

/**
 * Where a synced pull request lives on GitHub: its recorded URL, else the one
 * its `owner/repo/pull/N` key names.
 */
export function pullRequestGithubUrl(
  entity: ForeignEntity | undefined
): string | undefined {
  if (!entity || entity.foreignEntitySource !== 'github_pull_request') {
    return undefined;
  }
  const metadata = entity.metadata;
  const recorded =
    metadata && typeof metadata === 'object' && 'url' in metadata
      ? metadata.url
      : undefined;
  if (typeof recorded === 'string' && isGithubPullRequestUrl(recorded)) {
    return recorded;
  }
  const ref = parseGithubKey(entity.foreignEntityId);
  return ref ? prHtmlUrl(ref) : undefined;
}
