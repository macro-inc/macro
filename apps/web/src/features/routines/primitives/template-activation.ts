import type {
  CreateScheduledAction,
  RoutineTemplate,
  TemplateVariable,
} from '@service-scheduled-action/generated/schemas';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { DEFAULT_RUN_VISIBILITY } from '../core/draft';
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

/** The instructions a template's routine runs, from its task. */
export function templatePrompt(template: RoutineTemplate): string {
  const prompt = template.task.user_prompt;
  return typeof prompt === 'string' ? prompt : '';
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

  const prompt = () => {
    const activator = args.activator();
    if (!activator) return templatePrompt(args.template());
    return fillTemplatePrompt({
      prompt: templatePrompt(args.template()),
      variables: args.template().variables,
      activator,
      choices: choices(),
    });
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
      task: { ...template.task, user_prompt: prompt() },
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
