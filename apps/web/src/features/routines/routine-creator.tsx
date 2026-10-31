import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  enableRoutineConditions,
  enableRoutineStarterTemplates,
} from '@core/constant/featureFlags';
import { RoutineAiComposer } from './routine-ai-composer';
import { startRoutineDraft } from './routine-draft-start';
import { RoutineCreatorView } from './views/routine-creator';

/**
 * Production composition for New routine in the shared creation popover. A
 * choice closes it and opens the new routine's page with that draft.
 */
export function RoutineCreator(
  props: {
    /** Opens the new routine's page; by default in the Agents workspace. */
    onStart?: () => void;
  } = {}
) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const hasPaidAccess = useHasPaidAccess();
  const decisions = useFeatureFlag(enableRoutineConditions);
  const templates = useFeatureFlag(enableRoutineStarterTemplates);
  const defaultModel = () => defaultModelForPlan(hasPaidAccess());
  return (
    <RoutineCreatorView
      defaultModel={defaultModel()}
      decisionsEnabled={decisions().enabled}
      templatesEnabled={templates().enabled}
      renderComposer={(apply, current, initialDescription) => (
        <RoutineAiComposer
          apply={apply}
          current={current}
          initialDescription={initialDescription}
          defaultModel={defaultModel()}
          decisionsEnabled={decisions().enabled}
        />
      )}
      onClose={() => panel.handle.close()}
      onStart={(draft) => {
        // The page reads its first draft from the unsent-draft store.
        startRoutineDraft(draft);
        panel.handle.close();
        if (props.onStart) props.onStart();
        else openAgentsPage(layout, 'routines', { routineId: 'new' });
      }}
    />
  );
}
