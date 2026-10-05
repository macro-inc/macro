import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { agentSessionPullRequestKeys } from './keys';

const PULL_REQUEST_LINKS_STALE_TIME = 30_000;

/** Ids of the viewable sessions linked to the pull request at `url`. */
export function usePullRequestAgentSessionsQuery(
  url: Accessor<string | undefined>
) {
  return useQuery(() => ({
    queryKey: agentSessionPullRequestKeys.forPullRequest(url() ?? '').queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          agentHarnessServiceClient.sessionsForPullRequest(url()!)
        )
      ).sessionIds,
    enabled: Boolean(url()),
    staleTime: PULL_REQUEST_LINKS_STALE_TIME,
  }));
}

/** The pull requests linked to a session, with who linked each. */
export function useAgentSessionPullRequestsQuery(sessionId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: agentSessionPullRequestKeys.forSession(sessionId()).queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          agentHarnessServiceClient.listPullRequests(sessionId())
        )
      ).pullRequests,
    staleTime: PULL_REQUEST_LINKS_STALE_TIME,
  }));
}

type PullRequestLinkChange = { sessionId: string; url: string };

const invalidateLink = ({ sessionId, url }: PullRequestLinkChange) =>
  Promise.all([
    queryClient.invalidateQueries({
      queryKey: agentSessionPullRequestKeys.forPullRequest(url).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: agentSessionPullRequestKeys.forSession(sessionId).queryKey,
    }),
  ]);

/** Link a pull request to a session the caller can edit. */
export function useLinkAgentSessionPullRequestMutation() {
  return useMutation(() => ({
    mutationFn: ({ sessionId, url }: PullRequestLinkChange) =>
      throwOnErr(() =>
        agentHarnessServiceClient.linkPullRequest(sessionId, url)
      ),
    onSettled: (_data, _error, change) => invalidateLink(change),
  }));
}

/** Unlink a pull request a person linked to a session. */
export function useUnlinkAgentSessionPullRequestMutation() {
  return useMutation(() => ({
    mutationFn: ({ sessionId, url }: PullRequestLinkChange) =>
      throwOnErr(() =>
        agentHarnessServiceClient.unlinkPullRequest(sessionId, url)
      ),
    onSettled: (_data, _error, change) => invalidateLink(change),
  }));
}
