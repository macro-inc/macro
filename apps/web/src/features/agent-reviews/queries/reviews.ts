import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { agentReviewClient } from '@service-agent-harness/reviews';
import {
  type Query,
  type QueryClient,
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, createEffect } from 'solid-js';
import type { Review, ReviewDecision } from '../core/review';
import { reviewKeys } from './keys';

/**
 * How an open card learns that its saved review changed. `PresentedReviewPart`
 * decides which applies.
 */
export type ReviewUpdates =
  /**
   * Inside its session's live view, the session log announces every saved
   * revision (`reviewRevisions` in the fold metadata); the card fetches only
   * a revision newer than the one it holds.
   */
  | { kind: 'announced'; revision: Accessor<number | undefined> }
  /**
   * Elsewhere (DM and channel activity snapshots) nothing announces changes,
   * so the card polls while the review can still change.
   */
  | { kind: 'polled' };

/** Poll while the record is unpresented or an item can still move. */
function pollWhileChanging(query: Query<Review>) {
  const record = query.state.data;
  if (!record) return false;
  const changing =
    record.presentedAt == null ||
    record.items.some(
      (item) => item.status === 'pending' || item.status === 'submitting'
    );
  return changing ? 2_000 : false;
}

function options(session: string, review: string, polled: boolean) {
  return queryOptions({
    queryKey: reviewKeys.detail(session, review).queryKey,
    queryFn: () => throwOnErr(() => agentReviewClient.get(session, review)),
    enabled: Boolean(review && session),
    retry: false,
    staleTime: 0,
    refetchInterval: polled ? pollWhileChanging : false,
  });
}

function decideOptions(client: QueryClient, session: string, review: string) {
  const key = reviewKeys.detail(session, review).queryKey;
  return {
    mutationKey: key,
    mutationFn: (decision: ReviewDecision) =>
      throwOnErr(() => agentReviewClient.decide(session, review, decision)),
    onSuccess: (record: Review) => {
      client.setQueryData(key, record);
    },
  };
}

/** ACP announces the review identity; the card fetches its saved status. */
export function useReview(
  session: Accessor<string>,
  review: Accessor<string>,
  updates: Accessor<ReviewUpdates>
) {
  const query = useQuery(() =>
    options(session(), review(), updates().kind === 'polled')
  );
  // A decision's response carries the revision it committed, and its
  // announcement can arrive first; that revision is not someone else's.
  const deciding = useIsMutating(() => ({
    mutationKey: reviewKeys.detail(session(), review()).queryKey,
  }));
  createEffect(() => {
    const current = updates();
    if (current.kind !== 'announced') return;
    const announced = current.revision();
    const held = query.data?.revision;
    if (announced === undefined || held === undefined) return;
    if (announced <= held || deciding() > 0 || query.isFetching) return;
    fireAndForget(query.refetch(), 'agent-reviews');
  });
  return query;
}

export function useReviewActions(
  session: Accessor<string>,
  review: Accessor<string>
) {
  const client = useQueryClient();
  const decision = useMutation(() =>
    decideOptions(client, session(), review())
  );
  return {
    decide: (next: ReviewDecision): Promise<Review> =>
      decision.mutateAsync(next),
    reload: async (): Promise<Review> => {
      const record = await throwOnErr(() =>
        agentReviewClient.get(session(), review())
      );
      client.setQueryData(
        reviewKeys.detail(session(), review()).queryKey,
        record
      );
      return record;
    },
  };
}
