import { createLiveSession } from '@app/features/agent-activity/queries/live-session';
import { createReviewResponse } from '@app/features/agent-reviews/core/review-response';
import { useReview } from '@app/features/agent-reviews/queries/reviews';
import { PersistedReview } from '@app/features/agent-reviews/views/persisted-review';
import { WorkingLine } from '@app/features/block-agent/ui/WorkingLine';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import Envelope from '@phosphor/envelope-simple.svg';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { queryReadyGate } from '@queries/gate';
import { Match, Show, Switch } from 'solid-js';
import { Card, CardSingle } from './kit/card';
import { Tile } from './kit/parts';

/** What a saved review's drafts are. */
export type ReviewDrafts = 'email' | 'calendar';

/**
 * Drafts the agent saved for someone else to review, as a reader who
 * cannot decide them sees them: what they are, and whose they are to send.
 * Nothing of the drafts themselves is shown.
 */
export function ReviewWaitingCard(props: {
  drafts: ReviewDrafts;
  /** The person who decides the drafts: `Maya Chen`. Unknown to a reader who cannot see the session. */
  waitingOn?: string;
}) {
  return (
    <Card width="compact" data-agent-card="review">
      <CardSingle
        tile={
          <Tile>
            {props.drafts === 'email' ? <Envelope /> : <CalendarIcon />}
          </Tile>
        }
        title={
          props.drafts === 'email'
            ? 'Email drafts to review'
            : 'Event drafts to review'
        }
        meta={
          props.waitingOn
            ? `Waiting for ${props.waitingOn}`
            : 'Waiting for the person the agent works for'
        }
      />
    </Card>
  );
}

/**
 * Drafts the agent saved for the user to edit and send, in a conversation:
 * the saved review itself (`agent-reviews`) for the person who decides it,
 * who sends or dismisses each draft, and one line for everyone else.
 *
 * A review is decided by the account its drafts go out under: whoever
 * asked, when the agent acted as them, or the session's owner, as for every
 * review saved before reviews named one. Nothing loads until the session
 * says the reader may read it, and the review then says who decides it.
 */
export function ReviewCard(props: {
  sessionId: string;
  reviewId: string;
  drafts: ReviewDrafts;
}) {
  const userId = useUserId();
  const session = useAgentSessionQuery(() => props.sessionId);
  // The session, once both it and the reader are known.
  const readable = () =>
    userId() && queryReadyGate(session) ? session.data : undefined;
  const review = useReview(
    () => (readable() ? props.sessionId : ''),
    () => props.reviewId
  );
  // Who decides the review. One that will not load is left to the owner,
  // whose card says so and offers to load it again.
  const decider = () => {
    const data = readable();
    if (!data) return undefined;
    if (queryReadyGate(review)) return review.data.actingUser ?? data.ownerId;
    return review.isError ? data.ownerId : undefined;
  };
  return (
    <Switch
      fallback={
        <div
          class="skeleton-shimmer h-14 w-full max-w-md rounded-xl bg-skeleton"
          role="status"
          aria-label="Loading drafts to review"
        />
      }
    >
      <Match when={session.isError}>
        <ReviewWaitingCard drafts={props.drafts} />
      </Match>
      <Match when={decider() && decider() === userId()}>
        <DeciderReview
          sessionId={props.sessionId}
          reviewId={props.reviewId}
          ownerId={readable()?.ownerId}
          canAct={!!readable()?.canEdit && !readable()?.isArchived}
        />
      </Match>
      <Match when={review.isError}>
        <ReviewWaitingCard drafts={props.drafts} />
      </Match>
      <Match when={decider()}>
        {(by) => (
          <ReviewWaitingCard
            drafts={props.drafts}
            waitingOn={getDisplayName(tryMacroId(by())) || undefined}
          />
        )}
      </Match>
    </Switch>
  );
}

/**
 * The review as the person who decides it sees it, following the session's
 * notifications about it as the session view does: a decision made anywhere,
 * or a send that settles later, reloads it, and the agent responding to a
 * decision shows under it. The session's fold is the one every surface on it
 * shares.
 */
function DeciderReview(props: {
  sessionId: string;
  reviewId: string;
  ownerId?: string;
  canAct: boolean;
}) {
  const live = createLiveSession(() => props.sessionId);
  const response = createReviewResponse(() => props.reviewId, {
    metadata: live.metadata,
    messages: live.messages,
    turn: () => live.metadata()?.turn ?? 'idle',
  });
  return (
    <div class="w-full max-w-xl min-w-0" data-agent-card="review">
      <PersistedReview
        sessionId={props.sessionId}
        reviewId={props.reviewId}
        canAct={props.canAct}
        ownerId={props.ownerId}
        eventId={response.eventId()}
        onDecision={response.onDecision}
        onDecisionFailed={response.onDecisionFailed}
      />
      <Show when={response.responding()}>
        <WorkingLine label="Responding" />
      </Show>
    </div>
  );
}
