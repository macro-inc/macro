// The routine catalog as the judge reads it: what each ready-made routine
// does. The source is crates/routine_program/src/catalog.rs; `catalogDrift`
// says when the two disagree, so a renamed or new routine fails the bench
// instead of being judged blind.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Entry = { title: string; description: string; does: string; surfaces: string[]; suggest: boolean };

export const CATALOG: Record<string, Entry> = {
  inbox: { title: 'Sort my inbox', description: 'AI labels new email by topic', does: "When an email arrives, labels it with the one of the person's existing labels that fits it.", surfaces: ['email'], suggest: true },
  triage: { title: 'Triage new tasks', description: 'AI sets each new task’s priority', does: 'When a task is created, sets its priority from what it says.', surfaces: ['tasks'], suggest: true },
  brief: { title: 'Morning brief', description: 'Weekdays at 9, sum up my day', does: 'Weekdays at 9am, sums up the day: meetings, tasks due and anything waiting on the person.', surfaces: ['calendar', 'tasks'], suggest: true },
  updates: { title: 'Share updates', description: 'Post finished tasks to a channel', does: 'When a task is completed, posts its name in a channel.', surfaces: ['chat', 'tasks'], suggest: false },
  stuck: { title: 'Chase stuck tasks', description: 'Fridays, list what’s stalled', does: 'Fridays at 3pm, lists tasks in progress or in review for over a week, with a next step each.', surfaces: ['tasks'], suggest: true },
  email_tags: { title: 'Tag new email', description: 'AI tags new email Reply, Followup, Action or FYI', does: 'When an email arrives, tags it Reply, Followup, Action or FYI (tag names are knobs).', surfaces: ['email'], suggest: true },
  document_tags: { title: 'Tag new documents', description: 'AI tags new documents by topic', does: "When the person creates a document, tags it with the one of their personal tags that fits.", surfaces: ['files'], suggest: true },
  call_tasks: { title: 'Tasks from my calls', description: 'After a call, make tasks for what I agreed to do', does: "When a call in the app the person joined ends, makes a task for each thing they agreed to do.", surfaces: ['calls', 'tasks'], suggest: true },
  pipeline: { title: 'Weekly pipeline review', description: 'Mondays, list deals that need a next step', does: 'Mondays at 9am, lists CRM deals and companies with no contact in two weeks, with a next step each.', surfaces: ['crm'], suggest: true },
  mentions: { title: 'Catch up on mentions', description: 'Weekdays at 5, sum up where I was mentioned', does: "Weekdays at 5pm, sums up the day's channel messages that mention the person.", surfaces: ['chat'], suggest: true },
  pull_requests: { title: 'Sum up new pull requests', description: 'AI sums up each pull request opened in a repository', does: 'When a GitHub pull request is opened in a connected repository, sums up what it changes.', surfaces: ['reviews'], suggest: true },
  agent_digest: { title: 'Weekly agent digest', description: 'Fridays, sum up what my agents did', does: "Fridays at 4pm, sums up the week's agent sessions.", surfaces: ['agents'], suggest: true },
  invoices: { title: 'Task for invoices due soon', description: 'AI makes a task to pay each invoice due soon', does: 'When an email is an invoice or bill due within a week (knobs: the question, the days, the priority), makes a task to pay it.', surfaces: ['email', 'tasks'], suggest: true },
};

const SOURCE = resolve(import.meta.dir, '../../routine_program/src/catalog.rs');

/** Keys catalog.rs has that this table lacks, and the reverse; empty when they agree. */
export function catalogDrift(): string[] {
  const source = readFileSync(SOURCE, 'utf8');
  const keys = [...source.matchAll(/^\s+key: "([a-z_]+)",$/gm)].map((match) => match[1]);
  return [
    ...keys.filter((key) => !CATALOG[key]).map((key) => `catalog.rs has "${key}"; add it to bench/catalog.ts`),
    ...Object.keys(CATALOG).filter((key) => !keys.includes(key)).map((key) => `bench/catalog.ts has "${key}", which catalog.rs no longer has`),
  ];
}
