import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { PersistedReview } from '../../agent-reviews/views/persisted-review';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { WorkingLine } from '../ui/WorkingLine';

/** ACP presents the saved review immediately for every agent implementation. */
export function PresentedReviewPart(props: {
  sessionId: string;
  reviewId: string;
}) {
  const session = useOptionalAgentSession();
  const [pendingDecision, setPendingDecision] = createSignal<{
    previousEvent: string | undefined;
  }>();
  const latestNotification = createMemo(() =>
    session
      ?.metadata()
      ?.notifications?.filter((event) => event.subjectId === props.reviewId)
      .at(-1)
  );
  const responding = () => {
    const pending = pendingDecision();
    const event = latestNotification();
    if (pending && event?.id === pending.previousEvent) return true;
    if (!event || (!pending && !event.systemTurn)) return false;
    if (session?.metadata()?.noopTurn === event.turn) return false;
    if (
      !pending &&
      !['starting', 'running', 'blocked'].includes(session?.turn() ?? 'idle')
    )
      return false;
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
      (!responding() ||
        !['starting', 'running', 'blocked'].includes(session?.turn() ?? 'idle'))
    )
      setPendingDecision(undefined);
  });
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
        eventId={latestNotification()?.id}
        onDecision={() =>
          setPendingDecision({ previousEvent: latestNotification()?.id })
        }
        onDecisionFailed={() => setPendingDecision(undefined)}
      />
      <Show when={responding()}>
        <WorkingLine label="Responding" />
      </Show>
    </>
  );
}
