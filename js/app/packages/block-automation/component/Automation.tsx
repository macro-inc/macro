import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { whenSettled } from '@core/util/whenSettled';
import { formatDateAndTime } from '@entity';
import {
  invalidateSchedules,
  useRunScheduleNowMutation,
  useScheduleHistoryQuery,
  useSchedulesQuery,
  useUpdateScheduleMutation,
} from '@queries/agent-schedule/schedules';
import { useChatQuery } from '@queries/chat';
import { debounce } from '@solid-primitives/scheduled';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
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
  WEEKDAY_OPTIONS,
} from './automationUtils';
import type { ScheduleDraft } from './types';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';

type HistoryRecord = {
  id?: string | null;
  resource_id?: string | null;
  start_time?: string | null;
  is_success?: boolean | null;
};

function HistoryRow(props: { record: HistoryRecord }) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const chatId = () => props.record.resource_id ?? undefined;
  const chatQuery = useChatQuery(chatId);
  const name = () =>
    chatQuery.data?.chat?.name?.trim() ||
    (chatQuery.isLoading ? '' : 'Untitled run');

  const clickable = () => Boolean(chatId());
  // Synthetic pending rows (no id) are inserted by the websocket sync on
  // `started` and replaced on `stopped`. Treat them as neutral rather than
  // failures — the panel header already surfaces running state.
  const isPending = () => !props.record.id;

  return (
    <div
      class={cn(
        'flex items-center gap-2 border-b border-edge-muted px-3 py-2 text-sm',
        clickable() ? 'cursor-default hover:bg-hover' : 'cursor-default'
      )}
      onClick={() => {
        const id = chatId();
        if (id) replaceOrInsertSplit({ type: 'chat', id });
      }}
    >
      <div class="size-4 shrink-0">
        <EntityIcon targetType="chat" size="xs" />
      </div>
      <span class="min-w-0 flex-1 truncate">{name()}</span>
      <span
        class={cn(
          'ml-auto shrink-0 text-xs font-mono uppercase font-light',
          isPending() || props.record.is_success
            ? 'text-ink-extra-muted'
            : 'text-failure'
        )}
      >
        {formatDateAndTime(props.record.start_time ?? new Date())}
      </span>
    </div>
  );
}

function HistoryList(props: { records: HistoryRecord[]; isPending: boolean }) {
  return (
    <Show
      when={props.records.length > 0}
      fallback={
        <Show
          when={!props.isPending}
          fallback={
            <div class="px-3 py-8 text-center text-xs text-ink-muted">
              Loading…
            </div>
          }
        >
          <div class="px-3 py-8 text-center text-xs text-ink-muted">
            No runs yet.
          </div>
        </Show>
      }
    >
      <div class="min-h-0 h-full overflow-y-scroll">
        <For each={props.records.slice(0, 50)}>
          {(record) => <HistoryRow record={record} />}
        </For>
      </div>
    </Show>
  );
}

export function Automation() {
  const scheduleId = useBlockId();
  const panel = useSplitPanelOrThrow();

  const schedulesQuery = useSchedulesQuery(() => true);
  const schedule = createMemo(() =>
    schedulesQuery.data?.find((item) => item.id === scheduleId)
  );

  const [state, setRawState] = createSignal<ScheduleDraft | undefined>();

  const currentSummary = createMemo(() => {
    const d = state();
    if (!d) return '';
    return describeSchedule(d, getDefaultTimezone());
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

  const updateMutation = useUpdateScheduleMutation({
    onError: (error) =>
      toast.alert('Failed to update automation', getErrorMessage(error)),
  });

  const save = () => {
    if (formError()) return;
    const d = state();
    const previous = schedule();
    if (!d || !previous) return;
    updateMutation.mutate({
      scheduleId,
      body: draftToUpdateBody(d, previous),
    });
  };

  const debouncedSave = debounce(save, 300);

  const setState = (update: (prev: ScheduleDraft) => ScheduleDraft) => {
    const current = state();
    if (!current) return;
    const next = update(current);
    setRawState(next);
    if (next.name !== current.name) {
      panel.handle.setDisplayName(next.name);
    }
    debouncedSave();
  };

  whenSettled(schedulesQuery, () => {
    const current = schedule();
    if (!current) return;
    setRawState(draftFromSchedule(current));
    panel.handle.setDisplayName(current.name);
  });

  const historyQuery = useScheduleHistoryQuery(
    () => scheduleId,
    () => true
  );
  const history = createMemo(() => historyQuery.data ?? []);

  const [renameOpen, setRenameOpen] = createSignal(false);

  const runNowMutation = useRunScheduleNowMutation({
    onError: (error) =>
      toast.alert('Failed to start run', getErrorMessage(error)),
  });

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
    invalidateSchedules();
  });

  return (
    <Show
      when={state()}
      fallback={
        <Show
          when={!schedulesQuery.isPending && !schedule()}
          fallback={
            <div class="flex size-full items-center justify-center text-xs text-ink-muted">
              Loading…
            </div>
          }
        >
          <div class="flex size-full items-center justify-center text-xs text-ink-muted">
            Automation not found.
          </div>
        </Show>
      }
    >
      {(d) => (
        <>
          <SplitHeaderLeft>
            <div class="z-page-overlay relative flex h-full w-screen max-w-full shrink items-center gap-2">
              <EntityIcon class="shrink-0" targetType="automation" size="xs" />
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
            </div>
          </SplitHeaderLeft>
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
                  disabled={runNowMutation.isPending || isRunning()}
                  onClick={() => runNowMutation.mutate({ scheduleId })}
                >
                  Run Now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  class="cursor-default"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      enabled: !current.enabled,
                    }))
                  }
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
              <HistoryList
                records={history()}
                isPending={historyQuery.isPending}
              />
            </div>
          </div>
        </>
      )}
    </Show>
  );
}
