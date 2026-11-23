import { parseGithubPrUrl } from '@app/features/block-pr/util/prKey';
import type { RegisteredWorkEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';

/** How a registered session reads in Work. */
export type WorkItemState = 'running' | 'needs_input' | 'failed' | 'idle';

/** A session an account registered as its work. */
export type WorkItem = {
  /** The registration, which a removal names. */
  registrationId: string;
  accountId: string;
  registeredAt: string;
  sessionId: string;
  title: string;
  state: WorkItemState;
  pullRequestNumber?: number;
};

function workItemState(turn: string | null | undefined): WorkItemState {
  if (turn === 'blocked') return 'needs_input';
  if (turn === 'failed') return 'failed';
  if (turn === 'starting' || turn === 'running' || turn === 'stopping')
    return 'running';
  return 'idle';
}

export function workItemFromEntry(
  entry: RegisteredWorkEntryFieldsFragment
): WorkItem {
  const pullRequest = parseGithubPrUrl(entry.session.pullRequestUrl ?? '');

  return {
    registrationId: entry.id,
    accountId: entry.accountId,
    registeredAt: entry.registeredAt,
    sessionId: entry.session.id,
    title: entry.session.sessionName ?? '',
    state: workItemState(entry.session.turnState),
    pullRequestNumber: pullRequest?.number,
  };
}

/** Oldest first, so rows stay put as work comes and goes. */
export function sortWorkItems(items: Iterable<WorkItem>): WorkItem[] {
  return [...items].sort(
    (left, right) =>
      left.registeredAt.localeCompare(right.registeredAt) ||
      left.registrationId.localeCompare(right.registrationId)
  );
}
