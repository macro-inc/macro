import { Show } from 'solid-js';
import { createReviewResponse } from '../../agent-reviews/core/review-response';
import { PersistedReview } from '../../agent-reviews/views/persisted-review';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { WorkingLine } from '../ui/WorkingLine';

/** ACP presents the saved review immediately for every agent implementation. */
export function PresentedReviewPart(props: {
  sessionId: string;
  reviewId: string;
}) {
  const session = useOptionalAgentSession();
  const response = createReviewResponse(() => props.reviewId, session);
  const canAct = () =>
    Boolean(
      session?.sessionId() === props.sessionId &&
        session.userId() &&
        session.session()?.canEdit &&
        !session.session()?.isArchived
    );
  return (
    <>
      <PersistedReview
        sessionId={props.sessionId}
        reviewId={props.reviewId}
        canAct={canAct()}
        ownerId={session?.session()?.ownerId}
        eventId={response.eventId()}
        onDecision={response.onDecision}
        onDecisionFailed={response.onDecisionFailed}
      />
      <Show when={response.responding()}>
        <WorkingLine label="Responding" />
      </Show>
    </>
  );
}
