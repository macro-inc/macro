import { useSplitLayout } from '@app/component/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { useCreateScheduleMutation } from '@queries/agent-schedule/schedules';
import { debounce } from '@solid-primitives/scheduled';
import { Dialog, Button, Panel } from '@ui';
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import {
  clearAutomationComposerDraft,
  loadAutomationComposerDraft,
  saveAutomationComposerDraft,
} from '../util/automationComposerStorage';
import { AutomationPromptEditor } from './AutomationPromptEditor';
import { AutomationTimePicker } from './AutomationTimePicker';
import {
  createEmptyDraft,
  describeSchedule,
  draftToCreateBody,
  FREQUENCY_OPTIONS,
  getDefaultTimezone,
  getErrorMessage,
  INPUT_CLASS,
  isValidTime,
  WEEKDAY_OPTIONS,
} from './automationUtils';
import type { ScheduleDraft } from './types';

/**
 * Open/close signal for the automation composer modal. Flip to `true` from
 * anywhere (e.g. launcher / unified-list create button) to pop the dialog.
 */
export const [automationComposerOpen, setAutomationComposerOpen] =
  createControlledOpenSignal(false, { id: 'automation-composer' });

/**
 * Create-only automation composer modal. Mount once (see Layout.tsx) — the
 * dialog is driven by the `automationComposerOpen` signal.
 */
export function AutomationComposer() {
  const { openWithSplit } = useSplitLayout();

  const [draft, setRawDraft] = createSignal<ScheduleDraft>(createEmptyDraft());
  const [submitAttempted, setSubmitAttempted] = createSignal(false);
  // Snapshots the prompt value at dialog-open time so the editor gets a
  // stable initialValue per open (the editor only reads it on mount).
  const [initialPrompt, setInitialPrompt] = createSignal('');

  const setDraft = (
    update: ScheduleDraft | ((prev: ScheduleDraft) => ScheduleDraft)
  ) => {
    setRawDraft(update as typeof update & ScheduleDraft);
  };

  let skipNextSave = false;
  const debouncedSave = debounce(saveAutomationComposerDraft, 300);

  createEffect(
    on(automationComposerOpen, (open) => {
      if (!open) return;
      const loaded = loadAutomationComposerDraft();
      const next = loaded ?? createEmptyDraft();
      skipNextSave = true;
      setRawDraft(next);
      setInitialPrompt(next.prompt);
      setSubmitAttempted(false);
    })
  );

  createEffect(() => {
    const current = draft();
    if (skipNextSave) {
      skipNextSave = false;
      return;
    }
    debouncedSave(current);
  });

  const currentSummary = createMemo(() =>
    describeSchedule(draft(), getDefaultTimezone())
  );

  const formError = createMemo(() => {
    if (!draft().prompt.trim()) return 'Prompt is required.';
    if (!isValidTime(draft().time)) return 'Choose a valid time.';
    if (draft().frequency === 'week' && draft().daysOfWeek.length === 0) {
      return 'Select at least one day.';
    }
    if (draft().frequency === 'month') {
      const day = Number(draft().dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return 'Pick a day between 1 and 31.';
      }
    }
    return null;
  });

  const createMutation = useCreateScheduleMutation({
    onSuccess: async (schedule) => {
      clearAutomationComposerDraft();
      setAutomationComposerOpen(false, false);
      if (schedule.id) {
        openWithSplit(
          { type: 'automation', id: schedule.id },
          { referredFrom: 'launcher' }
        );
      }
      toast.success('Automation created', 'The automation is now scheduled.');
    },
    onError: (error) => {
      toast.alert('Failed to create automation', getErrorMessage(error));
    },
  });

  const handleCreate = () => {
    const error = formError();
    if (error) {
      setSubmitAttempted(true);
      return;
    }
    createMutation.mutate(draftToCreateBody(draft()));
  };

  const toggleClass = (active: boolean) =>
    cn(
      'cursor-default border rounded-sm px-2 py-1 text-xs transition-colors',
      active
        ? 'border-accent/30 bg-accent/10 text-accent'
        : 'border-edge-muted text-ink-muted hover:bg-hover'
    );

  return (
    <Dialog
      open={automationComposerOpen()}
      onOpenChange={(open) => setAutomationComposerOpen(open, false)}
    >
      <Panel depth={2} active>
        <div class="*:max-h-[75vh]">
          <div class="flex cursor-default flex-col text-ink">
            <div class="flex items-center justify-between border-b border-edge-muted px-3 py-2">
              <Dialog.Title class="m-0 p-0 text-sm font-semibold">
                New Automation
              </Dialog.Title>
              <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                &times;
              </Dialog.CloseButton>
            </div>

            <div class="grid max-h-[70vh] gap-3 overflow-y-auto px-3 py-3">
              <div class="grid gap-1.5">
                <label class="text-xs font-medium text-ink-muted cursor-default">
                  Name
                </label>
                <input
                  class={INPUT_CLASS}
                  placeholder="e.g. Morning standup summary"
                  value={draft().name}
                  onInput={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.currentTarget.value,
                    }))
                  }
                />
              </div>

              <div class="grid gap-1.5">
                <label class="text-xs font-medium text-ink-muted cursor-default">
                  Instructions
                </label>
                <AutomationPromptEditor
                  initialValue={initialPrompt()}
                  onChange={(markdown) =>
                    setDraft((current) => ({
                      ...current,
                      prompt: markdown,
                    }))
                  }
                />
              </div>

              <div class="grid gap-3 border border-edge-muted rounded-sm p-3">
                <div>
                  <p class="text-sm font-semibold">Schedule</p>
                  <p class="mt-0.5 text-xs text-ink-muted">
                    {currentSummary()}
                  </p>
                </div>

                <div class="flex flex-wrap gap-1">
                  <For each={FREQUENCY_OPTIONS}>
                    {(option) => (
                      <button
                        type="button"
                        class={toggleClass(draft().frequency === option.value)}
                        onClick={() =>
                          setDraft((current) => ({
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

                <Show when={draft().frequency === 'week'}>
                  <div class="grid gap-1.5">
                    <label class="text-xs font-medium text-ink-muted cursor-default">
                      Days
                    </label>
                    <div class="flex flex-wrap gap-1">
                      <For each={WEEKDAY_OPTIONS}>
                        {(option) => {
                          const active = () =>
                            draft().daysOfWeek.includes(option.value);
                          return (
                            <button
                              type="button"
                              class={toggleClass(active())}
                              onClick={() =>
                                setDraft((current) => {
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

                <Show when={draft().frequency === 'month'}>
                  <div class="grid gap-1.5">
                    <label class="text-xs font-medium text-ink-muted cursor-default">
                      Day of Month
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      class={INPUT_CLASS}
                      value={draft().dayOfMonth}
                      onInput={(event) =>
                        setDraft((current) => ({
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
                    value={draft().time}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        time: value,
                      }))
                    }
                  />
                </div>
              </div>

              <Show when={submitAttempted() && formError()}>
                {(message) => (
                  <div class="border border-failure/20 bg-failure/5 rounded-sm px-2 py-1.5 text-xs text-failure">
                    {message()}
                  </div>
                )}
              </Show>
            </div>

            <div class="flex items-center justify-end gap-2 border-t border-edge-muted px-3 py-2">
              <Button
                variant="base"
                size="sm"
                class="cursor-default"
                onClick={() => setAutomationComposerOpen(false, false)}
              >
                Cancel
              </Button>
              <Button
                variant="active"
                size="sm"
                class="cursor-default"
                disabled={createMutation.isPending}
                onClick={handleCreate}
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </Dialog>
  );
}
