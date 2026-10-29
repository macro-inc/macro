import type { WireSuggestion } from '../queries/suggestion-wire';

/**
 * The server's suggestions for a founder's workspace, for fixtures and fakes:
 * three email routines and one or two for other surfaces, with the AI's keep
 * estimates putting three of them over the default-on bar.
 */
export const FIXTURE_ROUTINE_SUGGESTIONS: WireSuggestion[] = [
  {
    surface: 'email',
    title: 'Tag invoices and receipts',
    summary: 'Labels every invoice and receipt as Finance when it arrives.',
    reason: 'Stripe and AWS bill you every month',
    instructions:
      'When an email is an invoice or a receipt, label it Finance and archive it. Note the vendor, amount, and due date in the Finance expenses document.',
    icon: 'tag',
    keepProbability: 0.86,
    affectsOthers: false,
    notify: false,
    trigger: {
      kind: 'event',
      event: 'email.message_received',
      condition: 'Is this email an invoice or a receipt?',
    },
  },
  {
    surface: 'email',
    title: 'Alert me about Acme',
    summary: 'Tells you right away when anyone from Acme writes in.',
    reason: 'Acme is your largest open deal',
    instructions:
      'When an email comes from someone at Acme or mentions the Acme renewal, summarize it in two sentences and draft a reply for me to review.',
    icon: 'bell',
    keepProbability: 0.74,
    affectsOthers: false,
    notify: true,
    trigger: {
      kind: 'event',
      event: 'email.message_received',
      condition: 'Is this email from Acme or about the Acme renewal?',
    },
  },
  {
    surface: 'email',
    title: 'Morning inbox digest',
    summary: 'A short list of what needs you, every weekday morning.',
    reason: 'You get 80+ emails a day',
    instructions:
      'Every weekday morning, list the emails from the last day that need my reply, ranked by urgency, with a one-line summary each.',
    icon: 'mail',
    keepProbability: 0.82,
    affectsOthers: false,
    notify: true,
    trigger: {
      kind: 'schedule',
      schedule: {
        frequency: 'week',
        time: '08:30',
        weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      },
    },
  },
  {
    surface: 'calls',
    title: 'Follow-ups after every call',
    summary: 'Creates tasks for the action items when a call ends.',
    reason: 'You run six customer calls a week',
    instructions:
      'When a call ends, read its transcript and create a task for me for each action item I own, due when I said.',
    icon: 'task',
    keepProbability: 0.88,
    affectsOthers: false,
    notify: false,
    trigger: { kind: 'event', event: 'call.ended' },
  },
  {
    surface: 'crm',
    title: 'Keep the pipeline honest',
    summary: 'Checks every deal sits in the right stage, each Friday.',
    reason: 'Your Sales pipeline has 40 open deals',
    instructions:
      'Every Friday afternoon, review each open deal in the Sales pipeline against its latest emails and calls, and move any deal whose stage is out of date. List what you moved.',
    icon: 'chart',
    keepProbability: 0.71,
    affectsOthers: true,
    notify: true,
    trigger: {
      kind: 'schedule',
      schedule: { frequency: 'week', time: '16:00', weekdays: ['fri'] },
    },
  },
  {
    surface: 'calendar',
    title: 'Meeting prep briefs',
    summary: 'A one-page brief on who you are meeting, every morning.',
    reason: 'Most of your meetings are with new people',
    instructions:
      'Every weekday morning, for each external meeting today, write a short brief on the attendees and their company from email history and the web.',
    icon: 'calendar',
    keepProbability: 0.64,
    affectsOthers: false,
    notify: true,
    trigger: {
      kind: 'schedule',
      schedule: { frequency: 'day', time: '07:45' },
    },
  },
];
