import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { useBlockId } from '@core/block';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import { enableRoutineSharing } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getOwner, onMount, Show } from 'solid-js';
import type { ScheduleDraft } from './core/draft';
import { getErrorMessage } from './core/routine-draft';
import {
  createAgentHistoryMetadata,
  createChatHistoryMetadata,
} from './queries/history-metadata';
import { createRoutineDetailSource } from './queries/routine-sources';
import { createRoutineConnectedApps, RoutineApps } from './routine-apps';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import {
  openShareTemplateDialog,
  RoutineTemplatePage,
} from './routine-template';
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
  const hasPaidAccess = useHasPaidAccess();
  const sharing = useFeatureFlag(enableRoutineSharing);
  const back = () =>
    props.onBack ? props.onBack() : openAgentsPage(layout, 'routines');
  const open = (id: string) =>
    props.onOpen
      ? props.onOpen(id)
      : openAgentsPage(layout, 'routines', { routineId: id });
  const source = createRoutineDetailSource(() => props.scheduleId, userId, {
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
  const owner = getOwner();
  const shareTemplate = () => {
    const routine = source.routine();
    if (!routine) return;
    openShareTemplateDialog(
      {
        routineId: routine.id,
        name: routine.name,
        prompt: routine.draft?.prompt ?? '',
        timezone: scheduleTimezone(routine.draft),
        ownerId: routine.ownerId,
      },
      owner
    );
  };
  // Routines run as their owner, so everyone else sees the shared template.
  const ownedByViewer = () => {
    const routine = source.routine();
    return routine ? routine.ownerId === userId() : true;
  };
  return (
    <Show
      when={ownedByViewer()}
      fallback={
        <RoutineTemplatePage scheduleId={props.scheduleId} onBack={back} />
      }
    >
      <RoutineDetailView
        source={source}
        userId={userId}
        defaultModel={defaultModelForPlan(hasPaidAccess())}
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
        onShareTemplate={sharing().enabled ? shareTemplate : undefined}
        onOpenTemplate={sharing().enabled ? open : undefined}
        slots={{
          PromptEditor: RoutinePromptEditor,
          ExecutionPicker: RoutineExecutionPicker,
          Triggers: RoutineTriggers,
          Apps: RoutineApps,
          createConnectedApps: createRoutineConnectedApps,
          createChatMetadata: createChatHistoryMetadata,
          createAgentMetadata: createAgentHistoryMetadata,
        }}
      />
    </Show>
  );
}

/** The time zone a routine's schedules run in, for sharing it as a template. */
function scheduleTimezone(draft: ScheduleDraft | undefined) {
  const schedule = draft?.triggers?.find(
    (trigger) => trigger.kind === 'schedule'
  );
  if (schedule?.kind === 'schedule') return schedule.timezone;
  return draft?.triggers ? undefined : draft?.timezone;
}
