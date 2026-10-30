import {
  buildCron,
  deriveRoutineName,
  deriveScheduleName,
  parseCron,
} from '../core/routine-draft';
import {
  firstAgent,
  type StepDraft,
  stepsFromTask,
  stepsToWire,
} from '../core/routine-steps';
import {
  onceFromCron,
  parseRoutineTriggers,
  serializeTriggers,
} from './routine-trigger-mapping';

export { onceFromCron } from './routine-trigger-mapping';

import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { getDefaultTimezone } from '@core/util/cron';
import type {
  CreateScheduledAction,
  ScheduledAction,
  UpdateScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import { DEFAULT_RUN_VISIBILITY, type ScheduleDraft } from '../core/draft';
import {
  type RoutineTarget,
  routineAgentIdSchema,
  routineModelSchema,
  routineTargetSchema,
  routineTargetsEqual,
} from '../core/routine-target';
import { getCronTrigger } from './triggers';

const routineAppsSchema = z
  .array(z.object({ app_slug: z.string(), server_name: z.string() }))
  .optional();

const agentTaskSchema = z
  .looseObject({
    agent: z.looseObject({ bot_id: routineAgentIdSchema }).nullish(),
    model: routineModelSchema.nullish(),
    mcp_servers: routineAppsSchema,
    prompt: z.string(),
    user_prompt: z.string(),
  })
  .refine((task) => task.agent != null || task.model != null);

type RoutineTask = z.infer<typeof agentTaskSchema>;

/** The apps a program requires, stored beside its steps. */
const programAppsSchema = z.looseObject({ mcp_servers: routineAppsSchema });

function programApps(task: unknown): ScheduleDraft['apps'] {
  const parsed = programAppsSchema.safeParse(task);
  return parsed.success ? (parsed.data.mcp_servers ?? []) : [];
}

function getAgentTask(schedule: ScheduledAction): RoutineTask | undefined {
  if (schedule.kind !== 'Agent') return undefined;
  const result = agentTaskSchema.safeParse(schedule.task);
  return result.success ? result.data : undefined;
}

/** Whether a routine runs an agent or a bare model; undefined when its task is unreadable. */
export function routineTargetKind(
  schedule: ScheduledAction
): RoutineTarget['kind'] | undefined {
  const task = getAgentTask(schedule);
  if (!task) return undefined;
  return task.agent ? 'agent' : 'model';
}

function targetFromTask(task: RoutineTask): RoutineTarget {
  if (task.agent) {
    if (task.model != null) {
      return {
        kind: 'agent',
        agentId: task.agent.bot_id,
        modelOverride: task.model,
      };
    }
    return { kind: 'agent', agentId: task.agent.bot_id };
  }
  // The task schema guarantees a model when there is no agent.
  return { kind: 'model', model: routineModelSchema.parse(task.model) };
}

/** A routine with steps, edited as its program. */
function programDraft(
  schedule: ScheduledAction,
  steps: StepDraft[],
  triggers: ScheduleDraft['triggers']
): ScheduleDraft | undefined {
  // Steps need the trigger editor; legacy cron-only drafts have no steps.
  if (!triggers) return undefined;
  const agent = firstAgent(steps);
  const parsed = parseCron('0 0 9 * * *');
  return {
    id: schedule.id ?? undefined,
    name: schedule.name,
    prompt: agent?.instructions ?? '',
    frequency: parsed.frequency,
    time: parsed.time,
    daysOfWeek: parsed.daysOfWeek,
    dayOfMonth: parsed.dayOfMonth,
    target: agent?.target ?? { kind: 'model', model: DEFAULT_MODEL },
    runVisibility: schedule.run_visibility,
    description: schedule.description ?? '',
    apps: programApps(schedule.task),
    triggers,
    steps,
  };
}

export function draftFromSchedule(
  schedule: ScheduledAction
): ScheduleDraft | undefined {
  const trigger = getCronTrigger(schedule);
  const sourceTrigger = schedule.trigger ?? trigger;
  const triggers = sourceTrigger
    ? parseRoutineTriggers(sourceTrigger)
    : undefined;
  if (!trigger && !triggers) return undefined;
  const steps =
    schedule.kind === 'Agent' ? stepsFromTask(schedule.task) : undefined;
  if (steps) return programDraft(schedule, steps, triggers);
  const parsed = trigger
    ? parseCron(trigger.schedule)
    : parseCron('0 0 9 * * *');
  const task = getAgentTask(schedule);
  if (!task) return undefined;

  return {
    id: schedule.id ?? undefined,
    name: schedule.name,
    prompt: task.user_prompt,
    ...(task.prompt.trim() ? { basePrompt: task.prompt } : {}),
    frequency: parsed.frequency,
    time: parsed.time,
    daysOfWeek: parsed.daysOfWeek,
    dayOfMonth: parsed.dayOfMonth,
    target: targetFromTask(task),
    runVisibility: schedule.run_visibility,
    description: schedule.description ?? '',
    apps: task.mcp_servers ?? [],
    timezone: trigger?.timezone,
    triggers,
    ...(trigger ? onceFromCron(trigger.schedule, trigger.timezone) : {}),
  };
}

function applyTarget(task: RoutineTask, target: RoutineTarget): void {
  if (target.kind === 'model') {
    if (task.agent != null) task.agent = null;
    task.model = target.model;
    return;
  }
  if (task.agent?.bot_id !== target.agentId) {
    task.agent = { bot_id: target.agentId };
  }
  if (target.modelOverride === undefined) {
    delete task.model;
  } else {
    task.model = target.modelOverride;
  }
}

function buildAgentTask(draft: ScheduleDraft): RoutineTask {
  const target = routineTargetSchema.parse(draft.target);
  const task: RoutineTask = {
    prompt: '',
    user_prompt: draft.prompt.trim(),
    mcp_servers: draft.apps,
  };
  applyTarget(task, target);
  return task;
}

function buildTask(draft: ScheduleDraft) {
  const [only, ...rest] = draft.steps ?? [];
  // A routine that is only an agent saves in the simple form, however its
  // step was added.
  if (only?.kind === 'agent' && !rest.length)
    return buildAgentTask({
      ...draft,
      prompt: only.instructions,
      target: only.target,
    });
  return draft.steps
    ? programTaskFor(draft.steps, draft.apps)
    : buildAgentTask(draft);
}

/**
 * A program task. Apps are sent when there are some, or when `clearsApps`:
 * the scheduler rejects an update that drops stored apps without saying so.
 */
function programTaskFor(
  steps: StepDraft[],
  apps: ScheduleDraft['apps'],
  clearsApps = false
) {
  return {
    steps: stepsToWire(steps),
    ...(apps.length || clearsApps ? { mcp_servers: apps } : {}),
  };
}

export function draftToCreateBody(draft: ScheduleDraft): CreateScheduledAction {
  return {
    name: draft.name.trim() || deriveRoutineName(draft),
    trigger: triggerFromDraft(draft),
    kind: 'Agent',
    task: buildTask(draft),
    enabled: draft.enabled ?? true,
    run_visibility: draft.runVisibility ?? DEFAULT_RUN_VISIBILITY,
    ...(draft.description?.trim()
      ? { description: draft.description.trim() }
      : {}),
  };
}

/** An edited description; otherwise the stored one stays as it is. */
function descriptionField(draft: ScheduleDraft, previous: ScheduledAction) {
  const description = draft.description?.trim();
  return description === undefined ||
    description === (previous.description ?? '')
    ? {}
    : { description };
}

/** Keep the stored task when the edited steps write the same program. */
function programTask(draft: ScheduleDraft, previous: ScheduledAction) {
  const previousApps = programApps(previous.task);
  const clearsApps = previousApps.length > 0;
  const task = draft.steps
    ? programTaskFor(draft.steps, draft.apps, clearsApps)
    : buildTask(draft);
  const previousSteps = stepsFromTask(previous.task);
  return previousSteps &&
    JSON.stringify(task) ===
      JSON.stringify(programTaskFor(previousSteps, previousApps, clearsApps))
    ? previous.task
    : task;
}

function serializedTrigger(
  draft: ScheduleDraft & { triggers: NonNullable<ScheduleDraft['triggers']> },
  previous: ScheduledAction
) {
  return previous.trigger &&
    JSON.stringify(serializeTriggers(draft.triggers)) ===
      JSON.stringify(
        serializeTriggers(parseRoutineTriggers(previous.trigger) ?? [])
      )
    ? previous.trigger
    : serializeTriggers(draft.triggers);
}

/** A routine with steps always edits through the trigger editor. */
function programUpdateBody(
  draft: ScheduleDraft,
  previous: ScheduledAction
): UpdateScheduledAction | undefined {
  const { triggers } = draft;
  if (!triggers) return undefined;
  return {
    name:
      draft.name === previous.name
        ? previous.name
        : draft.name.trim() || deriveRoutineName(draft),
    trigger: serializedTrigger({ ...draft, triggers }, previous),
    kind: previous.kind,
    task: programTask(draft, previous),
    run_visibility: draft.runVisibility ?? previous.run_visibility,
    ...descriptionField(draft, previous),
  };
}

export function draftToUpdateBody(
  draft: ScheduleDraft,
  previous: ScheduledAction
): UpdateScheduledAction | undefined {
  if (draft.steps) return programUpdateBody(draft, previous);
  const trigger = getCronTrigger(previous);
  const previousTask = getAgentTask(previous);
  const target = routineTargetSchema.safeParse(draft.target);
  if ((!trigger && !draft.triggers) || !previousTask || !target.success)
    return undefined;

  const targetChanged = !routineTargetsEqual(
    target.data,
    targetFromTask(previousTask)
  );
  const promptChanged = draft.prompt !== previousTask.user_prompt;
  const appsChanged =
    draft.apps.map((app) => app.app_slug).join(',') !==
    (previousTask.mcp_servers ?? []).map((app) => app.app_slug).join(',');
  let task = previous.task;
  if (targetChanged || promptChanged || appsChanged) {
    const editedTask = { ...previousTask };
    if (targetChanged) applyTarget(editedTask, target.data);
    if (promptChanged) editedTask.user_prompt = draft.prompt.trim();
    if (appsChanged) editedTask.mcp_servers = draft.apps;
    task = editedTask;
  }
  const runVisibility = draft.runVisibility ?? previous.run_visibility;

  // Preserve API-written cron expressions and raw task data when not edited.
  if (draft.triggers)
    return {
      name:
        draft.name === previous.name
          ? previous.name
          : draft.name.trim() || 'Untitled',
      trigger: serializedTrigger(
        { ...draft, triggers: draft.triggers },
        previous
      ),
      kind: previous.kind,
      task,
      run_visibility: runVisibility,
      ...descriptionField(draft, previous),
    };
  if (!trigger) return;
  const parsed = parseCron(trigger.schedule);
  const scheduleChanged =
    draft.frequency !==
      (onceFromCron(trigger.schedule, trigger.timezone)?.frequency ??
        parsed.frequency) ||
    draft.onceAt !== onceFromCron(trigger.schedule, trigger.timezone)?.onceAt ||
    (draft.timezone !== undefined && draft.timezone !== trigger.timezone) ||
    draft.time !== parsed.time ||
    draft.dayOfMonth !== parsed.dayOfMonth ||
    draft.daysOfWeek.join(',') !== parsed.daysOfWeek.join(',');
  return {
    name:
      draft.name === previous.name
        ? previous.name
        : draft.name.trim() || deriveScheduleName(draft.prompt),
    trigger: scheduleChanged
      ? triggerFromDraft(draft, trigger.timezone)
      : trigger,
    kind: previous.kind,
    task,
    run_visibility: runVisibility,
    ...descriptionField(draft, previous),
  };
}

export function scheduleToDuplicateBody(
  schedule: ScheduledAction
): CreateScheduledAction | undefined {
  const trigger = schedule.trigger ?? getCronTrigger(schedule);
  if (!trigger) return undefined;
  return {
    enabled: schedule.enabled,
    kind: schedule.kind,
    name: `${schedule.name} copy`,
    trigger,
    task: schedule.task,
    run_visibility: schedule.run_visibility,
    ...(schedule.description ? { description: schedule.description } : {}),
  };
}

function triggerFromDraft(
  draft: ScheduleDraft,
  timezone = getDefaultTimezone()
) {
  if (draft.triggers) return serializeTriggers(draft.triggers);
  if (draft.frequency === 'once') {
    const date = new Date(draft.onceAt ?? '');
    if (Number.isNaN(date.getTime()))
      throw new Error('Choose a valid date and time.');
    return {
      type: 'cron' as const,
      timezone: 'UTC',
      schedule: `${date.getUTCSeconds()} ${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} * ${date.getUTCFullYear()}`,
    };
  }
  return {
    type: 'cron' as const,
    timezone: draft.timezone ?? timezone,
    schedule: buildCron(draft),
  };
}
