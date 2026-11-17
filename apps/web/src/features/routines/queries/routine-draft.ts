import {
  buildCron,
  deriveRoutineName,
  deriveScheduleName,
  parseCron,
} from '../core/routine-draft';
import {
  firstAgent,
  programSteps,
  type StepDraft,
  stepsToWire,
} from '../core/routine-steps';
import {
  onceFromCron,
  onceTrigger,
  parseRoutineTriggers,
  serializeTriggers,
} from './routine-trigger-mapping';

export { onceFromCron } from './routine-trigger-mapping';

import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { deepEqual } from '@core/util/compareUtils';
import { getDefaultTimezone } from '@core/util/cron';
import type {
  ActionConfiguration,
  ActionConfigurationUpdate,
  AgentTask,
  RoutineTask,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { DEFAULT_RUN_VISIBILITY, type ScheduleDraft } from '../core/draft';
import {
  type RoutineTarget,
  routineTargetSchema,
  routineTargetsEqual,
} from '../core/routine-target';
import { getCronTrigger } from './triggers';

/** The apps a program requires, stored beside its steps. */
function programApps(task: RoutineTask): ScheduleDraft['apps'] {
  return 'steps' in task ? (task.mcp_servers ?? []) : [];
}

/** Whether a program's code steps write as its owner; absent means as the agent. */
function programOperatesAsUser(task: RoutineTask): boolean {
  return 'steps' in task && (task.dangerously_operate_as_user ?? false);
}

function getAgentTask(schedule: ScheduledAction): AgentTask | undefined {
  if (schedule.kind !== 'Agent' || 'steps' in schedule.task) return undefined;
  return schedule.task;
}

/** Whether a routine runs an agent or a bare model; undefined when its task is unreadable. */
export function routineTargetKind(
  schedule: ScheduledAction
): RoutineTarget['kind'] | 'steps' | undefined {
  if (programSteps(schedule.task)) return 'steps';
  const task = getAgentTask(schedule);
  const target = task && targetFromTask(task);
  return target?.kind;
}

/** The task's model or agent; undefined when it has neither, which saving rejects. */
function targetFromTask(task: AgentTask): RoutineTarget | undefined {
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
  return task.model != null ? { kind: 'model', model: task.model } : undefined;
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
    dangerouslyOperateAsUser: programOperatesAsUser(schedule.task),
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
    schedule.kind === 'Agent' ? programSteps(schedule.task) : undefined;
  if (steps) return programDraft(schedule, steps, triggers);
  const parsed = trigger
    ? parseCron(trigger.schedule)
    : parseCron('0 0 9 * * *');
  const task = getAgentTask(schedule);
  const target = task && targetFromTask(task);
  if (!task || !target) return undefined;

  return {
    id: schedule.id ?? undefined,
    name: schedule.name,
    prompt: task.user_prompt,
    ...(task.prompt.trim() ? { basePrompt: task.prompt } : {}),
    frequency: parsed.frequency,
    time: parsed.time,
    daysOfWeek: parsed.daysOfWeek,
    dayOfMonth: parsed.dayOfMonth,
    target,
    runVisibility: schedule.run_visibility,
    description: schedule.description ?? '',
    apps: task.mcp_servers ?? [],
    timezone: trigger?.timezone,
    triggers,
    ...(trigger ? onceFromCron(trigger.schedule, trigger.timezone) : {}),
  };
}

function applyTarget(task: AgentTask, target: RoutineTarget): void {
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

function buildAgentTask(draft: ScheduleDraft): AgentTask {
  const target = routineTargetSchema.parse(draft.target);
  const task: AgentTask = {
    prompt: '',
    user_prompt: draft.prompt.trim(),
    mcp_servers: draft.apps,
  };
  applyTarget(task, target);
  return task;
}

function buildTask(draft: ScheduleDraft): RoutineTask {
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
    ? programTaskFor(draft.steps, {
        apps: draft.apps,
        operatesAsUser: draft.dangerouslyOperateAsUser ?? false,
      })
    : buildAgentTask(draft);
}

/**
 * A program task. Apps are sent when there are some, or when `clearsApps`:
 * the scheduler rejects an update that drops stored apps without saying so.
 * Operating as the user is sent when on, or as `false` when it turns off.
 */
function programTaskFor(
  steps: StepDraft[],
  options: {
    apps: ScheduleDraft['apps'];
    operatesAsUser: boolean;
    clearsApps?: boolean;
    clearsOperatesAsUser?: boolean;
  }
) {
  return {
    steps: stepsToWire(steps),
    ...(options.apps.length || options.clearsApps
      ? { mcp_servers: options.apps }
      : {}),
    ...(options.operatesAsUser || options.clearsOperatesAsUser
      ? { dangerously_operate_as_user: options.operatesAsUser }
      : {}),
  };
}

export function draftToCreateBody(draft: ScheduleDraft): ActionConfiguration {
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
  const previousOperatesAsUser = programOperatesAsUser(previous.task);
  const clears = {
    clearsApps: previousApps.length > 0,
    clearsOperatesAsUser: previousOperatesAsUser,
  };
  const task = draft.steps
    ? programTaskFor(draft.steps, {
        apps: draft.apps,
        operatesAsUser: draft.dangerouslyOperateAsUser ?? false,
        ...clears,
      })
    : buildTask(draft);
  const previousSteps = programSteps(previous.task);
  return previousSteps &&
    JSON.stringify(task) ===
      JSON.stringify(
        programTaskFor(previousSteps, {
          apps: previousApps,
          operatesAsUser: previousOperatesAsUser,
          ...clears,
        })
      )
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
): ActionConfigurationUpdate | undefined {
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

/**
 * Whether an update writes back what is already stored. Saving it would
 * still bump the routine's revision, which cancels event runs queued under
 * the old one, so a save that changes nothing is skipped.
 */
export function isUnchangedUpdate(
  body: ActionConfigurationUpdate,
  stored: ScheduledAction
): boolean {
  if (!('trigger' in body)) return false;
  return (
    body.name === stored.name &&
    body.kind === stored.kind &&
    (body.enabled ?? stored.enabled) === stored.enabled &&
    (body.run_visibility ?? stored.run_visibility) === stored.run_visibility &&
    (body.description ?? stored.description ?? '') ===
      (stored.description ?? '') &&
    deepEqual(body.trigger, stored.trigger) &&
    deepEqual(body.task, stored.task)
  );
}

export function draftToUpdateBody(
  draft: ScheduleDraft,
  previous: ScheduledAction
): ActionConfigurationUpdate | undefined {
  if (draft.steps) return programUpdateBody(draft, previous);
  const trigger = getCronTrigger(previous);
  const previousTask = getAgentTask(previous);
  const previousTarget = previousTask && targetFromTask(previousTask);
  const target = routineTargetSchema.safeParse(draft.target);
  if (
    (!trigger && !draft.triggers) ||
    !previousTask ||
    !previousTarget ||
    !target.success
  )
    return undefined;

  const targetChanged = !routineTargetsEqual(target.data, previousTarget);
  const promptChanged = draft.prompt !== previousTask.user_prompt;
  const appsChanged =
    draft.apps.map((app) => app.app_slug).join(',') !==
    (previousTask.mcp_servers ?? []).map((app) => app.app_slug).join(',');
  let task = previous.task;
  if (targetChanged || promptChanged || appsChanged) {
    const editedTask: AgentTask = { ...previousTask };
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
): ActionConfiguration | undefined {
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
  if (draft.frequency === 'once') return onceTrigger(draft.onceAt ?? '');
  return {
    type: 'cron' as const,
    timezone: draft.timezone ?? timezone,
    schedule: buildCron(draft),
  };
}
