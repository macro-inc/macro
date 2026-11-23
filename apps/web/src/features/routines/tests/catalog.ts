import type {
  CatalogEntry,
  CodeStep,
} from '@service-scheduled-action/generated/schemas';
import type { RoutineTemplate } from '../core/routine-templates';
import { catalogTemplate } from '../queries/catalog';

const codeStep = (title: string): CodeStep & { type: 'code' } => ({
  type: 'code',
  title,
  summary: '',
  source: 'export async function main() {}',
});

const marks = {
  affectsOthers: false,
  safeDefault: false,
  template: true,
  suggest: true,
  namedKnobs: {},
};

/** The scheduler's catalog as it serves it, in the order it offers it. */
const ENTRIES: CatalogEntry[] = [
  {
    ...marks,
    key: 'inbox',
    surfaces: ['email'],
    title: 'Sort my inbox',
    description: 'AI labels new email by topic',
    request: 'When a new email arrives, label it.',
    action: 'Label with AI',
    trigger: {
      type: 'events',
      filters: [{ events: ['email.message_received'] }],
    },
    code: codeStep('Label by topic'),
    instructions: 'Label this email by topic with one of my existing labels.',
    safeDefault: true,
  },
  {
    ...marks,
    key: 'triage',
    surfaces: ['tasks'],
    title: 'Triage new tasks',
    description: 'AI sets each new task’s priority',
    request: 'When a task is created, set its priority.',
    action: 'Set priority with AI',
    trigger: { type: 'events', filters: [{ events: ['task.created'] }] },
    code: codeStep('Set the priority'),
    instructions: 'Set this task’s priority.',
    safeDefault: true,
  },
  {
    ...marks,
    key: 'brief',
    surfaces: ['calendar'],
    title: 'Morning brief',
    description: 'Weekdays at 9, sum up my day',
    request: 'Every weekday at 9am, sum up my day.',
    action: 'Ask AI',
    trigger: {
      type: 'cron',
      schedule: '0 0 9 * * 2,3,4,5,6',
      timezone: 'America/New_York',
    },
    code: null,
    instructions: 'Summarize my day: today’s meetings and tasks due.',
  },
  {
    ...marks,
    key: 'updates',
    surfaces: ['chat'],
    title: 'Share updates',
    description: 'Post finished tasks to a channel',
    request: 'When a task is marked completed, post it.',
    action: 'Post in a channel',
    trigger: {
      type: 'events',
      filters: [
        {
          events: ['task.status_changed'],
          condition: 'Was the task just marked completed?',
        },
      ],
    },
    code: codeStep('Post the update'),
    instructions: 'Post “Done:” and this task’s name in the updates channel.',
    affectsOthers: true,
    namedKnobs: { channel: 'channel' as const },
  },
  {
    ...marks,
    key: 'stuck',
    surfaces: ['tasks'],
    title: 'Chase stuck tasks',
    description: 'Fridays, list what’s stalled',
    request: 'Every Friday at 3pm, list my stalled tasks.',
    action: 'Ask AI',
    trigger: {
      type: 'cron',
      schedule: '0 0 15 * * 6',
      timezone: 'America/New_York',
    },
    code: null,
    instructions: 'List my tasks in progress for more than a week.',
  },
  {
    ...marks,
    key: 'invoices',
    surfaces: ['email'],
    title: 'Task for invoices due soon',
    description: 'AI makes a task to pay each invoice due soon',
    request: 'When an invoice arrives, make a task.',
    action: 'Make a task with AI',
    trigger: {
      type: 'events',
      filters: [{ events: ['email.message_received'] }],
    },
    code: codeStep('Task for invoices due soon'),
    instructions: 'Make a task to pay this invoice.',
    template: false,
  },
];

/** The catalog as the web reads it. */
export const TEST_CATALOG: RoutineTemplate[] = ENTRIES.map(catalogTemplate);

export function testTemplate(key: string): RoutineTemplate {
  const template = TEST_CATALOG.find((entry) => entry.key === key);
  if (!template) throw new Error(`No template ${key}`);
  return template;
}
