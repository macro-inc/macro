import { IS_MAC } from '@core/constant/isMac';
import { isEditableInput } from '@core/util/isEditableInput';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Badge, cn, Dropdown } from '@ui';
import {
  type Accessor,
  type Component,
  createContext,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { StepAuthor } from '../context/routine-slots';
import type {
  AgentStepDraft,
  RoutineSoFar,
  StepDraft,
} from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { copyStep } from '../core/step-edits';
import { stepHeadline } from '../core/step-headline';
import { AddStep } from './routine-add-step';
import { CodeStepBody, StepNote } from './routine-code-step';
import { RoutineSurface, RoutineTray } from './routine-editor';
import { menuMount } from './routine-search-menu';

export type RoutineStepSlots = {
  PromptEditor: Component<{
    initialValue: string;
    onChange(value: string): void;
  }>;
  ExecutionPicker: Component<{
    target: RoutineTarget;
    onChange(target: RoutineTarget): void;
  }>;
  /** AI that adds and changes steps; without it, steps are added by hand. */
  createStepAuthor?(routine: Accessor<RoutineSoFar>): StepAuthor;
};

type StepsContextValue = {
  /** The whole routine. */
  steps: Accessor<StepDraft[]>;
  defaultTarget: Accessor<RoutineTarget>;
  slots: RoutineStepSlots;
  /** Steps added while editing, which open for their first edit. */
  fresh: Set<string>;
  /** AI that adds and changes steps, when the host provides it. */
  author?: StepAuthor;
};

const StepsContext = createContext<StepsContextValue>();

export function useSteps(): StepsContextValue {
  const context = useContext(StepsContext);
  if (!context) throw new Error('Routine steps need StepsProvider');
  return context;
}

export type RoutineStepsProps = {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
  triggers: RoutineTriggerDraft[];
  defaultTarget: RoutineTarget;
  slots: RoutineStepSlots;
};

/** What every step editor reads: slots and the AI that writes steps. */
export function StepsProvider(
  props: RoutineStepsProps & { children: JSX.Element }
) {
  const author = props.slots.createStepAuthor?.(() => ({
    triggers: props.triggers,
    steps: props.steps,
  }));
  return (
    <StepsContext.Provider
      value={{
        steps: () => props.steps,
        defaultTarget: () => props.defaultTarget,
        slots: props.slots,
        fresh: new Set(),
        author,
      }}
    >
      {props.children}
    </StepsContext.Provider>
  );
}

/** The routine's steps in order, then "+ Add step" in a tray under them. */
export function StepList(props: {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
}) {
  const replace = (id: string, next: StepDraft) =>
    props.onChange(props.steps.map((step) => (step.id === id ? next : step)));
  const move = (id: string, delta: number) => {
    const at = props.steps.findIndex((step) => step.id === id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= props.steps.length) return;
    const steps = [...props.steps];
    const [step] = steps.splice(at, 1);
    if (step) steps.splice(to, 0, step);
    props.onChange(steps);
  };
  const ids = () => props.steps.map((step) => step.id);
  return (
    <div class="grid min-w-0 gap-2">
      <For each={ids()}>
        {(id) => {
          const index = () => props.steps.findIndex((step) => step.id === id);
          return (
            <Show when={props.steps[index()]}>
              {(step) => (
                <StepCard
                  step={step()}
                  number={index() + 1}
                  first={index() === 0}
                  last={index() === props.steps.length - 1}
                  onChange={(next) => replace(id, next)}
                  onMove={(delta) => move(id, delta)}
                  onDuplicate={(copy) => {
                    const steps = [...props.steps];
                    steps.splice(index() + 1, 0, copy);
                    props.onChange(steps);
                  }}
                  onRemove={() =>
                    props.onChange(props.steps.filter((step) => step.id !== id))
                  }
                />
              )}
            </Show>
          );
        }}
      </For>
      {/* Steps are added from a tray under the last card. */}
      <RoutineTray
        attached={props.steps.length > 0}
        // Into the list's gap, and behind the last card's corners.
        class={props.steps.length > 0 ? '-mt-5' : undefined}
      >
        <AddStep steps={props.steps} onChange={props.onChange} />
      </RoutineTray>
    </div>
  );
}

export function stepIcon(step: StepDraft): Component<{ class?: string }> {
  return match(step)
    .with({ kind: 'agent' }, () => SparkleIcon)
    .with({ kind: 'code' }, () => CodeIcon)
    .exhaustive();
}

/** Steps where AI does the work: Ask AI. */
function usesAi(step: StepDraft): boolean {
  return step.kind === 'agent';
}

export function StepIcon(props: { step: StepDraft }) {
  return (
    <span
      class={cn(
        'flex size-6.5 shrink-0 items-center justify-center rounded-[7px]',
        usesAi(props.step)
          ? 'bg-accent-bg text-accent'
          : 'bg-ink/5 text-ink-muted'
      )}
    >
      <Dynamic component={stepIcon(props.step)} class="size-3.5" />
    </span>
  );
}

type StepCardProps = {
  step: StepDraft;
  number: number;
  first: boolean;
  last: boolean;
  onChange(step: StepDraft): void;
  onMove(delta: number): void;
  onDuplicate(copy: StepDraft): void;
  onRemove(): void;
};

/**
 * One step under its name. A code step always shows what it does, with its
 * values; an Ask AI step closes to a single line.
 */
function StepCard(props: StepCardProps) {
  const steps = useSteps();
  // Saying what to change in a code step, from its menu's Edit.
  const [editing, setEditing] = createSignal(false);
  // A code step's code, from its menu.
  const [showCode, setShowCode] = createSignal(false);
  // Open where there is something to do; a finished routine reads as a list.
  const [open, setOpen] = createSignal(
    (steps.steps().length === 1 && steps.steps()[0]?.id === props.step.id) ||
      steps.fresh.has(props.step.id) ||
      (props.step.kind === 'agent' && !props.step.instructions.trim())
  );
  const isCode = () => props.step.kind === 'code';
  const shown = () => isCode() || open();
  const headline = () => stepHeadline(props.step);
  let header: HTMLButtonElement | undefined;
  let group: HTMLDivElement | undefined;
  const heading = () => (
    <>
      <span class="w-4.5 shrink-0 text-right text-xs tabular-nums text-ink-extra-muted">
        {props.number}
      </span>
      <StepIcon step={props.step} />
      <span class="shrink-0 text-sm font-medium">{headline().title}</span>
      <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
        {shown() ? '' : headline().summary}
      </span>
      <Show when={headline().mode}>
        {(mode) => (
          <Badge variant="secondary" size="xs" class="@max-[24rem]/step:hidden">
            {mode()}
          </Badge>
        )}
      </Show>
    </>
  );
  return (
    <RoutineSurface>
      {/* A named group, not a landmark: a routine has many steps. */}
      <div
        ref={group}
        role="group"
        aria-label={headline().title}
        // Where focus returns after a move, on a card without a header button.
        tabIndex={-1}
        class="@container/step group/step min-w-0 outline-none"
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          // Text fields keep ⌥↑/↓, and pickers portaled out of the card
          // aren't moving it.
          const target = event.target as Element;
          if (isEditableInput(target) || !event.currentTarget.contains(target))
            return;
          event.preventDefault();
          props.onMove(event.key === 'ArrowUp' ? -1 : 1);
          // Moving a card re-inserts it, which drops focus.
          queueMicrotask(() => (header ?? group)?.focus());
        }}
      >
        <div class="flex min-w-0 items-center gap-1 pr-2.5">
          <Show
            when={!isCode()}
            fallback={
              <div class="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-2 pl-4">
                {heading()}
              </div>
            }
          >
            <button
              ref={header}
              type="button"
              aria-expanded={open()}
              class="flex min-h-13 min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 pl-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-muted"
              onClick={() => setOpen(!open())}
            >
              {heading()}
            </button>
          </Show>
          <StepMenu
            {...props}
            open={shown()}
            onEdit={
              isCode() && steps.author ? () => setEditing(true) : undefined
            }
            showCode={isCode() ? showCode() : undefined}
            onShowCode={setShowCode}
            onEditShown={() =>
              group
                ?.querySelector<HTMLInputElement>('[data-step-change]')
                ?.focus()
            }
          />
        </div>
        <Show when={shown()}>
          {/* Fields keep the card's padding on every side. */}
          <div
            class={cn(
              'grid min-w-0 px-4',
              isCode() ? 'gap-2.5 pb-3.5' : 'gap-3 pb-4 pt-1'
            )}
          >
            <StepBody
              step={props.step}
              editing={editing()}
              onEditing={setEditing}
              showCode={showCode()}
              onChange={props.onChange}
            />
          </div>
        </Show>
      </div>
    </RoutineSurface>
  );
}

const ALT = IS_MAC ? '⌥' : 'Alt+';

function MenuShortcut(props: { children: JSX.Element }) {
  return (
    <span class="ml-auto pl-3 text-xs text-ink-muted">{props.children}</span>
  );
}

/** Edit, show code, move, duplicate, or delete a step. */
function StepMenu(
  props: StepCardProps & {
    open: boolean;
    onEdit?: () => void;
    /** Whether a code step's code shows; undefined for other steps. */
    showCode?: boolean;
    onShowCode(show: boolean): void;
    /** Focus what Edit opened, once the menu has let go of focus. */
    onEditShown(): void;
  }
) {
  let trigger: HTMLButtonElement | undefined;
  let editing = false;
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        ref={trigger}
        variant="ghost"
        size="icon-sm"
        aria-label="Step actions"
        class={cn(
          'not-touch:opacity-0 not-touch:group-hover/step:opacity-100 not-touch:group-focus-within/step:opacity-100 not-touch:popup-open:opacity-100',
          props.open && 'not-touch:opacity-100'
        )}
      >
        <DotsIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        mount={menuMount(trigger)}
        class="min-w-56"
        onCloseAutoFocus={() => {
          if (!editing) return;
          editing = false;
          // The menu focuses its trigger after this handler returns.
          queueMicrotask(() => props.onEditShown());
        }}
      >
        <Show when={props.onEdit || props.showCode !== undefined}>
          <Dropdown.Group>
            <Show when={props.onEdit}>
              {(edit) => (
                <Dropdown.Item
                  onSelect={() => {
                    editing = true;
                    edit()();
                  }}
                >
                  <PencilIcon class="size-4" />
                  Edit
                </Dropdown.Item>
              )}
            </Show>
            <Show when={props.showCode !== undefined}>
              <Dropdown.Item onSelect={() => props.onShowCode(!props.showCode)}>
                <CodeIcon class="size-4" />
                {props.showCode ? 'Hide code' : 'Show code'}
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
        </Show>
        <Dropdown.Group>
          <Dropdown.Item
            disabled={props.first}
            onSelect={() => props.onMove(-1)}
          >
            <ArrowUpIcon class="size-4" />
            Move up
            <MenuShortcut>{ALT}↑</MenuShortcut>
          </Dropdown.Item>
          <Dropdown.Item disabled={props.last} onSelect={() => props.onMove(1)}>
            <ArrowDownIcon class="size-4" />
            Move down
            <MenuShortcut>{ALT}↓</MenuShortcut>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => props.onDuplicate(copyStep(props.step))}
          >
            <CopyIcon class="size-4" />
            Duplicate
          </Dropdown.Item>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.Item class="text-failure-ink" onSelect={props.onRemove}>
            <TrashIcon class="size-4" />
            Delete step
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** The editor for any step, wherever it sits. */
export function StepBody(props: {
  step: StepDraft;
  /** Whether a code step shows where to say what to change. */
  editing?: boolean;
  onEditing?(editing: boolean): void;
  /** Whether a code step shows its code. */
  showCode?: boolean;
  onChange(step: StepDraft): void;
}) {
  return (
    <Switch>
      <Match when={props.step.kind === 'agent' && props.step}>
        {(step) => <AgentBody step={step()} onChange={props.onChange} />}
      </Match>
      <Match when={props.step.kind === 'code' && props.step}>
        {(step) => (
          <CodeStepBody
            step={step()}
            editing={props.editing ?? false}
            onEditing={(editing) => props.onEditing?.(editing)}
            showCode={props.showCode ?? false}
            onChange={props.onChange}
          />
        )}
      </Match>
    </Switch>
  );
}

/** A label over its control, for settings that need the room. */
export function Field(props: {
  label: string;
  /** Names the control for assistive tech when it has no label of its own. */
  id?: string;
  children: JSX.Element;
}) {
  return (
    <div class="grid min-w-0 gap-1.5">
      <span id={props.id} class="text-xs font-medium text-ink-muted">
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

/** Ask AI: who runs it and what they're told. */
function AgentBody(props: {
  step: AgentStepDraft;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  return (
    <div class="grid min-w-0 gap-3">
      <Field label="Who">
        <div class="flex min-w-0">
          <steps.slots.ExecutionPicker
            target={props.step.target}
            onChange={(target) => props.onChange({ ...props.step, target })}
          />
        </div>
      </Field>
      <Field label="Instructions">
        <div class="min-w-0 rounded-xl border border-edge-frame bg-control px-3 py-2 focus-within:ring-2 focus-within:ring-edge-muted">
          <steps.slots.PromptEditor
            initialValue={props.step.instructions}
            onChange={(instructions) =>
              props.step.instructions === instructions
                ? undefined
                : props.onChange({ ...props.step, instructions })
            }
          />
        </div>
        <StepNote>
          Type @ to add context. It also sees what triggered the run and what
          earlier steps did.
        </StepNote>
      </Field>
    </div>
  );
}
