import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, on, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { decisionWakesAgent, type Review } from '../core/review';
import {
  type ReviewUpdates,
  useReview,
  useReviewActions,
} from '../queries/reviews';
import { ImportReview } from './import-review';
import { ReviewStack } from './review-stack';

/** Every agent's ACP chain references the same authenticated, persisted review. */
export function PersistedReview(props: {
  sessionId: string;
  reviewId: string;
  canAct: boolean;
  updates: ReviewUpdates;
  eventId?: string;
  onDecision?: () => void;
  onDecisionFailed?: () => void;
}) {
  const userId = useUserId();
  const query = useReview(
    () => props.sessionId,
    () => props.reviewId,
    () => props.updates
  );
  const actions = useReviewActions(
    () => props.sessionId,
    () => props.reviewId
  );
  createEffect(
    on(
      () => props.eventId,
      (id) => {
        if (id) fireAndForget(query.refetch(), 'agent-reviews');
      }
    )
  );
  const decisions = (kind: Review['kind']) => ({
    reload: actions.reload,
    decide: async (decision: Parameters<typeof actions.decide>[0]) => {
      const wakes = decisionWakesAgent(kind, decision);
      if (wakes) props.onDecision?.();
      try {
        return await actions.decide(decision);
      } catch (error) {
        if (wakes) props.onDecisionFailed?.();
        throw error;
      }
    },
  });
  return (
    <Suspense fallback={<p class="text-xs text-ink-muted">Loading review…</p>}>
      <Show when={query.isError}>
        <p role="alert" class="text-sm text-ink-muted">
          This review could not be loaded.{' '}
          <button
            type="button"
            class="underline"
            onClick={() => fireAndForget(query.refetch(), 'agent-reviews')}
          >
            Retry
          </button>
        </p>
      </Show>
      <Show when={query.isSuccess ? query.data : undefined}>
        {(record) => {
          const canAct = () => props.canAct && userId() === record().actingUser;
          // A review's kind is fixed when it is saved; `updates` keeps its status live.
          return match(record().kind)
            .with('import', () => (
              <Show when={importReview(record())}>
                {(review) => (
                  <ImportReview
                    review={review()}
                    canAct={canAct()}
                    actions={decisions('import')}
                  />
                )}
              </Show>
            ))
            .with('email', 'calendar', (kind) => (
              <ReviewStack
                review={record()}
                canAct={canAct()}
                actions={decisions(kind)}
              />
            ))
            .exhaustive();
        }}
      </Show>
    </Suspense>
  );
}
function importReview(review: Review) {
  return review.kind === 'import' ? review : undefined;
}
