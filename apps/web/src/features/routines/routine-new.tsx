import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import {
  clearRoutineComposerDraft,
  loadRoutineComposerDraft,
  saveRoutineComposerDraft,
} from './draft-storage';
import { createRoutineCreatorSource } from './queries/routine-sources';
import { createRoutineConnectedApps, RoutineApps } from './routine-apps';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { routineToolSlots } from './routine-step-pickers';
import { RoutineTriggers } from './routine-triggers';
import { RoutineNewView } from './views/routine-new';

/** Production composition for a new routine's page, in the routines pane. */
export function RoutineNew(props: {
  onCreated(id: string): void;
  onCancel(): void;
}) {
  const source = createRoutineCreatorSource();
  const hasPaidAccess = useHasPaidAccess();
  const decisions = useFeatureFlag(enableRoutineConditions);
  return (
    <RoutineNewView
      source={source}
      defaultModel={defaultModelForPlan(hasPaidAccess())}
      decisionsEnabled={decisions().enabled}
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
      onCreated={props.onCreated}
      onCancel={props.onCancel}
    />
  );
}
