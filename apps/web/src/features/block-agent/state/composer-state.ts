/**
 * The composer's queue-and-send model, as pure decisions over present facts.
 *
 * The previous machine (`session-state.ts`) accumulated a phase from events
 * (`turn_started`, `post_succeeded`, ...) and could wedge in a phase whose
 * exit event never arrived. This model keeps no event history. Two facts are
 * owned — the prompt queue and the lifecycle of the single in-flight POST —
 * and `nextAction` derives the one thing to do from what is true *right
 * now*. The Solid shell (`context/create-composer-controller.ts`) re-runs it
 * whenever any fact changes, so nothing can get stuck: if a fact changes,
 * the decision changes. This is opencode's followup-drain shape
 * (`pages/session.tsx` — a guard list, not a transition table).
 *
 * Sending is one prompt at a time, head of the queue first. A failed head
 * stays in the queue behind a `failed` latch — visible, retryable, never
 * silently dropped — and holds everything queued behind it so order is
 * preserved.
 */

import { match, P } from 'ts-pattern';

/** A prompt waiting to be sent. Client-minted id, so rows are stable. */
export type QueuedPrompt = {
  id: string;
  markdown: string;
};

/**
 * The lifecycle of the single in-flight POST. At most one prompt is ever on
 * the wire; everything else waits in the queue.
 */
export type PostPhase =
  /** Nothing on the wire. The drain may send the queue's head. */
  | { type: 'idle' }
  /** The head prompt's POST is on the wire. */
  | { type: 'posting'; promptId: string }
  /**
   * The POST was accepted but the fold has not yet shown the turn it
   * starts. Held so the drain does not fire again into the same turn; freed
   * by the fold reporting the turn — or by a timeout, so a turn that never
   * appears cannot wedge the composer.
   */
  | { type: 'awaiting_turn'; promptId: string }
  /**
   * The head prompt's POST failed. It stays at the head of the queue; this
   * latch stops the drain until the user retries, removes it, or sends a
   * new message (which also retries).
   */
  | { type: 'failed'; promptId: string };

/** Everything `nextAction` is allowed to look at. */
export type ComposerFacts = {
  post: PostPhase;
  /** The queue's head — the only prompt that can send next. */
  head: QueuedPrompt | undefined;
  /** The block's one working signal (fold ∧ not disconnected). */
  agentWorking: boolean;
};

export type ComposerAction =
  | { type: 'post_head'; prompt: QueuedPrompt }
  | { type: 'hold'; reason: string };

const hold = (reason: string): ComposerAction => ({ type: 'hold', reason });

/**
 * The drain decision: given the facts, either send the queue's head or name
 * the reason not to. Every guard is one line; the order is the priority.
 */
export function nextAction(facts: ComposerFacts): ComposerAction {
  return match(facts)
    .with({ post: { type: 'posting' } }, () => hold('a post is on the wire'))
    .with({ post: { type: 'awaiting_turn' } }, () =>
      hold('posted; the fold has not shown the turn yet')
    )
    .with({ post: { type: 'failed' } }, () =>
      hold('the head prompt failed; waiting for retry, edit, or a new send')
    )
    .with({ agentWorking: true }, () => hold('the agent is mid-turn'))
    .with({ head: P.select(P.nonNullable) }, (head) => ({
      type: 'post_head' as const,
      prompt: head,
    }))
    .otherwise(() => hold('nothing queued'));
}

/**
 * Whether the stop affordance shows: a turn is running, or a post is in the
 * middle of starting one. A failed post is *not* busy — the user needs the
 * send button back to retry.
 */
export function isBusy(post: PostPhase, agentWorking: boolean): boolean {
  return (
    agentWorking || post.type === 'posting' || post.type === 'awaiting_turn'
  );
}
