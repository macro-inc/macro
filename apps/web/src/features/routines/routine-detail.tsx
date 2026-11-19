import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { EntityAppearanceMenu } from '@app/features/entity-appearance/appearance-menu';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { useBlockId } from '@core/block';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { chatAttachmentMentionToMarkdown } from '@core/component/AI/util/chatAttachmentMention';
import { toast } from '@core/component/Toast/Toast';
import {
  enableEntityAppearance,
  enableEventRoutines,
  enableRoutineSharing,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import {
  createEffect,
  createSignal,
  getOwner,
  on,
  onMount,
  Show,
} from 'solid-js';
import { EntityAppearanceTrigger } from '../entity-appearance/entity-appearance';
import { getErrorMessage } from './core/routine-draft';
import { createdNote } from './created-note';
import { createRoutineConnectedApps } from './queries/connected-apps';
import {
  createAgentHistoryMetadata,
  createChatHistoryMetadata,
} from './queries/history-metadata';
import { createRoutineAppTargetCheck } from './queries/routine-app-targets';
import { createRoutineDetailSource } from './queries/routine-sources';
import {
  traceRoutineInteraction,
  withRoutineQueryTrace,
} from './queries/routine-trace';
import {
  readRoutineTemplateStatus,
  useRoutineTemplateQuery,
  useUnshareTemplateMutation,
} from './queries/templates';
import { RoutineApps } from './routine-apps';
import { RoutineExecutionPicker } from './routine-execution-picker';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { createRoutineStepAuthor } from './routine-step-author';
import {
  openShareRoutineDialog,
  RoutineTemplatePage,
} from './routine-template';
import { RoutineTriggers } from './routine-triggers';
import { useSubRoutineWrites } from './use-sub-routine-writes';
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
  const eventRoutines = useFeatureFlag(enableEventRoutines);
  const appearanceFlag = useFeatureFlag(enableEntityAppearance);
  const back = () =>
    props.onBack ? props.onBack() : openAgentsPage(layout, 'routines');
  const open = (id: string) =>
    props.onOpen
      ? props.onOpen(id)
      : openAgentsPage(layout, 'routines', { routineId: id });
  const subRoutineWrites = useSubRoutineWrites();
  const source = createRoutineDetailSource(
    () => props.scheduleId,
    userId,
    {
      onError: (title, error) => {
        if (error === undefined) toast.alert(title);
        else toast.alert(title, { subtext: getErrorMessage(error) });
      },
      onDuplicated: (id) => {
        toast.success('Duplicated');
        open(id);
      },
      onKept: () => toast.success(t('subRoutines.kept')),
    },
    subRoutineWrites,
    () => eventRoutines().enabled
  );
  const remove = () => {
    const entity = source.entity();
    if (!entity || entity.ownerId !== userId()) return;
    // Its sub-routines are deleted with it: say how many. The page's list
    // gives the count at once; a fresh read replaces it when it arrives, as
    // in the list's row menu. A sub-routine creates none of its own.
    const note = source.routine()?.parent
      ? undefined
      : createdNote(source.subRoutines().length, source.createdCount());
    openBulkEditModal({
      view: 'delete',
      entities: [entity],
      get note() {
        return note?.();
      },
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
  const needsRevocation = () =>
    sharing().enabled &&
    source.routine()?.shareable === false &&
    ownedByViewer();
  const published = useRoutineTemplateQuery(
    () => props.scheduleId,
    () => false
  );
  const [actionsOpen, setActionsOpen] = createSignal(false);
  createEffect(
    on(
      () => (actionsOpen() && needsRevocation() ? props.scheduleId : undefined),
      (scheduleId) => {
        if (!scheduleId) return;
        fireAndForget(
          traceRoutineInteraction(
            'routine.template.status',
            scheduleId,
            (span) => readRoutineTemplateStatus(scheduleId, span)
          ),
          'routines'
        );
      }
    )
  );
  const hasPublishedSnapshot = () =>
    needsRevocation() &&
    (published.isSuccess || published.isError) &&
    Boolean(published.data);
  const unshare = useUnshareTemplateMutation({
    onSuccess: () => toast.success(t('subRoutines.stoppedSharing')),
    onError: () => toast.failure(t('subRoutines.stopSharingFailed')),
  });
  const stopSharing = () => {
    const scheduleId = props.scheduleId;
    fireAndForget(
      traceRoutineInteraction(
        'routine.stop_sharing',
        scheduleId,
        (parentSpan) => unshare.mutateAsync({ scheduleId, parentSpan })
      ),
      'routines'
    );
  };
  const retrySharing = () =>
    traceRoutineInteraction(
      'routine.template.status.retry',
      props.scheduleId,
      (span) =>
        withRoutineQueryTrace(span, (options) =>
          published.refetch({ ...options, throwOnError: true })
        )
    );
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
        onActionsOpenChange={setActionsOpen}
        identityIcon={
          <Show when={source.entity()}>
            {(entity) => (
              <EntityAppearanceTrigger
                entity={entity()}
                editable={ownedByViewer()}
              />
            )}
          </Show>
        }
        appearanceMenu={
          <Show
            when={
              appearanceFlag().enabled && ownedByViewer() && source.entity()
            }
          >
            {(entity) => <EntityAppearanceMenu entity={entity()} />}
          </Show>
        }
        defaultModel={defaultModelForPlan(hasPaidAccess())}
        decisionsEnabled
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
        onOpenItem={(item, newSplit) =>
          layout.openWithSplit(
            { type: item.block, id: item.id },
            { activate: true, preferNewSplit: newSplit }
          )
        }
        onCopyPrompt={async (prompt) => {
          const copied = await writeClipboardData({ 'text/plain': prompt });
          if (!copied) toast.alert('Could not copy prompt');
          return copied;
        }}
        onShare={
          sharing().enabled && source.routine()?.shareable ? share : undefined
        }
        onStopSharing={hasPublishedSnapshot() ? stopSharing : undefined}
        onRetrySharing={
          needsRevocation() && published.isError && !hasPublishedSnapshot()
            ? () => fireAndForget(retrySharing(), 'routines')
            : undefined
        }
        stopSharingPending={unshare.isPending}
        onCompose={compose}
        onOpenTemplate={sharing().enabled ? open : undefined}
        onOpenRoutine={open}
        slots={{
          PromptEditor: RoutinePromptEditor,
          ExecutionPicker: RoutineExecutionPicker,
          Triggers: RoutineTriggers,
          Apps: RoutineApps,
          createConnectedApps: createRoutineConnectedApps,
          createAppTargetCheck: createRoutineAppTargetCheck,
          createStepAuthor: createRoutineStepAuthor,
          createChatMetadata: createChatHistoryMetadata,
          createAgentMetadata: createAgentHistoryMetadata,
        }}
      />
    </Show>
  );
}
