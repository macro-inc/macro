import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createGraphqlAgentSessionMentionPreview } from './graphql-mentions';
import { agentSessionKeys } from './keys';
import { createAgentSessionMentionBatcher } from './mention-batcher';
import { fetchAgentSessionMentionPreviews } from './mention-fetchers';

const restPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, false)
);

function restMentionQueryOptions(
  id: string,
  graphql: boolean,
  enabled: boolean
) {
  return queryOptions({
    queryKey: agentSessionKeys.preview(id, graphql).queryKey,
    queryFn: () => restPreview(id),
    enabled,
    // A missing live record needs a fresh permission-aware answer.
    staleTime: graphql ? 0 : 15_000,
  });
}

export function useAgentSessionMentionPreview(
  id: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const flag = useFeatureFlag(enableGraphqlSoup);
  const active = () => enabled() && Boolean(id());
  const live = createGraphqlAgentSessionMentionPreview(
    id,
    () => active() && flag().enabled
  );
  const restEnabled = () =>
    active() && (!flag().enabled || live.shouldFallback());
  const rest = useQuery(() =>
    restMentionQueryOptions(id(), flag().enabled, restEnabled())
  );
  const data = () => {
    if (!active()) return undefined;
    if (flag().enabled && live.data()) return live.data();
    return restEnabled() &&
      rest.isSuccess &&
      (!flag().enabled || !rest.isFetching)
      ? rest.data
      : undefined;
  };
  return {
    get data() {
      return data();
    },
    get isSuccess() {
      return data() !== undefined;
    },
    get isError() {
      return restEnabled() && rest.isError && !data();
    },
    get error() {
      return restEnabled() ? rest.error : null;
    },
  };
}
