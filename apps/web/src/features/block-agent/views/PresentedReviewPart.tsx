import { PersistedReview } from '../../agent-reviews/views/persisted-review';
import { useOptionalAgentSession } from '../context/AgentSessionContext';

/** ACP presents the saved review immediately for every agent implementation. */
export function PresentedReviewPart(props: {
  sessionId: string;
  reviewId: string;
}) {
  const session = useOptionalAgentSession();
  const canAct = () =>
    Boolean(
      session?.sessionId() === props.sessionId &&
        session.userId() &&
        session.userId() === session.session()?.ownerId &&
        session.session()?.canEdit &&
        !session.session()?.isArchived
    );
  return (
    <PersistedReview
      sessionId={props.sessionId}
      reviewId={props.reviewId}
      canAct={canAct()}
    />
  );
}
