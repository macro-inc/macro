import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import {
  clearRoutineComposerDraft,
  loadRoutineComposerDraft,
  saveRoutineComposerDraft,
} from './draft-storage';
import { createRoutineCreatorSource } from './queries/routine-sources';
import { RoutineAiComposer } from './routine-ai-composer';
import { createRoutineConnectedApps, RoutineApps } from './routine-apps';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { routineToolSlots } from './routine-step-pickers';
import { RoutineTriggers } from './routine-triggers';
import { RoutineCreatorView } from './views/routine-creator';

/** Production composition for the shared task/project creation popover. */
export function RoutineCreator(
  props: { onCreated?: (id: string) => void } = {}
) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const source = createRoutineCreatorSource();
  const hasPaidAccess = useHasPaidAccess();
  const decisions = useFeatureFlag(enableRoutineConditions);
  const defaultModel = () => defaultModelForPlan(hasPaidAccess());
  return (
    <RoutineCreatorView
      source={source}
      defaultModel={defaultModel()}
      decisionsEnabled={decisions().enabled}
      renderComposer={(apply, current, initialDescription) => (
        <RoutineAiComposer
          apply={apply}
          current={current}
          initialDescription={initialDescription}
          defaultModel={defaultModel()}
          decisionsEnabled={decisions().enabled}
          disabled={source.pending()}
        />
      )}
      storage={{
        load: loadRoutineComposerDraft,
        save: saveRoutineComposerDraft,
        clear: clearRoutineComposerDraft,
      }}
      slots={{
        PromptEditor: RoutinePromptEditor,
        ExecutionPicker: RoutineExecutionPicker,
        Triggers: RoutineTriggers,
        Apps: RoutineApps,
        createConnectedApps: createRoutineConnectedApps,
        ...routineToolSlots,
      }}
      onClose={() => panel.handle.close()}
      onCreated={(id) => {
        panel.handle.close();
        if (props.onCreated) props.onCreated(id);
        else openAgentsPage(layout, 'routines', { routineId: id });
      }}
    />
  );
}
