import { IS_MAC } from '@core/constant/isMac';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import ChatIcon from '@icon/system/regular/chat-circle-text.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import EnvelopeIcon from '@icon/system/regular/envelope-simple.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import FlagIcon from '@icon/system/regular/flag.svg';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import GitForkIcon from '@icon/system/regular/git-fork.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
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
import type {
  AgentStepDraft,
  ChooseStepDraft,
  IfStepDraft,
  StepDraft,
} from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import {
  pickAction,
  type StepActionKey,
  type StepScope,
  scopeAfter,
  stepActionKey,
  stepNeedsInput,
  TRIGGER_ID,
} from '../core/step-catalog';
import { copyStep, wrapInIf } from '../core/step-edits';
import { stepHeadline } from '../core/step-headline';
import { AddStep } from './routine-add-step';
import { DecisionBody, DecisionBranches } from './routine-decision-step';
import { RoutineSurface, RoutineTray } from './routine-editor';
import {
  menuMount,
  type RoutineToolSlots,
  StepNote,
  ToolStepBody,
} from './routine-tool-step';

export type RoutineStepSlots = RoutineToolSlots & {
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
  /** The whole routine, so new outputs get unused names. */
  steps: Accessor<StepDraft[]>;
  /** Decisions need trigger conditions and activity triggers. */
  decisions: Accessor<'on' | 'needs-event' | 'off'>;
  defaultTarget: Accessor<RoutineTarget>;
  slots: RoutineStepSlots;
  /** Steps added while editing, which open for their first edit. */
  fresh: Set<string>;
  /** What the shown run did at each step path. */
  run: Accessor<ReadonlyMap<string, HistoryStep> | undefined>;
  /** Each step's number, counted through branches in reading order. */
  number(id: string): number | undefined;
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
  /** Decisions need trigger conditions, which are rolled out separately. */
  decisionsEnabled: boolean;
  slots: RoutineStepSlots;
  /** The latest run, shown on the steps it touched. */
  lastRun?: RoutineRunView;
};

/**
 * Every step that shows as a card, in reading order: a pick's values live
 * in its card, so their steps don't count.
 */
function shownSteps(steps: StepDraft[]): StepDraft[] {
  return steps.flatMap((step) => [
    step,
    ...match(step)
      .returnType<StepDraft[]>()
      .with({ kind: 'agent' }, { kind: 'tool' }, () => [])
      .with({ kind: 'if' }, (step) => shownSteps([...step.yes, ...step.no]))
      .with({ kind: 'choose' }, (step) =>
        shownSteps([
          ...step.options.flatMap((option) =>
            pickAction(step) ? option.steps.slice(1) : option.steps
          ),
          ...step.otherwise,
        ])
      )
      .exhaustive(),
  ]);
}

/** What every step editor reads: slots, decisions and the shown run. */
export function StepsProvider(
  props: RoutineStepsProps & { showRun: boolean; children: JSX.Element }
) {
  const allEvents = () =>
    props.triggers.length > 0 &&
    props.triggers.every((trigger) => trigger.kind === 'event');
  const run = () => {
    const lastRun = props.lastRun;
    return lastRun && props.showRun
      ? new Map(lastRun.steps.map((step) => [step.path, step] as const))
      : undefined;
  };
  const numbers = () =>
    new Map(shownSteps(props.steps).map((step, index) => [step.id, index + 1]));
  return (
    <StepsContext.Provider
      value={{
        steps: () => props.steps,
        decisions: () =>
          !props.decisionsEnabled ? 'off' : allEvents() ? 'on' : 'needs-event',
        defaultTarget: () => props.defaultTarget,
        slots: props.slots,
        fresh: new Set(),
        run,
        number: (id) => numbers().get(id),
      }}
    >
      {props.children}
    </StepsContext.Provider>
  );
}

/**
 * Steps in order, then "+ Step". `path` is where the list sits in the
 * program (empty at the top), so each step finds what the shown run did.
 */
export function StepList(props: {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
  /** What the first step can use. */
  scope: StepScope;
  path?: string;
  /** Where the first shown step sits in the list; earlier ones show elsewhere. */
  from?: number;
  /** Names the list for "+ Step", e.g. a branch. */
  place?: string;
  /** Say "Do nothing" while the list is empty, as a decision's branch does. */
  doNothing?: boolean;
}) {
  const from = () => props.from ?? 0;
  // Each step can use what the steps before it created.
  const scopeAt = (index: number) =>
    props.steps.slice(0, index).reduce(scopeAfter, props.scope);
  const pathAt = (index: number) =>
    props.path ? `${props.path}.${index}` : String(index);
  const replace = (id: string, next: StepDraft) =>
    props.onChange(props.steps.map((step) => (step.id === id ? next : step)));
  const move = (id: string, delta: number) => {
    const at = props.steps.findIndex((step) => step.id === id);
    const to = at + delta;
    if (at < 0 || to < from() || to >= props.steps.length) return;
    const steps = [...props.steps];
    const [step] = steps.splice(at, 1);
    if (step) steps.splice(to, 0, step);
    props.onChange(steps);
  };
  const shown = () => props.steps.slice(from()).map((step) => step.id);
  return (
    <div class="grid min-w-0 gap-2">
      <For each={shown()}>
        {(id) => {
          const index = () => props.steps.findIndex((step) => step.id === id);
          return (
            <Show when={props.steps[index()]}>
              {(step) => (
                <StepNode
                  step={step()}
                  first={index() === from()}
                  last={index() === props.steps.length - 1}
                  path={pathAt(index())}
                  scope={scopeAt(index())}
                  onChange={(next) => replace(id, next)}
                  onMove={(delta) => move(id, delta)}
                  onReplace={(next) => replace(id, next)}
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
      <Show
        when={!props.path}
        fallback={
          <div class="flex min-w-0 items-center gap-2">
            <Show when={props.doNothing && !shown().length}>
              <DoNothing />
            </Show>
            <AddStep
              place={props.place}
              scope={scopeAt(props.steps.length)}
              onAdd={(step) => props.onChange([...props.steps, step])}
            />
          </div>
        }
      >
        {/* The routine's own list adds steps from a tray under its last card. */}
        <RoutineTray
          attached={shown().length > 0}
          // Into the list's gap, and behind the last card's corners.
          class={shown().length > 0 ? '-mt-5' : undefined}
        >
          <AddStep
            variant="tray"
            place={props.place}
            scope={scopeAt(props.steps.length)}
            onAdd={(step) => props.onChange([...props.steps, step])}
          />
        </RoutineTray>
      </Show>
    </div>
  );
}

/** A step's card, and under a decision its branches. */
function StepNode(props: StepCardProps) {
  const decision = () =>
    props.step.kind === 'if' || props.step.kind === 'choose'
      ? props.step
      : undefined;
  return (
    <div class="grid min-w-0 gap-2">
      <StepCard {...props} />
      <Show when={decision()}>
        {(step) => (
          <DecisionBranches
            step={step()}
            path={props.path}
            scope={props.scope}
            onChange={props.onChange}
          />
        )}
      </Show>
    </div>
  );
}

export function actionIcon(key: StepActionKey): Component<{ class?: string }> {
  return match(key)
    .with('archive', () => ArchiveIcon)
    .with('star', 'mark_important', () => StarIcon)
    .with('add_label', 'remove_label', () => TagIcon)
    .with('mark_read', 'sender_policy', () => EnvelopeIcon)
    .with('add_tag', () => TagIcon)
    .with('set_status', 'set_priority', () => FlagIcon)
    .with('assign', () => UserPlusIcon)
    .with('move', () => FolderIcon)
    .with('create_task', () => CheckSquareIcon)
    .with('create_document', () => FileTextIcon)
    .with('comment', () => ChatIcon)
    .with('send_message', 'reply_in_thread', () => PaperPlaneIcon)
    .with('other', () => SparkleIcon)
    .exhaustive();
}

export function stepIcon(step: StepDraft): Component<{ class?: string }> {
  return match(step)
    .with({ kind: 'agent' }, () => SparkleIcon)
    .with({ kind: 'if' }, () => GitBranchIcon)
    .with({ kind: 'choose' }, (step) =>
      pickAction(step) ? SparkleIcon : GitForkIcon
    )
    .with({ kind: 'tool' }, (step) => actionIcon(stepActionKey(step)))
    .exhaustive();
}

/** Steps where AI judges something: agents and decisions. */
function usesAi(step: StepDraft): boolean {
  return step.kind !== 'tool';
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

const percent = (probability: number | undefined) =>
  probability === undefined ? '' : ` ${Math.round(probability * 100)}%`;

type RunOutcome = {
  failed?: string;
  /** A decision's answer. */
  text?: string;
  /** The answer was no, or nothing fit. */
  quiet?: boolean;
};

/** What a run did at one step: an error, a decision's answer, or plain success. */
export function runOutcome(record: HistoryStep): RunOutcome {
  return match(record)
    .returnType<RunOutcome>()
    .with({ kind: 'if' }, (record) => ({
      text: `${record.answer ? 'Yes' : 'No'}${percent(record.probability)}`,
      quiet: !record.answer,
    }))
    .with({ kind: 'choose' }, (record) => ({
      text: record.choices?.length
        ? `${record.choices.join(', ')}${percent(record.probability)}`
        : 'Nothing fit',
      quiet: !record.choices?.length,
    }))
    .with({ kind: 'tool' }, { kind: 'agent' }, (record) =>
      record.error ? { failed: record.error } : {}
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
                <Show when={!result().quiet}>
                  <CheckIcon class="size-3.5 shrink-0 text-success" />
                </Show>
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
  first: boolean;
  last: boolean;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
  onMove(delta: number): void;
  /** Swap the step for another, e.g. a question wrapped around it. */
  onReplace(step: StepDraft): void;
  onDuplicate(copy: StepDraft): void;
  onRemove(): void;
};

/**
 * One step: closed, a single line ("Add label  Finance" and what the shown
 * run did); open, its settings under its name.
 */
function StepCard(props: StepCardProps) {
  const steps = useSteps();
  // Open where there is something to do; a finished routine reads as a list.
  // A routine that is a single action or agent opens it; a lone decision
  // reads better as its branches.
  const [open, setOpen] = createSignal(
    (steps.steps().length === 1 &&
      steps.steps()[0]?.id === props.step.id &&
      props.step.kind !== 'if' &&
      props.step.kind !== 'choose') ||
      steps.fresh.has(props.step.id) ||
      stepNeedsInput(props.step)
  );
  const headline = () => stepHeadline(props.step);
  // A step acting on an item an earlier step created says so.
  const onTarget = () =>
    props.step.kind === 'tool'
      ? props.scope.items.find(
          (item) =>
            item.ref !== TRIGGER_ID &&
            JSON.stringify(props.step).includes(item.ref)
        )
      : undefined;
  const summary = () =>
    [headline().summary, onTarget() && `on the new ${onTarget()?.subject}`]
      .filter(Boolean)
      .join(' · ');
  return (
    <RoutineSurface>
      <section
        aria-label={headline().title}
        class="@container/step group/step min-w-0"
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          props.onMove(event.key === 'ArrowUp' ? -1 : 1);
        }}
      >
        <div class="flex min-w-0 items-center gap-1 pr-1.5">
          <button
            type="button"
            aria-expanded={open()}
            class="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-muted"
            onClick={() => setOpen(!open())}
          >
            <span class="w-4.5 shrink-0 text-right text-xs tabular-nums text-ink-extra-muted">
              {steps.number(props.step.id)}
            </span>
            <StepIcon step={props.step} />
            <span class="shrink-0 text-sm font-medium">{headline().title}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
              {open() ? '' : summary()}
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
          <div class="grid min-w-0 gap-3 pb-3.5 pl-[3.5rem] pr-3 pt-1 @max-[30rem]/step:pl-3">
            <StepBody
              step={props.step}
              path={props.path}
              scope={props.scope}
              onChange={props.onChange}
            />
          </div>
        </Show>
      </section>
    </RoutineSurface>
  );
}

const ALT = IS_MAC ? '⌥' : 'Alt+';

function MenuShortcut(props: { children: JSX.Element }) {
  return (
    <span class="ml-auto pl-3 text-xs text-ink-muted">{props.children}</span>
  );
}

/** Move, duplicate, wrap in a question, or delete a step. */
function StepMenu(props: StepCardProps & { open: boolean }) {
  const steps = useSteps();
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
            onSelect={() =>
              props.onDuplicate(copyStep(props.step, steps.steps()))
            }
          >
            <CopyIcon class="size-4" />
            Duplicate
          </Dropdown.Item>
          <Show when={steps.decisions() !== 'off'}>
            <Dropdown.Item
              disabledReason={
                steps.decisions() === 'needs-event'
                  ? 'Questions need an activity trigger, like a new email or task.'
                  : undefined
              }
              onSelect={() => {
                const wrapped = wrapInIf(props.step);
                steps.fresh.add(wrapped.id);
                props.onReplace(wrapped);
              }}
            >
              <GitBranchIcon class="size-4" />
              Wrap in “If yes or no”
            </Dropdown.Item>
          </Show>
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
  scope: StepScope;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  return (
    <Switch>
      <Match when={props.step.kind === 'agent' && props.step}>
        {(step) => <AgentBody step={step()} onChange={props.onChange} />}
      </Match>
      <Match when={props.step.kind === 'tool' && props.step}>
        {(step) => (
          <ToolStepBody
            step={step()}
            onChange={props.onChange}
            slots={steps.slots}
            scope={props.scope}
          />
        )}
      </Match>
      <Match
        when={
          (props.step.kind === 'if' || props.step.kind === 'choose') &&
          props.step
        }
      >
        {(step) => (
          <DecisionBody
            step={step() as IfStepDraft | ChooseStepDraft}
            path={props.path}
            scope={props.scope}
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

/** For a decision's empty branch. */
export function DoNothing() {
  return <span class="text-xs text-ink-muted">Do nothing</span>;
}
