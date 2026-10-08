import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import {
  clearRoutineComposerDraft,
  loadRoutineComposerDraft,
  saveRoutineComposerDraft,
} from './draft-storage';
import { createRoutineCreatorSource } from './queries/routine-sources';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { RoutineTriggers } from './routine-triggers';
import { RoutineCreatorView } from './views/routine-creator';

/** Production composition for the shared task/project creation popover. */
export function RoutineCreator(
  props: { onCreated?: (id: string) => void } = {}
) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const source = createRoutineCreatorSource();
  return (
    <RoutineCreatorView
      source={source}
      defaultModel={DEFAULT_MODEL}
      storage={{
        load: loadRoutineComposerDraft,
        save: saveRoutineComposerDraft,
        clear: clearRoutineComposerDraft,
      }}
      slots={{
        PromptEditor: RoutinePromptEditor,
        ExecutionPicker: RoutineExecutionPicker,
        Triggers: RoutineTriggers,
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
