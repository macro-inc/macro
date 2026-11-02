import { IS_MAC } from '@core/constant/isMac';
import { isEditableInput } from '@core/util/isEditableInput';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import WarningIcon from '@icon/system/regular/warning-circle.svg';
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
import type { HistoryStep } from '../core/history';
import type { AgentStepDraft, StepDraft } from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { copyStep } from '../core/step-edits';
import { stepHeadline } from '../core/step-headline';
import { callCount } from '../core/step-history';
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
};

/** A finished run to show on the steps: what each step did, by path. */
export type RoutineRunView = {
  steps: HistoryStep[];
  endedAt?: string | null;
  success?: boolean | null;
};

type StepsContextValue = {
  /** The whole routine. */
  steps: Accessor<StepDraft[]>;
  defaultTarget: Accessor<RoutineTarget>;
  slots: RoutineStepSlots;
  /** Steps added while editing, which open for their first edit. */
  fresh: Set<string>;
  /** What the shown run did at each step path. */
  run: Accessor<ReadonlyMap<string, HistoryStep> | undefined>;
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
  /** The latest run, shown on the steps it touched. */
  lastRun?: RoutineRunView;
};

/** What every step editor reads: slots and the shown run. */
export function StepsProvider(
  props: RoutineStepsProps & { showRun: boolean; children: JSX.Element }
) {
  const run = () => {
    const lastRun = props.lastRun;
    return lastRun && props.showRun
      ? new Map(lastRun.steps.map((step) => [step.path, step] as const))
      : undefined;
  };
  return (
    <StepsContext.Provider
      value={{
        steps: () => props.steps,
        defaultTarget: () => props.defaultTarget,
        slots: props.slots,
        fresh: new Set(),
        run,
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
                  path={String(index())}
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
        <AddStep onAdd={(step) => props.onChange([...props.steps, step])} />
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

type RunOutcome = {
  failed?: string;
  /** What it did, in a few words. */
  text?: string;
};

/** What a run did at one step: an error, its calls, or plain success. */
export function runOutcome(record: HistoryStep): RunOutcome {
  return match(record)
    .returnType<RunOutcome>()
    .with({ kind: 'agent' }, (record) =>
      record.error ? { failed: record.error } : {}
    )
    .with({ kind: 'code' }, (record) =>
      record.error
        ? { failed: record.error }
        : { text: callCount(record.calls.length, record.callsTruncated) }
    )
    .exhaustive();
}

/** What the shown run did at one step, in a few words. */
export function RunStatus(props: { path: string }) {
  const steps = useSteps();
  const outcome = () => {
    const record = steps.run()?.get(props.path);
    return record ? runOutcome(record) : undefined;
  };
  return (
    <Show when={outcome()}>
      {(result) => (
        <Switch
          fallback={
            <CheckIcon
              class="size-3.5 shrink-0 text-success"
              aria-label="Ran"
            />
          }
        >
          <Match when={result().failed}>
            {(error) => (
              <span
                class="flex shrink-0 items-center gap-1 text-xs text-failure"
                title={error()}
              >
                <WarningIcon class="size-3.5" />
                Failed
              </span>
            )}
          </Match>
          <Match when={result().text}>
            {(text) => (
              <span class="flex min-w-0 shrink items-center gap-1 text-xs text-ink-muted">
                <CheckIcon class="size-3.5 shrink-0 text-success" />
                <span class="truncate">{text()}</span>
              </span>
            )}
          </Match>
        </Switch>
      )}
    </Show>
  );
}

type StepCardProps = {
  step: StepDraft;
  number: number;
  first: boolean;
  last: boolean;
  path: string;
  onChange(step: StepDraft): void;
  onMove(delta: number): void;
  onDuplicate(copy: StepDraft): void;
  onRemove(): void;
};

/**
 * One step: closed, a single line (its title, what it does and what the
 * shown run did); open, its settings or code under its name.
 */
function StepCard(props: StepCardProps) {
  const steps = useSteps();
  // Open where there is something to do; a finished routine reads as a list.
  const [open, setOpen] = createSignal(
    (steps.steps().length === 1 && steps.steps()[0]?.id === props.step.id) ||
      steps.fresh.has(props.step.id) ||
      (props.step.kind === 'agent' && !props.step.instructions.trim())
  );
  const headline = () => stepHeadline(props.step);
  let header: HTMLButtonElement | undefined;
  return (
    <RoutineSurface>
      {/* A named group, not a landmark: a routine has many steps. */}
      <div
        role="group"
        aria-label={headline().title}
        class="@container/step group/step min-w-0"
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
          queueMicrotask(() => header?.focus());
        }}
      >
        <div class="flex min-w-0 items-center gap-1 pr-2.5">
          <button
            ref={header}
            type="button"
            aria-expanded={open()}
            class="flex min-h-13 min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 pl-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-muted"
            onClick={() => setOpen(!open())}
          >
            <span class="w-4.5 shrink-0 text-right text-xs tabular-nums text-ink-extra-muted">
              {props.number}
            </span>
            <StepIcon step={props.step} />
            <span class="shrink-0 text-sm font-medium">{headline().title}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
              {open() ? '' : headline().summary}
            </span>
            <Show when={headline().mode}>
              {(mode) => (
                <Badge
                  variant="secondary"
                  size="xs"
                  class="@max-[24rem]/step:hidden"
                >
                  {mode()}
                </Badge>
              )}
            </Show>
            <RunStatus path={props.path} />
          </button>
          <StepMenu {...props} open={open()} />
        </div>
        <Show when={open()}>
          {/* Fields keep the card's padding on every side. */}
          <div class="grid min-w-0 gap-3 px-4 pb-4 pt-1">
            <StepBody
              step={props.step}
              path={props.path}
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

/** Move, duplicate, or delete a step. */
function StepMenu(props: StepCardProps & { open: boolean }) {
  let trigger: HTMLButtonElement | undefined;
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
      >
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
  path: string;
  onChange(step: StepDraft): void;
}) {
  return (
    <Switch>
      <Match when={props.step.kind === 'agent' && props.step}>
        {(step) => <AgentBody step={step()} onChange={props.onChange} />}
      </Match>
      <Match when={props.step.kind === 'code' && props.step}>
        {(step) => <CodeStepBody step={step()} path={props.path} />}
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
