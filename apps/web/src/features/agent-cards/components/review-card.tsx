import { PersistedReview } from '@app/features/agent-reviews/views/persisted-review';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import Envelope from '@phosphor/envelope-simple.svg';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { queryReadyGate } from '@queries/gate';
import { Match, Switch } from 'solid-js';
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
  /** The person the agent works for: `Maya Chen`. Unknown to a reader who cannot see the session. */
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
 * the saved review itself (`agent-reviews`) for the person the agent works
 * for, who sends or dismisses each draft, and one line for everyone else.
 *
 * A review belongs to the session it was saved in, and only the session's
 * owner decides it - not whoever asked the agent in a shared conversation.
 * Nothing loads until the session says who the reader is to it.
 */
export function ReviewCard(props: {
  sessionId: string;
  reviewId: string;
  drafts: ReviewDrafts;
}) {
  const userId = useUserId();
  const session = useAgentSessionQuery(() => props.sessionId);
  // Who owns the session, once both it and the reader are known.
  const owner = () =>
    userId() && queryReadyGate(session) ? session.data?.ownerId : undefined;
  return (
    <Switch
      fallback={
        <div
          class="h-14 w-full max-w-md animate-pulse rounded-xl bg-hover"
          role="status"
          aria-label="Loading drafts to review"
        />
      }
    >
      <Match when={session.isError}>
        <ReviewWaitingCard drafts={props.drafts} />
      </Match>
      <Match when={owner() && owner() === userId()}>
        <div class="w-full max-w-xl min-w-0" data-agent-card="review">
          <PersistedReview
            sessionId={props.sessionId}
            reviewId={props.reviewId}
            canAct={!!session.data?.canEdit && !session.data?.isArchived}
          />
        </div>
      </Match>
      <Match when={owner()}>
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
