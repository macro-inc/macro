import { type Accessor, createMemo, createSignal } from 'solid-js';
import { pickDefaultOn, type RoutineSuggestion } from '../core/suggestions';
import type { SuggestionActions } from './suggestion-actions';

/**
 * Which suggestions are switched on in a list the user confirms all at once.
 * The AI's likely keepers start on; the user's own toggles win.
 */
export function createSuggestionSelection(
  actions: SuggestionActions,
  suggestions: Accessor<readonly RoutineSuggestion[] | undefined>
) {
  const defaults = createMemo(() => pickDefaultOn(suggestions() ?? []));
  const [choices, setChoices] = createSignal<Record<string, boolean>>({});
  const isOn = (suggestion: RoutineSuggestion) =>
    choices()[suggestion.id] ?? defaults().has(suggestion.id);
  const selected = () => (suggestions() ?? []).filter(isOn);

  return {
    isOn,
    setOn: (suggestion: RoutineSuggestion, on: boolean) =>
      setChoices((previous) => ({ ...previous, [suggestion.id]: on })),
    selected,
    /** Whether the AI switched this one on before the user touched it. */
    isDefault: (suggestion: RoutineSuggestion) => defaults().has(suggestion.id),
    /**
     * Creates every selected routine not created yet. Resolves true once all
     * of them exist; failures stay on their rows, and calling again retries
     * only those.
     */
    async enableSelected(): Promise<boolean> {
      const chosen = selected();
      await Promise.all(chosen.map(actions.enable));
      return chosen.every(
        (suggestion) => actions.statusFor(suggestion).kind === 'enabled'
      );
    },
  };
}

export type SuggestionSelection = ReturnType<typeof createSuggestionSelection>;
