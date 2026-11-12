import { fireAndForget } from '@core/util/fireAndForget';
import { Button, ConfirmDialog, ToggleSwitch } from '@ui';
import { type Component, createSignal, For, Show } from 'solid-js';
import { RoutineEditor } from '../components/routine-editor';
import type { RoutineEditorSlots } from '../context/routine-slots';
import type {
  RoutineCreatorSource,
  RoutineDraftStorage,
} from '../context/routine-sources';
import type { CreatedRoutineItem } from '../core/draft';
import { withNewDraftSteps } from '../core/routine-draft';
import { createRoutineComposer } from '../primitives/routine-composer';
import { routineSections } from './routine-sections';

/** Items AI created while drafting, which stay whether or not it's created. */
function CreatedItems(props: {
  label: string;
  items: CreatedRoutineItem[];
  Item: Component<{ item: CreatedRoutineItem }>;
}) {
  return (
    <Show when={props.items.length}>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
        <span>{props.label}</span>
        <For each={props.items}>{(item) => <props.Item item={item} />}</For>
        <span>They stay even if you don't create the routine.</span>
      </div>
    </Show>
  );
}

/**
 * A routine before it exists: its page, laid out like a saved routine's, that
 * is written only when Create routine succeeds. It starts from the draft New
 * routine left behind (a description, a template, or nothing).
 */
export function RoutineNewView(props: {
  source: RoutineCreatorSource;
  storage: RoutineDraftStorage;
  slots: RoutineEditorSlots;
  defaultModel: string;
  /** Decisions are answered by the classifier behind trigger conditions. */
  decisionsEnabled: boolean;
  /** One item AI created while drafting, by name. */
  CreatedItem: Component<{ item: CreatedRoutineItem }>;
  onCreated(id: string): void;
  onCancel(): void;
}) {
  const connected = props.slots.createConnectedApps();
  const { draft, change, attempted, formError, submitError, create, discard } =
    createRoutineComposer(
      props.source,
      props.storage,
      props.defaultModel,
      props.onCreated,
      connected
    );
  const pending = () => props.source.pending();
  const leave = () => {
    discard();
    props.onCancel();
  };
  const [confirming, setConfirming] = createSignal(false);
  /** Leaving drops an unsaved routine; one with anything in it asks first. */
  const cancel = () => {
    const current = draft();
    const started =
      current.name.trim() ||
      current.description?.trim() ||
      // A lone Ask AI step is kept as instructions, not steps.
      current.prompt.trim() ||
      current.triggers?.length ||
      current.steps?.length;
    if (started) setConfirming(true);
    else leave();
  };
  return (
    <>
      <RoutineEditor
        {...routineSections({
          draft,
          onChange: change,
          withSteps: withNewDraftSteps,
          // A new start remounts the whole page (routine-new.tsx), so the
          // steps never need replacing in place.
          version: () => 0,
          slots: props.slots,
          defaultModel: props.defaultModel,
          decisionsEnabled: props.decisionsEnabled,
          connected,
          runsAs: () => 'You',
          runsAsDescription: 'Steps and AI act with your access.',
        })}
        creating
        draft={draft()}
        onChange={change}
        disabled={pending()}
        tab="settings"
        onTab={() => {}}
        onBack={cancel}
        meta={
          <ToggleSwitch
            class="flex-row-reverse"
            label="Enabled"
            labelClass="text-sm font-medium text-ink"
            checked={draft().enabled ?? true}
            disabled={pending()}
            onChange={(enabled) =>
              change((current) => ({ ...current, enabled }))
            }
          />
        }
        feedback={
          <>
            <CreatedItems
              label="Created for this routine:"
              items={(draft().created ?? []).filter((item) => item.used)}
              Item={props.CreatedItem}
            />
            <CreatedItems
              label="Created, not used by this routine:"
              items={(draft().created ?? []).filter((item) => !item.used)}
              Item={props.CreatedItem}
            />
            <Show when={attempted() && formError()}>
              {(message) => (
                <p role="alert" class="text-sm text-failure">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={submitError()}>
              {(message) => (
                <p role="alert" class="text-sm text-failure">
                  {message()}
                </p>
              )}
            </Show>
          </>
        }
        footer={
          <>
            <Button variant="ghost" disabled={pending()} onClick={cancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending()}
              onClick={() => fireAndForget(create(), 'routines')}
            >
              {pending() ? 'Creating…' : 'Create routine'}
            </Button>
          </>
        }
      />
      <ConfirmDialog
        open={confirming()}
        onOpenChange={setConfirming}
        title="Discard this routine?"
        body="It hasn't been created, so its triggers and steps will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setConfirming(false);
          leave();
        }}
      />
    </>
  );
}
