import { match } from 'ts-pattern';
import { z } from 'zod';
import { type Knob, knobSchema, knobToWire } from './knobs';
import {
  type RoutineTarget,
  routineAgentIdSchema,
  routineModelSchema,
  routineTargetSchema,
} from './routine-target';
import type { RoutineTriggerDraft } from './routine-triggers';

/** TypeScript against Macro's SDK, written by the AI that built the routine. */
export type CodeStepDraft = {
  id: string;
  kind: 'code';
  /** Names the output for later steps. */
  output?: string;
  title: string;
  summary: string;
  source: string;
  /** Values its owner changes without new code. */
  knobs: Knob[];
  /** What it does, with `{name}` / `{?name}` where its knobs show. */
  sentence?: string;
  /** Type-checker problems found while drafting, until AI fixes them. Never saved. */
  problems?: string[];
};
export type AgentStepDraft = {
  id: string;
  kind: 'agent';
  target: RoutineTarget;
  instructions: string;
};
export type StepDraft = AgentStepDraft | CodeStepDraft;

/** What AI may make a step: code written once, or Ask AI each run. */
export type StepKind = StepDraft['kind'];

/** The routine a step is added to or changed in. */
export type RoutineSoFar = {
  triggers: RoutineTriggerDraft[];
  steps: StepDraft[];
};

/** A step drafted to add at the end, and why it is code or Ask AI. */
export type AddedStep = { step: StepDraft; reason: string };

/** Bounds the scheduler enforces; mirrored for immediate feedback. */
export const STEP_LIMITS = {
  steps: 40,
  /** Characters in an agent step's instructions. */
  instructions: 20_000,
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
      knobs?: Knob[];
      sentence?: string | null;
    }
  | {
      type: 'agent';
      model?: string | null;
      agent?: { bot_id: string } | null;
      instructions: string;
    };

const wireStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('code'),
    id: stepIdSchema.nullish(),
    title: z.string(),
    summary: z.string().nullish(),
    source: z.string(),
    knobs: z.array(knobSchema).optional(),
    sentence: z.string().nullish(),
  }),
  z.object({
    type: z.literal('agent'),
    model: routineModelSchema.nullish(),
    agent: z.object({ bot_id: routineAgentIdSchema }).nullish(),
    instructions: z.string(),
  }),
]);

const programSchema = z.looseObject({ steps: z.array(wireStepSchema) });

/** Editor state, as saved with unsent composer drafts. */
export const stepDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('code'),
    output: z.string().optional(),
    title: z.string(),
    summary: z.string(),
    source: z.string(),
    // Drafts saved before steps had knobs have none.
    knobs: z.array(knobSchema).default([]),
    sentence: z.string().optional(),
    problems: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('agent'),
    target: routineTargetSchema,
    instructions: z.string(),
  }),
]) satisfies z.ZodType<StepDraft>;

export function newStepId(): string {
  return crypto.randomUUID();
}

export function agentStep(
  target: RoutineTarget,
  instructions = ''
): AgentStepDraft {
  return { id: newStepId(), kind: 'agent', target, instructions };
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
        knobs: step.knobs ?? [],
        ...(step.sentence ? { sentence: step.sentence } : {}),
      }))
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
        ...(step.knobs.length ? { knobs: step.knobs.map(knobToWire) } : {}),
        ...(step.sentence?.trim() ? { sentence: step.sentence } : {}),
      }))
      .exhaustive()
  );
}

/** The code steps, in program order. */
export function codeSteps(steps: StepDraft[]): CodeStepDraft[] {
  return steps.filter((step): step is CodeStepDraft => step.kind === 'code');
}

/** Output ids: a lowercase letter, then up to 31 lowercase letters, digits or `_`. */
const OUTPUT_ID = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * An unused output id from `name`, as saving derives one; mirrors
 * `RoutineProgram::assign_step_ids` in `crates/agents/routine_program`.
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
 * Every code step with its output named, as saving names it: from its title,
 * unique in the routine. Names already given stay.
 */
export function withNamedOutputs(steps: StepDraft[]): StepDraft[] {
  const taken = new Set(
    codeSteps(steps).flatMap((step) => (step.output ? [step.output] : []))
  );
  return steps.map((step) =>
    step.kind === 'code' && !step.output
      ? { ...step, output: outputId(step.title, taken) }
      : step
  );
}

/**
 * The output ids saving gave code steps that were sent without one, by each
 * sent step's editor id. `saved` is the same steps as the scheduler stored
 * them; a different shape matches nothing.
 */
export function assignedOutputs(
  sent: StepDraft[],
  saved: StepDraft[]
): Map<string, string> {
  const outputs = new Map<string, string>();
  if (sent.length !== saved.length) return outputs;
  sent.forEach((step, index) => {
    const stored = saved[index];
    if (
      step.kind === 'code' &&
      stored?.kind === 'code' &&
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
  return steps.map((step) => {
    const output = outputs.get(step.id);
    return output && step.kind === 'code' && !step.output
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
  return steps.map((step) => (step.id === id ? update(step) : step));
}

/** Every agent step, in program order. */
export function agentSteps(steps: StepDraft[]): AgentStepDraft[] {
  return steps.filter((step): step is AgentStepDraft => step.kind === 'agent');
}

/** The routine's agent step, for list labels and "Copy prompt". */
export function firstAgent(steps: StepDraft[]): AgentStepDraft | undefined {
  return agentSteps(steps)[0];
}

export function validateSteps(steps: StepDraft[]): string | null {
  if (!steps.length) return 'Add a step to tell this routine what to do.';
  if (steps.length > STEP_LIMITS.steps)
    return `A routine can have at most ${STEP_LIMITS.steps} steps.`;
  if (agentSteps(steps).length > 1)
    return 'A routine can hand off to one Ask AI step. Remove the others.';
  const outputs = new Set<string>();
  for (const step of steps) {
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
        if (step.output) {
          if (outputs.has(step.output))
            return 'Two steps name their output the same. Remove one and add it again.';
          outputs.add(step.output);
        }
        return null;
      })
      .exhaustive();
    if (error) return error;
  }
  return null;
}
