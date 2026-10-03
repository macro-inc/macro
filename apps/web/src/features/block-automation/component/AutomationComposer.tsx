import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { useCreateScheduleMutation } from '@queries/agent-schedule/schedules';
import { debounce } from '@solid-primitives/scheduled';
import { Button, Dialog, Surface } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  Show,
} from 'solid-js';
import { RoutineExecutionPicker } from '../routine-execution-picker';
import {
  clearAutomationComposerDraft,
  loadAutomationComposerDraft,
  saveAutomationComposerDraft,
} from '../util/automationComposerStorage';
import { AutomationPromptEditor } from './AutomationPromptEditor';
import {
  createEmptyDraft,
  draftToCreateBody,
  getErrorMessage,
  INPUT_CLASS,
  validateRoutineDraft,
} from './automationUtils';
import { RoutineScheduleFields } from './RoutineScheduleFields';
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
export function AutomationComposer(): JSX.Element {
  const { openWithSplit } = useSplitLayout();

  const [draft, setRawDraft] = createSignal<ScheduleDraft>(createEmptyDraft());
  const [submitAttempted, setSubmitAttempted] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  // Snapshots the prompt value at dialog-open time so the editor gets a
  // stable initialValue per open (the editor only reads it on mount).
  const [initialPrompt, setInitialPrompt] = createSignal('');

  let draftChanged = false;
  const debouncedSave = debounce(saveAutomationComposerDraft, 300);

  function setDraft(update: (prev: ScheduleDraft) => ScheduleDraft): void {
    if (createMutation.isPending) return;
    const next = setRawDraft(update);
    draftChanged = true;
    setSubmitError(null);
    debouncedSave(next);
  }

  createEffect(
    on(automationComposerOpen, (open) => {
      debouncedSave.clear();
      if (!open) {
        // Closing before the debounce fires must still preserve the latest edit.
        if (draftChanged) saveAutomationComposerDraft(draft());
        draftChanged = false;
        return;
      }
      const next = loadAutomationComposerDraft() ?? createEmptyDraft();
      draftChanged = false;
      setRawDraft(next);
      setInitialPrompt(next.prompt);
      setSubmitAttempted(false);
      setSubmitError(null);
    })
  );

  const formError = createMemo(() => validateRoutineDraft(draft(), true));

  const createMutation = useCreateScheduleMutation({
    onSuccess: async (schedule) => {
      debouncedSave.clear();
      draftChanged = false;
      clearAutomationComposerDraft();
      setAutomationComposerOpen(false, false);
      if (schedule.id) {
        openWithSplit(
          { type: 'automation', id: schedule.id },
          { referredFrom: 'launcher' }
        );
      }
      toast.success('Routine created', {
        subtext: 'Your routine is scheduled.',
      });
    },
    onError: (error) => {
      setSubmitError(getErrorMessage(error));
      toast.alert('Failed to create routine', {
        subtext: getErrorMessage(error),
      });
    },
  });

  function handleCreate(): void {
    if (createMutation.isPending) return;
    setSubmitError(null);
    const error = formError();
    if (error) {
      setSubmitAttempted(true);
      return;
    }
    createMutation.mutate(draftToCreateBody(draft()));
  }

  return (
    <Dialog
      open={automationComposerOpen()}
      onOpenChange={(open) => setAutomationComposerOpen(open, false)}
    >
      <Surface depth={2} class="rounded-xl">
        <div class="*:max-h-[75vh]">
          <div class="flex cursor-default flex-col text-ink">
            <div class="flex items-center justify-between border-b border-edge-muted px-3 py-2">
              <Dialog.Title class="m-0 p-0 text-sm font-semibold">
                New Routine
              </Dialog.Title>
              <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                &times;
              </Dialog.CloseButton>
            </div>

            <fieldset
              disabled={createMutation.isPending}
              inert={createMutation.isPending}
              class="grid min-w-0 max-h-[70vh] gap-3 overflow-y-auto p-3"
            >
              <div class="grid gap-1.5">
                <label class="text-xs font-medium text-ink-muted cursor-default">
                  Name
                </label>
                <input
                  class={INPUT_CLASS}
                  placeholder="e.g. Morning briefing"
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

              <RoutineExecutionPicker
                target={draft().target}
                onChange={(target) =>
                  setDraft((current) => ({ ...current, target }))
                }
              />

              <div class="grid gap-3 border border-edge-muted rounded-sm p-3">
                <div>
                  <p class="text-sm font-semibold">Schedule</p>
                </div>

                <RoutineScheduleFields draft={draft()} onChange={setDraft} />
              </div>

              <Show when={submitAttempted() && formError()}>
                {(message) => (
                  <div class="border border-failure/20 bg-failure/5 rounded-sm px-2 py-1.5 text-xs text-failure">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={submitError()}>
                {(message) => (
                  <div role="alert" class="text-xs text-failure">
                    {message()}
                  </div>
                )}
              </Show>
            </fieldset>

            <div class="flex items-center justify-end gap-2 border-t border-edge-muted px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                class="cursor-default"
                onClick={() => setAutomationComposerOpen(false, false)}
              >
                Cancel
              </Button>
              <Button
                variant="strong"
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
      </Surface>
    </Dialog>
  );
}
