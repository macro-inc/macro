// The fixed drafting requests the benchmark runs, with what a good draft of
// each must do. `scenario.json` seeds the benchmark user's workspace first,
// so each item a request names has exactly one match, except where a case
// checks that a missing item is left out.

/**
 * The seeded items requests name, by the name a request uses: the seed
 * scenario's entity kind and key, from which its id is derived.
 */
export const FIXTURE: Record<string, { kind: string; key: string }> = {
  'design-feedback': { kind: 'channel', key: 'design-feedback' },
  engineering: { kind: 'channel', key: 'engineering' },
  'eng-announcements': { kind: 'channel', key: 'eng-announcements' },
  'Q4 Launch': { kind: 'project', key: 'q4-launch' },
};

/** The routine a step case starts from: one of Macro's catalog routines. */
export type BaseRoutine = { catalogKey: string };

export type Case = {
  id: string;
  /** What the person typed. */
  text: string;
  kind: 'routine' | 'add_step' | 'change_step';
  /** Whether the drafter may write code steps (the code-steps flag). */
  code: boolean;
  /** For step cases: the routine the step is added to or changed in. */
  base?: BaseRoutine;
  /** For `change_step`: the step to change. */
  index?: number;
  /** What a good draft does, checked on the returned draft. */
  expect: Expectation[];
};

/**
 * One property of a good draft. `ids` maps fixture names to their ids, so an
 * expectation can ask that a channel be used by id.
 */
export type Expectation = {
  says: string;
  holds: (draft: DraftResult, ids: Record<string, string>) => boolean;
};

/** The draft endpoint's answer, loosely typed: the benchmark only reads it. */
export type DraftResult = {
  outcome: 'routine' | 'step' | 'failed';
  message?: string;
  name?: string;
  trigger?: unknown;
  steps?: unknown[];
  step?: unknown;
  problems?: unknown[];
  created?: { entityType: string; entityId: string; used: boolean }[];
};

const text = (value: unknown) => JSON.stringify(value ?? null);

const drafted: Expectation = {
  says: 'drafted, with no code problems',
  holds: (draft) =>
    draft.outcome !== 'failed' && (draft.problems ?? []).length === 0,
};

const nothingUnused: Expectation = {
  says: 'created nothing it does not use',
  holds: (draft) => (draft.created ?? []).every((item) => item.used),
};

/** Every cron schedule in a trigger, split into its fields (seconds first). */
const schedules = (trigger: unknown): string[][] =>
  [...text(trigger).matchAll(/"schedule":"([^"]+)"/g)].map((match) =>
    match[1].trim().split(/\s+/),
  );

// The scheduler's cron numbers days from 1 = Sunday.
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The days of the week a day-of-week field names. */
function days(field: string): Set<string> {
  if (field === '*' || field === '?') return new Set(DAYS);
  const named = (part: string) =>
    /^\d+$/.test(part) ? DAYS[(Number(part) - 1) % 7] : part.toUpperCase();
  const out = new Set<string>();
  for (const part of field.split(',')) {
    const [from, to] = part.split('-').map(named);
    if (!to) {
      out.add(from);
      continue;
    }
    for (let i = DAYS.indexOf(from); ; i = (i + 1) % 7) {
      out.add(DAYS[i]);
      if (DAYS[i] === to) break;
    }
  }
  return out;
}

/** A schedule that runs at `hour:minute` on exactly `on` (any day if omitted). */
const at = (hour: number, minute: number, on?: string[]): Expectation => ({
  says: `runs at ${hour}:${String(minute).padStart(2, '0')}${on ? ` on ${on.join(', ')}` : ''}`,
  holds: (draft) =>
    schedules(draft.trigger).some((fields) => {
      const [, min, hr, , , dow = '*'] = fields;
      if (Number(min) !== minute || Number(hr) !== hour) return false;
      if (!on) return true;
      const named = days(dow);
      return named.size === on.length && on.every((day) => named.has(day));
    }),
});

const plain = (value: string) => value.trim().replace(/^#/, '').toLowerCase();

/** Whether some knob holds `name`: a step that finds the item by name when it runs. */
const knobNamed = (draft: DraftResult, name: string) =>
  [...(draft.steps ?? []), draft.step].some((step) =>
    ((step as { knobs?: { value?: unknown }[] } | undefined)?.knobs ?? []).some(
      (knob) => typeof knob.value === 'string' && plain(knob.value) === plain(name),
    ),
  );

const uses = (name: string): Expectation => ({
  says: `uses ${name}, by id or by a knob naming it`,
  holds: (draft, ids) =>
    (Boolean(ids[name]) && text([draft.trigger, draft.steps, draft.step]).includes(ids[name])) ||
    knobNamed(draft, name),
});

const stepKind = (kind: 'code' | 'agent'): Expectation => ({
  says: `is a ${kind} step`,
  holds: (draft) => text(draft.steps ?? draft.step).includes(`"type":"${kind}"`),
});

export const CASES: Case[] = [
  {
    id: 'due-today-digest',
    kind: 'routine',
    code: true,
    text: 'Every weekday at 8:30am, send me a short summary of the tasks I have due today and any that are overdue.',
    expect: [
      drafted,
      at(8, 30, ['MON', 'TUE', 'WED', 'THU', 'FRI']),
      stepKind('code'),
      nothingUnused,
    ],
  },
  {
    id: 'channel-message-to-task',
    kind: 'routine',
    code: true,
    text: 'When someone posts a message in #design-feedback, make a task for me with what they asked for.',
    expect: [
      drafted,
      {
        says: 'watches channel messages',
        holds: (draft) => /events/.test(text(draft.trigger)),
      },
      uses('design-feedback'),
      nothingUnused,
    ],
  },
  {
    id: 'weekly-channel-recap',
    kind: 'routine',
    code: true,
    text: 'Every Friday at 4pm, summarize what was discussed in the engineering channel this week and post the summary in #eng-announcements.',
    expect: [
      drafted,
      at(16, 0, ['FRI']),
      uses('engineering'),
      uses('eng-announcements'),
      nothingUnused,
    ],
  },
  {
    id: 'done-log-database',
    kind: 'routine',
    code: true,
    text: 'When a task assigned to me is marked done, add a row to a new database called Done log with the task name and when it was finished.',
    expect: [
      drafted,
      {
        says: 'watches task changes',
        holds: (draft) => /events/.test(text(draft.trigger)),
      },
      {
        says: 'creates the Done log database and uses it',
        holds: (draft) =>
          (draft.created ?? []).some(
            (item) => item.entityType === 'database' && item.used,
          ),
      },
      nothingUnused,
    ],
  },
  {
    id: 'missing-channel-left-out',
    kind: 'routine',
    code: true,
    text: 'Every Monday at 9am, post the open tasks in the Q4 Launch project to the #marketing channel.',
    expect: [
      drafted,
      at(9, 0, ['MON']),
      uses('Q4 Launch'),
      {
        says: 'leaves the missing #marketing channel for the person to pick',
        holds: (draft, ids) =>
          !['design-feedback', 'engineering', 'eng-announcements'].some(
            (name) =>
              text([draft.trigger, draft.steps]).includes(ids[name] ?? '-'),
          ),
      },
      nothingUnused,
    ],
  },
  {
    id: 'ask-ai-inbox-triage',
    kind: 'routine',
    code: false,
    text: 'Every morning at 7, go through my unread email and tell me which ones need a reply today.',
    expect: [
      drafted,
      at(7, 0),
      stepKind('agent'),
      nothingUnused,
    ],
  },
  {
    id: 'add-step-post-urgent',
    kind: 'add_step',
    code: true,
    base: { catalogKey: 'triage' },
    text: 'Then, if the task is urgent, post its name in #engineering.',
    expect: [drafted, uses('engineering'), nothingUnused],
  },
  {
    id: 'change-step-other-channel',
    kind: 'change_step',
    code: true,
    base: { catalogKey: 'updates' },
    index: 0,
    text: 'Post it in #eng-announcements instead, and say who the task was assigned to.',
    expect: [
      drafted,
      {
        says: 'posts in eng-announcements',
        holds: (draft, ids) =>
          text(draft.step).includes(ids['eng-announcements'] ?? '-') ||
          text(draft.step).includes('eng-announcements'),
      },
      {
        says: 'reads the assignees',
        holds: (draft) => /assign/i.test(text(draft.step)),
      },
      nothingUnused,
    ],
  },
];
