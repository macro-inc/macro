import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
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
import { formatDateAndTime } from '@entity';
import CopyIcon from '@phosphor/copy.svg';
import RenameIcon from '@phosphor/pencil-line.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import { scheduleToEntity } from '@queries/agent-schedule/entities';
import {
  invalidateSchedules,
  useCreateScheduleMutation,
  useRunScheduleNowMutation,
  useScheduleHistoryQuery,
  useSchedulesQuery,
  useUpdateScheduleMutation,
} from '@queries/agent-schedule/schedules';
import { getCronTrigger } from '@queries/agent-schedule/triggers';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { useChatQuery } from '@queries/chat';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { createRoutineAutosave } from '../primitives/routine-autosave';
import { RoutineExecutionPicker } from '../routine-execution-picker';
import { type HistoryMetadata, RoutineHistory } from '../views/routine-history';
import { AutomationPromptEditor } from './AutomationPromptEditor';
import { AutomationRenameModal } from './AutomationRenameModal';
import { AutomationTimePicker } from './AutomationTimePicker';
import {
  describeSchedule,
  draftFromSchedule,
  draftToUpdateBody,
  FREQUENCY_OPTIONS,
  getDefaultTimezone,
  getErrorMessage,
  INPUT_CLASS,
  isValidTime,
  scheduleToDuplicateBody,
  WEEKDAY_OPTIONS,
} from './automationUtils';
import type { ScheduleDraft } from './types';

type SaveIntent =
  | { type: 'edit'; draft: ScheduleDraft }
  | { type: 'pause'; draft: ScheduleDraft };

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
  const panel = useSplitPanelOrThrow();
  const { openWithSplit, replaceOrInsertSplit } = useSplitLayout();

  const schedulesQuery = useSchedulesQuery(() => true);
  const schedule = createMemo(() =>
    schedulesQuery.isSuccess || schedulesQuery.isError
      ? schedulesQuery.data?.find((item) => item.id === scheduleId)
      : undefined
  );
  const cronTrigger = () => {
    const current = schedule();
    return current ? getCronTrigger(current) : undefined;
  };
  const scheduleEntity = () => {
    const current = schedule();
    return current ? scheduleToEntity(current) : undefined;
  };

  const [state, setRawState] = createSignal<ScheduleDraft | undefined>();

  const currentSummary = createMemo(() => {
    const d = state();
    if (!d) return '';
    return describeSchedule(d, cronTrigger()?.timezone ?? getDefaultTimezone());
  });

  const formError = createMemo(() => {
    const d = state();
    if (!d) return null;
    if (!d.prompt.trim()) return 'Prompt is required.';
    if (!isValidTime(d.time)) return 'Choose a valid time.';
    if (d.frequency === 'week' && d.daysOfWeek.length === 0) {
      return 'Select at least one day.';
    }
    if (d.frequency === 'month') {
      const day = Number(d.dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return 'Pick a day between 1 and 31';
      }
    }
    return null;
  });

  const updateMutation = useUpdateScheduleMutation();
  const autosave = createRoutineAutosave<SaveIntent>(async (intent) => {
    const previous = schedule();
    if (!previous || !getCronTrigger(previous)) {
      throw new Error('This routine is no longer editable.');
    }
    const body =
      intent.type === 'pause'
        ? {
            name: previous.name,
            trigger: previous.trigger,
            kind: previous.kind,
            task: previous.task,
            enabled: false,
          }
        : draftToUpdateBody(intent.draft, previous);
    if (!body) throw new Error('Choose a valid execution target.');
    if (intent.type === 'pause' && state() === intent.draft) {
      // A preceding write may have changed the saved configuration while queued.
      setRawState(draftFromSchedule({ ...previous, enabled: false }));
    }
    await updateMutation.mutateAsync({ scheduleId, body });
  });

  function setState(update: (prev: ScheduleDraft) => ScheduleDraft): void {
    const current = state();
    if (!current || !cronTrigger() || isRunning()) return;
    const next = update(current);
    setRawState(next);
    if (next.name !== current.name) {
      panel.handle.setDisplayName(next.name);
    }
    autosave.queue(formError() ? undefined : { type: 'edit', draft: next });
  }

  function toggleEnabled(): void {
    const previous = schedule();
    if (!previous || !cronTrigger()) return;
    if (!isRunning()) {
      setState((current) => ({ ...current, enabled: !current.enabled }));
      return;
    }
    // A running action only accepts disabling with its exact saved configuration.
    const saved = draftFromSchedule(previous);
    if (!saved || !previous.enabled) return;
    const paused = { ...saved, enabled: false };
    setRawState(paused);
    autosave.queue({ type: 'pause', draft: paused });
  }

  function runNow(): void {
    if (
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
    () => Boolean(cronTrigger())
  );
  const history = createMemo(() =>
    historyQuery.isSuccess ? (historyQuery.data ?? []) : []
  );

  const [renameOpen, setRenameOpen] = createSignal(false);

  const runNowMutation = useRunScheduleNowMutation({
    onError: (error) =>
      toast.alert('Failed to start run', { subtext: getErrorMessage(error) }),
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
    if (!entity) return;
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

  // Treat an action as "running" when the server has a fresh claim on it.
  // The backend's MAX_ACTION_TIME is 20 minutes — after that a claim is
  // considered stale (e.g. executor crashed) and we stop showing the
  // running indicator. The websocket sync patches `claimed` live; GETs seed
  // it on page load.
  const MAX_CLAIMED_MS = 20 * 60 * 1000;
  const isRunning = createMemo(() => {
    const claimed = schedule()?.claimed;
    if (!claimed) return false;
    return Date.now() - Date.parse(claimed) < MAX_CLAIMED_MS;
  });

  onMount(() => {
    void invalidateSchedules();
  });

  return (
    <Show
      when={cronTrigger() && state()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-ink-muted">
          <Switch fallback={<>Automation not found.</>}>
            <Match when={schedulesQuery.isError && !schedule()}>
              Unable to load automation. Please try again.
            </Match>
            <Match when={schedulesQuery.isPending}>Loading…</Match>
            <Match when={schedule() && !cronTrigger()}>
              <h1 class="font-semibold text-ink">Backend-managed routine</h1>
              <p>
                Event-triggered routines cannot be edited or duplicated here.
                Manage this routine through the API. This editor only supports
                cron schedules.
              </p>
            </Match>
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
                  onDblClick={() => setRenameOpen(true)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setRenameOpen(true);
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
                {
                  group: 'file',
                  label: 'Rename',
                  icon: RenameIcon,
                  action: () => setRenameOpen(true),
                },
                {
                  group: 'file',
                  label: 'Duplicate',
                  icon: CopyIcon,
                  action: duplicateAutomation,
                },
                {
                  group: 'delete',
                  label: 'Delete',
                  icon: TrashIcon,
                  action: deleteAutomation,
                },
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

          <div class="flex min-h-0 size-full cursor-default flex-col text-ink">
            <div class="flex shrink-0 flex-col gap-3 p-3">
              <div class="flex items-center gap-2">
                <Button
                  variant="accent"
                  size="sm"
                  class="cursor-default"
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
                <Button
                  variant="outline"
                  size="sm"
                  class="cursor-default"
                  disabled={isRunning() && !d().enabled}
                  onClick={toggleEnabled}
                >
                  {d().enabled ? 'Pause' : 'Resume'}
                </Button>
                <div class="ml-auto text-xs font-mono text-right uppercase font-light">
                  <Show
                    when={isRunning()}
                    fallback={
                      <span class="text-ink-extra-muted">
                        <Show
                          when={d().enabled && schedule()?.next_run_at}
                          fallback={<>Paused</>}
                        >
                          {(nextRunAt) => (
                            <>Next run {formatDateAndTime(nextRunAt())}</>
                          )}
                        </Show>
                      </span>
                    }
                  >
                    <span class="flex items-center justify-end gap-1.5 text-accent">
                      <span class="size-1.5 animate-pulse rounded-full bg-accent" />
                      Running
                    </span>
                  </Show>
                </div>
              </div>

              <div class="grid gap-1.5">
                <h1 class="text-sm font-semibold">Execution target</h1>
                <RoutineExecutionPicker
                  target={d().target}
                  onChange={(target) =>
                    setState((current) => ({ ...current, target }))
                  }
                />
                <Show when={isRunning()}>
                  <p class="text-xs text-ink-muted">
                    Configuration cannot be changed while running.
                  </p>
                </Show>
              </div>

              <div class="grid gap-1.5">
                <h1 class="text-sm font-semibold">Instructions</h1>
                <AutomationPromptEditor
                  initialValue={d().prompt}
                  onChange={(markdown) =>
                    setState((current) => ({
                      ...current,
                      prompt: markdown,
                    }))
                  }
                />
              </div>

              <div>
                <h1 class="text-sm font-semibold">Schedule</h1>
                <p class="mt-0.5 text-xs text-ink-muted">{currentSummary()}</p>
              </div>

              <div class="flex flex-wrap gap-1">
                <For each={FREQUENCY_OPTIONS}>
                  {(option) => (
                    <button
                      type="button"
                      class={cn(
                        'cursor-default border rounded-sm px-2 py-1 text-xs transition-colors',
                        d().frequency === option.value
                          ? 'border-accent/30 bg-accent/10 text-accent'
                          : 'border-edge-muted text-ink-muted hover:bg-hover'
                      )}
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          frequency: option.value,
                        }))
                      }
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>

              <Show when={d().frequency === 'week'}>
                <div class="grid gap-1.5">
                  <label class="text-xs font-medium text-ink-muted cursor-default">
                    Days
                  </label>
                  <div class="flex flex-wrap gap-1">
                    <For each={WEEKDAY_OPTIONS}>
                      {(option) => {
                        const active = () =>
                          d().daysOfWeek.includes(option.value);
                        return (
                          <button
                            type="button"
                            class={cn(
                              'cursor-default border rounded-sm px-2 py-1 text-xs transition-colors',
                              active()
                                ? 'border-accent/30 bg-accent/10 text-accent'
                                : 'border-edge-muted text-ink-muted hover:bg-hover'
                            )}
                            onClick={() =>
                              setState((current) => {
                                const has = current.daysOfWeek.includes(
                                  option.value
                                );
                                return {
                                  ...current,
                                  daysOfWeek: has
                                    ? current.daysOfWeek.filter(
                                        (v) => v !== option.value
                                      )
                                    : [...current.daysOfWeek, option.value],
                                };
                              })
                            }
                          >
                            {option.label}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={d().frequency === 'month'}>
                <div class="grid gap-1.5">
                  <label class="text-xs font-medium text-ink-muted cursor-default">
                    Day of Month
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    class={INPUT_CLASS}
                    value={d().dayOfMonth}
                    onInput={(event) =>
                      setState((current) => ({
                        ...current,
                        dayOfMonth: event.currentTarget.value,
                      }))
                    }
                  />
                </div>
              </Show>

              <div class="grid gap-1.5">
                <label class="text-xs font-medium text-ink-muted cursor-default">
                  Time
                </label>
                <AutomationTimePicker
                  value={d().time}
                  onChange={(value) =>
                    setState((current) => ({
                      ...current,
                      time: value,
                    }))
                  }
                />
              </div>

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
                  <div class="border border-failure/20 bg-failure/5 rounded-sm px-2 py-1.5 text-xs text-failure">
                    {message()}
                  </div>
                )}
              </Show>
            </div>

            <div class="flex min-h-0 flex-1 flex-col">
              <div class="border-b border-edge-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                History
              </div>
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
          </div>
        </>
      )}
    </Show>
  );
}
