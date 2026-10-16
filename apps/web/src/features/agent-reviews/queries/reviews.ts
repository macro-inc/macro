import { throwOnErr } from '@core/util/result';
import { agentReviewClient } from '@service-agent-harness/reviews';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { Review, ReviewDecision } from '../core/review';
import { reviewKeys } from './keys';

function options(session: string, review: string) {
  return queryOptions({
    queryKey: reviewKeys.detail(session, review).queryKey,
    queryFn: () => throwOnErr(() => agentReviewClient.get(session, review)),
    enabled: Boolean(review && session),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data &&
      (query.state.data.presentedAt == null ||
        query.state.data.notificationId ||
        query.state.data.items.some(
          (item) => item.status === 'pending' || item.status === 'submitting'
        ))
        ? 2_000
        : false,
  });
}
/** ACP announces the review identity; polling only refreshes its saved status. */
export function useReview(session: Accessor<string>, review: Accessor<string>) {
  return useQuery(() => options(session(), review()));
}
export function useReviewActions(
  session: Accessor<string>,
  review: Accessor<string>
) {
  const client = useQueryClient();
  const save = (record: Review) => {
    client.setQueryData(
      reviewKeys.detail(session(), review()).queryKey,
      record
    );
    return record;
  };
  return {
    decide: async (decision: ReviewDecision): Promise<Review> =>
      save(
        await throwOnErr(() =>
          agentReviewClient.decide(session(), review(), decision)
        )
      ),
    reload: async (): Promise<Review> =>
      save(await throwOnErr(() => agentReviewClient.get(session(), review()))),
  };
}
