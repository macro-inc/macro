import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import {
  buildCron as buildCronExpression,
  type CronParts,
  DEFAULT_TIME,
  DEFAULT_WEEKDAYS,
  describeCron,
  getDefaultTimezone,
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
import type { ScheduleDraft, ScheduleFrequency } from './types';

export {
  DEFAULT_TIME,
  getDefaultTimezone,
  isValidTime,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';

export const INPUT_CLASS =
  'w-full border border-edge-muted rounded-sm bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent/20 cursor-default';

export const FREQUENCY_OPTIONS: Array<{
  value: ScheduleFrequency;
  label: string;
}> = [
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
];

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
    frequency: draft.frequency,
    time: draft.time,
    daysOfWeek: draft.daysOfWeek,
    dayOfMonth: draft.dayOfMonth,
  };
}

export function describeSchedule(draft: ScheduleDraft, timezone: string) {
  return describeCron(cronParts(draft), timezone);
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
    enabled: true,
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
  if (!trigger) return undefined;
  const parsed = parseCron(trigger.schedule);
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
    enabled: schedule.enabled,
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
    trigger: {
      type: 'cron',
      schedule: buildCron(draft),
      timezone: getDefaultTimezone(),
    },
    kind: 'Agent',
    task: buildAgentTask(draft),
    enabled: draft.enabled,
  };
}

export function draftToUpdateBody(
  draft: ScheduleDraft,
  previous: ScheduledAction
): UpdateScheduledAction | undefined {
  const trigger = getCronTrigger(previous);
  const previousTask = getAgentTask(previous);
  const target = routineTargetSchema.safeParse(draft.target);
  if (!trigger || !previousTask || !target.success) return undefined;

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
  // The backend permits disabling a running action only if configuration matches.
  const parsed = parseCron(trigger.schedule);
  const scheduleChanged =
    draft.frequency !== parsed.frequency ||
    draft.time !== parsed.time ||
    draft.dayOfMonth !== parsed.dayOfMonth ||
    draft.daysOfWeek.join(',') !== parsed.daysOfWeek.join(',');
  return {
    name:
      draft.name === previous.name
        ? previous.name
        : draft.name.trim() || deriveScheduleName(draft.prompt),
    trigger: scheduleChanged
      ? { ...trigger, schedule: buildCron(draft) }
      : trigger,
    kind: previous.kind,
    task,
    enabled: draft.enabled,
  };
}

export function scheduleToDuplicateBody(
  schedule: ScheduledAction
): CreateScheduledAction | undefined {
  const trigger = getCronTrigger(schedule);
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
