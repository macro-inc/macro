import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createGraphqlAgentSessionMentionPreview } from './graphql-mentions';
import { agentSessionKeys } from './keys';
import { createAgentSessionMentionBatcher } from './mention-batcher';
import { fetchAgentSessionMentionPreviews } from './mention-fetchers';

const restPreview = createAgentSessionMentionBatcher((ids) =>
  fetchAgentSessionMentionPreviews(ids, false)
);

function restMentionQueryOptions(id: string, enabled: boolean) {
  return queryOptions({
    queryKey: agentSessionKeys.preview(id).queryKey,
    queryFn: () => restPreview(id),
    enabled,
    // A missing live record needs a fresh permission-aware answer.
    staleTime: 0,
  });
}

export function useAgentSessionMentionPreview(
  id: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const active = () => enabled() && Boolean(id());
  const live = createGraphqlAgentSessionMentionPreview(id, active);
  const restEnabled = () => active() && live.shouldFallback();
  const rest = useQuery(() => restMentionQueryOptions(id(), restEnabled()));
  const data = () => {
    if (!active()) return undefined;
    if (live.data()) return live.data();
    return restEnabled() && rest.isSuccess && !rest.isFetching
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
