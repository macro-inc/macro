import ClockIcon from '@phosphor/clock.svg';
import XIcon from '@phosphor/x.svg';
import { Button, EntityComposer, ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import type { RoutineEditorSlots } from '../context/routine-slots';
import type {
  RoutineCreatorSource,
  RoutineDraftStorage,
} from '../context/routine-sources';
import { validateRoutineDraft } from '../core/routine-draft';
import { createRoutineComposer } from '../primitives/routine-composer';

export function RoutineCreatorView(props: {
  source: RoutineCreatorSource;
  storage: RoutineDraftStorage;
  slots: RoutineEditorSlots;
  defaultModel: string;
  onCreated(id: string): void;
  onClose(): void;
}) {
  const { draft, change, attempted, submitError, create } =
    createRoutineComposer(
      props.source,
      props.storage,
      props.defaultModel,
      props.onCreated
    );
  return (
    <EntityComposer.Root
      class="w-full h-auto max-h-[75vh]"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void create();
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
          onClick={() => props.onClose()}
        >
          <XIcon />
        </Button>
      </EntityComposer.Header>
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
        <fieldset
          disabled={props.source.pending()}
          inert={props.source.pending()}
          class="grid min-w-0 gap-4"
        >
          <section class="min-h-32" aria-label="Instructions">
            <props.slots.PromptEditor
              initialValue={draft().prompt}
              onChange={(prompt) =>
                change((draft) =>
                  draft.prompt === prompt ? draft : { ...draft, prompt }
                )
              }
            />
          </section>
          <EntityComposer.Properties aria-label="Routine properties">
            <props.slots.ExecutionPicker
              target={draft().target}
              onChange={(target) => change((draft) => ({ ...draft, target }))}
            />
            <props.slots.Triggers
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
          disabled={props.source.pending()}
          onChange={(enabled) => change((draft) => ({ ...draft, enabled }))}
        />
        <EntityComposer.Submit
          aria-label={props.source.pending() ? 'Creating…' : 'Create routine'}
          hasContent={Boolean(draft().prompt.trim())}
          disabled={props.source.pending()}
          onClick={() => void create()}
        >
          {props.source.pending() ? 'Creating…' : 'Create routine'}
        </EntityComposer.Submit>
      </EntityComposer.Footer>
    </EntityComposer.Root>
  );
}
