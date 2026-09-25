import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentSessionKeys } from './keys';
import { createAgentSessionMentionBatcher } from './mention-batcher';
import { fetchAgentSessionMentionPreviews } from './mention-fetchers';

const restPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, false)
);
const graphqlPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, true)
);

function agentSessionMentionQueryOptions(
  id: string,
  graphql: boolean,
  enabled: boolean
) {
  return queryOptions({
    queryKey: agentSessionKeys.preview(id, graphql).queryKey,
    queryFn: () => (graphql ? graphqlPreview : restPreview)(id),
    enabled: enabled && !!id,
    staleTime: 15_000,
  });
}

export function useAgentSessionMentionPreview(
  id: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const flag = useFeatureFlag(enableGraphqlSoup);
  return useQuery(() =>
    agentSessionMentionQueryOptions(id(), flag().enabled, enabled())
  );
}
