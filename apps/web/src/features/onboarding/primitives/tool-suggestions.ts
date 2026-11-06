import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import type { OnboardingContext } from '../context/onboarding-context';
import {
  ONBOARDING_SENDER_DOMAINS,
  rankSuggestedTools,
  type SuggestedTool,
} from '../core/tools';

/** What the tools step shows while and after the inbox is read. */
export type ToolSuggestionsView =
  | { t: 'loading' }
  | { t: 'ready'; suggestions: SuggestedTool[] }
  /** The inbox couldn't be read in time: show the plain catalog instead. */
  | { t: 'fallback' };

export type ToolSuggestionsTiming = {
  /** The loader shows at least this long, so it never flashes. */
  minMs: number;
  /** After this long without an answer, the step falls back. */
  maxMs: number;
};

export const TOOL_SUGGESTIONS_TIMING: ToolSuggestionsTiming = {
  minMs: 800,
  maxMs: 3000,
};

/**
 * The tools to suggest, ranked by the viewer's inbox. An answer already in
 * hand shows at once; otherwise the loader runs until it lands. Once it leaves
 * `loading` the view never changes, so a late answer can't swap the screen
 * under the person. No inbox counts as an answer: the defaults are suggested.
 */
export function createToolSuggestions(
  context: Pick<OnboardingContext, 'createSenderDomainCounts' | 'track'>,
  timing: ToolSuggestionsTiming = TOOL_SUGGESTIONS_TIMING
): {
  view: () => ToolSuggestionsView;
  /** Whole seconds left before the step falls back, for the countdown. */
  secondsLeft: () => number;
} {
  const counts = context.createSenderDomainCounts(ONBOARDING_SENDER_DOMAINS);
  const started = performance.now();
  const answeredAtStart = untrack(counts).t !== 'loading';
  const [minElapsed, setMinElapsed] = createSignal(
    answeredAtStart || timing.minMs <= 0
  );
  const [timedOut, setTimedOut] = createSignal(false);
  const [secondsLeft, setSecondsLeft] = createSignal(
    Math.ceil(timing.maxMs / 1000)
  );
  const minTimer = setTimeout(() => setMinElapsed(true), timing.minMs);
  const maxTimer = setTimeout(() => setTimedOut(true), timing.maxMs);
  const tick = setInterval(
    () => setSecondsLeft((left) => Math.max(1, left - 1)),
    1000
  );
  onCleanup(() => {
    clearTimeout(minTimer);
    clearTimeout(maxTimer);
    clearInterval(tick);
  });

  const decide = (): ToolSuggestionsView => {
    const loaded = counts();
    if (loaded.t === 'loading' || !minElapsed())
      return timedOut() ? { t: 'fallback' } : { t: 'loading' };
    if (loaded.t === 'error') return { t: 'fallback' };
    return { t: 'ready', suggestions: rankSuggestedTools(loaded.value) };
  };
  const view = createMemo<ToolSuggestionsView>(
    (previous) => (previous.t === 'loading' ? decide() : previous),
    { t: 'loading' }
  );
  // Analytics is an external system; it hears the outcome once.
  createEffect(
    on(
      () => view().t,
      (outcome) => {
        if (outcome === 'loading') return;
        context.track('onboarding_v4_tool_suggestions', {
          outcome,
          duration_ms: Math.round(performance.now() - started),
        });
      }
    )
  );
  return { view, secondsLeft };
}
