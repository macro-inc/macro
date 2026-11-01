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
  'Comment',
  'SendChannelMessage',
  'MoveToProject',
] as const;
type RoutineToolName = (typeof routineTools)[number];

/** Areas a code step may change; reads are always allowed. The scheduler owns this list. */
export const writeScopes = [
  'email',
  'calendar',
  'workspace',
  'properties',
  'contacts',
  'notifications',
  'ai',
] as const;
export type WriteScope = (typeof writeScopes)[number];

/** What each write scope lets a code step change, for its owner. */
export const WRITE_SCOPE_LABELS: Record<WriteScope, string> = {
  email: 'Email',
  calendar: 'Calendar',
  workspace: 'Documents, tasks and channels',
  properties: 'Properties',
  contacts: 'Contacts',
  notifications: 'Notifications',
  ai: 'AI that can act',
};

/** TypeScript against Macro's SDK, written by the AI that built the routine. */
export type CodeStepDraft = {
  id: string;
  kind: 'code';
  /** Names the output for later steps. */
  output?: string;
  title: string;
  summary: string;
  source: string;
  writes: WriteScope[];
  /** Type-checker problems found while drafting, until AI fixes them. Never saved. */
  problems?: string[];
};
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
  | CodeStepDraft
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
  /** Characters in an agent step's instructions. */
  instructions: 20_000,
  /** Serialized bytes of one tool step's arguments. */
  argumentBytes: 16 * 1024,
  /** Characters in a code step's title. */
  codeTitle: 80,
  /** Bytes of a code step's source. */
  sourceBytes: 64 * 1024,
} as const;

const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

export type WireStep =
  | {
      type: 'code';
      id?: string | null;
      title: string;
      summary?: string | null;
      source: string;
      writes?: WriteScope[];
    }
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
      type: z.literal('code'),
      id: stepIdSchema.nullish(),
      title: z.string(),
      summary: z.string().nullish(),
      source: z.string(),
      writes: z.array(z.enum(writeScopes)).optional(),
    }),
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
      kind: z.literal('code'),
      output: z.string().optional(),
      title: z.string(),
      summary: z.string(),
      source: z.string(),
      writes: z.array(z.enum(writeScopes)),
      problems: z.array(z.string()).optional(),
    }),
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
      .with({ type: 'code' }, (step) => ({
        id: newStepId(),
        kind: 'code',
        output: step.id ?? undefined,
        title: step.title,
        summary: step.summary ?? '',
        source: step.source,
        writes: step.writes ?? [],
      }))
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
      .with({ kind: 'code' }, (step) => ({
        type: 'code',
        ...(step.output ? { id: step.output } : {}),
        title: step.title.trim(),
        ...(step.summary.trim() ? { summary: step.summary.trim() } : {}),
        source: step.source,
        ...(step.writes.length ? { writes: step.writes } : {}),
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
    .with({ kind: 'agent' }, { kind: 'code' }, { kind: 'tool' }, () => [])
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

/** Output ids: a lowercase letter, then up to 31 lowercase letters, digits or `_`. */
const OUTPUT_ID = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * An unused output id from `name`, as saving derives one; mirrors
 * `RoutineProgram::assign_step_ids` in `crates/routine_program`.
 */
function outputId(name: string, taken: Set<string>): string {
  let slug = '';
  // `HasRead` → `has_read`: a capital after a lowercase letter starts a word.
  let previousLower = false;
  for (const c of name) {
    if (/^[A-Za-z0-9]$/.test(c)) {
      if (/[A-Z]/.test(c) && previousLower && !slug.endsWith('_')) slug += '_';
      previousLower = /[a-z0-9]/.test(c);
      slug += c.toLowerCase();
    } else {
      previousLower = false;
      if (slug && !slug.endsWith('_')) slug += '_';
    }
  }
  let base = slug.replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `step_${base}`;
  // Room for a `_N` suffix; a long name ends on a word.
  if (base.length > 28) {
    const at = base.slice(0, 28).lastIndexOf('_');
    base = base.slice(0, at >= 8 ? at : 28);
  }
  base = base.replace(/_+$/, '');
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? '' : `_${number}`;
    const candidate = suffix
      ? `${base.slice(0, 32 - suffix.length).replace(/_+$/, '')}${suffix}`
      : base;
    if (!taken.has(candidate) && OUTPUT_ID.test(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * Every code and tool step with its output named, as saving names it: from
 * a code step's title or a tool step's tool, unique in the routine. Names
 * already given stay.
 */
export function withNamedOutputs(steps: StepDraft[]): StepDraft[] {
  const taken = new Set(
    flattenSteps(steps).flatMap((step) =>
      (step.kind === 'code' || step.kind === 'tool') && step.output
        ? [step.output]
        : []
    )
  );
  return mapSteps(steps, (step) =>
    match(step)
      .returnType<StepDraft>()
      .with({ kind: 'code' }, (step) =>
        step.output ? step : { ...step, output: outputId(step.title, taken) }
      )
      .with({ kind: 'tool' }, (step) =>
        step.output ? step : { ...step, output: outputId(step.tool, taken) }
      )
      .otherwise((step) => step)
  );
}

/**
 * The output ids saving gave steps that were sent without one, by each sent
 * step's editor id. `saved` is the same steps as the scheduler stored them;
 * a different shape matches nothing.
 */
export function assignedOutputs(
  sent: StepDraft[],
  saved: StepDraft[]
): Map<string, string> {
  const before = flattenSteps(sent);
  const after = flattenSteps(saved);
  const outputs = new Map<string, string>();
  if (before.length !== after.length) return outputs;
  before.forEach((step, index) => {
    const stored = after[index];
    if (
      (step.kind === 'code' || step.kind === 'tool') &&
      stored?.kind === step.kind &&
      !step.output &&
      stored.output
    )
      outputs.set(step.id, stored.output);
  });
  return outputs;
}

/** `steps` with the output ids saving gave them, so later saves keep them. */
export function withAssignedOutputs(
  steps: StepDraft[],
  outputs: ReadonlyMap<string, string>
): StepDraft[] {
  if (!outputs.size) return steps;
  return mapSteps(steps, (step) => {
    const output = outputs.get(step.id);
    return output &&
      (step.kind === 'code' || step.kind === 'tool') &&
      !step.output
      ? { ...step, output }
      : step;
  });
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
      .with(
        { kind: 'agent' },
        { kind: 'code' },
        { kind: 'tool' },
        (step) => step
      )
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

/** The same steps with `update` applied to every step, nested ones included. */
export function mapSteps(
  steps: StepDraft[],
  update: (step: StepDraft) => StepDraft
): StepDraft[] {
  return steps.map((step) =>
    update(
      match(step)
        .returnType<StepDraft>()
        .with(
          { kind: 'agent' },
          { kind: 'code' },
          { kind: 'tool' },
          (step) => step
        )
        .with({ kind: 'if' }, (step) => ({
          ...step,
          yes: mapSteps(step.yes, update),
          no: mapSteps(step.no, update),
        }))
        .with({ kind: 'choose' }, (step) => ({
          ...step,
          options: step.options.map((option) => ({
            ...option,
            steps: mapSteps(option.steps, update),
          })),
          otherwise: mapSteps(step.otherwise, update),
        }))
        .exhaustive()
    )
  );
}

/** Every agent step, branches included, in program order. */
export function agentSteps(steps: StepDraft[]): AgentStepDraft[] {
  return flattenSteps(steps).filter(
    (step): step is AgentStepDraft => step.kind === 'agent'
  );
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

/** What a `{{…}}` placeholder reads, as the scheduler parses it. */
type Placeholder = { kind: 'trigger' } | { kind: 'step'; id: string };

const PLACEHOLDER_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * The placeholders in a value's strings, or why one can't be read. Mirrors
 * the scheduler's `template::references`.
 */
function placeholders(value: unknown): Placeholder[] | string {
  if (typeof value === 'string') {
    const found: Placeholder[] = [];
    let rest = value;
    for (
      let start = rest.indexOf('{{');
      start >= 0;
      start = rest.indexOf('{{')
    ) {
      const after = rest.slice(start + 2);
      const end = after.indexOf('}}');
      if (end < 0) return 'Close every “{{” field with “}}”.';
      const inner = after.slice(0, end).trim();
      const [root, id, ...path] = inner.split('.');
      const segments = [root, id, ...path].filter(
        (segment) => segment !== undefined
      );
      const readable =
        segments.every((segment) => PLACEHOLDER_SEGMENT.test(segment)) &&
        (root === 'trigger' ||
          (root === 'steps' &&
            id !== undefined &&
            stepIdSchema.safeParse(id).success));
      if (!readable)
        return `“{{${inner}}}” isn’t a field. Insert fields with the { } button.`;
      found.push(
        root === 'trigger'
          ? { kind: 'trigger' }
          : { kind: 'step', id: id ?? '' }
      );
      rest = after.slice(end + 2);
    }
    return found;
  }
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [];
  const found: Placeholder[] = [];
  for (const item of items) {
    const inner = placeholders(item);
    if (typeof inner === 'string') return inner;
    found.push(...inner);
  }
  return found;
}

/**
 * `{{steps.<output>…}}` must name a tool step that runs before it on every
 * path: earlier in the same list, or earlier in a list that encloses it. A
 * branch's outputs stay inside that branch, since it may not have run.
 * Mirrors the scheduler's check, as do the unique outputs and the size limit.
 */
function validateToolArguments(steps: StepDraft[]): string | null {
  const outputs = new Set<string>();
  const visible: string[] = [];
  const walk = (list: StepDraft[]): string | null => {
    for (const step of list) {
      if (step.kind === 'tool') {
        const bytes = new TextEncoder().encode(
          JSON.stringify(step.arguments)
        ).length;
        if (bytes > STEP_LIMITS.argumentBytes)
          return 'A step’s settings are too long. Shorten its text.';
        const found = placeholders(step.arguments);
        if (typeof found === 'string') return found;
        if (
          found.some(
            (placeholder) =>
              placeholder.kind === 'step' && !visible.includes(placeholder.id)
          )
        )
          return 'A step uses a field from a step that may not have run before it. Keep it below that step, in the same branch.';
      }
      if ((step.kind === 'tool' || step.kind === 'code') && step.output) {
        if (outputs.has(step.output))
          return 'Two steps name their output the same. Remove one and add it again.';
        outputs.add(step.output);
        visible.push(step.output);
      }
      for (const branch of stepBranches(step)) {
        const scope = visible.length;
        const error = walk(branch);
        if (error) return error;
        visible.length = scope;
      }
    }
    return null;
  };
  return walk(steps);
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
        if ([...step.instructions].length > STEP_LIMITS.instructions)
          return `Keep the agent’s instructions under ${STEP_LIMITS.instructions.toLocaleString('en-US')} characters.`;
        return routineTargetSchema.safeParse(step.target).success
          ? null
          : 'Choose a valid model or agent.';
      })
      .with({ kind: 'code' }, (step) => {
        const title = step.title.trim();
        if (!title || [...title].length > STEP_LIMITS.codeTitle)
          return 'Give each code step a short title.';
        const bytes = new TextEncoder().encode(step.source).length;
        if (!step.source.trim() || bytes > STEP_LIMITS.sourceBytes)
          return 'A code step’s code is empty or too long. Ask AI to rewrite it.';
        if (step.problems?.length)
          return `“${title}” doesn’t type-check yet. Draft the routine again or remove that step.`;
        return null;
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
  const argumentError = validateToolArguments(steps);
  if (argumentError) return argumentError;
  if (
    stepsNeedEvent(steps) &&
    (!triggers.length || triggers.some((trigger) => trigger.kind !== 'event'))
  )
    return 'Steps that decide about or act on the triggering item need activity triggers only. Remove schedules or those steps.';
  return null;
}
