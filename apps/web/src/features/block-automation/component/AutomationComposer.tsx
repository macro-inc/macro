import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import ClockIcon from '@phosphor/clock.svg';
import XIcon from '@phosphor/x.svg';
import { useCreateScheduleMutation } from '@queries/agent-schedule/schedules';
import { debounce } from '@solid-primitives/scheduled';
import { Button, EntityComposer, ToggleSwitch } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { RoutineExecutionPicker } from '../routine-execution-picker';
import { RoutineTriggers } from '../routine-triggers';
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
  validateRoutineDraft,
} from './automationUtils';
import type { ScheduleDraft } from './types';

/** The shared task/project popover hosts the routine composer too. */
export function RoutineCreator(
  props: { onCreated?: (id: string) => void } = {}
) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const onCreated = (id: string) => {
    panel.handle.close();
    if (props.onCreated) props.onCreated(id);
    else openAgentsPage(layout, 'routines', { routineId: id });
  };
  const restored = loadAutomationComposerDraft();
  const [draft, setRawDraft] = createSignal<ScheduleDraft>(
    restored
      ? {
          ...restored,
          triggers: restored.triggers ?? [],
          enabled: restored.enabled ?? true,
        }
      : { ...createEmptyDraft(), triggers: [], enabled: true }
  );
  const [attempted, setAttempted] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string>();
  const save = debounce(saveAutomationComposerDraft, 300);
  let dirty = false;
  const mutation = useCreateScheduleMutation({
    onSuccess: (routine) => {
      save.clear();
      dirty = false;
      clearAutomationComposerDraft();
      if (routine.id) onCreated(routine.id);
    },
    onError: (error) => setSubmitError(getErrorMessage(error)),
  });
  function change(update: (draft: ScheduleDraft) => ScheduleDraft) {
    if (mutation.isPending) return;
    const next = update(draft());
    if (next === draft()) return;
    setRawDraft(next);
    dirty = true;
    setSubmitError(undefined);
    save(next);
  }
  onCleanup(() => {
    save.clear();
    if (dirty) saveAutomationComposerDraft(draft());
  });
  function create() {
    if (mutation.isPending) return;
    setAttempted(true);
    if (validateRoutineDraft(draft(), true)) {
      return;
    }
    mutation.mutate(draftToCreateBody(draft()));
  }
  return (
    <EntityComposer.Root
      class="w-full h-auto max-h-[75vh]"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          create();
        }
      }}
    >
      <EntityComposer.Header>
        <ClockIcon class="ml-2 size-4 text-ink-muted" />
        <span class="flex-1 px-1 text-sm text-ink-muted">New routine</span>
        <Button
          size="icon-composer"
          variant="ghost"
          aria-label="Close routine composer"
          onClick={() => panel.handle.close()}
        >
          <XIcon />
        </Button>
      </EntityComposer.Header>
      <div class="min-h-0 overflow-y-auto px-2">
        <input
          aria-label="Routine name"
          placeholder="Routine name"
          value={draft().name}
          disabled={mutation.isPending}
          onInput={(e) =>
            change((draft) => ({ ...draft, name: e.currentTarget.value }))
          }
          class="mb-4 w-full bg-transparent text-xl font-medium leading-7 text-ink outline-none placeholder:text-ink-placeholder"
        />
        <fieldset
          disabled={mutation.isPending}
          inert={mutation.isPending}
          class="grid min-w-0 gap-4"
        >
          <section class="min-h-32" aria-label="Instructions">
            <AutomationPromptEditor
              initialValue={draft().prompt}
              onChange={(prompt) =>
                change((draft) =>
                  draft.prompt === prompt ? draft : { ...draft, prompt }
                )
              }
            />
          </section>
          <EntityComposer.Properties aria-label="Routine properties">
            <RoutineExecutionPicker
              target={draft().target}
              onChange={(target) => change((draft) => ({ ...draft, target }))}
            />
            <RoutineTriggers
              triggers={draft().triggers ?? []}
              onChange={(triggers) =>
                change((draft) => ({ ...draft, triggers }))
              }
            />
          </EntityComposer.Properties>
        </fieldset>
        <Show when={attempted() && validateRoutineDraft(draft(), true)}>
          {(message) => (
            <p role="alert" class="mt-3 text-xs text-failure">
              {message()}
            </p>
          )}
        </Show>
        <Show when={submitError()}>
          {(message) => (
            <p role="alert" class="mt-3 text-xs text-failure">
              {message()}
            </p>
          )}
        </Show>
      </div>
      <EntityComposer.Footer class="border-t border-edge-muted px-2 pt-4 items-center">
        <ToggleSwitch
          label="Start enabled"
          labelClass="text-xs text-ink-muted"
          checked={draft().enabled ?? true}
          disabled={mutation.isPending}
          onChange={(enabled) => change((draft) => ({ ...draft, enabled }))}
        />
        <EntityComposer.Submit
          aria-label={mutation.isPending ? 'Creating…' : 'Create routine'}
          hasContent={Boolean(draft().prompt.trim())}
          disabled={mutation.isPending}
          onClick={create}
        >
          {mutation.isPending ? 'Creating…' : 'Create routine'}
        </EntityComposer.Submit>
      </EntityComposer.Footer>
    </EntityComposer.Root>
  );
}
