import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createGraphqlAgentSessionMentionPreview } from './graphql-mentions';
import { agentSessionKeys } from './keys';
import { createAgentSessionMentionBatcher } from './mention-batcher';
import { fetchAgentSessionMentionPreviews } from './mention-fetchers';

const restPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, false)
);

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
  const rest = useQuery(() => ({
    queryKey: agentSessionKeys.preview(id(), flag().enabled).queryKey,
    queryFn: () => restPreview(id()),
    enabled: restEnabled(),
    // A missing live record needs a fresh permission-aware answer.
    staleTime: flag().enabled ? 0 : 15_000,
  }));
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
