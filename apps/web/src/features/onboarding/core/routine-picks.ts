import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';

type StarterSuggestion = Extract<RoutineSuggestion, { kind: 'starter' }>;

/** AI is confident the person keeps these. */
const LIKELY_KEPT = 0.8;
/** Switched on even when AI is less sure, so the step shows what routines do. */
const AT_LEAST = 2;
/** Never more, so the first week isn't a wall of runs. */
const AT_MOST = 5;

/**
 * What onboarding's last step lists: catalog routines only. A request needs
 * drafting and a review of its own, so it waits for the sidebars.
 */
export function onboardingSuggestions(
  suggestions: readonly RoutineSuggestion[]
): StarterSuggestion[] {
  return suggestions.filter(
    (suggestion): suggestion is StarterSuggestion =>
      suggestion.kind === 'starter'
  );
}

/**
 * The suggestions switched on before the person changes anything: only
 * catalog routines the scheduler marks safe by default (never something AI
 * wrote), most likely kept first, every one AI is confident in and at
 * least two, at most five.
 */
export function preselectedSuggestions(
  suggestions: readonly RoutineSuggestion[]
): string[] {
  const safe = onboardingSuggestions(suggestions)
    .filter((suggestion) => suggestion.safeDefault)
    .toSorted((a, b) => b.keepProbability - a.keepProbability);
  const confident = safe.filter(
    (suggestion) => suggestion.keepProbability >= LIKELY_KEPT
  ).length;
  return safe
    .slice(0, Math.min(AT_MOST, Math.max(AT_LEAST, confident)))
    .map((suggestion) => suggestion.id);
}
