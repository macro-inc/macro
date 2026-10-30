import { match } from 'ts-pattern';
import type { ScheduleDraft } from './draft';
import { withNewDraftSteps } from './routine-draft';
import { agentStep, type StepDraft } from './routine-steps';
import type { RoutineTarget } from './routine-target';
import {
  newScheduleTrigger,
  type RoutineTriggerDraft,
} from './routine-triggers';
import {
  aiPicks,
  createActionStep,
  createPickStep,
  type StepSubject,
  stepActions,
  triggerScope,
} from './step-catalog';

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
  /** It only runs right when AI checks its trigger, so it needs decisions. */
  needsDecisions?: true;
};

export const routineTemplates: RoutineTemplate[] = [
  {
    key: 'inbox',
    when: 'When: New email received',
    title: 'Sort my inbox',
    description: 'AI labels new email by topic',
    kind: 'email',
    ai: true,
  },
  {
    key: 'triage',
    when: 'When: Task created',
    title: 'Triage new tasks',
    description: 'AI sets priority and an owner',
    kind: 'task',
    ai: true,
  },
  {
    key: 'brief',
    when: 'Weekdays at 9:00 AM',
    title: 'Morning brief',
    description: 'Weekdays at 9, sum up my day',
    kind: 'schedule',
    ai: false,
  },
  {
    key: 'stuck',
    when: 'Fridays at 3:00 PM',
    title: 'Chase stuck tasks',
    description: 'Fridays, list what’s stalled',
    kind: 'schedule',
    ai: false,
  },
  {
    key: 'updates',
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

export type TemplateContext = {
  /** Decision steps and trigger conditions are available. */
  decisions: boolean;
  /** Who runs agent steps. */
  target: RoutineTarget;
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

function pick(
  action: (typeof aiPicks)[number]['action'],
  subject: StepSubject
) {
  const preset = aiPicks.find((pick) => pick.action === action);
  if (!preset) throw new Error(`Unknown AI pick ${action}`);
  return createPickStep(preset, triggerScope(subject));
}

function messageStep(content: string): StepDraft {
  const action = stepActions.find((action) => action.key === 'send_message');
  if (!action) throw new Error('Send message is missing from the catalog');
  const step = createActionStep(action, triggerScope('task'));
  return { ...step, arguments: { ...step.arguments, content } };
}

/** A new routine started from `template`, ready to review. */
export function templateDraft(
  template: RoutineTemplate,
  base: ScheduleDraft,
  context: TemplateContext
): ScheduleDraft {
  const agent = (instructions: string) =>
    agentStep(context.target, instructions);
  const plan = match(template.key)
    .returnType<{ triggers: RoutineTriggerDraft[]; steps: StepDraft[] }>()
    .with('inbox', () => ({
      triggers: [eventTrigger(['email.message_received'])],
      steps: context.decisions
        ? [pick('add_label', 'email')]
        : [
            agent(
              'Label this email by topic with one of my existing Gmail labels. Leave it alone if none fits.'
            ),
          ],
    }))
    .with('triage', () => ({
      triggers: [eventTrigger(['task.created'])],
      steps: context.decisions
        ? [pick('set_priority', 'task'), pick('assign', 'task')]
        : [
            agent(
              'Set this task’s priority to Urgent, High, Medium or Low from what it says, and assign it to whoever owns that area.'
            ),
          ],
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
      steps: [messageStep('Done: {{trigger.item.name}}')],
    }))
    .exhaustive();
  return withNewDraftSteps(
    { ...base, name: template.title, triggers: plan.triggers },
    plan.steps
  );
}
