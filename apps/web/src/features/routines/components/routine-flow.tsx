import { Popover } from '@kobalte/core/popover';
import CheckIcon from '@phosphor/check.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createContext,
  createSignal,
  For,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import type {
  ChooseStepDraft,
  IfStepDraft,
  StepDraft,
} from '../core/routine-steps';
import {
  actionLabel,
  type PickActionKey,
  pickAction,
  type StepScope,
  scopeAfter,
  summarizeStep,
} from '../core/step-catalog';
import {
  AddStep,
  chipLabel,
  type DecisionRow,
  decisionRows,
  RunStatus,
  rowChosen,
  runOutcome,
  StepBody,
  StepIcon,
  stepTitle,
  useSteps,
} from './routine-steps';
import { menuMount } from './routine-tool-step';

type FlowContextValue = {
  /** The step whose editor is open. */
  open: Accessor<string | undefined>;
  setOpen: Setter<string | undefined>;
};

const FlowContext = createContext<FlowContextValue>();

function useFlow(): FlowContextValue {
  const context = useContext(FlowContext);
  if (!context) throw new Error('Flow nodes need RoutineFlow');
  return context;
}

/**
 * The routine's steps as a flow: steps run top to bottom, and each decision
 * fans out into one column per answer that joins again below it. Clicking a
 * step opens its editor.
 */
export function RoutineFlow(props: {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
  scope: StepScope;
}) {
  const [open, setOpen] = createSignal<string>();
  const scopeAfterAll = () => props.steps.reduce(scopeAfter, props.scope);
  return (
    <FlowContext.Provider value={{ open, setOpen }}>
      <div class="min-w-0 overflow-x-auto pb-2">
        <div class="mx-auto flex w-max min-w-full flex-col items-center">
          <FlowSequence
            steps={props.steps}
            onChange={props.onChange}
            scope={props.scope}
            pathOf={String}
          />
          <Show when={props.steps.length}>
            <Line class="h-4" />
          </Show>
          <AddStep
            variant="list"
            scope={scopeAfterAll()}
            onAdd={(step) => {
              props.onChange([...props.steps, step]);
              setOpen(step.id);
            }}
          />
        </div>
      </div>
    </FlowContext.Provider>
  );
}

function Line(props: { class?: string }) {
  return <span class={cn('w-px shrink-0 bg-edge', props.class)} />;
}

/** Steps that run one after another, each followed by its branches. */
function FlowSequence(props: {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
  scope: StepScope;
  /** A step's path from its index in this list. */
  pathOf(index: number): string;
  /** Steps inside a branch, drawn small. */
  compact?: boolean;
  /** The first step applies the branch's value, named above it. */
  valueFirst?: boolean;
}) {
  // Each step can use what the steps before it in this branch created.
  const scopeAt = (index: number) =>
    props.steps.slice(0, index).reduce(scopeAfter, props.scope);
  const replace = (id: string, next: StepDraft) =>
    props.onChange(props.steps.map((step) => (step.id === id ? next : step)));
  return (
    <For each={props.steps.map((step) => step.id)}>
      {(id, index) => (
        <Show when={props.steps.find((step) => step.id === id)}>
          {(step) => (
            <>
              <Show when={index() > 0}>
                <Line class={props.compact ? 'h-3' : 'h-4'} />
              </Show>
              <FlowNode
                step={step()}
                number={props.compact ? undefined : index() + 1}
                value={Boolean(props.valueFirst) && index() === 0}
                path={props.pathOf(index())}
                scope={scopeAt(index())}
                onChange={(next) => replace(id, next)}
                onRemove={() =>
                  props.onChange(props.steps.filter((step) => step.id !== id))
                }
              />
              <Show
                when={
                  (step().kind === 'if' || step().kind === 'choose') && step()
                }
              >
                {(decision) => (
                  <FlowBranches
                    step={decision() as IfStepDraft | ChooseStepDraft}
                    path={props.pathOf(index())}
                    scope={scopeAt(index())}
                    onChange={(next) => replace(id, next)}
                  />
                )}
              </Show>
            </>
          )}
        </Show>
      )}
    </For>
  );
}

/** A decision's answers side by side, each with the steps it runs. */
function FlowBranches(props: {
  step: IfStepDraft | ChooseStepDraft;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  const rows = () => decisionRows(props.step, props.onChange);
  const record = () => steps.run()?.get(props.path);
  const pick = () =>
    props.step.kind === 'choose' ? pickAction(props.step) : undefined;
  // Keyed by row, so editing one column keeps the others mounted.
  const keys = () => rows().map((row) => row.key);
  return (
    <>
      <Line class="h-3" />
      <div class="flex">
        <For each={keys()}>
          {(key, index) => (
            <Show when={rows().find((row) => row.key === key)}>
              {(row) => (
                <FlowColumn
                  row={row()}
                  first={index() === 0}
                  last={index() === keys().length - 1}
                  path={`${props.path}.${row().branch}`}
                  scope={props.scope}
                  chosen={rowChosen(record(), row())}
                  dimmed={Boolean(record()) && !rowChosen(record(), row())}
                  pick={pick()}
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </>
  );
}

function FlowColumn(props: {
  row: DecisionRow;
  first: boolean;
  last: boolean;
  path: string;
  scope: StepScope;
  chosen: boolean;
  dimmed: boolean;
  pick: PickActionKey | undefined;
}) {
  const flow = useFlow();
  const label = () =>
    props.row.option?.label.trim() || props.row.label || 'Unnamed option';
  const fallback = () => props.row.branch === 'otherwise';
  const bus = () =>
    cn(
      'absolute h-px bg-edge',
      props.first ? 'left-1/2' : 'left-0',
      props.last ? 'right-1/2' : 'right-0'
    );
  return (
    <div
      class={cn(
        'relative flex flex-col items-center px-1',
        props.dimmed && 'opacity-50'
      )}
    >
      {/* The bus the answers hang from, and the one they join on. */}
      <span class={cn(bus(), 'top-0')} />
      <span class={cn(bus(), 'bottom-0')} />
      <Line class="h-3" />
      <span
        class={cn(
          'flex h-6 max-w-32 items-center gap-1 rounded-full border bg-panel px-2.5 text-xs',
          fallback()
            ? 'border-dashed border-edge text-ink-muted'
            : 'border-edge-muted text-ink'
        )}
      >
        <Show when={props.chosen}>
          <CheckIcon class="size-3 shrink-0 text-success" aria-label="Chosen" />
        </Show>
        <span class="truncate">{label()}</span>
      </span>
      <Line class="h-3" />
      <Show
        when={props.row.steps.length}
        fallback={
          <span class="py-1 text-xs text-ink-extra-muted">Do nothing</span>
        }
      >
        <FlowSequence
          steps={props.row.steps}
          onChange={props.row.setSteps}
          scope={props.scope}
          pathOf={(index) => `${props.path}.${index}`}
          compact
          valueFirst={Boolean(props.pick && props.row.option)}
        />
      </Show>
      <div class="mt-2">
        <AddStep
          variant="chip"
          title={`Add a step when AI says ${label()}`}
          scope={props.row.steps.reduce(scopeAfter, props.scope)}
          onAdd={(step) => {
            props.row.setSteps([...props.row.steps, step]);
            flow.setOpen(step.id);
          }}
        />
      </div>
      <Line class="mt-2 min-h-3 flex-1" />
    </div>
  );
}

/** A check or warning for what the shown run did at a small node. */
function RunMark(props: { path: string }) {
  const steps = useSteps();
  const record = () => steps.run()?.get(props.path);
  return (
    <Show when={record()}>
      {(record) => (
        <Show
          when={runOutcome(record()).failed}
          fallback={
            <CheckIcon class="size-3 shrink-0 text-success" aria-label="Ran" />
          }
        >
          {(error) => (
            <span title={error()} class="shrink-0">
              <WarningIcon class="size-3 text-failure" aria-label="Failed" />
            </span>
          )}
        </Show>
      )}
    </Show>
  );
}

/** A step in the flow; clicking it opens its editor beside it. */
function FlowNode(props: {
  step: StepDraft;
  /** Top-level steps are numbered and drawn full size. */
  number?: number;
  /** Applies its branch's value: named by the action alone. */
  value?: boolean;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
  onRemove(): void;
}) {
  const flow = useFlow();
  const isOpen = () => flow.open() === props.step.id;
  const label = () => {
    const step = props.step;
    if (props.value && step.kind === 'tool') return actionLabel(step);
    return props.number === undefined ? chipLabel(step) : stepTitle(step);
  };
  let trigger: HTMLButtonElement | undefined;
  return (
    <Popover
      open={isOpen()}
      onOpenChange={(open) => flow.setOpen(open ? props.step.id : undefined)}
      placement="bottom"
      gutter={6}
    >
      <Popover.Trigger
        ref={trigger}
        aria-label={stepTitle(props.step)}
        class={cn(
          'flex items-center gap-2 border bg-surface text-left',
          props.number === undefined
            ? 'h-10 w-[8.5rem] rounded-lg px-2 text-xs'
            : 'min-h-11 w-96 max-w-full rounded-xl px-3 text-sm',
          isOpen() ? 'border-edge-focus' : 'border-edge-muted'
        )}
      >
        <Show when={props.number} fallback={<StepIcon step={props.step} />}>
          {(number) => (
            <>
              <span class="w-4 shrink-0 text-xs tabular-nums text-ink-extra-muted">
                {number()}
              </span>
              <StepIcon step={props.step} />
            </>
          )}
        </Show>
        <span class="min-w-0 flex-1 truncate">
          <span class="font-medium">{label()}</span>
          <Show when={!props.value && summarizeStep(props.step)}>
            {(summary) => <span class="text-ink-muted"> {summary()}</span>}
          </Show>
        </span>
        <Show
          when={props.number !== undefined}
          fallback={<RunMark path={props.path} />}
        >
          <RunStatus path={props.path} />
        </Show>
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(trigger)}>
        <Popover.Content class="z-modal w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border border-edge-muted bg-menu p-3 text-ink shadow-lg">
          <div class="mb-2 flex min-w-0 items-center gap-2">
            <StepIcon step={props.step} />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">
              {stepTitle(props.step)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="text-ink-muted"
              onClick={() => {
                flow.setOpen(undefined);
                props.onRemove();
              }}
            >
              <TrashIcon class="size-3.5" />
              Remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => flow.setOpen(undefined)}
            >
              Done
            </Button>
          </div>
          <StepBody
            step={props.step}
            path={props.path}
            scope={props.scope}
            onChange={props.onChange}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
