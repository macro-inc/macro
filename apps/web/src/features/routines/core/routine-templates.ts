import { match } from 'ts-pattern';
import type { ScheduleDraft } from './draft';
import { createEmptyDraft, withNewDraftSteps } from './routine-draft';
import { agentStep, type StepDraft } from './routine-steps';
import type { RoutineTarget } from './routine-target';
import {
  newScheduleTrigger,
  type RoutineTriggerDraft,
} from './routine-triggers';

/** A starting point for a new routine, shown before the editor. */
export type RoutineTemplate = {
  key: 'inbox' | 'triage' | 'brief' | 'stuck' | 'updates';
  title: string;
  description: string;
  /** What starts it, for its icon. */
  kind: 'email' | 'task' | 'schedule';
  /** Its trigger in a line, as shared templates show theirs. */
  when: string;
  /** Its steps let AI decide, so it is highlighted as an AI routine. */
  ai: boolean;
  /** Its trigger has a condition, which needs AI decisions. */
  needsDecisions?: true;
  /** What starts it and what it does, as the list's template cards show. */
  chain: { trigger: string; action: string; actionAi: boolean };
};

export const routineTemplates: RoutineTemplate[] = [
  {
    key: 'inbox',
    chain: { trigger: 'New email', action: 'Label with AI', actionAi: true },
    when: 'When: New email received',
    title: 'Sort my inbox',
    description: 'AI labels new email by topic',
    kind: 'email',
    ai: true,
  },
  {
    key: 'triage',
    chain: {
      trigger: 'Task created',
      action: 'Set priority with AI',
      actionAi: true,
    },
    when: 'When: Task created',
    title: 'Triage new tasks',
    description: 'AI sets each new task’s priority',
    kind: 'task',
    ai: true,
  },
  {
    key: 'brief',
    chain: { trigger: 'Weekdays 9:00', action: 'Ask AI', actionAi: true },
    when: 'Weekdays at 9:00 AM',
    title: 'Morning brief',
    description: 'Weekdays at 9, sum up my day',
    kind: 'schedule',
    ai: false,
  },
  {
    key: 'stuck',
    chain: { trigger: 'Fridays 15:00', action: 'Ask AI', actionAi: true },
    when: 'Fridays at 3:00 PM',
    title: 'Chase stuck tasks',
    description: 'Fridays, list what’s stalled',
    kind: 'schedule',
    ai: false,
  },
  {
    key: 'updates',
    chain: {
      trigger: 'Status changed',
      action: 'Post in a channel',
      actionAi: false,
    },
    when: 'When: Status changed',
    title: 'Share updates',
    description: 'Post finished tasks to a channel',
    kind: 'task',
    ai: false,
    needsDecisions: true,
  },
];

/** The templates a new routine can start from. */
export function availableTemplates(decisions: boolean): RoutineTemplate[] {
  return routineTemplates.filter(
    (template) => decisions || !template.needsDecisions
  );
}

/** The list shows four; these come first, the rest fill in when one is off. */
const FEATURED: readonly RoutineTemplate['key'][] = [
  'inbox',
  'triage',
  'brief',
  'updates',
];

/** The templates the routines list offers above it. */
export function featuredTemplates(decisions: boolean): RoutineTemplate[] {
  const available = availableTemplates(decisions);
  return [
    ...available.filter((template) => FEATURED.includes(template.key)),
    ...available.filter((template) => !FEATURED.includes(template.key)),
  ].slice(0, FEATURED.length);
}

/**
 * The scheduler's code steps for templates that are code (`inbox`, `triage`,
 * `updates`), by key; a template without them starts with an Ask AI step.
 */
export type StarterSteps = Partial<Record<RoutineTemplate['key'], StepDraft[]>>;

export type TemplateContext = {
  /** Who runs agent steps. */
  target: RoutineTarget;
  starters: StarterSteps;
};

function eventTrigger(
  events: Extract<RoutineTriggerDraft, { kind: 'event' }>['events'],
  condition?: string
): RoutineTriggerDraft {
  return {
    id: crypto.randomUUID(),
    kind: 'event',
    events,
    ...(condition ? { condition } : {}),
  };
}

/** Days use the cron crate's numbering: 1 is Sunday. */
function weekly(days: string[], time: string): RoutineTriggerDraft {
  return { ...newScheduleTrigger('week'), daysOfWeek: days, time };
}

/** A new routine started from `template`, ready to review. */
export function templateDraft(
  template: RoutineTemplate,
  base: ScheduleDraft,
  context: TemplateContext
): ScheduleDraft {
  const agent = (instructions: string) =>
    agentStep(context.target, instructions);
  // Each starter's code, or, where code can't be saved, an Ask AI step.
  const starter = (key: RoutineTemplate['key'], instructions: string) =>
    context.starters[key] ?? [agent(instructions)];
  const plan = match(template.key)
    .returnType<{ triggers: RoutineTriggerDraft[]; steps: StepDraft[] }>()
    .with('inbox', () => ({
      triggers: [eventTrigger(['email.message_received'])],
      steps: starter(
        'inbox',
        'Label this email by topic with one of my existing labels. Leave it alone if none fits.'
      ),
    }))
    .with('triage', () => ({
      triggers: [eventTrigger(['task.created'])],
      steps: starter(
        'triage',
        'Set this task’s priority to Urgent, High, Medium or Low from what it says.'
      ),
    }))
    .with('brief', () => ({
      triggers: [weekly(['2', '3', '4', '5', '6'], '09:00')],
      steps: [
        agent(
          'Summarize my day: today’s meetings, tasks due today or overdue, and anything waiting on me. Link each item.'
        ),
      ],
    }))
    .with('stuck', () => ({
      triggers: [weekly(['6'], '15:00')],
      steps: [
        agent(
          'List my tasks that have been in progress or in review for more than a week, oldest first, with a suggested next step for each.'
        ),
      ],
    }))
    .with('updates', () => ({
      triggers: [
        eventTrigger(
          ['task.status_changed'],
          'Was the task just marked completed?'
        ),
      ],
      steps: starter(
        'updates',
        'Post “Done:” and this task’s name in the updates channel.'
      ),
    }))
    .exhaustive();
  return withNewDraftSteps(
    {
      ...base,
      name: template.title,
      description: template.description,
      triggers: plan.triggers,
    },
    plan.steps
  );
}

/**
 * A new routine's first draft: blank, or started from a template, with
 * agent steps run by the plan's default model.
 */
export function newRoutineDraft(
  template: RoutineTemplate | undefined,
  context: { defaultModel: string; starters: StarterSteps }
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
        starters: context.starters,
      })
    : blank;
}
