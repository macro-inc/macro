import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useForYouRoutineSuggestions } from '../routine-suggestions/routine-suggestions';
import { useSuggestionGeneration } from './queries/generation';
import { useRoutinesSource } from './queries/routines-source';
import { useSuggestionsSource } from './queries/suggestions-source';
import { createSuggestionActions } from './suggestion-actions';

/** The person's suggestions and the app's actions on them, for a view to compose. */
export function useSuggestions() {
  const layout = useSplitLayout();
  const routines = useForYouRoutineSuggestions();
  const actions = createSuggestionActions(layout, {
    reviewRoutine: routines.review,
    turnOnRoutine: routines.turnOn,
  });

  return {
    source: useSuggestionsSource(),
    generation: useSuggestionGeneration(),
    actions,
  };
}

/** The person's routines, for the For you page's sidebar and turned-on rows. */
export function useForYouRoutines() {
  const layout = useSplitLayout();

  return useRoutinesSource((routineId) =>
    openAgentsPage(layout, 'routines', { routineId })
  );
}
