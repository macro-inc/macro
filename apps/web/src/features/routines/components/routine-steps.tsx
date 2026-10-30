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
import PlusIcon from '@phosphor/plus.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import StarIcon from '@phosphor/star.svg';
import TagIcon from '@phosphor/tag.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Dropdown, Input, TextField } from '@ui';
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
import {
  type AgentStepDraft,
  agentStep,
  type ChoiceDraft,
  type ChooseStepDraft,
  choice,
  chooseStep,
  type IfStepDraft,
  ifStep,
  STEP_LIMITS,
  type StepDraft,
  type ToolStepDraft,
} from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import {
  availableActions,
  availablePicks,
  blankPickOption,
  createActionStep,
  createPickStep,
  describeChoice,
  describeToolStep,
  type PickActionKey,
  pickAction,
  pickHints,
  retarget,
  type StepActionKey,
  type StepScope,
  scopeAfter,
  singleValued,
  stepActionGroups,
  stepActionKey,
  stepNeedsInput,
  stepTarget,
  stepTargets,
  summarizeStep,
} from '../core/step-catalog';
import {
  ActionValue,
  menuMount,
  type RoutineToolSlots,
  TargetRow,
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

function actionIcon(key: StepActionKey): Component<{ class?: string }> {
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

function stepIcon(step: StepDraft): Component<{ class?: string }> {
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

export function stepTitle(step: StepDraft): string {
  return match(step)
    .with({ kind: 'agent' }, () => 'Ask AI')
    .with({ kind: 'if' }, () => 'If')
    .with({ kind: 'choose' }, (step) => describeChoice(step))
    .with({ kind: 'tool' }, (step) => describeToolStep(step))
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

/** One row of a decision: an answer AI can give and the steps it runs. */
export type DecisionRow = {
  /** Stable across edits: the option's id, or its branch for fixed rows. */
  key: string;
  /** Its branch in the step's path: `then`, `options.1`, `otherwise`. */
  branch: string;
  option?: ChoiceDraft;
  /** Fixed rows: Yes, No and Nothing fits. */
  label?: string;
  steps: StepDraft[];
  setSteps(steps: StepDraft[]): void;
};

export function decisionRows(
  step: IfStepDraft | ChooseStepDraft,
  onChange: (step: StepDraft) => void
): DecisionRow[] {
  if (step.kind === 'if')
    return [
      {
        key: 'then',
        branch: 'then',
        label: 'Yes',
        steps: step.yes,
        setSteps: (yes) => onChange({ ...step, yes }),
      },
      {
        key: 'else',
        branch: 'else',
        label: 'No',
        steps: step.no,
        setSteps: (no) => onChange({ ...step, no }),
      },
    ];
  return [
    ...step.options.map((option, index) => ({
      key: option.id,
      branch: `options.${index}`,
      option,
      steps: option.steps,
      setSteps: (steps: StepDraft[]) =>
        onChange({
          ...step,
          options: step.options.map((item) =>
            item.id === option.id ? { ...item, steps } : item
          ),
        }),
    })),
    {
      key: 'otherwise',
      branch: 'otherwise',
      label: 'Nothing fits',
      steps: step.otherwise,
      setSteps: (otherwise) => onChange({ ...step, otherwise }),
    },
  ];
}

/** Whether the shown run took this row. */
export function rowChosen(
  record: HistoryStep | undefined,
  row: DecisionRow
): boolean {
  if (!record) return false;
  if (record.kind === 'if')
    return row.branch === (record.answer ? 'then' : 'else');
  if (record.kind !== 'choose') return false;
  const choices = record.choices ?? [];
  return row.option
    ? choices.includes(row.option.label.trim())
    : row.branch === 'otherwise' && !choices.length;
}

function ModeToggle(props: {
  multiple: boolean;
  onChange(multiple: boolean): void;
}) {
  const modes = [
    { multiple: false, label: 'Best match' },
    { multiple: true, label: 'All that apply' },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Which answers run"
      class="flex shrink-0 rounded-lg border border-edge-muted bg-input p-0.5"
    >
      <For each={modes}>
        {(mode) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.multiple === mode.multiple}
            class={cn(
              'h-6 rounded-md px-2 text-xs',
              props.multiple === mode.multiple
                ? 'bg-hover font-medium text-ink'
                : 'text-ink-muted'
            )}
            onClick={() => props.onChange(mode.multiple)}
          >
            {mode.label}
          </button>
        )}
      </For>
    </div>
  );
}

/**
 * A decision: a question, then each answer AI can give with the steps it
 * runs. Picks list values; other decisions read as an If AI says / Then table.
 */
function DecisionBody(props: {
  step: IfStepDraft | ChooseStepDraft;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  const [editing, setEditing] = createSignal<string>();
  const pick = () =>
    props.step.kind === 'choose' ? pickAction(props.step) : undefined;
  const record = () => steps.run()?.get(props.path);
  const rows = () => decisionRows(props.step, props.onChange);
  const choose = () => (props.step.kind === 'choose' ? props.step : undefined);
  const setOptions = (options: ChoiceDraft[]) => {
    const step = choose();
    if (step) props.onChange({ ...step, options });
  };
  const updateOption = (id: string, patch: Partial<ChoiceDraft>) => {
    const step = choose();
    if (step)
      setOptions(
        step.options.map((option) =>
          option.id === id ? { ...option, ...patch } : option
        )
      );
  };
  const removeOption = (id: string) =>
    setOptions((choose()?.options ?? []).filter((option) => option.id !== id));
  // A pick's first step applies the row's value; every row acts on one item.
  const firstPickStep = () =>
    choose()
      ?.options.map((option) => option.steps[0])
      .find((step): step is ToolStepDraft => step?.kind === 'tool');
  const retargetAll = (moved: ToolStepDraft) => {
    const step = choose();
    const item = stepTargets(moved, props.scope).find(
      (item) => item.ref === stepTarget(moved)
    );
    if (!step || !item) return;
    setOptions(
      step.options.map((option) => ({
        ...option,
        steps: option.steps.map((step, index) =>
          index === 0 && step.kind === 'tool' ? retarget(step, item) : step
        ),
      }))
    );
  };
  const addOption = () => {
    const step = choose();
    if (!step) return;
    const key = pick();
    const option = key ? blankPickOption(step, key) : choice();
    if (option) setOptions([...step.options, option]);
  };
  // Keyed by row, so typing in one keeps its inputs mounted.
  const rowKeys = () => rows().map((row) => row.key);
  const rowFor = (key: string) => rows().find((row) => row.key === key);
  const canRemove = () => (choose()?.options.length ?? 0) > 2;
  return (
    <div class="grid min-w-0 overflow-hidden rounded-lg border border-edge-muted bg-panel">
      <div class="flex min-w-0 flex-wrap items-center gap-2 border-b border-edge-muted bg-accent-bg/40 px-2.5 py-2">
        <Show
          when={props.step.kind === 'if' && props.step}
          fallback={
            <Input
              aria-label="What AI decides"
              size="sm"
              class="min-w-48 flex-1 border-transparent bg-transparent"
              value={choose()?.question ?? ''}
              maxLength={STEP_LIMITS.description}
              placeholder="What is AI deciding? e.g. What kind of email is this?"
              onInput={(event) => {
                const step = choose();
                if (step)
                  props.onChange({
                    ...step,
                    question: event.currentTarget.value,
                  });
              }}
            />
          }
        >
          {(step) => (
            <Input
              aria-label="Yes/no question"
              size="sm"
              class="min-w-48 flex-1 border-transparent bg-transparent"
              value={step().condition}
              maxLength={STEP_LIMITS.condition}
              placeholder="Ask AI a yes/no question, e.g. Is this from a customer?"
              onInput={(event) =>
                props.onChange({
                  ...step(),
                  condition: event.currentTarget.value,
                })
              }
            />
          )}
        </Show>
        <Show when={pick() && firstPickStep()}>
          {(step) => (
            <TargetRow
              step={step()}
              scope={props.scope}
              onChange={retargetAll}
            />
          )}
        </Show>
        <Show
          when={
            props.step.kind === 'choose' &&
            !(pick() && singleValued(pick() as PickActionKey))
          }
        >
          <ModeToggle
            multiple={choose()?.multiple ?? false}
            onChange={(multiple) => {
              const step = choose();
              if (step) props.onChange({ ...step, multiple });
            }}
          />
        </Show>
      </div>
      <Show
        when={pick()}
        fallback={
          <div
            role="table"
            aria-label="Rules"
            class="grid min-w-0 grid-cols-[minmax(10rem,2fr)_minmax(0,3fr)]"
          >
            <div role="row" class="contents">
              <span
                role="columnheader"
                class="border-b border-edge-muted px-2.5 py-1.5 text-xs font-medium text-ink-muted"
              >
                If AI says
              </span>
              <span
                role="columnheader"
                class="border-b border-l border-edge-muted px-2.5 py-1.5 text-xs font-medium text-ink-muted"
              >
                Then
              </span>
            </div>
            <For each={rowKeys()}>
              {(key) => (
                <Show when={rowFor(key)}>
                  {(row) => (
                    <RuleRow
                      row={row()}
                      path={`${props.path}.${row().branch}`}
                      scope={props.scope}
                      chosen={rowChosen(record(), row())}
                      editing={editing()}
                      onEdit={setEditing}
                      canRemove={canRemove()}
                      onOption={(patch) => updateOption(key, patch)}
                      onRemoveOption={() => removeOption(key)}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
        }
      >
        {(key) => (
          <div class="grid min-w-0">
            <For each={rowKeys().filter((rowKey) => rowKey !== 'otherwise')}>
              {(rowKey) => (
                <Show when={rowFor(rowKey)}>
                  {(row) => (
                    <PickRow
                      row={row()}
                      path={`${props.path}.${row().branch}`}
                      scope={props.scope}
                      chosen={rowChosen(record(), row())}
                      editing={editing()}
                      onEdit={setEditing}
                      pick={key()}
                      canRemove={canRemove()}
                      onOption={(patch) => updateOption(rowKey, patch)}
                      onRemoveOption={() => removeOption(rowKey)}
                    />
                  )}
                </Show>
              )}
            </For>
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start rounded-none border-b border-edge-muted font-normal text-ink-muted"
              disabled={(choose()?.options.length ?? 0) >= STEP_LIMITS.options}
              onClick={addOption}
            >
              <PlusIcon class="size-3.5" />
              {pickHints[key()].add}
            </Button>
            <Show when={rowFor('otherwise')}>
              {(row) => (
                <FallbackRow
                  row={row()}
                  path={`${props.path}.${row().branch}`}
                  scope={props.scope}
                  chosen={rowChosen(record(), row())}
                  editing={editing()}
                  onEdit={setEditing}
                />
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.step.kind === 'choose' && !pick()}>
        <Button
          variant="ghost"
          size="sm"
          class="w-full justify-start rounded-none border-t border-edge-muted font-normal text-ink-muted"
          disabled={(choose()?.options.length ?? 0) >= STEP_LIMITS.options}
          onClick={addOption}
        >
          <PlusIcon class="size-3.5" />
          Add option
        </Button>
      </Show>
    </div>
  );
}

type RowProps = {
  row: DecisionRow;
  path: string;
  scope: StepScope;
  chosen: boolean;
  editing: string | undefined;
  onEdit(id: string | undefined): void;
};

/** A row's steps from `from` on, as chips that open their editor. */
function StepChips(props: RowProps & { from?: number }) {
  return (
    <For each={props.row.steps}>
      {(step, index) => (
        <Show when={index() >= (props.from ?? 0)}>
          <StepChip
            step={step}
            path={`${props.path}.${index()}`}
            active={props.editing === step.id}
            onClick={() =>
              props.onEdit(props.editing === step.id ? undefined : step.id)
            }
          />
        </Show>
      )}
    </For>
  );
}

/** Each step can use what the row's earlier steps created. */
function rowScope(props: RowProps, index: number): StepScope {
  return props.row.steps.slice(0, index).reduce(scopeAfter, props.scope);
}

/** The dashed + that adds a step to a row and opens it. */
function AddRowStep(props: RowProps & { title?: string }) {
  return (
    <AddStep
      variant="chip"
      title={props.title}
      scope={rowScope(props, props.row.steps.length)}
      onAdd={(step) => {
        props.row.setSteps([...props.row.steps, step]);
        props.onEdit(step.id);
      }}
    />
  );
}

/** The editor of the row's step being edited, under the row. */
function RowEditor(props: RowProps & { class?: string }) {
  const index = () =>
    props.row.steps.findIndex((step) => step.id === props.editing);
  return (
    <Show when={index() >= 0 && props.row.steps[index()]}>
      {(step) => (
        <div
          class={cn(
            'min-w-0 border-b border-edge-muted bg-surface px-3 py-3',
            props.class
          )}
        >
          <div class="mb-2 flex min-w-0 items-center gap-2">
            <StepIcon step={step()} />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">
              {stepTitle(step())}
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="text-ink-muted"
              onClick={() => {
                props.row.setSteps(
                  props.row.steps.filter((item) => item.id !== step().id)
                );
                props.onEdit(undefined);
              }}
            >
              <TrashIcon class="size-3.5" />
              Remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => props.onEdit(undefined)}
            >
              Done
            </Button>
          </div>
          <StepBody
            step={step()}
            path={`${props.path}.${index()}`}
            scope={rowScope(props, index())}
            onChange={(next) =>
              props.row.setSteps(
                props.row.steps.map((item) =>
                  item.id === step().id ? next : item
                )
              )
            }
          />
        </div>
      )}
    </Show>
  );
}

function OptionDescription(props: {
  value: string;
  placeholder: string;
  onChange(value: string): void;
}) {
  return (
    <TextField value={props.value} onChange={props.onChange} class="min-w-0">
      <TextField.Label class="sr-only">When it fits</TextField.Label>
      <TextField.TextArea
        autoResize
        rows={1}
        maxLength={STEP_LIMITS.description}
        placeholder={props.placeholder}
        class="min-h-0 resize-none border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-muted"
      />
    </TextField>
  );
}

function RemoveOption(props: { onRemove(): void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove option"
      class="shrink-0 text-ink-muted"
      onClick={() => props.onRemove()}
    >
      <XIcon class="size-3.5" />
    </Button>
  );
}

function Chosen() {
  return (
    <CheckIcon class="size-3.5 shrink-0 text-success" aria-label="Chosen" />
  );
}

/** A table row: an answer on the left, the steps it runs on the right. */
function RuleRow(
  props: RowProps & {
    canRemove: boolean;
    onOption(patch: Partial<ChoiceDraft>): void;
    onRemoveOption(): void;
  }
) {
  return (
    <div role="row" class="contents">
      <div
        role="cell"
        class={cn(
          'flex min-w-0 flex-col gap-1 border-b border-edge-muted px-2.5 py-2',
          props.chosen && 'bg-success-bg'
        )}
      >
        <Show
          when={props.row.option}
          fallback={
            <span
              class={cn(
                'flex items-center gap-1.5',
                props.row.branch === 'otherwise'
                  ? 'text-xs text-ink-muted'
                  : 'text-sm font-medium'
              )}
            >
              {props.row.label}
              <Show when={props.chosen}>
                <Chosen />
              </Show>
            </span>
          }
        >
          {(option) => (
            <>
              <div class="flex min-w-0 items-center gap-1.5">
                <Input
                  aria-label="Option"
                  size="sm"
                  class="min-w-0 flex-1"
                  value={option().label}
                  maxLength={STEP_LIMITS.label}
                  placeholder="Invoice"
                  onInput={(event) =>
                    props.onOption({ label: event.currentTarget.value })
                  }
                />
                <Show when={props.chosen}>
                  <Chosen />
                </Show>
                <Show when={props.canRemove}>
                  <RemoveOption onRemove={props.onRemoveOption} />
                </Show>
              </div>
              <OptionDescription
                value={option().description}
                placeholder="When it fits (optional)"
                onChange={(description) => props.onOption({ description })}
              />
            </>
          )}
        </Show>
      </div>
      <div
        role="cell"
        class="flex min-w-0 flex-wrap content-start items-center gap-1.5 border-b border-l border-edge-muted px-2.5 py-2"
      >
        <StepChips {...props} />
        <Show when={!props.row.steps.length}>
          <span class="text-xs text-ink-extra-muted">Do nothing</span>
        </Show>
        <AddRowStep {...props} />
      </div>
      <RowEditor {...props} class="col-span-2" />
    </div>
  );
}

/**
 * A pick's row: the value AI may apply and when it fits. Its first step
 * applies the value; later steps show as "Also".
 */
function PickRow(
  props: RowProps & {
    pick: PickActionKey;
    canRemove: boolean;
    onOption(patch: Partial<ChoiceDraft>): void;
    onRemoveOption(): void;
  }
) {
  const steps = useSteps();
  const valueStep = () => {
    const [step] = props.row.steps;
    return step?.kind === 'tool' ? step : undefined;
  };
  return (
    <div
      class={cn(
        'grid min-w-0 gap-1.5 border-b border-edge-muted px-2.5 py-2',
        props.chosen && 'bg-success-bg'
      )}
    >
      <div class="flex min-w-0 items-start gap-2">
        <Show when={valueStep()}>
          {(step) => (
            // A minimum width lines up most rows' descriptions.
            <div class="flex min-w-28 shrink-0 items-center gap-1.5">
              <ActionValue
                step={step()}
                slots={steps.slots}
                onChange={(patch, name) =>
                  props.onOption({
                    label: name,
                    steps: [
                      {
                        ...step(),
                        arguments: { ...step().arguments, ...patch },
                      },
                      ...props.row.steps.slice(1),
                    ],
                  })
                }
              />
              <Show when={props.chosen}>
                <Chosen />
              </Show>
            </div>
          )}
        </Show>
        <div class="min-w-0 flex-1 pt-0.5">
          <OptionDescription
            value={props.row.option?.description ?? ''}
            placeholder={pickHints[props.pick].placeholder}
            onChange={(description) => props.onOption({ description })}
          />
        </div>
        <AddRowStep {...props} title="Also do something when this fits" />
        <Show when={props.canRemove}>
          <RemoveOption onRemove={props.onRemoveOption} />
        </Show>
      </div>
      <Show when={props.row.steps.length > 1}>
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span class="text-xs text-ink-muted">Also</span>
          <StepChips {...props} from={1} />
        </div>
      </Show>
      <RowEditor {...props} class="-mx-2.5 -mb-2 border-b-0" />
    </div>
  );
}

/** What runs when no value fits, under a pick's values. */
function FallbackRow(props: RowProps) {
  return (
    <>
      <div
        class={cn(
          'flex min-w-0 flex-wrap items-center gap-1.5 px-2.5 py-2',
          props.chosen && 'bg-success-bg'
        )}
      >
        <span class="text-xs text-ink-muted">If nothing fits</span>
        <Show when={props.chosen}>
          <Chosen />
        </Show>
        <StepChips {...props} />
        <Show when={!props.row.steps.length}>
          <span class="text-xs text-ink-extra-muted">do nothing</span>
        </Show>
        <AddRowStep {...props} />
      </div>
      <RowEditor {...props} class="border-b-0 border-t" />
    </>
  );
}

export function chipLabel(step: StepDraft): string {
  return match(step)
    .with({ kind: 'if' }, (step) => `If ${step.condition.trim() || '…'}`)
    .otherwise((step) => stepTitle(step));
}

/** A step inside a rule; clicking it opens its editor under the row. */
function StepChip(props: {
  step: StepDraft;
  path: string;
  active: boolean;
  onClick(): void;
}) {
  const steps = useSteps();
  const record = () => steps.run()?.get(props.path);
  const failed = () => {
    const step = record();
    return Boolean(step && runOutcome(step).failed);
  };
  return (
    <button
      type="button"
      aria-expanded={props.active}
      class={cn(
        'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs',
        props.active
          ? 'border-edge-focus bg-panel text-ink'
          : 'border-edge-muted bg-surface text-ink',
        steps.run() && !record() && 'opacity-60'
      )}
      onClick={() => props.onClick()}
    >
      <Dynamic component={stepIcon(props.step)} class="size-3.5 shrink-0" />
      <span class="max-w-56 truncate">{chipLabel(props.step)}</span>
      <Show when={steps.run()}>
        <Show
          when={record()}
          fallback={<span class="sr-only">(didn’t run)</span>}
        >
          <Show
            when={failed()}
            fallback={
              <CheckIcon
                class="size-3 shrink-0 text-success"
                aria-label="Ran"
              />
            }
          >
            <WarningIcon
              class="size-3 shrink-0 text-failure"
              aria-label="Failed"
            />
          </Show>
        </Show>
      </Show>
    </button>
  );
}

function MenuHint(props: { children: JSX.Element }) {
  return (
    <p class="max-w-64 px-2 pb-1.5 text-xs text-ink-muted">{props.children}</p>
  );
}

export function AddStep(props: {
  /** `list` closes a step list; `chip` sits among a rule's steps. */
  variant: 'list' | 'chip';
  title?: string;
  scope: StepScope;
  onAdd(step: StepDraft): void;
}) {
  const steps = useSteps();
  const actions = () => availableActions(props.scope);
  const add = (step: StepDraft) => {
    steps.fresh.add(step.id);
    props.onAdd(step);
  };
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown placement="bottom-start">
      <Show
        when={props.variant === 'chip'}
        fallback={
          <Dropdown.Trigger
            ref={trigger}
            variant="ghost"
            size="sm"
            class="w-fit gap-1.5 text-ink-muted"
            aria-label="Add step"
          >
            <PlusIcon class="size-3.5" />
            Add step
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          class="size-7 shrink-0 border border-dashed border-edge text-ink-muted"
          aria-label="Add step to branch"
          title={props.title ?? 'Add a step'}
        >
          <PlusIcon class="size-3" />
        </Dropdown.Trigger>
      </Show>
      <Dropdown.Content
        portalScope="local"
        mount={menuMount(trigger)}
        class="max-h-[min(32rem,var(--kb-popper-content-available-height))] min-w-56 overflow-y-auto overscroll-contain"
      >
        <Dropdown.Group>
          <Dropdown.GroupLabel>AI</Dropdown.GroupLabel>
          <Dropdown.Item onSelect={() => add(agentStep(steps.defaultTarget()))}>
            <SparkleIcon class="size-4" />
            Ask AI
          </Dropdown.Item>
        </Dropdown.Group>
        <Show when={steps.decisions() !== 'off'}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Let AI decide</Dropdown.GroupLabel>
            <Show
              when={steps.decisions() === 'on'}
              fallback={
                <MenuHint>
                  Needs an activity trigger, like a new email or task.
                </MenuHint>
              }
            >
              <For each={availablePicks(props.scope)}>
                {(pick) => (
                  <Dropdown.Item
                    title={pick.description}
                    onSelect={() => add(createPickStep(pick, props.scope))}
                  >
                    <Dynamic
                      component={actionIcon(pick.action)}
                      class="size-4"
                    />
                    {pick.label}
                  </Dropdown.Item>
                )}
              </For>
              <Dropdown.Item onSelect={() => add(ifStep())}>
                <GitBranchIcon class="size-4" />
                If yes or no
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => add(chooseStep())}>
                <ArrowsSplitIcon class="size-4" />
                Choose between options
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
        </Show>
        <For each={stepActionGroups}>
          {(group) => (
            <Show when={actions().some((action) => action.group === group)}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>{group}</Dropdown.GroupLabel>
                <For
                  each={actions().filter((action) => action.group === group)}
                >
                  {(action) => (
                    <Dropdown.Item
                      title={action.description}
                      onSelect={() =>
                        add(
                          createActionStep(action, props.scope, steps.steps())
                        )
                      }
                    >
                      <Dynamic
                        component={actionIcon(action.key)}
                        class="size-4"
                      />
                      {action.label}
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Show>
          )}
        </For>
        <Show when={!actions().some((action) => action.group === 'Item')}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Item</Dropdown.GroupLabel>
            <MenuHint>
              Tag, assign, comment and move need an activity trigger or a task
              created by an earlier step.
            </MenuHint>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
