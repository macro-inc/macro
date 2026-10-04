import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import CopyIcon from '@phosphor/copy.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import {
  isClaimActive,
  scheduleToEntity,
} from '@queries/agent-schedule/entities';
import { useRoutineQuery } from '@queries/agent-schedule/routines';
import {
  invalidateSchedules,
  useCreateScheduleMutation,
  useRunScheduleNowMutation,
  useScheduleHistoryQuery,
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
  useUpdateScheduleMutation,
} from '@queries/agent-schedule/schedules';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { useChatQuery } from '@queries/chat';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { Dropdown } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { RoutineEditor } from '../components/routine-editor';
import { RoutineRunButton } from '../components/routine-run-button';
import { hasOnlyScheduledTriggers } from '../core/routine-triggers';
import { createRoutineAutosave } from '../primitives/routine-autosave';
import { RoutineExecutionPicker } from '../routine-execution-picker';
import { RoutineTriggers } from '../routine-triggers';
import { type HistoryMetadata, RoutineHistory } from '../views/routine-history';
import { AutomationPromptEditor } from './AutomationPromptEditor';
import {
  createEmptyDraft,
  draftFromSchedule,
  draftToUpdateBody,
  formatDateTime,
  getErrorMessage,
  scheduleToDuplicateBody,
  validateRoutineDraft,
} from './automationUtils';
import type { ScheduleDraft } from './types';

class RoutineConflictError extends Error {
  constructor() {
    super(
      'This routine changed elsewhere. Reload the latest settings before editing.'
    );
  }
}

function configurationKey(routine: ScheduledAction): string {
  return JSON.stringify([
    routine.name,
    routine.kind,
    routine.trigger,
    routine.task,
  ]);
}

function createChatHistoryMetadata(id: string): Accessor<HistoryMetadata> {
  const query = useChatQuery(() => id);
  return () => {
    if (query.isPending) return { status: 'pending' };
    if (!query.isSuccess) return { status: 'unavailable' };
    const chat = query.data?.chat;
    return chat
      ? {
          status: 'ready',
          entity: {
            type: 'chat',
            id,
            name: chat.name,
            ownerId: chat.userId,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            model: chat.model,
          },
        }
      : { status: 'unavailable' };
  };
}

function createAgentHistoryMetadata(id: string): Accessor<HistoryMetadata> {
  const query = useAgentSessionQuery(() => id);
  return () => {
    if (query.isPending) return { status: 'pending' };
    if (!query.isSuccess) return { status: 'unavailable' };
    const session = query.data;
    return session
      ? {
          status: 'ready',
          entity: {
            type: 'agent_session',
            id,
            name: session.name,
            ownerId: session.ownerId,
            botId: session.botId,
            harness: session.harness,
            isArchived: session.isArchived,
            createdAt: session.createdAt,
            updatedAt: session.modifiedAt,
            status:
              session.status.kind === 'event'
                ? session.status.event
                : session.status.kind,
          },
        }
      : { status: 'unavailable' };
  };
}

export function Automation() {
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
  const scheduleId = props.scheduleId;
  const userId = useUserId();
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const { openWithSplit } = layout;

  const schedulesQuery = useSchedulesQuery(() => true);
  const routineQuery = useRoutineQuery(() => scheduleId);
  const ownedSchedule = createMemo(() =>
    schedulesQuery.isSuccess || schedulesQuery.isError
      ? schedulesQuery.data?.find((item) => item.id === scheduleId)
      : undefined
  );
  const schedule = () =>
    (routineQuery.isSuccess || routineQuery.isError
      ? routineQuery.data
      : undefined) ?? ownedSchedule();
  const isOwned = () => schedule()?.owner === userId();
  const [tab, setTab] = createSignal<'settings' | 'history'>(
    props.initialTab ?? 'settings'
  );
  const editableTrigger = () => Boolean(schedule());
  const back = () =>
    props.onBack ? props.onBack() : openAgentsPage(layout, 'routines');
  const open = (id: string) =>
    props.onOpen
      ? props.onOpen(id)
      : openAgentsPage(layout, 'routines', { routineId: id });
  const scheduleEntity = () => {
    const current = schedule();
    return current ? scheduleToEntity(current) : undefined;
  };
  const isRunning = () => isClaimActive(schedule()?.claimed);
  const isActive = () => schedule()?.enabled ?? false;

  const [state, setRawState] = createSignal<ScheduleDraft | undefined>();
  const [editorVersion, setEditorVersion] = createSignal(0);
  let baselineRevision = 0;
  let baselineKey = '';

  const isCompleted = () =>
    hasOnlyScheduledTriggers(state()?.triggers) &&
    !schedule()?.next_run_at &&
    !isRunning();

  const formError = () => {
    const draft = state();
    return draft ? validateRoutineDraft(draft) : null;
  };

  const updateMutation = useUpdateScheduleMutation();
  const autosave = createRoutineAutosave<ScheduleDraft>(async (draft) => {
    const previous = schedule();
    if (!previous || !editableTrigger()) {
      throw new Error('This routine is no longer editable.');
    }
    if (
      previous.configuration_revision > baselineRevision &&
      configurationKey(previous) !== baselineKey
    )
      throw new RoutineConflictError();
    const body = draftToUpdateBody(draft, previous);
    if (!body) throw new Error('Choose a valid execution target.');
    const saved = await updateMutation.mutateAsync({ scheduleId, body });
    baselineRevision = saved.configuration_revision;
    baselineKey = configurationKey(saved);
  });

  function setState(update: (prev: ScheduleDraft) => ScheduleDraft): void {
    const current = state();
    if (!isOwned() || !current || !editableTrigger() || isRunning()) return;
    const next = update(current);
    if (next === current) return;
    setRawState(next);
    if (next.name !== current.name) {
      if (!props.onBack) panel.handle.setDisplayName(next.name);
    }
    autosave.queue(formError() ? undefined : next);
  }

  function runNow(): void {
    if (
      !isOwned() ||
      !editableTrigger() ||
      !state() ||
      formError() ||
      autosave.dirty() ||
      autosave.saving() ||
      runNowMutation.isPending ||
      isRunning()
    )
      return;
    runNowMutation.mutate({ scheduleId });
  }

  function initializeDraft(): void {
    const current = schedule();
    if (!current) return;
    baselineRevision = current.configuration_revision;
    baselineKey = configurationKey(current);
    setRawState(draftFromSchedule(current));
    setEditorVersion((version) => version + 1);
    if (!props.onBack) panel.handle.setDisplayName(current.name);
  }

  // A server revision refreshes clean settings, while a pending edit keeps its
  // original revision so a conflicting remote change cannot be overwritten.
  createEffect(
    on(
      () => schedule()?.configuration_revision,
      (revision) => {
        if (revision === undefined) return;
        if (
          !state() ||
          (revision > baselineRevision &&
            !autosave.dirty() &&
            !autosave.saving())
        )
          initializeDraft();
      }
    )
  );

  const historyQuery = useScheduleHistoryQuery(
    () => scheduleId,
    () => Boolean(schedule())
  );
  const history = createMemo(() =>
    historyQuery.isSuccess ? (historyQuery.data ?? []) : []
  );

  const runNowMutation = useRunScheduleNowMutation({
    onError: (error) =>
      toast.alert('Failed to start run', { subtext: getErrorMessage(error) }),
  });

  const setEnabledMutation = useSetScheduleEnabledMutation({
    onError: (error) =>
      toast.alert('Failed to update routine', {
        subtext: getErrorMessage(error),
      }),
  });

  const duplicateMutation = useCreateScheduleMutation({
    onSuccess: (created) => {
      toast.success('Duplicated');
      if (created.id) {
        open(created.id);
      }
    },
    onError: (error) =>
      toast.alert('Failed to duplicate routine', {
        subtext: getErrorMessage(error),
      }),
  });

  const duplicateAutomation = () => {
    const current = schedule();
    if (!current || !editableTrigger() || duplicateMutation.isPending) return;
    const body = scheduleToDuplicateBody(current);
    if (!body) return;
    duplicateMutation.mutate(body);
  };

  // Confirms via the shared bulk-delete modal, which routes automations to
  // the scheduled-action API and evicts them from the schedules cache.
  const deleteAutomation = () => {
    const entity = scheduleEntity();
    if (!isOwned() || !entity) return;
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

  onMount(() => {
    void invalidateSchedules();
  });

  const nextRun = () => {
    if (!isActive()) return 'Paused';
    const next = schedule()?.next_run_at;
    if (next) return formatDateTime(next);
    if (isRunning()) return 'Running now';
    if (isCompleted()) return 'No upcoming runs';
    return 'On the next matching event';
  };

  const runDisabled = () =>
    !isOwned() ||
    runNowMutation.isPending ||
    isRunning() ||
    autosave.dirty() ||
    autosave.saving() ||
    Boolean(formError()) ||
    !state();
  const activationDisabled = () =>
    !isOwned() ||
    setEnabledMutation.isPending ||
    (!isActive() && (isCompleted() || runDisabled()));
  const copyPrompt = async () => {
    const prompt = state()?.prompt;
    if (!prompt) return;
    if (await writeClipboardData({ 'text/plain': prompt })) {
      toast.success('Prompt copied');
    } else {
      toast.alert('Could not copy prompt');
    }
  };

  return (
    <Show
      when={schedule()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-ink-muted">
          <Switch fallback={<>Routine not found.</>}>
            <Match when={routineQuery.isError && !schedule()}>
              Unable to load routine. Please try again.
            </Match>
            <Match when={routineQuery.isPending}>Loading…</Match>
          </Switch>
        </div>
      }
    >
      {(routine) => (
        <RoutineEditor
          draft={state() ?? { ...createEmptyDraft(), name: routine().name }}
          onChange={setState}
          disabled={!isOwned() || isRunning() || !state()}
          tab={tab()}
          onTab={setTab}
          onBack={back}
          enabled={isActive()}
          runActions={
            <RoutineRunButton
              enabled={isActive()}
              runDisabled={runDisabled()}
              activationDisabled={activationDisabled()}
              copyDisabled={!state()?.prompt}
              onRun={runNow}
              onEnabled={(enabled) =>
                setEnabledMutation.mutate({ scheduleId, enabled })
              }
              onCopyPrompt={() => void copyPrompt()}
            />
          }
          actions={
            <Dropdown placement="bottom-start">
              <Dropdown.Trigger
                variant="ghost"
                size="icon-sm"
                aria-label="Routine actions"
              >
                <DotsIcon class="size-5" />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope="local">
                <Dropdown.Item
                  disabled={!state() || duplicateMutation.isPending}
                  onSelect={duplicateAutomation}
                >
                  <CopyIcon class="size-4" />
                  Duplicate
                </Dropdown.Item>
                <Show when={isOwned()}>
                  <Dropdown.Item onSelect={deleteAutomation}>
                    <TrashIcon class="size-4" />
                    Delete
                  </Dropdown.Item>
                </Show>
              </Dropdown.Content>
            </Dropdown>
          }
          nextRun={nextRun()}
          instructions={
            <Show when={state()}>
              <Show when={{ version: editorVersion() }} keyed>
                <AutomationPromptEditor
                  initialValue={state()?.prompt ?? ''}
                  onChange={(prompt) =>
                    setState((draft) =>
                      draft.prompt === prompt ? draft : { ...draft, prompt }
                    )
                  }
                />
              </Show>
            </Show>
          }
          executionPicker={
            <Show when={state()}>
              {(draft) => (
                <RoutineExecutionPicker
                  target={draft().target}
                  onChange={(target) =>
                    setState((current) => ({ ...current, target }))
                  }
                />
              )}
            </Show>
          }
          triggerContent={
            <Show
              when={state()}
              fallback={
                <p class="text-sm text-ink-muted">
                  This routine has an unsupported task configuration.
                </p>
              }
            >
              {(draft) => (
                <RoutineTriggers
                  triggers={draft().triggers ?? []}
                  onChange={(triggers) =>
                    setState((current) => ({ ...current, triggers }))
                  }
                />
              )}
            </Show>
          }
          feedback={
            <>
              <Show when={autosave.error()}>
                <p role="alert" class="text-sm text-failure">
                  Changes not saved. {getErrorMessage(autosave.error())}
                  <button
                    type="button"
                    class="ml-2 underline"
                    onClick={() => {
                      if (autosave.error() instanceof RoutineConflictError) {
                        autosave.cancel();
                        initializeDraft();
                      } else autosave.retry();
                    }}
                  >
                    {autosave.error() instanceof RoutineConflictError
                      ? 'Reload latest'
                      : 'Retry save'}
                  </button>
                </p>
              </Show>
              <Show when={formError()}>
                {(message) => (
                  <p role="alert" class="text-sm text-failure">
                    {message()}
                  </p>
                )}
              </Show>
              <Show when={isRunning()}>
                <p class="text-xs text-ink-muted">
                  Running. Configuration cannot be changed while running.
                </p>
              </Show>
            </>
          }
          history={
            <>
              <Show when={historyQuery.isError}>
                <p role="alert" class="px-4 py-3 text-sm text-failure">
                  Could not load run history.{' '}
                  <button
                    class="underline"
                    onClick={() => void historyQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              </Show>
              <RoutineHistory
                records={history()}
                isPending={historyQuery.isPending}
                createChatMetadata={createChatHistoryMetadata}
                createAgentMetadata={createAgentHistoryMetadata}
                onOpen={(resource, newSplit) =>
                  openWithSplit(resource, {
                    activate: true,
                    preferNewSplit: newSplit,
                  })
                }
              />
            </>
          }
        />
      )}
    </Show>
  );
}
