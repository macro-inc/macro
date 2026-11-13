import { useSplitLayout } from '@components/app/split-layout/layout';
import { useForYouRoutineSuggestions } from '../routine-suggestions/routine-suggestions';
import { useSuggestionGeneration } from './queries/generation';
import { useSuggestionsSource } from './queries/suggestions-source';
import { createSuggestionActions } from './suggestion-actions';

/** The person's suggestions and the app's actions on them, for a view to compose. */
export function useSuggestions() {
  const layout = useSplitLayout();
  const routines = useForYouRoutineSuggestions();
  const actions = createSuggestionActions(layout, {
    routineText: routines.text,
    reviewRoutine: routines.review,
    turnOnRoutine: routines.turnOn,
  });

  return {
    source: useSuggestionsSource(),
    generation: useSuggestionGeneration(),
    actions,
  };
}
