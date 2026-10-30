import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { useBlockId } from '@core/block';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { chatAttachmentMentionToMarkdown } from '@core/component/AI/util/chatAttachmentMention';
import { toast } from '@core/component/Toast/Toast';
import {
  enableRoutineConditions,
  enableRoutineSharing,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import { getOwner, onMount, Show } from 'solid-js';
import { getErrorMessage } from './core/routine-draft';
import {
  createAgentHistoryMetadata,
  createChatHistoryMetadata,
} from './queries/history-metadata';
import { createRoutineDetailSource } from './queries/routine-sources';
import { createRoutineConnectedApps, RoutineApps } from './routine-apps';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { routineToolSlots } from './routine-step-pickers';
import {
  openShareRoutineDialog,
  RoutineTemplatePage,
} from './routine-template';
import { RoutineTriggers } from './routine-triggers';
import { RoutineDetailView } from './views/routine-detail';

/** The built-in skill for composing routines (crates/system_skills). */
const COMPOSE_ROUTINES_SKILL = 'Compose Routines';

export function Routine() {
  const scheduleId = useBlockId();
  const layout = useSplitLayout();
  onMount(() => {
    if (scheduleId === 'new') {
      openAgentsPage(layout, 'routines', { routineId: 'new' });
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
  const decisions = useFeatureFlag(enableRoutineConditions);
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
  const share = () => {
    const routine = source.routine();
    if (!routine) return;
    openShareRoutineDialog(
      {
        routineId: routine.id,
        name: routine.name,
      },
      owner
    );
  };
  const systemSkills = useSystemSkillsQuery();
  /**
   * Ask AI, as on other surfaces: a new conversation with this routine and
   * the Compose Routines skill attached, waiting for what to change.
   */
  const compose = () => {
    const routine = source.routine();
    if (!routine) return;
    // System skills carry no slug to the client; their names are fixed.
    const skill = systemSkills
      .skills()
      .find((skill) => skill.name === COMPOSE_ROUTINES_SKILL);
    const mentions = [
      skill &&
        chatAttachmentMentionToMarkdown({
          documentId: skill.id,
          documentName: skill.name,
          blockName: 'skill',
        }),
      chatAttachmentMentionToMarkdown({
        documentId: routine.id,
        documentName: routine.name,
        blockName: 'routine',
      }),
    ].filter(Boolean);
    fireAndForget(openChatWithInput(`${mentions.join(' ')} `), 'routines');
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
        decisionsEnabled={decisions().enabled}
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
        onShare={sharing().enabled ? share : undefined}
        onCompose={compose}
        onOpenTemplate={sharing().enabled ? open : undefined}
        slots={{
          PromptEditor: RoutinePromptEditor,
          ExecutionPicker: RoutineExecutionPicker,
          Triggers: RoutineTriggers,
          Apps: RoutineApps,
          createConnectedApps: createRoutineConnectedApps,
          ...routineToolSlots,
          createChatMetadata: createChatHistoryMetadata,
          createAgentMetadata: createAgentHistoryMetadata,
        }}
      />
    </Show>
  );
}
