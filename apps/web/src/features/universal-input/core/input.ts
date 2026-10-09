import { z } from 'zod';

export const intentSchema = z.enum([
  'ai',
  'search',
  'email',
  'note',
  'task',
  'calendar',
  'message',
]);
export type Intent = z.infer<typeof intentSchema>;
export const intents = intentSchema.options;
export const intentLabels: Record<Intent, string> = {
  ai: 'AI',
  search: 'Search',
  email: 'Email',
  note: 'Note',
  task: 'Task',
  calendar: 'Event',
  message: 'Message',
};
export const actionLabels: Record<Intent, string> = {
  ai: 'Ask AI',
  search: 'Search Macro',
  email: 'Send email',
  note: 'Create note',
  task: 'Create task',
  calendar: 'Create event',
  message: 'Send message',
};
export const fieldsSchema = z.object({
  title: z.string().default(''),
  body: z.string().default(''),
  subject: z.string().default(''),
  recipients: z.string().default(''),
  query: z.string().default(''),
  start: z.string().default(''),
  end: z.string().default(''),
  due_date: z.string().default(''),
  location: z.string().default(''),
  guests: z.string().default(''),
  calendarId: z.string().default(''),
  inboxId: z.string().default(''),
  taskProperties: z.string().default(''),
  botId: z.string().default(''),
  model: z.string().default(''),
});
export type InputFields = z.infer<typeof fieldsSchema>;
export type Field = keyof InputFields;
export type Scores = { intent: Intent; score: number }[];
export const scoresSchema = z.array(
  z.object({ intent: intentSchema, score: z.number().min(0).max(1) })
);
export const suggestionsSchema = z.object({
  title: z.string().nullish(),
  body: z.string().nullish(),
  subject: z.string().nullish(),
  recipients: z.array(z.string()).default([]),
  query: z.string().nullish(),
  start: z.string().nullish(),
  end: z.string().nullish(),
  due_date: z.string().nullish(),
  location: z.string().nullish(),
  guests: z.array(z.string()).default([]),
});
export type Suggestions = z.infer<typeof suggestionsSchema>;

export function rankIntents(scores: Scores): Scores {
  return [...scores].sort((a, b) => b.score - a.score);
}

export function inferIntent(scores: Scores): Intent | undefined {
  const [first, second] = rankIntents(scores);
  return first &&
    first.score >= 0.8 &&
    first.score - (second?.score ?? 0) >= 0.2 - Number.EPSILON
    ? first.intent
    : undefined;
}

export const draftSchema = z.object({
  version: z.literal(1),
  submissionId: z.string().uuid().optional(),
  text: z.string(),
  intent: intentSchema.optional(),
  locked: z.boolean(),
  fields: z.record(intentSchema, fieldsSchema.partial()).default({
    ai: {},
    search: {},
    email: {},
    note: {},
    task: {},
    calendar: {},
    message: {},
  }),
  edited: z
    .record(intentSchema, z.array(z.enum(fieldsSchema.keyof().options)))
    .default({
      ai: [],
      search: [],
      email: [],
      note: [],
      task: [],
      calendar: [],
      message: [],
    }),
});
export type Draft = z.infer<typeof draftSchema>;
export function emptyDraft(): Draft {
  return draftSchema.parse({ version: 1, text: '', locked: false });
}

export function applySuggestions(
  fields: Partial<InputFields>,
  edited: Field[],
  suggestions: Suggestions
): Partial<InputFields> {
  const next = { ...fields };
  for (const key of Object.keys(suggestions) as (keyof Suggestions)[]) {
    if (edited.includes(key)) continue;
    const value = suggestions[key];
    next[key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }
  return next;
}

/** A changed thought invalidates model-owned fields, including inactive types. */
export function updateDraftText(draft: Draft, text: string): Draft {
  const fields = { ...draft.fields };
  for (const intent of intents) {
    const next = { ...fields[intent] };
    for (const key of suggestionsSchema.keyof().options) {
      if (!draft.edited[intent].includes(key)) next[key] = '';
    }
    fields[intent] = next;
  }
  return { ...draft, text, fields };
}

export type Submission = {
  intent: Intent;
  text: string;
  fields: InputFields;
  id: string;
};
export type SubmissionResult = { message: string; open?: () => void };

export function missingFields(input: Submission): string | undefined {
  const f = input.fields;
  if (!input.text.trim()) return 'Type something to begin';
  if (['note', 'task', 'calendar'].includes(input.intent) && !f.title.trim())
    return 'Add a title';
  if (['email', 'message'].includes(input.intent)) {
    if (!f.recipients.trim()) return 'Choose a recipient';
    if (!f.body.trim()) return 'Add the outgoing message';
  }
  if (input.intent === 'email' && !f.subject.trim()) return 'Add a subject';
  if (input.intent === 'calendar') {
    const start = new Date(f.start).getTime();
    const end = new Date(f.end).getTime();
    if (
      !f.start ||
      !f.end ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    )
      return 'Choose a valid start and end time';
  }
}
