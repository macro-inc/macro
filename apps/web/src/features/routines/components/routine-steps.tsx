import ArchiveIcon from '@phosphor/archive.svg';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import ArrowsSplitIcon from '@phosphor/arrows-split.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ChatIcon from '@phosphor/chat-circle-text.svg';
import CheckIcon from '@phosphor/check.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import EnvelopeIcon from '@phosphor/envelope-simple.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import FlagIcon from '@phosphor/flag.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import PaperPlaneIcon from '@phosphor/paper-plane-tilt.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import StarIcon from '@phosphor/star.svg';
import TagIcon from '@phosphor/tag.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Button, cn, Dropdown } from '@ui';
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
  stepTitle,
  summarizeStep,
} from '../core/step-catalog';
import { AddStep } from './routine-add-step';
import { DecisionBody } from './routine-decision-step';
import {
  menuMount,
  type RoutineToolSlots,
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
      }}
    >
      {props.children}
    </StepsContext.Provider>
  );
}

function formatRunTime(at: string | null | undefined): string {
  if (!at) return '';
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export function RunBanner(props: {
  run: RoutineRunView;
  shown: boolean;
  onToggle(): void;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2 text-xs text-ink-muted">
      <Show
        when={props.run.success !== false}
        fallback={<WarningIcon class="size-3.5 text-failure" />}
      >
        <CheckIcon class="size-3.5 text-success" />
      </Show>
      <span class="truncate">
        Last run {formatRunTime(props.run.endedAt)}
        {props.shown ? ' · shown on the steps' : ''}
      </span>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 px-1.5 text-xs text-ink-muted"
        onClick={() => props.onToggle()}
      >
        {props.shown ? 'Hide' : 'Show'}
      </Button>
    </div>
  );
}

export function StepList(props: {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
  /** What the first step can use. */
  scope: StepScope;
}) {
  // Each step can use what the steps before it created.
  const scopeAt = (index: number) =>
    props.steps.slice(0, index).reduce(scopeAfter, props.scope);
  const replace = (id: string, next: StepDraft) =>
    props.onChange(props.steps.map((step) => (step.id === id ? next : step)));
  const move = (id: string, delta: number) => {
    const from = props.steps.findIndex((step) => step.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= props.steps.length) return;
    const steps = [...props.steps];
    const [step] = steps.splice(from, 1);
    if (step) steps.splice(to, 0, step);
    props.onChange(steps);
  };
  return (
    <div class="grid min-w-0 gap-2">
      <For each={props.steps.map((step) => step.id)}>
        {(id, index) => (
          <Show when={props.steps.find((step) => step.id === id)}>
            {(step) => (
              <StepCard
                step={step()}
                number={index() + 1}
                only={props.steps.length === 1}
                first={index() === 0}
                last={index() === props.steps.length - 1}
                path={String(index())}
                scope={scopeAt(index())}
                onChange={(next) => replace(id, next)}
                onMove={(delta) => move(id, delta)}
                onRemove={() =>
                  props.onChange(props.steps.filter((step) => step.id !== id))
                }
              />
            )}
          </Show>
        )}
      </For>
      <AddStep
        variant="list"
        scope={scopeAt(props.steps.length)}
        onAdd={(step) => props.onChange([...props.steps, step])}
      />
    </div>
  );
}

export function actionIcon(key: StepActionKey): Component<{ class?: string }> {
  return match(key)
    .with('archive', () => ArchiveIcon)
    .with('star', 'mark_important', () => StarIcon)
    .with(
      'add_label',
      'remove_label',
      'mark_read',
      'sender_policy',
      () => EnvelopeIcon
    )
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
    .with({ kind: 'choose' }, (step) => {
      const pick = pickAction(step);
      return pick ? actionIcon(pick) : ArrowsSplitIcon;
    })
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
        'flex size-6 shrink-0 items-center justify-center rounded-md',
        usesAi(props.step)
          ? 'bg-accent-bg text-accent-ink'
          : 'bg-hover text-ink-muted'
      )}
    >
      <Dynamic component={stepIcon(props.step)} class="size-3.5" />
    </span>
  );
}

const percent = (probability: number | undefined) =>
  probability === undefined ? '' : ` · ${Math.round(probability * 100)}%`;

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
      text: `${
        record.choices?.length
          ? `Chose ${record.choices.join(', ')}`
          : 'Nothing fit'
      }${percent(record.probability)}`,
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
    <Show when={steps.run()}>
      <Switch
        fallback={
          <CheckIcon class="size-3.5 shrink-0 text-success" aria-label="Ran" />
        }
      >
        <Match when={!outcome()}>
          <span class="shrink-0 text-xs text-ink-extra-muted">Didn’t run</span>
        </Match>
        <Match when={outcome()?.failed}>
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
        <Match when={outcome()?.text}>
          {(text) => (
            <span
              class={cn(
                'min-w-0 shrink truncate text-xs',
                outcome()?.quiet ? 'text-ink-muted' : 'text-success-ink'
              )}
            >
              {text()}
            </span>
          )}
        </Match>
      </Switch>
    </Show>
  );
}

function StepCard(props: {
  step: StepDraft;
  number: number;
  only: boolean;
  first: boolean;
  last: boolean;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
  onMove(delta: number): void;
  onRemove(): void;
}) {
  const steps = useSteps();
  // Open where there is something to do; a finished routine reads as a list.
  const [open, setOpen] = createSignal(
    props.only || steps.fresh.has(props.step.id) || stepNeedsInput(props.step)
  );
  return (
    <section
      aria-label={stepTitle(props.step)}
      class={cn(
        'min-w-0 rounded-xl border bg-surface',
        open() ? 'border-edge' : 'border-edge-muted'
      )}
    >
      <div class="flex min-w-0 items-center gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={open()}
          class="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left"
          onClick={() => setOpen(!open())}
        >
          <span class="w-4 shrink-0 text-xs tabular-nums text-ink-extra-muted">
            {props.number}
          </span>
          <StepIcon step={props.step} />
          <span class="shrink-0 text-sm font-medium">
            {stepTitle(props.step)}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
            {open() ? '' : summarizeStep(props.step)}
          </span>
          <RunStatus path={props.path} />
          <CaretRightIcon
            class={cn(
              'size-3.5 shrink-0 text-ink-muted transition-transform',
              open() && 'rotate-90'
            )}
          />
        </button>
        <StepMenu
          first={props.first}
          last={props.last}
          onMove={props.onMove}
          onRemove={props.onRemove}
        />
      </div>
      <Show when={open()}>
        <div class="min-w-0 px-3 pb-3">
          <StepBody
            step={props.step}
            path={props.path}
            scope={props.scope}
            onChange={props.onChange}
          />
        </div>
      </Show>
    </section>
  );
}

function StepMenu(props: {
  first: boolean;
  last: boolean;
  onMove(delta: number): void;
  onRemove(): void;
}) {
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        ref={trigger}
        variant="ghost"
        size="icon-sm"
        aria-label="Step actions"
      >
        <DotsIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" mount={menuMount(trigger)}>
        <Dropdown.Group>
          <Dropdown.Item
            disabled={props.first}
            onSelect={() => props.onMove(-1)}
          >
            <ArrowUpIcon class="size-4" />
            Move up
          </Dropdown.Item>
          <Dropdown.Item disabled={props.last} onSelect={() => props.onMove(1)}>
            <ArrowDownIcon class="size-4" />
            Move down
          </Dropdown.Item>
          <Dropdown.Item onSelect={props.onRemove}>
            <TrashIcon class="size-4" />
            Remove step
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

function AgentBody(props: {
  step: AgentStepDraft;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  return (
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <steps.slots.ExecutionPicker
          target={props.step.target}
          onChange={(target) => props.onChange({ ...props.step, target })}
        />
      </div>
      <steps.slots.PromptEditor
        initialValue={props.step.instructions}
        onChange={(instructions) =>
          props.step.instructions === instructions
            ? undefined
            : props.onChange({ ...props.step, instructions })
        }
      />
    </div>
  );
}
