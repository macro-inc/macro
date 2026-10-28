import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import type { SuggestionObservation } from '../context/telemetry';
import { isInferable } from '../core/inferable';
import { type Intent, rankIntents, type Scores } from '../core/input';
import { createInferenceQueue } from './inference-queue';

/** Independent probability worth interrupting a host's own input for. */
const CONFIDENCE = 0.6;
/** An uninvited guess waits for a pause rather than racing the next keystroke. */
const SETTLE_MS = 600;

export type IntentSuggestionSource = {
  classify(
    text: string,
    revision: number
  ): Promise<{ revision: number; scores: Scores }>;
  /** Types this host can hand its draft to; the rest are never offered. */
  offers(): Intent[];
  /** Stops classifying while the host has no use for an offer. */
  enabled?(): boolean;
  confidence?: number;
  observe?(observation: SuggestionObservation): void;
};

/**
 * `accepted` and `dismissed` both stop detection: one because a composer owns
 * the draft, the other because the writer said no. Clearing the draft, or
 * `reset`, starts over.
 */
type Phase = 'detecting' | 'accepted' | 'dismissed';
type Retirement = 'accepted' | 'dismissed' | 'replaced' | 'abandoned';

/**
 * Reads a host's own draft and offers one type for it, without building a
 * Universal Input draft. The offer is the classifier's first choice, so a host
 * that already does what the text asks for — a channel composer sending a
 * message — leaves that type out of `offers` and hears nothing.
 *
 * Scores outlive the keystroke that produced them: a slightly stale offer costs
 * nothing, because accepting it hands the current text to a composer that
 * classifies it again, while re-deciding on every keystroke would flicker.
 */
export function createIntentSuggestion(
  text: () => string,
  source: IntentSuggestionSource
) {
  const [scores, setScores] = createSignal<Scores>([]);
  const [phase, setPhase] = createSignal<Phase>('detecting');
  const confidence = source.confidence ?? CONFIDENCE;
  const enabled = () => source.enabled?.() ?? true;
  let revision = 0;
  let disposed = false;
  const queue = createInferenceQueue({
    pace: { strategy: 'debounce', delayMs: SETTLE_MS },
    read: () => {
      const draft = text();
      return !disposed &&
        enabled() &&
        phase() === 'detecting' &&
        isInferable(draft)
        ? { text: draft }
        : undefined;
    },
    key: (input) => input.text,
    async run(input) {
      const id = ++revision;
      try {
        const response = await source.classify(input.text, id);
        if (disposed || text() !== input.text) return;
        if (response.revision === id) setScores(response.scores);
      } catch {
        // An offer nobody asked for stays silent when inference is unavailable.
      }
    },
  });

  const intent = () => {
    if (phase() !== 'detecting') return undefined;
    const best = rankIntents(scores())[0];
    return best &&
      best.score >= confidence &&
      source.offers().includes(best.intent)
      ? best.intent
      : undefined;
  };

  let offered: Intent | undefined;
  const retire = (outcome: Retirement) => {
    if (!offered) return;
    source.observe?.({ event: 'retired', intent: offered, outcome });
    offered = undefined;
  };
  createEffect(
    on(intent, (current) => {
      if (current === offered) return;
      retire('replaced');
      if (!current) return;
      offered = current;
      source.observe?.({
        event: 'offered',
        intent: current,
        score: rankIntents(scores())[0]?.score ?? 0,
      });
    })
  );

  createEffect(
    on([text, enabled], ([draft, ready]) => {
      if (!isInferable(draft)) {
        queue.clear();
        setScores([]);
        if (!draft.trim()) setPhase('detecting');
        return;
      }
      if (ready && phase() === 'detecting') queue.enqueue();
    })
  );
  onCleanup(() => {
    disposed = true;
    queue.dispose();
    retire('abandoned');
  });

  const stop = (outcome: 'accepted' | 'dismissed', next: Phase) => {
    retire(outcome);
    queue.clear();
    setPhase(next);
  };
  return {
    intent,
    scores,
    /** A composer owns the draft now; detection pauses until `reset`. */
    accept: () => stop('accepted', 'accepted'),
    /** Refuses the offer; nothing more is offered until the draft clears. */
    dismiss: () => stop('dismissed', 'dismissed'),
    /** Detects again, for a host that took the draft back into its own hands. */
    reset() {
      setScores([]);
      setPhase('detecting');
    },
  };
}
export type IntentSuggestionController = ReturnType<
  typeof createIntentSuggestion
>;
