import type {
  CreateScheduledAction,
  RoutineTemplate,
  TemplateVariable,
} from '@service-scheduled-action/generated/schemas';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { DEFAULT_RUN_VISIBILITY } from '../core/draft';
import {
  agentSteps,
  firstAgent,
  stepsFromTask,
  stepsToWire,
  updateStep,
} from '../core/routine-steps';
import {
  type Activator,
  fillTemplatePrompt,
  fillTemplateTrigger,
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
export function templatePrompt(template: Pick<RoutineTemplate, 'task'>): string {
  const steps = stepsFromTask(template.task);
  if (steps) return firstAgent(steps)?.instructions ?? '';
  const prompt = template.task.user_prompt;
  return typeof prompt === 'string' ? prompt : '';
}

/**
 * The template's task with every agent's instructions filled in for the
 * activator, including agents in branches.
 */
function filledTask(
  task: RoutineTemplate['task'],
  fill: (instructions: string) => string
) {
  const steps = stepsFromTask(task);
  if (!steps) return { ...task, user_prompt: fill(templatePrompt({ task })) };
  const agents = agentSteps(steps);
  if (!agents.length) return task;
  return {
    ...task,
    steps: stepsToWire(
      agents.reduce(
        (filled, agent) =>
          updateStep(filled, agent.id, (step) =>
            step.kind === 'agent'
              ? { ...step, instructions: fill(step.instructions) }
              : step
          ),
        steps
      )
    ),
  };
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
  const request = (): CreateScheduledAction | undefined => {
    const activator = args.activator();
    if (!activator || undecided().length > 0) return undefined;
    const template = args.template();
    return {
      name: template.name,
      trigger: fillTemplateTrigger({
        trigger: template.trigger,
        variables: template.variables,
        activator,
      }),
      kind: 'Agent',
      task: filledTask(template.task, fill(activator)),
      enabled: true,
      run_visibility: DEFAULT_RUN_VISIBILITY,
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
