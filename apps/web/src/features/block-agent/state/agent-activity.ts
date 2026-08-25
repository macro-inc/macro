/**
 * What the block says the harness is doing while the transcript has nothing
 * to show for it — the shimmer line's label, or undefined when the
 * transcript speaks for itself.
 *
 * The wire's status vocabulary is deliberately tiny (`acp_ready`,
 * `disconnected`, and unmodeled event names passed through), so the states a
 * reader actually waits on — a container provisioning for minutes, a reaped
 * sandbox waking up, a prompt accepted with nothing streamed yet — are
 * inferred here from facts the block already tracks, the same way the
 * context infers `resuming`.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import {
  isDisconnected,
  type SessionStatus,
} from '../context/create-session-status-controller';
import { prettyEventName } from '../ui/SessionStatusPill';
import { lastTurnMessage } from './control-message';

/** Everything `activityLabel` is allowed to look at. */
export type ActivityFacts = {
  /** The block has nothing to load — an error line shows instead. */
  loadFailed: boolean;
  /** `POST /agent-sessions` is still on the wire; the sandbox is booting. */
  pending: boolean;
  /** The runtime is gone and the service is waking its sandbox back up. */
  resuming: boolean;
  /** A prompt is on the wire or awaiting its turn (`composer.sendingId`). */
  sending: boolean;
  /** The block's one working signal (fold ∧ not disconnected). */
  working: boolean;
  /** The runtime's status, live-followed. */
  status: SessionStatus;
  /** The folded transcript. */
  messages: readonly FoldedMessage[];
};

/** The open turn has streamed something the transcript already renders. */
function streamHasContent(messages: readonly FoldedMessage[]): boolean {
  const last = lastTurnMessage(messages);
  return (
    last?.author.kind === 'agent' && last.stop == null && last.parts.length > 0
  );
}

export function activityLabel(facts: ActivityFacts): string | undefined {
  if (facts.loadFailed) return undefined;
  // The two waits no transport can report, in the order a session meets
  // them: the create does not answer until the sandbox is up, and a resume
  // keeps the log silent until the container is back.
  if (facts.pending) return 'Starting container';
  if (facts.resuming) return 'Resuming container';
  if (isDisconnected(facts.status)) return undefined;
  if (streamHasContent(facts.messages)) return undefined;
  if (!facts.working && !facts.sending) {
    // Nothing asked of the agent: the one thing still worth narrating is a
    // container coming up on a session that has never spoken.
    return facts.messages.length === 0 && facts.status.kind === 'no_messages'
      ? 'Starting container'
      : undefined;
  }
  // A turn is due and nothing has streamed: name the harness's real state.
  if (facts.status.kind === 'no_messages') return 'Starting container';
  if (facts.status.kind === 'event') {
    return facts.status.event === 'acp_ready'
      ? 'Thinking'
      : // An event the protocol doesn't model yet — surface it, as the
        // status pill does.
        prettyEventName(facts.status.event);
  }
  return undefined;
}
