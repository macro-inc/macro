import { describeTriggers, validateTriggers } from '../core/routine-triggers';
import {
  onceFromCron,
  parseRoutineTriggers,
  serializeTriggers,
} from '../queries/routine-trigger-mapping';

export { onceFromCron } from '../queries/routine-trigger-mapping';

import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
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
import { ThrownResultError } from '@core/util/result';
import { getCronTrigger } from '@queries/agent-schedule/triggers';
import type {
  CreateScheduledAction,
  ScheduledAction,
  UpdateScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import {
  type RoutineTarget,
  routineAgentIdSchema,
  routineModelSchema,
  routineTargetSchema,
  routineTargetsEqual,
} from '../core/routine-target';
import type { ScheduleDraft } from './types';

export {
  DEFAULT_TIME,
  getDefaultTimezone,
  isValidTime,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';

function normalizePrompt(value: string) {
  return value
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function deriveScheduleName(prompt: string) {
  const summary = normalizePrompt(prompt);
  if (!summary) return blockNameToDefaultFile('automation');
  return summary.length > 72 ? `${summary.slice(0, 71)}…` : summary;
}

/** The cron-editable parts of a draft, which is all the shared helpers need. */
function cronParts(draft: ScheduleDraft): CronParts {
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

type ParsedCron = Pick<
  ScheduleDraft,
  'frequency' | 'time' | 'daysOfWeek' | 'dayOfMonth'
>;

/**
 * Read a cron expression into the parts an automation's picker edits.
 *
 * A pass-through: the shared parser only ever reports frequencies this picker
 * can render, so there is nothing to adapt.
 */
export function parseCron(cron: string): ParsedCron {
  return parseCronParts(cron);
}

function buildCron(draft: ScheduleDraft) {
  return buildCronExpression(cronParts(draft));
}

export function createEmptyDraft(): ScheduleDraft {
  return {
    name: '',
    prompt: '',
    frequency: 'week',
    time: DEFAULT_TIME,
    daysOfWeek: [...DEFAULT_WEEKDAYS],
    dayOfMonth: '1',
    target: { kind: 'model', model: DEFAULT_MODEL },
  };
}

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
  const parsed = trigger ? parseCron(trigger.schedule) : createEmptyDraft();
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

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ThrownResultError) {
    return error.errors.map((item) => item.message).join(', ');
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return 'Please try again.';
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

export function validateRoutineDraft(
  draft: ScheduleDraft,
  creating = false
): string | null {
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
