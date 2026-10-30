import { match } from 'ts-pattern';
import { z } from 'zod';
import {
  type RoutineTarget,
  routineAgentIdSchema,
  routineModelSchema,
  routineTargetSchema,
} from './routine-target';
import type { RoutineTriggerDraft } from './routine-triggers';

/** Tools a routine step may call. The scheduler owns this list. */
export const routineTools = [
  'UpdateThreadLabels',
  'SetSenderPolicy',
  'SetEntityProperty',
  'CreateDocument',
  'CommentOnDocument',
  'SendChannelMessage',
  'MoveToProject',
] as const;
type RoutineToolName = (typeof routineTools)[number];

export type AgentStepDraft = {
  id: string;
  kind: 'agent';
  target: RoutineTarget;
  instructions: string;
};
export type ToolStepDraft = {
  id: string;
  kind: 'tool';
  tool: RoutineToolName;
  /** Names the output for later steps' `{{steps.<output>.…}}` placeholders. */
  output?: string;
  arguments: Record<string, unknown>;
};
export type IfStepDraft = {
  id: string;
  kind: 'if';
  condition: string;
  /** Steps when the answer is yes; `then` on the wire. */
  yes: StepDraft[];
  /** Steps when the answer is no; `else` on the wire. */
  no: StepDraft[];
};
export type ChoiceDraft = {
  id: string;
  label: string;
  description: string;
  steps: StepDraft[];
};
export type ChooseStepDraft = {
  id: string;
  kind: 'choose';
  question: string;
  options: ChoiceDraft[];
  /** Run every option that fits instead of only the best one. */
  multiple: boolean;
  otherwise: StepDraft[];
};
export type StepDraft =
  | AgentStepDraft
  | ToolStepDraft
  | IfStepDraft
  | ChooseStepDraft;

/** Bounds the scheduler enforces; mirrored for immediate feedback. */
export const STEP_LIMITS = {
  steps: 40,
  depth: 4,
  options: 8,
  questions: 32,
  label: 80,
  description: 200,
  condition: 500,
} as const;

const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

export type WireStep =
  | {
      type: 'agent';
      model?: string | null;
      agent?: { bot_id: string } | null;
      instructions: string;
    }
  | {
      type: 'tool';
      id?: string | null;
      tool: RoutineToolName;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'if';
      condition: string;
      then?: WireStep[];
      else?: WireStep[];
    }
  | {
      type: 'choose';
      question?: string | null;
      multiple?: boolean;
      options: {
        label: string;
        description?: string | null;
        steps?: WireStep[];
      }[];
      otherwise?: WireStep[];
    };

const wireStepSchema: z.ZodType<WireStep> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('agent'),
      model: routineModelSchema.nullish(),
      agent: z.object({ bot_id: routineAgentIdSchema }).nullish(),
      instructions: z.string(),
    }),
    z.object({
      type: z.literal('tool'),
      id: stepIdSchema.nullish(),
      tool: z.enum(routineTools),
      arguments: z.record(z.string(), z.unknown()),
    }),
    z.object({
      type: z.literal('if'),
      condition: z.string(),
      // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
      then: z.array(wireStepSchema).optional(),
      else: z.array(wireStepSchema).optional(),
    }),
    z.object({
      type: z.literal('choose'),
      question: z.string().nullish(),
      multiple: z.boolean().optional(),
      options: z.array(
        z.object({
          label: z.string(),
          description: z.string().nullish(),
          steps: z.array(wireStepSchema).optional(),
        })
      ),
      otherwise: z.array(wireStepSchema).optional(),
    }),
  ])
);

const programSchema = z.looseObject({ steps: z.array(wireStepSchema) });

/** Editor state, as saved with unsent composer drafts. */
export const stepDraftSchema: z.ZodType<StepDraft> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      id: z.string(),
      kind: z.literal('agent'),
      target: routineTargetSchema,
      instructions: z.string(),
    }),
    z.object({
      id: z.string(),
      kind: z.literal('tool'),
      tool: z.enum(routineTools),
      output: z.string().optional(),
      arguments: z.record(z.string(), z.unknown()),
    }),
    z.object({
      id: z.string(),
      kind: z.literal('if'),
      condition: z.string(),
      yes: z.array(stepDraftSchema),
      no: z.array(stepDraftSchema),
    }),
    z.object({
      id: z.string(),
      kind: z.literal('choose'),
      question: z.string(),
      multiple: z.boolean().default(false),
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          description: z.string(),
          steps: z.array(stepDraftSchema),
        })
      ),
      otherwise: z.array(stepDraftSchema),
    }),
  ])
);

export function newStepId(): string {
  return crypto.randomUUID();
}

export function agentStep(
  target: RoutineTarget,
  instructions = ''
): AgentStepDraft {
  return { id: newStepId(), kind: 'agent', target, instructions };
}

export function ifStep(condition = ''): IfStepDraft {
  return { id: newStepId(), kind: 'if', condition, yes: [], no: [] };
}

export function choice(label = ''): ChoiceDraft {
  return { id: newStepId(), label, description: '', steps: [] };
}

export function chooseStep(
  question = '',
  options: ChoiceDraft[] = [choice(), choice()],
  multiple = false
): ChooseStepDraft {
  return {
    id: newStepId(),
    kind: 'choose',
    question,
    options,
    multiple,
    otherwise: [],
  };
}

function targetFromWire(
  step: Extract<WireStep, { type: 'agent' }>
): RoutineTarget | undefined {
  if (step.agent)
    return step.model != null
      ? { kind: 'agent', agentId: step.agent.bot_id, modelOverride: step.model }
      : { kind: 'agent', agentId: step.agent.bot_id };
  return step.model != null ? { kind: 'model', model: step.model } : undefined;
}

function fromWire(steps: WireStep[]): StepDraft[] | undefined {
  const drafts: StepDraft[] = [];
  for (const step of steps) {
    const draft = match(step)
      .returnType<StepDraft | undefined>()
      .with({ type: 'agent' }, (step) => {
        const target = targetFromWire(step);
        return target && agentStep(target, step.instructions);
      })
      .with({ type: 'tool' }, (step) => ({
        id: newStepId(),
        kind: 'tool',
        tool: step.tool,
        output: step.id ?? undefined,
        arguments: step.arguments,
      }))
      .with({ type: 'if' }, (step) => {
        const yes = fromWire(step.then ?? []);
        const no = fromWire(step.else ?? []);
        return yes && no ? { ...ifStep(step.condition), yes, no } : undefined;
      })
      .with({ type: 'choose' }, (step) => {
        const otherwise = fromWire(step.otherwise ?? []);
        const options = step.options.map((option) => {
          const steps = fromWire(option.steps ?? []);
          return (
            steps && {
              ...choice(option.label),
              description: option.description ?? '',
              steps,
            }
          );
        });
        if (!otherwise || options.some((option) => !option)) return undefined;
        return {
          id: newStepId(),
          kind: 'choose',
          question: step.question ?? '',
          options: options.filter((option) => option !== undefined),
          multiple: step.multiple ?? false,
          otherwise,
        };
      })
      .exhaustive();
    if (!draft) return undefined;
    drafts.push(draft);
  }
  return drafts;
}

/** A stored program's steps; undefined for single agent tasks and unknown shapes. */
export function stepsFromTask(task: unknown): StepDraft[] | undefined {
  const parsed = programSchema.safeParse(task);
  return parsed.success ? fromWire(parsed.data.steps) : undefined;
}

function targetToWire(target: RoutineTarget) {
  return target.kind === 'model'
    ? { model: target.model }
    : {
        agent: { bot_id: target.agentId },
        ...(target.modelOverride === undefined
          ? {}
          : { model: target.modelOverride }),
      };
}

export function stepsToWire(steps: StepDraft[]): WireStep[] {
  return steps.map((step) =>
    match(step)
      .returnType<WireStep>()
      .with({ kind: 'agent' }, (step) => ({
        type: 'agent',
        ...targetToWire(routineTargetSchema.parse(step.target)),
        instructions: step.instructions.trim(),
      }))
      .with({ kind: 'tool' }, (step) => ({
        type: 'tool',
        ...(step.output ? { id: step.output } : {}),
        tool: step.tool,
        arguments: step.arguments,
      }))
      .with({ kind: 'if' }, (step) => ({
        type: 'if',
        condition: step.condition.trim(),
        // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
        then: stepsToWire(step.yes),
        ...(step.no.length ? { else: stepsToWire(step.no) } : {}),
      }))
      .with({ kind: 'choose' }, (step) => ({
        type: 'choose',
        ...(step.question.trim() ? { question: step.question.trim() } : {}),
        ...(step.multiple ? { multiple: true } : {}),
        options: step.options.map((option) => ({
          label: option.label.trim(),
          ...(option.description.trim()
            ? { description: option.description.trim() }
            : {}),
          steps: stepsToWire(option.steps),
        })),
        ...(step.otherwise.length
          ? { otherwise: stepsToWire(step.otherwise) }
          : {}),
      }))
      .exhaustive()
  );
}

/** Nested step lists in program order. */
function stepBranches(step: StepDraft): StepDraft[][] {
  return match(step)
    .returnType<StepDraft[][]>()
    .with({ kind: 'agent' }, { kind: 'tool' }, () => [])
    .with({ kind: 'if' }, (step) => [step.yes, step.no])
    .with({ kind: 'choose' }, (step) => [
      ...step.options.map((option) => option.steps),
      step.otherwise,
    ])
    .exhaustive();
}

/** Every step in program order, including untaken branches. */
export function flattenSteps(steps: StepDraft[]): StepDraft[] {
  return steps.flatMap((step) => [
    step,
    ...stepBranches(step).flatMap(flattenSteps),
  ]);
}

/** The same steps, with `update` applied to the step whose id is `id`. */
export function updateStep(
  steps: StepDraft[],
  id: string,
  update: (step: StepDraft) => StepDraft
): StepDraft[] {
  return steps.map((step) => {
    if (step.id === id) return update(step);
    return match(step)
      .returnType<StepDraft>()
      .with({ kind: 'agent' }, { kind: 'tool' }, (step) => step)
      .with({ kind: 'if' }, (step) => ({
        ...step,
        yes: updateStep(step.yes, id, update),
        no: updateStep(step.no, id, update),
      }))
      .with({ kind: 'choose' }, (step) => ({
        ...step,
        options: step.options.map((option) => ({
          ...option,
          steps: updateStep(option.steps, id, update),
        })),
        otherwise: updateStep(step.otherwise, id, update),
      }))
      .exhaustive();
  });
}

/** The first agent a run can reach, for list labels and "Copy prompt". */
export function firstAgent(steps: StepDraft[]): AgentStepDraft | undefined {
  return flattenSteps(steps).find(
    (step): step is AgentStepDraft => step.kind === 'agent'
  );
}

/** Sequences add up and branches don't, except a choice's options when every fitting one runs. */
function maxAgents(steps: StepDraft[]): number {
  return steps.reduce(
    (sum, step) =>
      sum +
      match(step)
        .with({ kind: 'agent' }, () => 1)
        .with({ kind: 'choose', multiple: true }, (step) =>
          Math.max(
            maxAgents(step.otherwise),
            step.options.reduce(
              (total, option) => total + maxAgents(option.steps),
              0
            )
          )
        )
        .otherwise((step) => Math.max(0, ...stepBranches(step).map(maxAgents))),
    0
  );
}

function depth(steps: StepDraft[]): number {
  return Math.max(
    0,
    ...steps.map((step) => {
      const branches = stepBranches(step);
      return branches.length ? 1 + Math.max(0, ...branches.map(depth)) : 0;
    })
  );
}

function questionCount(steps: StepDraft[]): number {
  return flattenSteps(steps).reduce(
    (sum, step) =>
      sum +
      (step.kind === 'if'
        ? 1
        : step.kind === 'choose'
          ? step.options.length
          : 0),
    0
  );
}

/** Whether steps decide about or read the item that triggered the run. */
export function stepsNeedEvent(steps: StepDraft[]): boolean {
  return flattenSteps(steps).some(
    (step) =>
      step.kind === 'if' ||
      step.kind === 'choose' ||
      (step.kind === 'tool' &&
        JSON.stringify(step.arguments).includes('{{trigger'))
  );
}

export function validateSteps(
  steps: StepDraft[],
  triggers: RoutineTriggerDraft[],
  validateTool: (step: ToolStepDraft) => string | null
): string | null {
  if (!steps.length) return 'Add a step to tell this routine what to do.';
  const all = flattenSteps(steps);
  if (all.length > STEP_LIMITS.steps)
    return `A routine can have at most ${STEP_LIMITS.steps} steps.`;
  if (depth(steps) > STEP_LIMITS.depth)
    return `Decisions can be nested at most ${STEP_LIMITS.depth} levels deep.`;
  if (maxAgents(steps) > 1)
    return 'A run can hand off to one agent. Put agents in different branches.';
  if (questionCount(steps) > STEP_LIMITS.questions)
    return `Decisions can ask at most ${STEP_LIMITS.questions} questions; each option counts as one.`;
  for (const step of all) {
    const error = match(step)
      .returnType<string | null>()
      .with({ kind: 'agent' }, (step) => {
        if (!step.instructions.trim()) return 'Tell the agent what to do.';
        return routineTargetSchema.safeParse(step.target).success
          ? null
          : 'Choose a valid model or agent.';
      })
      .with({ kind: 'tool' }, (step) => validateTool(step))
      .with({ kind: 'if' }, (step) => {
        const condition = step.condition.trim();
        if (!condition) return 'Write the yes/no question for each “If” step.';
        return [...condition].length > STEP_LIMITS.condition
          ? `Keep questions under ${STEP_LIMITS.condition} characters.`
          : null;
      })
      .with({ kind: 'choose' }, (step) => {
        if (
          step.options.length < 2 ||
          step.options.length > STEP_LIMITS.options
        )
          return `A choice needs between 2 and ${STEP_LIMITS.options} options.`;
        const labels = step.options.map((option) =>
          option.label.trim().toLowerCase()
        );
        if (labels.some((label) => !label))
          return 'Give every option a label, or pick its value.';
        if (new Set(labels).size !== labels.length)
          return 'Option labels must be different.';
        if (
          step.options.some(
            (option) =>
              [...option.label.trim()].length > STEP_LIMITS.label ||
              [...option.description.trim()].length > STEP_LIMITS.description
          ) ||
          [...step.question.trim()].length > STEP_LIMITS.description
        )
          return 'Keep choice labels and descriptions short.';
        return null;
      })
      .exhaustive();
    if (error) return error;
  }
  if (
    stepsNeedEvent(steps) &&
    (!triggers.length || triggers.some((trigger) => trigger.kind !== 'event'))
  )
    return 'Steps that decide about or act on the triggering item need activity triggers only. Remove schedules or those steps.';
  return null;
}
