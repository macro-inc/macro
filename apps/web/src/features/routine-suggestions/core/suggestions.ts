import type { ScheduleDraft } from '@app/features/routines/core/draft';
import { createEmptyDraft } from '@app/features/routines/core/routine-draft';
import type { RoutineTarget } from '@app/features/routines/core/routine-target';
import type { RoutineTriggerDraft } from '@app/features/routines/core/routine-triggers';
import type { SuggestionIcon } from '@service-cognition/generated/schemas/suggestionIcon';
import type { RoutineSurface } from './surfaces';

export type { SuggestionIcon };

/**
 * Onboarding turns on the suggestions the AI expects the user to keep: those
 * at or above this keep probability, at least {@link MIN_DEFAULT_ON} and at
 * most {@link MAX_DEFAULT_ON} of them. The server's prompt asks the model to
 * calibrate against the same bar.
 */
const DEFAULT_ON_THRESHOLD = 0.8;
const MIN_DEFAULT_ON = 2;
const MAX_DEFAULT_ON = 5;

/** A suggestion the UI can show and enable as-is. */
export type RoutineSuggestion = {
  /** Stable within one set: surface plus title. */
  id: string;
  surface: RoutineSurface;
  title: string;
  summary: string;
  reason: string;
  instructions: string;
  icon: SuggestionIcon;
  /** The AI's estimate, 0-1, that the user keeps it on once enabled for them. */
  keepProbability: number;
  /** Sends, posts, shares, or changes what others see; never on by default. */
  affectsOthers: boolean;
  notify: boolean;
  trigger: RoutineTriggerDraft;
  /** The trigger in words, e.g. "When a new email arrives". */
  when: string;
};

/** What the user has done with a suggestion so far. */
export type SuggestionStatus =
  | { kind: 'idle' }
  | { kind: 'enabling' }
  | { kind: 'enabled'; routineId: string }
  | { kind: 'failed'; message: string };

/** The parts of a suggestion the user can edit before enabling it. */
export type SuggestionEdits = {
  title: string;
  instructions: string;
  notify: boolean;
};

/** The routine a suggestion creates, ready to save or open in the composer. */
export function suggestionToDraft(
  suggestion: Pick<
    RoutineSuggestion,
    'title' | 'instructions' | 'trigger' | 'notify'
  >,
  target: RoutineTarget
): ScheduleDraft {
  return {
    ...createEmptyDraft(''),
    name: suggestion.title,
    prompt: suggestion.instructions,
    target,
    triggers: [{ ...suggestion.trigger, id: crypto.randomUUID() }],
    enabled: true,
    runVisibility: suggestion.notify ? 'listed' : 'unlisted',
  };
}

/**
 * The suggestions to turn on by default: every one the AI expects the user to
 * keep ({@link DEFAULT_ON_THRESHOLD} or more), topped up to
 * {@link MIN_DEFAULT_ON} with the next most likely and capped at
 * {@link MAX_DEFAULT_ON}, most likely first. Ties keep the AI's order.
 * Routines that affect other people are never chosen: their instructions come
 * from a model that read third-party mail, so the user switches them on.
 */
export function pickDefaultOn(
  suggestions: readonly RoutineSuggestion[]
): ReadonlySet<string> {
  const ranked = suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .filter(({ suggestion }) => !suggestion.affectsOthers)
    .toSorted(
      (a, b) =>
        b.suggestion.keepProbability - a.suggestion.keepProbability ||
        a.index - b.index
    )
    .map(({ suggestion }) => suggestion);
  const likely = ranked.filter(
    (suggestion) => suggestion.keepProbability >= DEFAULT_ON_THRESHOLD
  ).length;
  const count = Math.min(
    MAX_DEFAULT_ON,
    Math.max(MIN_DEFAULT_ON, likely),
    ranked.length
  );
  return new Set(ranked.slice(0, count).map((suggestion) => suggestion.id));
}
