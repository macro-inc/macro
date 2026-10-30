import type {
  CreateScheduledAction,
  RoutineTemplate,
  TemplateVariable,
} from '@service-scheduled-action/generated/schemas';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { DEFAULT_RUN_VISIBILITY } from '../core/draft';
import {
  firstAgent,
  flattenSteps,
  type StepDraft,
  stepsFromTask,
  stepsToWire,
  updateStep,
} from '../core/routine-steps';
import {
  type Activator,
  argumentDestinations,
  fillStepArguments,
  fillTemplatePrompt,
  fillTemplateTrigger,
  keepsAuthor,
  needsDecision,
  type ReferenceChoice,
  type ReferenceState,
  referenceState,
  type StepDestination,
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
  const steps = stepsFromTask(template.task);
  if (steps) return firstAgent(steps)?.instructions ?? '';
  const prompt = template.task.user_prompt;
  return typeof prompt === 'string' ? prompt : '';
}

/** The fixed channels, folders and documents a template's steps act on. */
export function templateDestinations(
  template: Pick<RoutineTemplate, 'task'>
): StepDestination[] {
  const steps = stepsFromTask(template.task) ?? [];
  const seen = new Set<string>();
  return flattenSteps(steps).flatMap((step) =>
    step.kind === 'tool'
      ? argumentDestinations(step.arguments).filter(
          (destination) =>
            !seen.has(destination.id) && Boolean(seen.add(destination.id))
        )
      : []
  );
}

/** The tag options a template's steps apply. */
function templateTagOptions(template: Pick<RoutineTemplate, 'task'>): string[] {
  const steps = stepsFromTask(template.task) ?? [];
  return [
    ...new Set(
      flattenSteps(steps).flatMap((step) =>
        step.kind === 'tool' && Array.isArray(step.arguments.add_option_ids)
          ? step.arguments.add_option_ids.filter(
              (id): id is string => typeof id === 'string'
            )
          : []
      )
    ),
  ];
}

/**
 * The template's task filled in for the activator: every agent's instructions,
 * including agents in branches, and each tool step's arguments.
 */
function filledTask(
  task: RoutineTemplate['task'],
  fill: (instructions: string) => string,
  fillArguments: (args: Record<string, unknown>) => Record<string, unknown>
) {
  const steps = stepsFromTask(task);
  if (!steps) return { ...task, user_prompt: fill(templatePrompt({ task })) };
  return {
    ...task,
    steps: stepsToWire(
      flattenSteps(steps).reduce(
        (filled, current) =>
          updateStep(filled, current.id, (step) =>
            match(step)
              .returnType<StepDraft>()
              .with({ kind: 'agent' }, (agent) => ({
                ...agent,
                instructions: fill(agent.instructions),
              }))
              .with({ kind: 'tool' }, (tool) => ({
                ...tool,
                arguments: fillArguments(tool.arguments),
              }))
              .with({ kind: 'if' }, { kind: 'choose' }, (decision) => decision)
              .exhaustive()
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
  /**
   * Whether the activator can open each mentioned item and each step's fixed
   * destination (`templateDestinations`), by item ID.
   */
  access: Accessor<ReadonlyMap<string, boolean>>;
  /** Tag options the activator can apply; undefined until they're known. */
  tags?: Accessor<ReadonlySet<string> | undefined>;
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

  const destinations = createMemo(() => templateDestinations(args.template()));
  const tagIds = createMemo(() => templateTagOptions(args.template()));
  /** Still learning what the activator can open and apply. */
  const checking = () =>
    destinations().some((destination) => !args.access().has(destination.id)) ||
    (tagIds().length > 0 && args.tags?.() === undefined);
  /** Tags the steps apply that the activator can't: those steps start empty. */
  const missingTags = () => {
    const available = args.tags?.();
    return available ? tagIds().filter((id) => !available.has(id)) : [];
  };
  /** Channels and folders the activator can't open: their steps start empty. */
  const unreachable = () =>
    destinations().filter(
      (destination) =>
        destination.blockName !== 'md' &&
        args.access().get(destination.id) === false
    );
  /**
   * Documents the activator can't open. A step acting on one has nothing to
   * act on in their routine, so the template can't be activated as is.
   */
  const blocked = () =>
    destinations().filter(
      (destination) =>
        destination.blockName === 'md' &&
        args.access().get(destination.id) === false
    );

  /** The routine to create, once every reference that needs one has a decision. */
  const request = (): CreateScheduledAction | undefined => {
    const activator = args.activator();
    if (
      !activator ||
      undecided().length > 0 ||
      checking() ||
      blocked().length > 0
    )
      return undefined;
    const template = args.template();
    const context = {
      authorId: template.author,
      activator,
      keepAuthor: keepsAuthor(template.variables, template.author),
      inaccessible: new Set(unreachable().map((destination) => destination.id)),
      tags: args.tags?.(),
    };
    let cleared = false;
    const task = filledTask(template.task, fill(activator), (stepArgs) => {
      const filled = fillStepArguments(stepArgs, context);
      cleared ||= filled.cleared;
      return filled.args;
    });
    return {
      name: template.name,
      trigger: fillTemplateTrigger({
        trigger: template.trigger,
        variables: template.variables,
        activator,
      }),
      kind: 'Agent',
      task,
      // A step left without its destination can't run; it starts off.
      enabled: !cleared,
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
    checking,
    unreachable,
    missingTags,
    blocked,
  };
}
