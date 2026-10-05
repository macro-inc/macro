import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { onMount, Show } from 'solid-js';
import { getErrorMessage } from './core/routine-draft';
import {
  createAgentHistoryMetadata,
  createChatHistoryMetadata,
} from './queries/history-metadata';
import { createRoutineDetailSource } from './queries/routine-sources';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { RoutineTriggers } from './routine-triggers';
import { RoutineDetailView } from './views/routine-detail';

export function Routine() {
  const scheduleId = useBlockId();
  const layout = useSplitLayout();
  onMount(() => {
    if (scheduleId === 'new') {
      layout.popoverSplit({ type: 'component', id: 'routine-compose' });
      openAgentsPage(layout, 'routines');
    }
  });
  return (
    <Show when={scheduleId !== 'new'}>
      <RoutineDetail scheduleId={scheduleId} />
    </Show>
  );
}

export function RoutineDetail(props: {
  scheduleId: string;
  initialTab?: 'settings' | 'history';
  onBack?: () => void;
  onOpen?: (id: string) => void;
}) {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const back = () =>
    props.onBack ? props.onBack() : openAgentsPage(layout, 'routines');
  const open = (id: string) =>
    props.onOpen
      ? props.onOpen(id)
      : openAgentsPage(layout, 'routines', { routineId: id });
  const source = createRoutineDetailSource(() => props.scheduleId, {
    onError: (title, error) =>
      toast.alert(title, { subtext: getErrorMessage(error) }),
    onDuplicated: (id) => {
      toast.success('Duplicated');
      open(id);
    },
  });
  const remove = () => {
    const entity = source.entity();
    if (!entity || entity.ownerId !== userId()) return;
    openBulkEditModal({
      view: 'delete',
      entities: [entity],
      onFinish: () => {
        toast.success('Deleted');
        back();
      },
      onError: () => toast.failure('Failed to delete'),
    });
  };
  return (
    <RoutineDetailView
      source={source}
      userId={userId}
      defaultModel={DEFAULT_MODEL}
      initialTab={props.initialTab}
      onBack={back}
      onDelete={remove}
      onRename={(name) => {
        if (!props.onBack) panel.handle.setDisplayName(name);
      }}
      onOpenRun={(resource, newSplit) =>
        layout.openWithSplit(resource, {
          activate: true,
          preferNewSplit: newSplit,
        })
      }
      onCopyPrompt={async (prompt) => {
        if (await writeClipboardData({ 'text/plain': prompt }))
          toast.success('Prompt copied');
        else toast.alert('Could not copy prompt');
      }}
      slots={{
        PromptEditor: RoutinePromptEditor,
        ExecutionPicker: RoutineExecutionPicker,
        Triggers: RoutineTriggers,
        createChatMetadata: createChatHistoryMetadata,
        createAgentMetadata: createAgentHistoryMetadata,
      }}
    />
  );
}
