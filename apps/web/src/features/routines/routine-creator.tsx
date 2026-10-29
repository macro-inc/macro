import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  clearRoutineComposerDraft,
  loadRoutineComposerDraft,
  parseRoutineDraft,
  saveRoutineComposerDraft,
} from './draft-storage';
import { createRoutineCreatorSource } from './queries/routine-sources';
import { createRoutineConnectedApps, RoutineApps } from './routine-apps';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { RoutineTriggers } from './routine-triggers';
import { RoutineCreatorView } from './views/routine-creator';

/** Production composition for the shared task/project creation popover. */
export function RoutineCreator(
  props: {
    onCreated?: (id: string) => void;
    /**
     * Prefills the composer, e.g. with a suggested routine. Split params are
     * untyped, so it is validated here and ignored when malformed.
     */
    initialDraft?: unknown;
  } = {}
) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const source = createRoutineCreatorSource();
  const hasPaidAccess = useHasPaidAccess();
  return (
    <RoutineCreatorView
      source={source}
      defaultModel={defaultModelForPlan(hasPaidAccess())}
      initialDraft={parseRoutineDraft(props.initialDraft)}
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
