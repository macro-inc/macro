import { fireAndForget } from '@core/util/fireAndForget';
import ClockIcon from '@icon/system/regular/clock.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, EntityComposer, ToggleSwitch } from '@ui';
import { type Accessor, createSignal, type JSX, Show } from 'solid-js';
import { RoutineRunVisibility } from '../components/routine-run-visibility';
import { RoutineStart } from '../components/routine-start';
import { RoutineSteps } from '../components/routine-step-editor';
import type { RoutineEditorSlots } from '../context/routine-slots';
import type {
  RoutineCreatorSource,
  RoutineDraftStorage,
} from '../context/routine-sources';
import { DEFAULT_RUN_VISIBILITY, type ScheduleDraft } from '../core/draft';
import {
  draftPrompt,
  draftSteps,
  withNewDraftSteps,
} from '../core/routine-draft';
import { firstAgent } from '../core/routine-steps';
import {
  availableTemplates,
  type RoutineTemplate,
  templateDraft,
} from '../core/routine-templates';
import { createRoutineComposer } from '../primitives/routine-composer';

export function RoutineCreatorView(props: {
  source: RoutineCreatorSource;
  storage: RoutineDraftStorage;
  slots: RoutineEditorSlots;
  defaultModel: string;
  /** Decisions are answered by the classifier behind trigger conditions. */
  decisionsEnabled: boolean;
  /** Drafts the routine from a description; absent where that is unavailable. */
  renderComposer?: (
    apply: (draft: ScheduleDraft, description: string) => void,
    current: Accessor<ScheduleDraft>,
    initialDescription: string | undefined
  ) => JSX.Element;
  onCreated(id: string): void;
  onClose(): void;
}) {
  const {
    draft,
    restored,
    change,
    replace,
    version,
    attempted,
    formError,
    submitError,
    create,
  } = createRoutineComposer(
    props.source,
    props.storage,
    props.defaultModel,
    props.onCreated,
    props.slots.createConnectedApps()
  );
  // A new routine starts from a description or a starting point; an unsent
  // draft resumes in the editor.
  const [stage, setStage] = createSignal<'start' | 'edit'>(
    restored ? 'edit' : 'start'
  );
  /** The description the current draft was drafted from. */
  const [described, setDescribed] = createSignal<string>();
  const begin = (next: ScheduleDraft, description?: string) => {
    replace(next);
    setDescribed(description);
    setStage('edit');
  };
  const startFrom = (template: RoutineTemplate) =>
    begin(
      templateDraft(template, draft(), {
        decisions: props.decisionsEnabled,
        target: { kind: 'model', model: props.defaultModel },
      })
    );
  return (
    <EntityComposer.Root
      class="w-full h-auto max-h-[75vh]"
      onKeyDown={(event) => {
        if (
          stage() === 'edit' &&
          (event.metaKey || event.ctrlKey) &&
          event.key === 'Enter'
        ) {
          event.preventDefault();
          fireAndForget(create(), 'routines');
        }
      }}
    >
      <EntityComposer.Header>
        <ClockIcon class="ml-2 size-4 shrink-0 text-ink-muted" />
        <h2 class="flex-1 px-1 text-base font-semibold tracking-[-0.01em] text-ink">
          New routine
        </h2>
        <Button
          size="icon-md"
          variant="ghost"
          aria-label="Close routine composer"
          onClick={() => props.onClose()}
        >
          <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </EntityComposer.Header>
      <Show when={stage() === 'start'}>
        <div class="min-h-0 flex-1 overflow-y-auto px-2">
          <RoutineStart
            describe={props.renderComposer?.(begin, draft, described())}
            templates={availableTemplates(props.decisionsEnabled)}
            onTemplate={startFrom}
          />
        </div>
        <EntityComposer.Footer class="-mx-4 items-center border-t border-edge-muted px-4 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => begin({ ...draft(), triggers: [], steps: [] })}
          >
            <PlusIcon class="size-3.5" />
            Start from scratch
          </Button>
        </EntityComposer.Footer>
      </Show>
      <Show when={stage() === 'edit'}>
        <div class="min-h-0 overflow-y-auto px-2">
          <input
            aria-label="Routine name"
            placeholder="Routine name"
            value={draft().name}
            disabled={props.source.pending()}
            onInput={(e) =>
              change((draft) => ({ ...draft, name: e.currentTarget.value }))
            }
            class="mb-4 w-full bg-transparent text-xl font-medium leading-7 text-ink outline-none placeholder:text-ink-placeholder"
          />
          <Show when={described()}>
            {(description) => (
              <div class="mb-4 flex min-w-0 items-center gap-2 rounded-lg border border-edge-muted bg-surface py-1 pl-3 pr-1">
                <SparkleIcon class="size-3.5 shrink-0 text-accent-ink" />
                <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  “{description()}”
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  class="shrink-0 text-ink-muted"
                  onClick={() => setStage('start')}
                >
                  Change
                </Button>
              </div>
            )}
          </Show>
          <fieldset
            disabled={props.source.pending()}
            inert={props.source.pending()}
            class="grid min-w-0 gap-4"
          >
            <section aria-label="When" class="grid gap-2">
              <span class="text-xs font-medium text-ink-extra-muted">When</span>
              <EntityComposer.Properties aria-label="Routine triggers">
                <props.slots.Triggers
                  triggers={draft().triggers ?? []}
                  onChange={(triggers) =>
                    change((draft) => ({ ...draft, triggers }))
                  }
                />
                <RoutineRunVisibility
                  value={draft().runVisibility ?? DEFAULT_RUN_VISIBILITY}
                  onChange={(runVisibility) =>
                    change((draft) => ({ ...draft, runVisibility }))
                  }
                />
                <props.slots.Apps
                  apps={draft().apps}
                  onChange={(apps) => change((draft) => ({ ...draft, apps }))}
                />
              </EntityComposer.Properties>
            </section>
            <section aria-label="Then" class="grid gap-2">
              <span class="text-xs font-medium text-ink-extra-muted">Then</span>
              <Show when={{ version: version() }} keyed>
                <RoutineSteps
                  steps={draftSteps(draft())}
                  onChange={(steps) =>
                    change((current) => withNewDraftSteps(current, steps))
                  }
                  triggers={draft().triggers ?? []}
                  defaultTarget={
                    firstAgent(draftSteps(draft()))?.target ?? {
                      kind: 'model',
                      model: props.defaultModel,
                    }
                  }
                  decisionsEnabled={props.decisionsEnabled}
                  slots={props.slots}
                />
              </Show>
            </section>
          </fieldset>
          <Show when={attempted() && formError()}>
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
            disabled={props.source.pending()}
            onChange={(enabled) => change((draft) => ({ ...draft, enabled }))}
          />
          <EntityComposer.Submit
            aria-label={props.source.pending() ? 'Creating…' : 'Create routine'}
            hasContent={Boolean(
              draftPrompt(draft()).trim() || draft().steps?.length
            )}
            disabled={props.source.pending()}
            onClick={() => fireAndForget(create(), 'routines')}
          >
            {props.source.pending() ? 'Creating…' : 'Create routine'}
          </EntityComposer.Submit>
        </EntityComposer.Footer>
      </Show>
    </EntityComposer.Root>
  );
}
