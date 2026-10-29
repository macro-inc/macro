import type { RoutineSuggestion } from '@app/features/routine-suggestions/core/suggestions';
import {
  type RoutineSurface,
  routineSurfaces,
} from '@app/features/routine-suggestions/core/surfaces';
import { createSuggestionActions } from '@app/features/routine-suggestions/primitives/suggestion-actions';
import { createSuggestionSelection } from '@app/features/routine-suggestions/primitives/suggestion-selection';
import { createMemo, createSignal } from 'solid-js';
import type { OnboardingContext } from '../context/onboarding-context';

type RoutinesStepCapabilities = Pick<
  OnboardingContext,
  'createRoutineSuggestionsStep' | 'track'
>;

export type RoutineGroup = {
  surface: RoutineSurface;
  suggestions: RoutineSuggestion[];
};

/**
 * The last step: every suggested routine grouped by surface, the AI's likely
 * keepers switched on, and one action that turns the chosen ones on before
 * leaving. Failed creates stay on their rows; continuing again retries only
 * those, so nothing is created twice.
 */
export function createRoutinesStep(context: RoutinesStepCapabilities) {
  const step = context.createRoutineSuggestionsStep();
  const actions = createSuggestionActions({
    target: step.target,
    // A new account has no routines yet.
    existingRoutines: () => [],
    create: step.create,
  });
  const selection = createSuggestionSelection(actions, step.source.suggestions);
  const [enabling, setEnabling] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  const groups = createMemo((): RoutineGroup[] => {
    const all = step.source.suggestions() ?? [];
    return routineSurfaces.flatMap((surface) => {
      const suggestions = all.filter(
        (suggestion) => suggestion.surface === surface
      );
      return suggestions.length ? [{ surface, suggestions }] : [];
    });
  });

  const report = (enabled: readonly RoutineSuggestion[]) => {
    const all = step.source.suggestions() ?? [];
    context.track('onboarding_v4_routines', {
      suggested: all.length,
      recommended: all.filter(selection.isDefault).length,
      enabled: enabled.length,
      recommended_kept: enabled.filter(selection.isDefault).length,
    });
  };

  return {
    source: step.source,
    actions,
    selection,
    groups,
    enabling,
    failed,
    /** Turns on the chosen routines, then leaves; stays when one fails. */
    async turnOnAndFinish(onFinish: () => void) {
      if (enabling()) return;
      setEnabling(true);
      setFailed(false);
      const enabled = await selection.enableSelected();
      setEnabling(false);
      if (!enabled) {
        setFailed(true);
        return;
      }
      report(selection.selected());
      onFinish();
    },
    /** Leaves without turning anything on. */
    skip(onFinish: () => void) {
      if (enabling()) return;
      report([]);
      onFinish();
    },
  };
}
