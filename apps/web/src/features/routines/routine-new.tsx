import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import { createSignal, onCleanup, Show } from 'solid-js';
import type { RoutineDraftStorage } from './context/routine-sources';
import type { ScheduleDraft } from './core/draft';
import {
  clearRoutineComposerDraft,
  loadRoutineComposerDraft,
  saveRoutineComposerDraft,
} from './draft-storage';
import { createRoutineCreatorSource } from './queries/routine-sources';
import { createRoutineConnectedApps, RoutineApps } from './routine-apps';
import { onRoutineDraftStarted } from './routine-draft-start';
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
  // Each start remounts the page, so its editors take the new draft.
  const [start, setStart] = createSignal<{ draft?: ScheduleDraft }>({});
  onCleanup(onRoutineDraftStarted((draft) => setStart({ draft })));
  return (
    <Show when={start()} keyed>
      {(current) => {
        // A page a newer start replaced must not write over that draft.
        const live = () => start() === current;
        const storage: RoutineDraftStorage = {
          load: () => current.draft ?? loadRoutineComposerDraft(),
          save: (draft) => {
            if (live()) saveRoutineComposerDraft(draft);
          },
          clear: () => {
            if (live()) clearRoutineComposerDraft();
          },
        };
        return (
          <RoutineNewView
            source={source}
            defaultModel={defaultModelForPlan(hasPaidAccess())}
            decisionsEnabled={decisions().enabled}
            storage={storage}
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
      }}
    </Show>
  );
}
