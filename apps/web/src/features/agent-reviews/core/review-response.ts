import type {
  FoldedMessage,
  SessionMetadata,
  TurnState,
} from '@service-agent-fold/generated/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';

/** What a saved review's card reads from its session's fold. */
export type ReviewSession = {
  metadata: Accessor<SessionMetadata | undefined>;
  messages: Accessor<readonly FoldedMessage[]>;
  turn: Accessor<TurnState>;
};

const ACTIVE: readonly TurnState[] = ['starting', 'running', 'blocked'];

/**
 * Follows the session's notifications about one saved review, wherever its
 * card is shown: the latest one, which reloads the review when it arrives,
 * and whether the agent is still responding to a decision made on it. A
 * decision made on this card counts from the moment it is sent; one made
 * elsewhere, from the system turn its notification woke. A `<noop/>` turn,
 * or an agent message with text in the event's turn, ends the response.
 */
export function createReviewResponse(
  reviewId: Accessor<string>,
  session: ReviewSession | undefined
) {
  const [pendingDecision, setPendingDecision] = createSignal<{
    previousEvent: string | undefined;
  }>();
  const latestNotification = createMemo(() =>
    session
      ?.metadata()
      ?.notifications?.filter((event) => event.subjectId === reviewId())
      .at(-1)
  );
  const responding = () => {
    const pending = pendingDecision();
    const event = latestNotification();
    if (pending && event?.id === pending.previousEvent) return true;
    if (!event || (!pending && !event.systemTurn)) return false;
    if (session?.metadata()?.noopTurn === event.turn) return false;
    if (!pending && !ACTIVE.includes(session?.turn() ?? 'idle')) return false;
    return !session
      ?.messages()
      .some(
        (message) =>
          message.author.kind === 'agent' &&
          message.turn === event.turn &&
          message.parts.some(
            (part) => part.kind === 'text' && part.text.length > 0
          )
      );
  };
  createEffect(() => {
    const pending = pendingDecision();
    const event = latestNotification();
    if (
      pending &&
      event &&
      event.id !== pending.previousEvent &&
      (!responding() || !ACTIVE.includes(session?.turn() ?? 'idle'))
    )
      setPendingDecision(undefined);
  });
  return {
    /** The latest notification about the review; a new one reloads it. */
    eventId: () => latestNotification()?.id,
    responding,
    onDecision: () =>
      setPendingDecision({ previousEvent: latestNotification()?.id }),
    onDecisionFailed: () => setPendingDecision(undefined),
  };
}
