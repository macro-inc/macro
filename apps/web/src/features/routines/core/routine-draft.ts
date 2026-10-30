import {
  buildCron as buildCronExpression,
  type CronParts,
  DEFAULT_TIME,
  DEFAULT_WEEKDAYS,
  describeCron,
  getDefaultTimezone,
  isValidTime,
  parseCron as parseCronParts,
} from '@core/util/cron';
import { match } from 'ts-pattern';
import { DEFAULT_RUN_VISIBILITY, type ScheduleDraft } from './draft';
import {
  agentStep,
  firstAgent,
  newStepId,
  type StepDraft,
  updateStep,
  validateSteps,
} from './routine-steps';
import { routineTargetSchema } from './routine-target';
import { describeTriggers, validateTriggers } from './routine-triggers';
import { describeToolStep, validateToolStep } from './step-catalog';

export {
  DEFAULT_TIME,
  getDefaultTimezone,
  isValidTime,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';

type ParsedCron = Pick<
  ScheduleDraft,
  'frequency' | 'time' | 'daysOfWeek' | 'dayOfMonth'
>;
function normalizePrompt(value: string) {
  return value
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

export function deriveScheduleName(prompt: string) {
  const summary = normalizePrompt(prompt);
  if (!summary) return 'Untitled routine';
  return summary.length > 72 ? `${summary.slice(0, 71)}…` : summary;
}

/** The id of the single agent step a routine without steps is shown as. */
const SINGLE_AGENT_STEP_ID = 'single-agent';

/** The routine's steps; a single agent routine is one agent step. */
export function draftSteps(draft: ScheduleDraft): StepDraft[] {
  return (
    draft.steps ?? [
      {
        ...agentStep(draft.target, draft.prompt),
        id: SINGLE_AGENT_STEP_ID,
      },
    ]
  );
}

/**
 * Replace the routine's steps. A routine that is still just its single agent
 * keeps the simple form, so it saves exactly as before steps existed.
 */
export function withDraftSteps(
  draft: ScheduleDraft,
  steps: StepDraft[]
): ScheduleDraft {
  const [only] = steps;
  if (
    draft.steps === undefined &&
    steps.length === 1 &&
    only?.kind === 'agent' &&
    only.id === SINGLE_AGENT_STEP_ID
  )
    return draft.prompt === only.instructions && draft.target === only.target
      ? draft
      : { ...draft, prompt: only.instructions, target: only.target };
  const base = draft.steps === undefined ? draft.basePrompt?.trim() : undefined;
  return {
    ...draft,
    // The program's agent step runs with everything the single agent did,
    // as the scheduler reads an old task. A new id remounts its editor, which
    // otherwise keeps showing (and saving) the instructions without them.
    steps: base
      ? updateStep(steps, SINGLE_AGENT_STEP_ID, (step) =>
          step.kind === 'agent'
            ? {
                ...step,
                id: newStepId(),
                instructions: `${base}\n\n${step.instructions}`,
              }
            : step
        )
      : steps,
  };
}

/**
 * Replace a new routine's steps. A lone agent step takes the simple form, so
 * a routine that is only an agent is stored as one wherever it started.
 */
export function withNewDraftSteps(
  draft: ScheduleDraft,
  steps: StepDraft[]
): ScheduleDraft {
  const [only, ...rest] = steps;
  if (only?.kind !== 'agent' || rest.length) return { ...draft, steps };
  if (
    draft.steps === undefined &&
    draft.prompt === only.instructions &&
    draft.target === only.target
  )
    return draft;
  const { steps: _program, ...simple } = draft;
  return { ...simple, prompt: only.instructions, target: only.target };
}

/** The instructions of the agent a run reaches first, if any. */
export function draftPrompt(draft: ScheduleDraft): string {
  return draft.steps
    ? (firstAgent(draft.steps)?.instructions ?? '')
    : draft.prompt;
}

/** A name for an unnamed routine, from its agent's instructions or first step. */
export function deriveRoutineName(draft: ScheduleDraft): string {
  const prompt = draftPrompt(draft);
  if (prompt.trim() || !draft.steps?.length) return deriveScheduleName(prompt);
  const [first] = draft.steps;
  if (!first) return deriveScheduleName('');
  return match(first)
    .with({ kind: 'tool' }, (step) => describeToolStep(step))
    .with({ kind: 'if' }, (step) => deriveScheduleName(step.condition))
    .with({ kind: 'choose' }, (step) => deriveScheduleName(step.question))
    .with({ kind: 'agent' }, (step) => deriveScheduleName(step.instructions))
    .exhaustive();
}

export function cronParts(draft: ScheduleDraft): CronParts {
  return {
    frequency: draft.frequency === 'once' ? 'week' : draft.frequency,
    time: draft.time,
    daysOfWeek: draft.daysOfWeek,
    dayOfMonth: draft.dayOfMonth,
  };
}

export function describeSchedule(draft: ScheduleDraft, timezone: string) {
  if (draft.triggers) return describeTriggers(draft.triggers);
  if (draft.frequency === 'once') {
    return draft.onceAt && !Number.isNaN(new Date(draft.onceAt).getTime())
      ? `Once on ${formatDateTime(new Date(draft.onceAt).toISOString())}`
      : 'Choose a date and time for a single run.';
  }
  return describeCron(cronParts(draft), draft.timezone ?? timezone);
}

export function parseCron(cron: string): ParsedCron {
  return parseCronParts(cron);
}

export function buildCron(draft: ScheduleDraft) {
  return buildCronExpression(cronParts(draft));
}

export function createEmptyDraft(model: string): ScheduleDraft {
  return {
    name: '',
    prompt: '',
    frequency: 'week',
    time: DEFAULT_TIME,
    daysOfWeek: [...DEFAULT_WEEKDAYS],
    dayOfMonth: '1',
    target: { kind: 'model', model },
    runVisibility: DEFAULT_RUN_VISIBILITY,
    apps: [],
  };
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function validateProgramDraft(
  steps: StepDraft[],
  draft: ScheduleDraft,
  creating: boolean
): string | null {
  const triggers = draft.triggers ?? [];
  if (draft.apps.length && !firstAgent(steps))
    return 'Apps are for an Ask AI step. Add one, or remove the apps.';
  return (
    validateSteps(steps, triggers, validateToolStep) ??
    validateTriggers(triggers, creating)
  );
}

export function validateRoutineDraft(
  draft: ScheduleDraft,
  creating = false
): string | null {
  if (draft.steps) return validateProgramDraft(draft.steps, draft, creating);
  if (!draft.prompt.trim()) return 'Instructions are required.';
  if (!routineTargetSchema.safeParse(draft.target).success)
    return 'Choose a valid model or agent.';
  if (draft.triggers) return validateTriggers(draft.triggers, creating);
  if (draft.frequency === 'once') {
    const at = new Date(draft.onceAt ?? '').getTime();
    if (!Number.isFinite(at)) return 'Choose a date and time.';
    if (creating && at <= Date.now()) return 'Choose a time in the future.';
    return null;
  }
  if (!isValidTime(draft.time)) return 'Choose a valid time.';
  if (draft.frequency === 'week' && !draft.daysOfWeek.length)
    return 'Select at least one day.';
  if (
    draft.frequency === 'month' &&
    (!Number.isInteger(Number(draft.dayOfMonth)) ||
      Number(draft.dayOfMonth) < 1 ||
      Number(draft.dayOfMonth) > 31)
  )
    return 'Pick a day between 1 and 31.';
  try {
    new Intl.DateTimeFormat(undefined, {
      timeZone: draft.timezone ?? getDefaultTimezone(),
    });
  } catch {
    return 'Choose a valid time zone, such as America/New_York.';
  }
  return null;
}

/** Null until the owner's connections load; the server checks again on save. */
export function validateRoutineApps(
  apps: readonly { app_slug: string }[],
  connectedSlugs: ReadonlySet<string> | undefined
): string | null {
  if (!connectedSlugs) return null;
  return apps.every((app) => connectedSlugs.has(app.app_slug))
    ? null
    : 'Connect every app this routine requires.';
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Please try again.';
}
