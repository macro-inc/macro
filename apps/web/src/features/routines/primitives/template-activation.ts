import type {
  ActionConfiguration,
  RoutineTemplate,
  TemplateVariable,
} from '@service-scheduled-action/generated/schemas';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { DEFAULT_RUN_VISIBILITY } from '../core/draft';
import { firstAgent, programSteps, stepsToWire } from '../core/routine-steps';
import {
  type Activator,
  fillTemplatePrompt,
  fillTemplateTrigger,
  mapStepTexts,
  needsDecision,
  type ReferenceChoice,
  type ReferenceState,
  referenceState,
  variableKey,
} from '../core/template';

export type TemplateReference = {
  key: string;
  variable: TemplateVariable;
  state: ReferenceState;
};

/**
 * The instructions a template's routine runs, from its task: a routine with
 * steps keeps them on its agent step.
 */
export function templatePrompt(
  template: Pick<RoutineTemplate, 'task'>
): string {
  if (!('steps' in template.task)) return template.task.user_prompt;
  const steps = programSteps(template.task);
  return (steps && firstAgent(steps)?.instructions) ?? '';
}

/**
 * The template's task filled in for the activator: every text that can
 * mention someone (each Ask AI step's instructions).
 */
function filledTask(
  task: RoutineTemplate['task'],
  fill: (text: string) => string
): RoutineTemplate['task'] {
  if (!('steps' in task))
    return {
      ...task,
      prompt: fill(task.prompt),
      user_prompt: fill(task.user_prompt),
    };
  const steps = programSteps(task);
  return steps
    ? { ...task, steps: stepsToWire(mapStepTexts(steps, fill)) }
    : task;
}

/**
 * One person's activation of a template: which references they still have to
 * decide on, and the routine their decisions produce.
 */
export function createTemplateActivation(args: {
  template: Accessor<RoutineTemplate>;
  activator: Accessor<Activator | undefined>;
  /** Whether the activator can open each mentioned item, by item ID. */
  access: Accessor<ReadonlyMap<string, boolean>>;
}) {
  const [choices, setChoices] = createSignal<
    ReadonlyMap<string, ReferenceChoice>
  >(new Map());

  const references = createMemo((): TemplateReference[] =>
    args.template().variables.map((variable) => ({
      key: variableKey(variable),
      variable,
      state: referenceState(
        variable,
        variable.kind === 'item' ? args.access().get(variable.id) : undefined
      ),
    }))
  );

  const undecided = () =>
    references().filter(
      (reference) =>
        needsDecision(reference.state) && !choices().has(reference.key)
    );

  const fill = (activator: Activator) => (prompt: string) =>
    fillTemplatePrompt({
      prompt,
      variables: args.template().variables,
      activator,
      choices: choices(),
    });

  const prompt = () => {
    const activator = args.activator();
    const instructions = templatePrompt(args.template());
    return activator ? fill(activator)(instructions) : instructions;
  };

  /** The routine to create, once every reference that needs one has a decision. */
  const request = (): ActionConfiguration | undefined => {
    const activator = args.activator();
    if (!activator || undecided().length > 0) return undefined;
    const template = args.template();
    const task = filledTask(template.task, fill(activator));
    return {
      name: template.name,
      trigger: fillTemplateTrigger({
        trigger: template.trigger,
        variables: template.variables,
        activator,
      }),
      kind: 'Agent',
      task,
      enabled: true,
      run_visibility: DEFAULT_RUN_VISIBILITY,
      ...(template.description ? { description: template.description } : {}),
    };
  };

  return {
    references,
    undecided,
    choices,
    choose(key: string, choice: ReferenceChoice) {
      setChoices((current) => new Map(current).set(key, choice));
    },
    prompt,
    request,
  };
}
