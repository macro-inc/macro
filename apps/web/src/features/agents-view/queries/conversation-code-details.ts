import { parseGithubPrUrl, prHtmlUrl } from '@app/features/block-pr/util/prKey';
import type { AgentSessionEntity } from '@entity';
import {
  repositoryLabel,
  type SessionCodeDetails,
} from '../core/session-code-details';

/** Project only persisted code identity; starting branches are not working branches. */
export function conversationCodeDetails(
  entity: AgentSessionEntity
): SessionCodeDetails | undefined {
  const pr = parseGithubPrUrl(entity.pullRequestUrl ?? '');
  const repository =
    repositoryLabel(entity.repoUrl) ??
    (pr ? `${pr.owner}/${pr.repo}` : undefined);
  const branch = entity.workingBranch ?? undefined;
  if (!repository && !branch && !pr) return undefined;
  return {
    repository,
    branch,
    pullRequest: pr
      ? {
          id: entity.pullRequestId ?? undefined,
          number: pr.number,
          url: prHtmlUrl(pr),
          status: entity.pullRequestState ?? undefined,
        }
      : undefined,
  };
}
