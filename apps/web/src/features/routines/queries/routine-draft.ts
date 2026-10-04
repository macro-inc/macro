import {
  buildCron,
  deriveScheduleName,
  parseCron,
} from '../core/routine-draft';
import {
  onceFromCron,
  parseRoutineTriggers,
  serializeTriggers,
} from './routine-trigger-mapping';

export { onceFromCron } from './routine-trigger-mapping';

import { getDefaultTimezone } from '@core/util/cron';
import type {
  CreateScheduledAction,
  ScheduledAction,
  UpdateScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import type { ScheduleDraft } from '../core/draft';
import {
  type RoutineTarget,
  routineAgentIdSchema,
  routineModelSchema,
  routineTargetSchema,
  routineTargetsEqual,
} from '../core/routine-target';
import { getCronTrigger } from './triggers';

const agentTaskSchema = z
  .looseObject({
    agent: z.looseObject({ bot_id: routineAgentIdSchema }).nullish(),
    model: routineModelSchema.nullish(),
    prompt: z.string(),
    user_prompt: z.string(),
  })
  .refine((task) => task.agent != null || task.model != null);

type RoutineTask = z.infer<typeof agentTaskSchema>;

function getAgentTask(schedule: ScheduledAction): RoutineTask | undefined {
  if (schedule.kind !== 'Agent') return undefined;
  const result = agentTaskSchema.safeParse(schedule.task);
  return result.success ? result.data : undefined;
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

export function draftFromSchedule(
  schedule: ScheduledAction
): ScheduleDraft | undefined {
  const trigger = getCronTrigger(schedule);
  const sourceTrigger = schedule.trigger ?? trigger;
  const triggers = sourceTrigger
    ? parseRoutineTriggers(sourceTrigger)
    : undefined;
  if (!trigger && !triggers) return undefined;
  const parsed = trigger
    ? parseCron(trigger.schedule)
    : parseCron('0 0 9 * * *');
  const task = getAgentTask(schedule);
  if (!task) return undefined;

  return {
    id: schedule.id ?? undefined,
    name: schedule.name,
    prompt: task.user_prompt,
    frequency: parsed.frequency,
    time: parsed.time,
    daysOfWeek: parsed.daysOfWeek,
    dayOfMonth: parsed.dayOfMonth,
    target: targetFromTask(task),
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
  const task: RoutineTask = { prompt: '', user_prompt: draft.prompt.trim() };
  applyTarget(task, target);
  return task;
}

export function draftToCreateBody(draft: ScheduleDraft): CreateScheduledAction {
  return {
    name: draft.name.trim() || deriveScheduleName(draft.prompt),
    trigger: triggerFromDraft(draft),
    kind: 'Agent',
    task: buildAgentTask(draft),
    enabled: draft.enabled ?? true,
  };
}

export function draftToUpdateBody(
  draft: ScheduleDraft,
  previous: ScheduledAction
): UpdateScheduledAction | undefined {
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
  let task = previous.task;
  if (targetChanged || promptChanged) {
    const editedTask = { ...previousTask };
    if (targetChanged) applyTarget(editedTask, target.data);
    if (promptChanged) editedTask.user_prompt = draft.prompt.trim();
    task = editedTask;
  }

  // Preserve API-written cron expressions and raw task data when not edited.
  if (draft.triggers)
    return {
      name:
        draft.name === previous.name
          ? previous.name
          : draft.name.trim() || 'Untitled',
      trigger:
        previous.trigger &&
        JSON.stringify(serializeTriggers(draft.triggers)) ===
          JSON.stringify(
            serializeTriggers(parseRoutineTriggers(previous.trigger) ?? [])
          )
          ? previous.trigger
          : serializeTriggers(draft.triggers),
      kind: previous.kind,
      task,
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
