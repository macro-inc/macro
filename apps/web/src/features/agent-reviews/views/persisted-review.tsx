import { Show, Suspense } from 'solid-js';
import { useReview, useReviewActions } from '../queries/reviews';
import { ReviewStack } from './review-stack';

/** Every agent's ACP chain references the same authenticated, persisted review. */
export function PersistedReview(props: {
  sessionId: string;
  reviewId: string;
  canAct: boolean;
}) {
  const query = useReview(
    () => props.sessionId,
    () => props.reviewId
  );
  const actions = useReviewActions(
    () => props.sessionId,
    () => props.reviewId
  );
  return (
    <Suspense fallback={<p class="text-xs text-ink-muted">Loading review…</p>}>
      <Show when={query.isError}>
        <p role="alert" class="text-sm text-ink-muted">
          This review could not be loaded.{' '}
          <button
            type="button"
            class="underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      </Show>
      <Show when={query.isSuccess ? query.data : undefined}>
        {(record) => (
          <ReviewStack
            review={record()}
            canAct={props.canAct}
            actions={actions}
          />
        )}
      </Show>
    </Suspense>
  );
}
