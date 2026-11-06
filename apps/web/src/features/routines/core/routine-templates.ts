import type { CatalogEntry } from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft } from './draft';
import { createEmptyDraft, withNewDraftSteps } from './routine-draft';
import { agentStep, type StepDraft, stepsFromTask } from './routine-steps';
import type { RoutineTarget } from './routine-target';
import { describeTrigger, type RoutineTriggerDraft } from './routine-triggers';

/**
 * A starting point for a new routine: one of the scheduler's catalog
 * routines, with its trigger as the editor's drafts, shown before the
 * editor.
 */
export type RoutineTemplate = CatalogEntry & {
  triggers: RoutineTriggerDraft[];
};

/** Its trigger waits on a yes/no condition, which needs AI decisions. */
function needsDecisions(template: RoutineTemplate): boolean {
  const trigger = template.trigger;
  const values = trigger.type === 'multiple' ? trigger.triggers : [trigger];
  return values.some(
    (value) =>
      value.type === 'events' &&
      value.filters.some((filter) => Boolean(filter.condition))
  );
}

/** The templates a new routine can start from. */
export function availableTemplates(
  catalog: readonly RoutineTemplate[],
  decisions: boolean
): RoutineTemplate[] {
  return catalog.filter(
    (template) => template.template && (decisions || !needsDecisions(template))
  );
}

/** The list shows four, the catalog's first that are available. */
const FEATURED_COUNT = 4;

/** The templates the routines list offers above it. */
export function featuredTemplates(
  catalog: readonly RoutineTemplate[],
  decisions: boolean
): RoutineTemplate[] {
  return availableTemplates(catalog, decisions).slice(0, FEATURED_COUNT);
}

/** What starts the template's routine and what it does, for its card. */
export function templateChain(template: RoutineTemplate) {
  const [first] = template.triggers;
  return {
    trigger: first ? describeTrigger(first) : '',
    action: template.action,
    actionAi: /\bAI\b/.test(template.action),
  };
}

export type TemplateContext = {
  /** Who runs agent steps. */
  target: RoutineTarget;
  /** Code steps can be saved (`enable-routine-code-steps`). */
  codeSteps: boolean;
};

/**
 * The template's steps: its code where code can be saved, or else an Ask AI
 * step with its instructions.
 */
function templateSteps(
  template: RoutineTemplate,
  context: TemplateContext
): StepDraft[] {
  const code =
    context.codeSteps && template.code
      ? stepsFromTask({ steps: [template.code] })
      : undefined;
  return code ?? [agentStep(context.target, template.instructions)];
}

/** A new routine started from `template`, ready to review. */
export function templateDraft(
  template: RoutineTemplate,
  base: ScheduleDraft,
  context: TemplateContext
): ScheduleDraft {
  return withNewDraftSteps(
    {
      ...base,
      name: template.title,
      description: template.description,
      triggers: template.triggers,
    },
    templateSteps(template, context)
  );
}

/**
 * A new routine's first draft: blank, or started from a template, with
 * agent steps run by the plan's default model.
 */
export function newRoutineDraft(
  template: RoutineTemplate | undefined,
  context: { defaultModel: string; codeSteps: boolean }
): ScheduleDraft {
  const blank: ScheduleDraft = {
    ...createEmptyDraft(context.defaultModel),
    triggers: [],
    steps: [],
    enabled: true,
  };
  return template
    ? templateDraft(template, blank, {
        target: { kind: 'model', model: context.defaultModel },
        codeSteps: context.codeSteps,
      })
    : blank;
}
