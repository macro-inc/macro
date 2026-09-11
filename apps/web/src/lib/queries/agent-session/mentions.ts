import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentSessionKeys } from './keys';
import { createAgentSessionMentionBatcher } from './mention-batcher';
import {
  fetchAgentSessionMentionPreviews,
  fetchRecentAgentSessionMentions,
} from './mention-fetchers';

const restPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, false)
);
const graphqlPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, true)
);

export function useRecentAgentSessionMentions(enabled: Accessor<boolean>) {
  const flag = useFeatureFlag(enableGraphqlSoup);
  return useQuery(() => ({
    queryKey: agentSessionKeys.recent(flag().enabled).queryKey,
    queryFn: () => fetchRecentAgentSessionMentions(flag().enabled),
    enabled: enabled(),
    staleTime: 60_000,
  }));
}

export function useAgentSessionMentionPreview(
  id: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const flag = useFeatureFlag(enableGraphqlSoup);
  return useQuery(() => ({
    queryKey: agentSessionKeys.preview(id(), flag().enabled).queryKey,
    queryFn: () => (flag().enabled ? graphqlPreview : restPreview)(id()),
    enabled: enabled() && !!id(),
    staleTime: 15_000,
  }));
}
