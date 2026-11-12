// The requests the eval drafts, with what a good draft of each must do, and
// for most of them how to run the drafted routine once and what that run
// must do. `workspace.ts` seeds the person's workspace first, so each item a
// request names has exactly one match, except where a case checks a name
// with none or two.

import { FIXTURE, userId } from './workspace';

export { FIXTURE };

/** The routine a step case starts from: one of Macro's catalog routines. */
export type BaseRoutine = { catalogKey: string };

export type Arm = 'draft' | 'bare';

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
  /**
   * Asking the person instead of drafting is right here: a name with no
   * single match, which the question must mention. A bare session that asks
   * passes; a draft must leave the name out.
   */
  asking?: RegExp;
  /** How to run the drafted routine once, and what the run must do. */
  run?: RunCheck;
};

/** What a check knows besides the draft: seeded ids by name, and when it was asked. */
export type Context = { ids: Record<string, string>; now: Date; timezone: string };

/**
 * One property of a good draft. `arms` limits it to one arm: the bare agent
 * isn't asked for code steps, and doesn't report what it created.
 */
export type Expectation = {
  says: string;
  holds: (draft: DraftResult, context: Context) => boolean;
  arms?: Arm[];
};

/** The draft endpoint's answer, loosely typed: the eval only reads it. */
export type DraftResult = {
  outcome: 'routine' | 'step' | 'failed';
  message?: string;
  name?: string;
  trigger?: unknown;
  steps?: unknown[];
  step?: unknown;
  /** A bare session's routine with one agent task instead of steps. */
  task?: unknown;
  problems?: unknown[];
  created?: { entityType: string; entityId: string; used: boolean }[];
};

/** Task statuses, as the seed names them. */
export type Status = 'not_started' | 'in_progress' | 'in_review' | 'completed' | 'canceled';

/** What makes a saved routine run once. */
export type Fire =
  /** Run it now (`POST /scheduled-actions/{id}/execute`). */
  | { type: 'execute' }
  /** A person posts in a channel. */
  | { type: 'message'; channel: string; from: string; text: string }
  /** The owner moves a seeded task to a status; it's put back afterwards. */
  | { type: 'task_status'; task: string; status: Status; restore: Status }
  /** The owner creates a task, in a folder when given; it's deleted afterwards. */
  | { type: 'task_created'; name: string; project?: string };

/** What changed in the workspace while the routine ran. */
export type Effects = {
  /** The routine's runs since it fired, newest first, with an agent step's reply from its session. */
  runs: { isSuccess: boolean; result: unknown; reply?: string }[];
  /** Messages posted in the owner's channels, the fired message left out. */
  messages: { channel: string; from: string; text: string }[];
  /** Tasks created, by name and text. */
  tasks: { id: string; name: string; text: string }[];
  /** The owner's new notifications, as text. */
  notifications: string[];
};

export type RunCheck = {
  says: string;
  fire: (draft: DraftResult) => Fire;
  holds: (effects: Effects, context: Context) => boolean;
};

const text = (value: unknown) => JSON.stringify(value ?? null);

/** Everything a draft says, for checks that look for an id or a name anywhere in it. */
const body = (draft: DraftResult) => text([draft.trigger, draft.steps, draft.step, draft.task]);

const drafted: Expectation = {
  says: 'drafted, with no code problems',
  holds: (draft) =>
    (draft.outcome === 'routine' || draft.outcome === 'step') && (draft.problems ?? []).length === 0,
};

const nothingUnused: Expectation = {
  says: 'created nothing it does not use',
  holds: (draft) => (draft.created ?? []).every((item) => item.used),
  arms: ['draft'],
};

/** Every cron schedule in a trigger, split into its fields (seconds first). */
const schedules = (trigger: unknown): string[][] =>
  [...text(trigger).matchAll(/"schedule":"([^"]+)"/g)].map((match) => match[1].trim().split(/\s+/));

// The scheduler's cron numbers days from 1 = Sunday.
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

/** The days of the week a day-of-week field names, or none when it uses syntax this doesn't read (steps, `L`, `#`). */
function days(field: string): Set<string> {
  if (field === '*' || field === '?') return new Set(DAYS);
  // Numbers from 1 = Sunday; names by their first three letters (`Thurs`, `Monday`).
  const named = (part: string) =>
    /^\d+$/.test(part) ? DAYS[(Number(part) - 1) % 7] : /^[a-z]+$/i.test(part) ? part.slice(0, 3).toUpperCase() : part;
  const out = new Set<string>();
  for (const part of field.split(',')) {
    const [from, to, ...rest] = part.split('-').map(named);
    if (rest.length || !DAYS.includes(from) || (to !== undefined && !DAYS.includes(to))) return new Set();
    if (to === undefined) {
      out.add(from);
      continue;
    }
    for (let i = DAYS.indexOf(from), seen = 0; seen < DAYS.length; i = (i + 1) % 7, seen++) {
      out.add(DAYS[i]);
      if (DAYS[i] === to) break;
    }
  }
  return out;
}

/** A schedule that runs at `hour:minute` on exactly `on` (every day if omitted), in every month and on any day of it. */
const at = (hour: number, minute: number, on?: string[]): Expectation => ({
  says: `runs at ${hour}:${String(minute).padStart(2, '0')}${on ? ` on ${on.join(', ')}` : ''}`,
  holds: (draft) =>
    schedules(draft.trigger).some((fields) => {
      const [, min, hr, dom, month, dow = '*'] = fields;
      if (Number(min) !== minute || Number(hr) !== hour) return false;
      if (![dom, month].every((field) => field === '*' || field === '?')) return false;
      const named = days(dow);
      const want = on ?? DAYS;
      return named.size === want.length && want.every((day) => named.has(day));
    }),
});

/** The wall-clock date and time `date` shows in `timezone`. */
function local(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as { year: number; month: number; day: number; hour: number; minute: number };
}

/** Runs once, `daysAhead` days after it was asked, at `hour:minute` in the person's time zone. */
const once = (daysAhead: number, hour: number, minute: number): Expectation => ({
  says: `runs once, ${daysAhead === 1 ? 'tomorrow' : `in ${daysAhead} days`} at ${hour}:${String(minute).padStart(2, '0')}`,
  holds: (draft, { now, timezone }) => {
    const want = { ...local(new Date(now.getTime() + daysAhead * 86_400_000), timezone), hour, minute };
    const trigger = draft.trigger as { type?: string; at?: string; schedule?: string; timezone?: string } | undefined;
    if (trigger?.type === 'once' && trigger.at) {
      const got = local(new Date(trigger.at), timezone);
      return (['year', 'month', 'day', 'hour', 'minute'] as const).every((key) => got[key] === want[key]);
    }
    // A seven-field cron that names one date also runs once.
    return schedules(trigger).some((fields) => {
      const [, min, hr, dom, month, , year] = fields;
      return (
        Number(min) === minute &&
        Number(hr) === hour &&
        Number(dom) === want.day &&
        Number(month) === want.month &&
        Number(year) === want.year
      );
    });
  },
});

/** Runs on a schedule on weekdays only, at some time in the morning. */
const weekdayMornings: Expectation = {
  says: 'runs on weekday mornings',
  holds: (draft) =>
    schedules(draft.trigger).some((fields) => {
      const [, , hr, , , dow = '*'] = fields;
      const named = days(dow);
      return Number(hr) >= 6 && Number(hr) <= 11 && named.size > 0 && [...named].every((day) => WEEKDAYS.includes(day));
    }),
};

const plain = (value: string) => value.trim().replace(/^[#@]/, '').toLowerCase();

/** Whether some knob holds `name`: a step that finds the item by name when it runs. */
const knobNamed = (draft: DraftResult, name: string) =>
  [...(draft.steps ?? []), draft.step].some((step) =>
    ((step as { knobs?: { value?: unknown }[] } | undefined)?.knobs ?? []).some(
      (knob) => typeof knob.value === 'string' && plain(knob.value) === plain(name),
    ),
  );

const uses = (name: string): Expectation => ({
  says: `uses ${name}, by id or by a knob naming it`,
  holds: (draft, { ids }) => (Boolean(ids[name]) && body(draft).includes(ids[name])) || knobNamed(draft, name),
});

/** Uses none of these look-alikes by id: the exact name was asked for. */
const notAny = (names: string[]): Expectation => ({
  says: `uses none of ${names.join(', ')}`,
  holds: (draft, { ids }) => names.every((name) => !ids[name] || !body(draft).includes(ids[name])),
});

/** Names a person: their user id, or their direct message with the owner. */
const person = (key: string): Expectation => ({
  says: `names ${key}`,
  holds: (draft, { ids }) =>
    body(draft).includes(userId(key)) || Boolean(ids[`dm-${key}`] && body(draft).includes(ids[`dm-${key}`])),
});

const notPerson = (keys: string[]): Expectation => ({
  says: `names none of ${keys.join(', ')}`,
  holds: (draft, { ids }) =>
    keys.every(
      (key) => !body(draft).includes(userId(key)) && !(ids[`dm-${key}`] && body(draft).includes(ids[`dm-${key}`])),
    ),
});

const watches = (...events: string[]): Expectation => ({
  says: `watches ${events.join(' or ')}`,
  holds: (draft) => events.some((event) => text(draft.trigger).includes(`"${event}"`)),
});

const stepKind = (kind: 'code' | 'agent'): Expectation => ({
  says: `is a ${kind} step`,
  holds: (draft) => text(draft.steps ?? draft.step).includes(`"type":"${kind}"`),
  arms: ['draft'],
});

// ---------- run checks ----------

/** A run that did its steps: a condition that wasn't met still records a success. */
const didRun = (run: Effects['runs'][number]) =>
  run.isSuccess && (run.result as { condition?: { status?: string } } | null)?.condition?.status !== 'not_met';

/**
 * Notifications the routine sent itself. Left out: one per message (the
 * message is read already, and the fired one must not count), the run's own
 * finished notice, which names the routine, and the agent chat's replies.
 */
const ownNotification = (metadata: string) => {
  const parsed = JSON.parse(metadata) as Record<string, unknown> | null;
  return !(parsed && ('messageId' in parsed || 'routineId' in parsed || 'excerpt' in parsed));
};

const said = (effects: Effects) =>
  [
    ...effects.messages.map((message) => message.text),
    ...effects.tasks.map((task) => `${task.name}\n${task.text}`),
    ...effects.notifications.filter(ownNotification),
    ...effects.runs.filter(didRun).map((run) => `${text(run.result)}\n${run.reply ?? ''}`),
  ].join('\n');

const ran = (effects: Effects) => effects.runs.some(didRun);

/** The run succeeded and something it produced, anywhere, matches every pattern. */
const reports =
  (...patterns: RegExp[]) =>
  (effects: Effects) =>
    ran(effects) && patterns.every((pattern) => pattern.test(said(effects)));

const postedIn =
  (channel: string, pattern: RegExp, from?: (sender: string) => boolean) =>
  (effects: Effects) =>
    ran(effects) &&
    effects.messages.some(
      (message) => message.channel === channel && pattern.test(message.text) && (!from || from(message.from)),
    );

const execute = () => ({ type: 'execute' }) as const;

// ---------- cases ----------

export const CASES: Case[] = [
  {
    id: 'eric-says-hello',
    kind: 'routine',
    code: true,
    text: 'anytime eric sends me a message respond with hello',
    expect: [
      drafted,
      watches('channel.message_posted'),
      person('eric'),
      notPerson(['erica']),
      nothingUnused,
    ],
    run: {
      says: 'Eric writes in his DM, and the run answers there with hello',
      fire: () => ({ type: 'message', channel: 'dm-eric', from: 'eric', text: 'hey, got a minute about the release?' }),
      holds: postedIn('dm-eric', /\bhello\b/i, (from) => from !== 'eric'),
    },
  },
  {
    id: 'due-today-digest',
    kind: 'routine',
    code: true,
    text: 'Every weekday at 8:30am, send me a short summary of the tasks I have due today and any that are overdue.',
    expect: [drafted, at(8, 30, WEEKDAYS), stepKind('code'), nothingUnused],
    run: {
      says: 'the summary names a task due today and an overdue one',
      fire: execute,
      holds: reports(/expense report/i, /certificate|launch checklist/i),
    },
  },
  {
    id: 'channel-message-to-task',
    kind: 'routine',
    code: true,
    text: 'When someone posts a message in #design-feedback, make a task for me with what they asked for.',
    expect: [
      drafted,
      watches('channel.message_posted'),
      uses('design-feedback'),
      notAny(['design-feedback-archive', 'design']),
      nothingUnused,
    ],
    run: {
      says: 'Sam asks for something in #design-feedback, and a task for it exists',
      fire: () => ({
        type: 'message',
        channel: 'design-feedback',
        from: 'sam',
        text: 'Could the export button on reports be easier to find?',
      }),
      holds: (effects) => ran(effects) && effects.tasks.some((task) => /export/i.test(`${task.name} ${task.text}`)),
    },
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
      notAny(['engineering-archive', 'eng', 'eng-announcements-old']),
      nothingUnused,
    ],
    run: {
      says: 'a summary of #engineering lands in #eng-announcements',
      fire: execute,
      holds: postedIn('eng-announcements', /pagination|search index|deploy/i),
    },
  },
  {
    id: 'done-log-database',
    kind: 'routine',
    code: true,
    text: 'When a task assigned to me is marked done, add a row to a new database called Done log with the task name and when it was finished.',
    expect: [
      drafted,
      watches('task.status_changed', 'task.property_changed'),
      {
        says: 'creates the Done log database and uses it',
        holds: (draft) => (draft.created ?? []).some((item) => item.entityType === 'database' && item.used),
        arms: ['draft'],
      },
      nothingUnused,
    ],
    run: {
      says: 'marking a task done runs it without error',
      fire: () => ({ type: 'task_status', task: 'task:onboarding-emails', status: 'completed', restore: 'not_started' }),
      holds: ran,
    },
  },
  {
    id: 'missing-channel-left-out',
    kind: 'routine',
    code: true,
    asking: /marketing/i,
    text: 'Every Monday at 9am, post the open tasks in the Q4 Launch project to the #marketing channel.',
    expect: [
      drafted,
      at(9, 0, ['MON']),
      uses('Q4 Launch'),
      {
        says: 'leaves the missing #marketing channel for the person to pick',
        // Neither a look-alike's id nor the name itself, in a knob or as a
        // string in a code step's source.
        holds: (draft, { ids }) =>
          !['product-marketing', 'marketing-site', 'launch'].some((name) => body(draft).includes(ids[name] ?? '-')) &&
          !knobNamed(draft, 'marketing') &&
          !(draft.steps ?? []).some((step) =>
            /(["'`])#?marketing\1/i.test(String((step as { source?: unknown }).source ?? '')),
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
    expect: [drafted, at(7, 0), stepKind('agent'), nothingUnused],
    run: {
      says: 'the answer names the contract renewal, which asks for a reply today',
      fire: execute,
      holds: reports(/contract/i),
    },
  },
  {
    id: 'add-step-post-urgent',
    kind: 'add_step',
    code: true,
    base: { catalogKey: 'triage' },
    text: 'Then, if the task is urgent, post its name in #engineering.',
    expect: [drafted, uses('engineering'), notAny(['engineering-archive', 'eng']), nothingUnused],
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
        holds: (draft, { ids }) =>
          text(draft.step).includes(ids['eng-announcements'] ?? '-') || knobNamed(draft, 'eng-announcements'),
      },
      notAny(['eng-announcements-old']),
      { says: 'reads the assignees', holds: (draft) => /assign/i.test(text(draft.step)) },
      nothingUnused,
    ],
  },
  {
    id: 'once-budget-reminder',
    kind: 'routine',
    code: true,
    text: 'Tomorrow at 3pm, remind me to send the Q3 budget to Priya.',
    expect: [drafted, once(1, 15, 0), nothingUnused],
    run: { says: 'the reminder mentions the budget', fire: execute, holds: reports(/budget/i) },
  },
  {
    id: 'invoice-mail-to-finance',
    kind: 'routine',
    code: true,
    text: 'When I get an email from billing@supplies.example.com, post the subject line in #finance.',
    expect: [
      drafted,
      watches('email.message_received'),
      uses('finance'),
      notAny(['finance-ops']),
      {
        says: 'only for mail from billing@supplies.example.com',
        holds: (draft) => /billing@supplies\.example\.com/i.test(body(draft)),
      },
      nothingUnused,
    ],
  },
  {
    id: 'review-status-to-channel',
    kind: 'routine',
    code: true,
    text: 'Whenever a task in the Website Redesign project moves to In review, post the task name in #design-review.',
    expect: [
      drafted,
      watches('task.status_changed', 'task.property_changed'),
      uses('Website Redesign'),
      notAny(['Website Redesign 2025']),
      uses('design-review'),
      notAny(['design', 'design-feedback']),
      nothingUnused,
    ],
    run: {
      says: 'moving the homepage hero task to In review posts it in #design-review',
      fire: () => ({ type: 'task_status', task: 'task:homepage-hero', status: 'in_review', restore: 'in_progress' }),
      holds: postedIn('design-review', /homepage hero/i),
    },
  },
  {
    id: 'two-jordans',
    kind: 'routine',
    code: true,
    asking: /jordan/i,
    text: 'Every Thursday at 10am, DM Jordan the open tasks assigned to them.',
    expect: [
      drafted,
      at(10, 0, ['THU']),
      {
        says: 'leaves Jordan, who has two matches, for the person to pick',
        holds: (draft, context) => notPerson(['jordan-lee', 'jordan-patel']).holds(draft, context),
      },
      nothingUnused,
    ],
  },
  {
    id: 'vague-standup',
    kind: 'routine',
    code: true,
    text: 'standup reminder',
    expect: [drafted, weekdayMornings, nothingUnused],
    run: { says: 'the reminder mentions standup', fire: execute, holds: reports(/stand-?up/i) },
  },
  {
    id: 'vague-support-watch',
    kind: 'routine',
    code: true,
    text: 'keep me posted on #support',
    expect: [drafted, uses('support'), notAny(['support-escalations', 'customer-support']), nothingUnused],
    run: {
      says: 'news from #support reaches the person',
      fire: (draft) =>
        /events/.test(text(draft.trigger))
          ? { type: 'message', channel: 'support', from: 'nina', text: 'Customer says the CSV export fails again.' }
          : { type: 'execute' },
      holds: (effects) =>
        reports(/csv|export/i)(effects) && !effects.messages.some((message) => message.channel === 'support' && message.from !== 'nina'),
    },
  },
  {
    id: 'launch-overdue-chase',
    kind: 'routine',
    code: true,
    text: "Every Monday at 9am, find the overdue tasks in the Q4 Launch project, post a short list in #launch, and DM each overdue task's assignee asking for an update.",
    expect: [
      drafted,
      at(9, 0, ['MON']),
      uses('Q4 Launch'),
      notAny(['Q4 Launch Retro']),
      uses('launch'),
      notAny(['launch-planning', 'q4-launch-war-room']),
      nothingUnused,
    ],
    run: {
      says: 'the list in #launch names the press kit, and Dana gets a DM about it',
      fire: execute,
      holds: (effects) =>
        postedIn('launch', /press kit/i)(effects) &&
        effects.messages.some((message) => message.channel === 'dm-dana' && /press kit/i.test(message.text)),
    },
  },
  {
    id: 'weekly-metrics-ask-ai',
    kind: 'routine',
    code: false,
    text: 'Every Friday at 5pm, read the Weekly metrics doc and send me three bullet points on what changed.',
    expect: [
      drafted,
      at(17, 0, ['FRI']),
      stepKind('agent'),
      uses('Weekly metrics'),
      notAny(['Weekly metrics (old)', 'Weekly metrics template']),
      nothingUnused,
    ],
    run: {
      says: 'the bullets come from the metrics document',
      fire: execute,
      holds: reports(/signups|activation|churn/i),
    },
  },
  {
    id: 'hiring-task-to-database',
    kind: 'routine',
    code: true,
    text: 'When a task is created in the Hiring project, add a row with its name to the Candidates database.',
    expect: [
      drafted,
      watches('task.created'),
      uses('Hiring'),
      uses('Candidates'),
      notAny(['Candidates 2024']),
      {
        says: 'creates nothing: the database exists',
        holds: (draft) => (draft.created ?? []).length === 0,
        arms: ['draft'],
      },
    ],
    run: {
      says: 'a new Hiring task runs it without error',
      fire: () => ({ type: 'task_created', name: 'Phone screen with the platform engineer candidate', project: 'Hiring' }),
      holds: ran,
    },
  },
  {
    id: 'add-step-ask-ai-review',
    kind: 'add_step',
    code: true,
    base: { catalogKey: 'triage' },
    text: 'Then ask AI whether the task needs a design review, and if it does, post it in #design-review.',
    expect: [drafted, uses('design-review'), notAny(['design', 'design-feedback']), nothingUnused],
  },
  {
    id: 'change-step-only-eric',
    kind: 'change_step',
    code: true,
    base: { catalogKey: 'updates' },
    index: 0,
    text: 'Only post it when the task was assigned to Eric, and post it in #engineering.',
    expect: [
      drafted,
      {
        says: 'names Eric, by user id or by a knob naming him',
        holds: (draft) => text(draft.step).includes(userId('eric')) || knobNamed(draft, 'eric') || /\beric\b/i.test(text(draft.step)),
      },
      notPerson(['erica']),
      {
        says: 'posts in engineering',
        holds: (draft, { ids }) => text(draft.step).includes(ids.engineering ?? '-') || knobNamed(draft, 'engineering'),
      },
      notAny(['engineering-archive', 'eng']),
      nothingUnused,
    ],
  },
];
