import { useSplitLayout } from '@components/app/split-layout/layout';
import { useRoutineIdeaSuggestions } from '../routine-suggestions/routine-suggestions';
import { createIdeaActions } from './idea-actions';
import { useIdeasSource } from './queries/ideas-source';

/** The person's ideas and the app's actions on them, for a view to compose. */
export function useIdeas() {
  const layout = useSplitLayout();
  const routines = useRoutineIdeaSuggestions();
  const actions = createIdeaActions(layout, {
    routineText: routines.text,
    reviewRoutine: routines.review,
    turnOnRoutine: routines.turnOn,
  });

  return { source: useIdeasSource(), actions };
}
