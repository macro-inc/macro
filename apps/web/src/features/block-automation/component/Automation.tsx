import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { createSearchParams } from '@app/lib/split-router';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { SplitTitleFileMenu } from '@components/app/split-layout/components/SplitLabel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  returnSplitToRecentListView,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import { formatDateAndTime } from '@entity';
import CopyIcon from '@phosphor/copy.svg';
import RenameIcon from '@phosphor/pencil-line.svg';
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
import { getCronTrigger } from '@queries/agent-schedule/triggers';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { useChatQuery } from '@queries/chat';
import { Button, cn, ToggleSwitch } from '@ui';
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
import { match } from 'ts-pattern';
import { createRoutineAutosave } from '../primitives/routine-autosave';
import { RoutineExecutionPicker } from '../routine-execution-picker';
import { routineSearch } from '../routine-search';
import { RoutineSharing } from '../routine-sharing';
import { type HistoryMetadata, RoutineHistory } from '../views/routine-history';
import { AutomationPromptEditor } from './AutomationPromptEditor';
import { AutomationRenameModal } from './AutomationRenameModal';
import {
  draftFromSchedule,
  draftToUpdateBody,
  getErrorMessage,
  scheduleToDuplicateBody,
  validateRoutineDraft,
} from './automationUtils';
import { RoutineScheduleFields } from './RoutineScheduleFields';
import type { ScheduleDraft } from './types';

function createChatHistoryMetadata(id: string): Accessor<HistoryMetadata> {
  const query = useChatQuery(() => id);
  return () => {
    if (query.isPending) return { status: 'pending' };
    if (!query.isSuccess) return { status: 'unavailable' };
    const chat = query.data?.chat;
    return chat
      ? { status: 'ready', name: chat.name }
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
      ? { status: 'ready', name: session.name }
      : { status: 'unavailable' };
  };
}

export function Automation() {
  const scheduleId = useBlockId();
  const userId = useUserId();
  const panel = useSplitPanelOrThrow();
  const { openWithSplit, replaceOrInsertSplit } = useSplitLayout();

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
  const [search, setSearch] = createSearchParams(routineSearch);
  const tab = () => search.tab;
  const setTab = (tab: 'settings' | 'history') => setSearch({ tab });
  const cronTrigger = () => {
    const current = schedule();
    return current ? getCronTrigger(current) : undefined;
  };
  const scheduleEntity = () => {
    const current = schedule();
    return current ? scheduleToEntity(current) : undefined;
  };
  const status = () => scheduleEntity()?.status;
  const isRunning = () => isClaimActive(schedule()?.claimed);
  const isActive = () => schedule()?.enabled ?? false;

  const [state, setRawState] = createSignal<ScheduleDraft | undefined>();

  const isCompleted = () =>
    state()?.frequency === 'once' && !schedule()?.next_run_at && !isRunning();

  const formError = () => {
    const draft = state();
    return draft ? validateRoutineDraft(draft) : null;
  };

  const updateMutation = useUpdateScheduleMutation();
  const autosave = createRoutineAutosave<ScheduleDraft>(async (draft) => {
    const previous = schedule();
    if (!previous || !getCronTrigger(previous)) {
      throw new Error('This routine is no longer editable.');
    }
    const body = draftToUpdateBody(draft, previous);
    if (!body) throw new Error('Choose a valid execution target.');
    await updateMutation.mutateAsync({ scheduleId, body });
  });

  function setState(update: (prev: ScheduleDraft) => ScheduleDraft): void {
    const current = state();
    if (!isOwned() || !current || !cronTrigger() || isRunning()) return;
    const next = update(current);
    setRawState(next);
    if (next.name !== current.name) {
      panel.handle.setDisplayName(next.name);
    }
    autosave.queue(formError() ? undefined : next);
  }

  function runNow(): void {
    if (
      !isOwned() ||
      !cronTrigger() ||
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
    setRawState(draftFromSchedule(current));
    panel.handle.setDisplayName(current.name);
  }

  // Only entering/leaving cron editing resets the draft, never save responses.
  const cronEditable = createMemo(() => Boolean(cronTrigger()));
  createEffect(
    on(cronEditable, (editable) => {
      autosave.cancel();
      if (editable) initializeDraft();
      else setRawState(undefined);
    })
  );

  const historyQuery = useScheduleHistoryQuery(
    () => scheduleId,
    () => Boolean(schedule())
  );
  const history = createMemo(() =>
    historyQuery.isSuccess ? (historyQuery.data ?? []) : []
  );

  const [renameOpen, setRenameOpen] = createSignal(false);

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
        replaceOrInsertSplit(
          { type: 'automation', id: created.id },
          'entity-actions-menu'
        );
      }
    },
    onError: (error) =>
      toast.alert('Failed to duplicate automation', {
        subtext: getErrorMessage(error),
      }),
  });

  const duplicateAutomation = () => {
    const current = schedule();
    if (!current || duplicateMutation.isPending) return;
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
        returnSplitToRecentListView(panel.handle);
      },
      onError: () => toast.failure('Failed to delete'),
    });
  };

  onMount(() => {
    void invalidateSchedules();
  });

  return (
    <Show
      when={schedule()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-ink-muted">
          <Switch fallback={<>Automation not found.</>}>
            <Match when={routineQuery.isError && !schedule()}>
              Unable to load automation. Please try again.
            </Match>
            <Match when={routineQuery.isPending}>Loading…</Match>
          </Switch>
        </div>
      }
    >
      {(d) => (
        <>
          <SplitHeaderLeft>
            <HeaderIsland class="shrink">
              <div class="z-split-header-content relative flex h-full w-screen max-w-full shrink items-center gap-2">
                <EntityIcon
                  class="shrink-0"
                  targetType="automation"
                  size="xs"
                />
                <span
                  class="inline-block min-w-0 flex-1 truncate text-sm"
                  onDblClick={() => {
                    if (isOwned() && cronTrigger()) setRenameOpen(true);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (isOwned() && cronTrigger()) setRenameOpen(true);
                  }}
                >
                  {d().name || blockNameToDefaultFile('automation')}
                </span>
                <div
                  class="shrink-0 flex items-center h-full"
                  ref={(ref) => panel.setTitleFileMenuRef(ref)}
                />
              </div>
            </HeaderIsland>
          </SplitHeaderLeft>
          <SplitTitleFileMenu>
            <BlockSplitFileMenu
              id={scheduleId}
              itemType="automation"
              name={d().name || blockNameToDefaultFile('automation')}
              ops={[]}
              // Generic chrome can't reconstruct an AutomationEntity (it
              // lacks the cron), so supply it for entity-gated menu items.
              entity={scheduleEntity()}
              tools={[
                ...(isOwned() && cronTrigger()
                  ? [
                      {
                        group: 'file' as const,
                        label: 'Rename',
                        icon: RenameIcon,
                        action: () => setRenameOpen(true),
                      },
                    ]
                  : []),
                ...(cronTrigger()
                  ? [
                      {
                        group: 'file' as const,
                        label: 'Duplicate',
                        icon: CopyIcon,
                        action: duplicateAutomation,
                      },
                    ]
                  : []),
                ...(isOwned() && cronTrigger()
                  ? [
                      {
                        group: 'delete' as const,
                        label: 'Delete',
                        icon: TrashIcon,
                        action: deleteAutomation,
                      },
                    ]
                  : []),
              ]}
            />
          </SplitTitleFileMenu>
          <AutomationRenameModal
            isOpen={renameOpen}
            setIsOpen={setRenameOpen}
            name={d().name}
            onRename={(newName) =>
              setState((current) => ({ ...current, name: newName }))
            }
          />

          <div class="size-full overflow-y-auto text-ink">
            <div class="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-6 sm:px-8 sm:py-9 touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1.5rem)]">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-0">
                  <h1 class="text-xl font-medium">
                    <button
                      type="button"
                      disabled={!isOwned() || !cronTrigger()}
                      class="max-w-full truncate text-left"
                      title={cronTrigger() ? 'Rename routine' : undefined}
                      onClick={() => setRenameOpen(true)}
                    >
                      {d().name || 'Untitled routine'}
                    </button>
                  </h1>
                  <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                    <ToggleSwitch
                      label="Active"
                      labelClass="text-xs text-ink-muted"
                      checked={isActive()}
                      disabled={
                        !isOwned() ||
                        isCompleted() ||
                        setEnabledMutation.isPending ||
                        (isRunning() && !isActive())
                      }
                      onChange={(active) =>
                        setEnabledMutation.mutate({
                          scheduleId,
                          enabled: active,
                        })
                      }
                    />
                    <Show when={isCompleted()}>
                      <span>Completed</span>
                    </Show>
                    <Show when={!isOwned()}>
                      <span>Shared with your team · View only</span>
                    </Show>
                    {match(status())
                      .with({ kind: 'running' }, () => (
                        <span class="text-accent">Running</span>
                      ))
                      .with({ kind: 'scheduled' }, ({ nextRunAt }) => (
                        <span>Next run {formatDateAndTime(nextRunAt)}</span>
                      ))
                      .otherwise(() => undefined)}
                  </div>
                </div>
                <Show when={isOwned() && cronTrigger()}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      runNowMutation.isPending ||
                      isRunning() ||
                      autosave.dirty() ||
                      autosave.saving() ||
                      Boolean(formError())
                    }
                    onClick={runNow}
                  >
                    Run Now
                  </Button>
                </Show>
              </div>
              <div
                class="flex items-center gap-1 border-b border-edge-muted pb-3"
                role="tablist"
                aria-label="Routine details"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === 'settings'}
                  class={cn(
                    'rounded-md px-3 py-1.5 text-sm',
                    tab() === 'settings'
                      ? 'bg-hover text-ink'
                      : 'text-ink-muted hover:bg-hover'
                  )}
                  onClick={() => setTab('settings')}
                >
                  Settings
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === 'history'}
                  class={cn(
                    'rounded-md px-3 py-1.5 text-sm',
                    tab() === 'history'
                      ? 'bg-hover text-ink'
                      : 'text-ink-muted hover:bg-hover'
                  )}
                  onClick={() => setTab('history')}
                >
                  Run History
                </button>
                <Show when={tab() === 'settings' && isOwned() && cronTrigger()}>
                  <span
                    role="status"
                    class="ml-auto text-xs text-ink-extra-muted"
                  >
                    {autosave.saving()
                      ? 'Saving…'
                      : autosave.dirty()
                        ? 'Unsaved changes'
                        : 'All changes saved'}
                  </span>
                </Show>
              </div>
              <Show when={tab() === 'settings'}>
                <div role="tabpanel" aria-label="Settings" class="grid gap-7">
                  <Show
                    when={state()}
                    fallback={
                      <p class="text-sm text-ink-muted">
                        This routine runs when its configured events occur.
                        Event triggers and instructions are managed through the
                        API.
                      </p>
                    }
                  >
                    {(draft) => (
                      <fieldset
                        disabled={!isOwned() || isRunning()}
                        inert={!isOwned() || isRunning()}
                        class="grid min-w-0 gap-7"
                      >
                        <section class="grid gap-3">
                          <h2 class="text-sm font-medium">Schedule</h2>
                          <div class="rounded-lg border border-edge-muted p-4">
                            <RoutineScheduleFields
                              draft={draft()}
                              onChange={setState}
                            />
                          </div>
                        </section>
                        <section class="grid gap-3">
                          <h2 class="text-sm font-medium">
                            Agent instructions
                          </h2>
                          <AutomationPromptEditor
                            initialValue={draft().prompt}
                            onChange={(prompt) => {
                              if (prompt === state()?.prompt) return;
                              setState((current) => ({ ...current, prompt }));
                            }}
                          />
                          <RoutineExecutionPicker
                            target={draft().target}
                            onChange={(target) =>
                              setState((current) => ({ ...current, target }))
                            }
                          />
                        </section>
                      </fieldset>
                    )}
                  </Show>
                  <Show when={isRunning()}>
                    <p class="text-xs text-ink-muted">
                      Configuration cannot be changed while running.
                    </p>
                  </Show>
                  <Show when={autosave.error()}>
                    <div role="alert" class="text-xs text-failure">
                      Changes not saved. {getErrorMessage(autosave.error())}
                      <button
                        type="button"
                        class="ml-2 underline"
                        onClick={autosave.retry}
                      >
                        Retry save
                      </button>
                    </div>
                  </Show>
                  <Show when={formError()}>
                    {(message) => (
                      <p class="text-xs text-failure">{message()}</p>
                    )}
                  </Show>
                  <Show when={isOwned()}>
                    <section class="border-t border-edge-muted pt-5">
                      <RoutineSharing id={scheduleId} />
                    </section>
                  </Show>
                </div>
              </Show>
              <Show when={tab() === 'history'}>
                <div
                  role="tabpanel"
                  aria-label="Run History"
                  class="overflow-hidden rounded-lg border border-edge-muted"
                >
                  <Show when={historyQuery.isError}>
                    <div role="alert" class="p-4 text-sm text-failure">
                      Could not load run history.{' '}
                      <button
                        class="underline"
                        onClick={() => void historyQuery.refetch()}
                      >
                        Retry
                      </button>
                    </div>
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
                </div>
              </Show>
            </div>
          </div>
        </>
      )}
    </Show>
  );
}
