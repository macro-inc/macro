import PlusIcon from '@icon/system/regular/plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn, Input, Tabs } from '@ui';
import { For, Show } from 'solid-js';
import type { HistoryStep } from '../core/history';
import {
  type ChoiceDraft,
  type ChooseStepDraft,
  choice,
  type IfStepDraft,
  STEP_LIMITS,
  type StepDraft,
  type ToolStepDraft,
} from '../core/routine-steps';
import {
  blankPickOption,
  pickAction,
  pickHints,
  retarget,
  type StepScope,
  stepTarget,
  stepTargets,
} from '../core/step-catalog';
import { choiceMode } from '../core/step-headline';
import { AddStep } from './routine-add-step';
import { Field, StepList, useSteps } from './routine-steps';
import { ActionValue, PropRow, StepNote, TargetRow } from './routine-tool-step';

/** One answer AI can give and the steps it runs. */
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

const rowLabel = (row: DecisionRow) =>
  row.option ? row.option.label.trim() || 'Untitled option' : (row.label ?? '');

/**
 * Under a decision, each answer with the steps it runs, indented on a rule.
 * A pick's values live in its card, so only their extra steps show here.
 */
export function DecisionBranches(props: {
  step: IfStepDraft | ChooseStepDraft;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  const pick = () =>
    props.step.kind === 'choose' ? pickAction(props.step) : undefined;
  const record = () => steps.run()?.get(props.path);
  const rows = () =>
    decisionRows(props.step, props.onChange).filter((row) =>
      // A pick's first step applies its value; only what follows shows here.
      pick() ? row.steps.length > (row.option ? 1 : 0) : true
    );
  // Keyed by row, so editing one keeps the others mounted.
  const rowKeys = () => rows().map((row) => row.key);
  const rowFor = (key: string) => rows().find((row) => row.key === key);
  return (
    <Show when={rowKeys().length}>
      <div class="ml-5.5 grid min-w-0 gap-1 border-l border-edge-frame pl-4 max-sm:ml-3 max-sm:pl-3">
        <For each={rowKeys()}>
          {(key) => (
            <Show when={rowFor(key)}>
              {(row) => (
                <div class="grid min-w-0 gap-2">
                  <p
                    class={cn(
                      'flex min-h-6 min-w-0 items-center gap-1.5 text-xs font-medium',
                      rowChosen(record(), row())
                        ? 'text-success'
                        : 'text-ink-muted'
                    )}
                  >
                    <span class="shrink-0">
                      {rowLabel(row())}
                      <Show when={pick() && row().option}> also</Show>
                    </span>
                    <Show when={!pick() && row().option?.description.trim()}>
                      {(description) => (
                        <span class="min-w-0 truncate font-normal text-ink-placeholder">
                          · {description()}
                        </span>
                      )}
                    </Show>
                  </p>
                  <StepList
                    steps={row().steps}
                    onChange={row().setSteps}
                    scope={props.scope}
                    path={`${props.path}.${row().branch}`}
                    from={pick() && row().option ? 1 : 0}
                    place={`“${rowLabel(row())}”`}
                    doNothing
                  />
                </div>
              )}
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

/** A decision's settings: its question, how it runs, and its options. */
export function DecisionBody(props: {
  step: IfStepDraft | ChooseStepDraft;
  path: string;
  scope: StepScope;
  onChange(step: StepDraft): void;
}) {
  return (
    <Show
      when={props.step.kind === 'choose' && props.step}
      fallback={
        <Show when={props.step.kind === 'if' && props.step}>
          {(step) => (
            <Field label="Yes/no question">
              <Input
                aria-label="Yes/no question"
                value={step().condition}
                maxLength={STEP_LIMITS.condition}
                placeholder="Is this from a customer?"
                onInput={(event) =>
                  props.onChange({
                    ...step(),
                    condition: event.currentTarget.value,
                  })
                }
              />
            </Field>
          )}
        </Show>
      }
    >
      {(step) => (
        <Show
          when={pickAction(step())}
          fallback={<ChooseBody step={step()} onChange={props.onChange} />}
        >
          <PickBody
            step={step()}
            scope={props.scope}
            onChange={props.onChange}
          />
        </Show>
      )}
    </Show>
  );
}

function ModeTabs(props: {
  step: ChooseStepDraft;
  onChange(step: StepDraft): void;
}) {
  return (
    <Tabs
      aria-label="Which answers run"
      size="sm"
      options={[
        { value: 'best', label: 'Best match' },
        { value: 'all', label: 'All that apply' },
      ]}
      value={props.step.multiple ? 'all' : 'best'}
      onChange={(value) =>
        props.onChange({ ...props.step, multiple: value === 'all' })
      }
    />
  );
}

function RemoveOption(props: { label: string; onRemove(): void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Remove ${props.label || 'option'}`}
      onClick={() => props.onRemove()}
    >
      <XIcon class="size-3.5" />
    </Button>
  );
}

function setOption(
  step: ChooseStepDraft,
  id: string,
  patch: Partial<ChoiceDraft>
): ChooseStepDraft {
  return {
    ...step,
    options: step.options.map((option) =>
      option.id === id ? { ...option, ...patch } : option
    ),
  };
}

/** Choose between options: what AI decides, and each option's answer. */
function ChooseBody(props: {
  step: ChooseStepDraft;
  onChange(step: StepDraft): void;
}) {
  const canRemove = () => props.step.options.length > 2;
  return (
    <div class="grid min-w-0 gap-3">
      <Field label="What AI decides">
        <Input
          aria-label="What AI decides"
          value={props.step.question}
          maxLength={STEP_LIMITS.description}
          placeholder="What kind of email is this?"
          onInput={(event) =>
            props.onChange({
              ...props.step,
              question: event.currentTarget.value,
            })
          }
        />
      </Field>
      <Field label="Which answers run">
        <div>
          <ModeTabs step={props.step} onChange={props.onChange} />
        </div>
      </Field>
      <Field label={`Options · 2 to ${STEP_LIMITS.options}`}>
        <div class="grid min-w-0 gap-1.5">
          <For each={props.step.options.map((option) => option.id)}>
            {(id) => (
              <Show
                when={props.step.options.find((option) => option.id === id)}
              >
                {(option) => (
                  <div class="grid min-w-0 grid-cols-[minmax(0,9rem)_minmax(0,1fr)_1.75rem] items-center gap-2 @max-[30rem]/step:grid-cols-[minmax(0,1fr)_1.75rem]">
                    <Input
                      aria-label="Option"
                      value={option().label}
                      maxLength={STEP_LIMITS.label}
                      placeholder="Invoice"
                      onInput={(event) =>
                        props.onChange(
                          setOption(props.step, id, {
                            label: event.currentTarget.value,
                          })
                        )
                      }
                    />
                    <Input
                      aria-label="When it fits"
                      class="@max-[30rem]/step:order-last @max-[30rem]/step:col-span-2"
                      value={option().description}
                      maxLength={STEP_LIMITS.description}
                      placeholder="When it fits (optional)"
                      onInput={(event) =>
                        props.onChange(
                          setOption(props.step, id, {
                            description: event.currentTarget.value,
                          })
                        )
                      }
                    />
                    <Show when={canRemove()}>
                      <RemoveOption
                        label={option().label}
                        onRemove={() =>
                          props.onChange({
                            ...props.step,
                            options: props.step.options.filter(
                              (item) => item.id !== id
                            ),
                          })
                        }
                      />
                    </Show>
                  </div>
                )}
              </Show>
            )}
          </For>
          <Button
            variant="ghost"
            size="sm"
            class="w-fit"
            disabled={props.step.options.length >= STEP_LIMITS.options}
            onClick={() =>
              props.onChange({
                ...props.step,
                options: [...props.step.options, choice()],
              })
            }
          >
            <PlusIcon class="size-3.5" />
            Option
          </Button>
        </div>
      </Field>
      <StepNote>
        {props.step.multiple
          ? 'Every option AI says yes to runs, in order.'
          : 'Each option is one yes/no question to AI. The best one wins if it reaches 50%.'}
      </StepNote>
    </div>
  );
}

/**
 * A pick: the same action with a different value per option, e.g. a label
 * per kind of email. Each row is a value and when it fits.
 */
function PickBody(props: {
  step: ChooseStepDraft;
  scope: StepScope;
  onChange(step: StepDraft): void;
}) {
  const steps = useSteps();
  const key = () => pickAction(props.step);
  const canRemove = () => props.step.options.length > 2;
  // Every row acts on one item; a pick's first step applies the value.
  const firstStep = () =>
    props.step.options
      .map((option) => option.steps[0])
      .find((step): step is ToolStepDraft => step?.kind === 'tool');
  const retargetAll = (moved: ToolStepDraft) => {
    const item = stepTargets(moved, props.scope).find(
      (item) => item.ref === stepTarget(moved)
    );
    if (!item) return;
    props.onChange({
      ...props.step,
      options: props.step.options.map((option) => ({
        ...option,
        steps: option.steps.map((step, index) =>
          index === 0 && step.kind === 'tool' ? retarget(step, item) : step
        ),
      })),
    });
  };
  return (
    <div class="grid min-w-0 gap-3">
      <Show when={firstStep()}>
        {(step) => (
          <TargetRow step={step()} scope={props.scope} onChange={retargetAll} />
        )}
      </Show>
      <Show when={choiceMode(props.step)}>
        <PropRow label="Which run">
          <ModeTabs step={props.step} onChange={props.onChange} />
        </PropRow>
      </Show>
      <div class="grid min-w-0 gap-1.5">
        <For each={props.step.options.map((option) => option.id)}>
          {(id) => (
            <Show when={props.step.options.find((option) => option.id === id)}>
              {(option) => {
                const value = () => {
                  const [step] = option().steps;
                  return step?.kind === 'tool' ? step : undefined;
                };
                return (
                  <div class="grid min-w-0 grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 @max-[30rem]/step:grid-cols-[minmax(0,1fr)_auto]">
                    <div class="flex min-w-0">
                      <Show when={value()}>
                        {(step) => (
                          <ActionValue
                            step={step()}
                            slots={steps.slots}
                            onChange={(patch, name) =>
                              props.onChange(
                                setOption(props.step, id, {
                                  label: name,
                                  steps: [
                                    {
                                      ...step(),
                                      arguments: {
                                        ...step().arguments,
                                        ...patch,
                                      },
                                    },
                                    ...option().steps.slice(1),
                                  ],
                                })
                              )
                            }
                          />
                        )}
                      </Show>
                    </div>
                    <Input
                      aria-label="When it fits"
                      class="@max-[30rem]/step:order-last @max-[30rem]/step:col-span-2"
                      value={option().description}
                      maxLength={STEP_LIMITS.description}
                      placeholder={
                        key() ? pickHints[key()!].placeholder : 'When it fits'
                      }
                      onInput={(event) =>
                        props.onChange(
                          setOption(props.step, id, {
                            description: event.currentTarget.value,
                          })
                        )
                      }
                    />
                    <div class="flex items-center">
                      <AddStep
                        variant="icon"
                        place={`“${option().label.trim() || 'this option'}”`}
                        scope={props.scope}
                        onAdd={(step) =>
                          props.onChange(
                            setOption(props.step, id, {
                              steps: [...option().steps, step],
                            })
                          )
                        }
                      />
                      <Show when={canRemove()}>
                        <RemoveOption
                          label={option().label}
                          onRemove={() =>
                            props.onChange({
                              ...props.step,
                              options: props.step.options.filter(
                                (item) => item.id !== id
                              ),
                            })
                          }
                        />
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Show>
          )}
        </For>
        <Show when={key()}>
          {(pick) => (
            <Button
              variant="ghost"
              size="sm"
              class="w-fit"
              disabled={props.step.options.length >= STEP_LIMITS.options}
              onClick={() => {
                const option = blankPickOption(props.step, pick());
                if (option)
                  props.onChange({
                    ...props.step,
                    options: [...props.step.options, option],
                  });
              }}
            >
              <PlusIcon class="size-3.5" />
              {pickHints[pick()].add}
            </Button>
          )}
        </Show>
      </div>
      <PropRow label="Nothing fits">
        <Show
          when={props.step.otherwise.length}
          fallback={<span class="text-xs text-ink-muted">Do nothing</span>}
        >
          <span class="text-xs text-ink-muted">
            {props.step.otherwise.length === 1
              ? '1 step, below'
              : `${props.step.otherwise.length} steps, below`}
          </span>
        </Show>
        <AddStep
          variant="icon"
          place="“Nothing fits”"
          scope={props.scope}
          onAdd={(step) =>
            props.onChange({
              ...props.step,
              otherwise: [...props.step.otherwise, step],
            })
          }
        />
      </PropRow>
    </div>
  );
}
