// The eval's workspace: a person's Macro of realistic size, built the same
// way on every run so each request finds the same items. `seed` writes it as
// a seed CLI scenario; the few things the seed CLI can't make (due dates,
// databases) are set up through the API by `setup` in drafts.ts.
//
// Names come in near-duplicate families (engineering, engineering-archive,
// eng), so a draft that picks an item by "contains" instead of the exact name
// shows up in the checks. Two people are called Jordan, so a request naming
// Jordan has two matches; nothing is called marketing, so a request naming
// #marketing has none.

export const SCENARIO_NAME = 'routine-drafting-eval';
const DOMAIN = 'routines-eval.seed.macro.local';

/** The person whose workspace it is, and the one every draft runs as. */
export const OWNER = 'riley';

/** A separate user the blind judge's model calls are billed to. */
export const JUDGE = 'judge';

const PEOPLE: Record<string, [first: string, last: string]> = {
  riley: ['Riley', 'Chen'],
  eric: ['Eric', 'Lindqvist'],
  erica: ['Erica', 'Moss'],
  'jordan-lee': ['Jordan', 'Lee'],
  'jordan-patel': ['Jordan', 'Patel'],
  sam: ['Sam', 'Okafor'],
  priya: ['Priya', 'Raman'],
  marcus: ['Marcus', 'Webb'],
  dana: ['Dana', 'Kim'],
  lena: ['Lena', 'Fischer'],
  tom: ['Tom', 'Alvarez'],
  nina: ['Nina', 'Petrov'],
};

export const email = (person: string) => `${person}@${DOMAIN}`;

/** A seeded person's first and last name. */
export const fullName = (person: string): [first: string, last: string] => PEOPLE[person];

/** Channel name to the people in it besides Riley, who owns them all. */
const CHANNELS: Record<string, string[]> = {
  general: Object.keys(PEOPLE).filter((p) => p !== OWNER),
  random: ['sam', 'priya', 'marcus', 'dana', 'tom'],
  engineering: ['sam', 'eric', 'marcus', 'jordan-lee', 'nina'],
  'engineering-archive': ['sam', 'marcus'],
  eng: ['sam', 'eric'],
  'eng-announcements': ['sam', 'eric', 'marcus', 'jordan-lee', 'nina', 'lena'],
  'eng-announcements-old': ['sam'],
  design: ['priya', 'erica', 'lena'],
  'design-feedback': ['sam', 'priya', 'erica'],
  'design-feedback-archive': ['priya'],
  'design-review': ['priya', 'erica', 'lena', 'tom'],
  product: ['priya', 'dana', 'jordan-patel'],
  'product-marketing': ['dana', 'jordan-patel', 'tom'],
  'marketing-site': ['dana', 'tom', 'priya'],
  launch: ['dana', 'sam', 'priya', 'tom', 'jordan-patel'],
  'launch-planning': ['dana', 'tom'],
  'q4-launch-war-room': ['dana', 'sam', 'eric'],
  support: ['nina', 'tom', 'jordan-lee'],
  'support-escalations': ['nina', 'marcus'],
  'customer-support': ['nina', 'tom'],
  finance: ['lena', 'dana'],
  'finance-ops': ['lena'],
  sales: ['jordan-patel', 'tom', 'dana'],
  'sales-leads': ['jordan-patel'],
  hiring: ['lena', 'marcus', 'priya'],
  'hiring-interviews': ['lena', 'marcus'],
  ops: ['marcus', 'nina'],
  incidents: ['marcus', 'nina', 'eric', 'sam'],
  'incident-review': ['marcus', 'eric'],
  standup: ['sam', 'eric', 'marcus', 'nina', 'jordan-lee'],
  leadership: ['dana', 'lena'],
  'offsite-2026': ['dana', 'lena', 'priya', 'marcus'],
};

/** Direct messages Riley has, keyed `dm-<person>`. */
const DMS = ['eric', 'erica', 'jordan-lee', 'jordan-patel', 'sam', 'priya', 'dana'];

/** Folders, by key: their display name. */
const PROJECTS: Record<string, string> = {
  'q4-launch': 'Q4 Launch',
  'q4-launch-retro': 'Q4 Launch Retro',
  'website-redesign': 'Website Redesign',
  'website-redesign-2025': 'Website Redesign 2025',
  hiring: 'Hiring',
  onboarding: 'Customer Onboarding',
  infra: 'Infrastructure',
};

const DOCUMENTS: Record<string, { name: string; project?: string; content: string }> = {
  'weekly-metrics': {
    name: 'Weekly metrics',
    content:
      '# Weekly metrics\n\n- Signups: 1,240 (up 8% on last week)\n- Activation: 41% (flat)\n- Churned teams: 6 (down from 9)\n- Support tickets: 312, median first reply 2h 10m\n',
  },
  'weekly-metrics-old': {
    name: 'Weekly metrics (old)',
    content: '# Weekly metrics (old)\n\nThe spreadsheet version, kept until March.\n',
  },
  'weekly-metrics-template': {
    name: 'Weekly metrics template',
    content: '# Weekly metrics template\n\n- Signups:\n- Activation:\n- Churned teams:\n',
  },
  'launch-plan': {
    name: 'Q4 Launch plan',
    project: 'q4-launch',
    content: '# Q4 Launch plan\n\nLaunch date: the second Tuesday of December. Owners: Dana (marketing), Sam (eng).\n',
  },
  'onboarding-guide': {
    name: 'Onboarding guide',
    project: 'onboarding',
    content: '# Onboarding guide\n\nWhat a new customer sees in their first week.\n',
  },
  'interview-rubric': {
    name: 'Interview rubric',
    project: 'hiring',
    content: '# Interview rubric\n\nScore each area from 1 to 4.\n',
  },
  'incident-runbook': {
    name: 'Incident runbook',
    project: 'infra',
    content: '# Incident runbook\n\nPage the on-call engineer, open #incidents, post updates every 30 minutes.\n',
  },
  'pricing-notes': { name: 'Pricing notes', content: '# Pricing notes\n\nTeam plan stays at $12 per seat.\n' },
  roadmap: { name: 'Roadmap 2026', content: '# Roadmap 2026\n\nH1: mobile, offline. H2: integrations.\n' },
  'roadmap-draft': { name: 'Roadmap 2026 draft', content: '# Roadmap 2026 draft\n\nEarly notes.\n' },
  'design-principles': {
    name: 'Design principles',
    project: 'website-redesign',
    content: '# Design principles\n\nCalm, quick, obvious.\n',
  },
  'eng-sync-notes': { name: 'Eng sync notes', content: '# Eng sync notes\n\nPagination bug is the top priority.\n' },
  'support-macros': { name: 'Support macros', content: '# Support macros\n\nCanned replies for common questions.\n' },
  okrs: { name: 'Q4 OKRs', content: '# Q4 OKRs\n\n1. Ship the launch. 2. Halve first reply time.\n' },
};

/** Databases `setup` creates through the API, by name. */
export const DATABASES = ['Candidates', 'Candidates 2024', 'Bug tracker'];

type Status = 'not_started' | 'in_progress' | 'in_review' | 'completed' | 'canceled';

type TaskSeed = {
  name: string;
  project?: string;
  status: Status;
  assignees: string[];
  /** Days from today `setup` sets the due date to; negative is overdue. */
  due?: number;
};

/** Tasks the cases and run checks name. */
const NAMED_TASKS: Record<string, TaskSeed> = {
  'launch-checklist': {
    name: 'Finish the launch checklist',
    project: 'q4-launch',
    status: 'in_progress',
    assignees: ['riley'],
    due: -2,
  },
  'pricing-page': {
    name: 'Review the pricing page copy',
    project: 'q4-launch',
    status: 'not_started',
    assignees: ['riley', 'sam'],
    due: 0,
  },
  'launch-press': {
    name: 'Send the press kit to the agency',
    project: 'q4-launch',
    status: 'not_started',
    assignees: ['dana'],
    due: -1,
  },
  'expense-report': { name: 'Submit the October expense report', status: 'not_started', assignees: ['riley'], due: 0 },
  'renew-cert': {
    name: 'Renew the status page certificate',
    project: 'infra',
    status: 'in_progress',
    assignees: ['riley'],
    due: -3,
  },
  'homepage-hero': {
    name: 'Rewrite the homepage hero copy',
    project: 'website-redesign',
    status: 'in_progress',
    assignees: ['riley', 'priya'],
    due: 4,
  },
  'onboarding-emails': { name: 'Draft the onboarding emails', status: 'not_started', assignees: ['riley'], due: 6 },
};

// Filler tasks: realistic names, made from a fixed list so every seed is the
// same. Each project gets its own share.
const FILLER: Record<string, string[]> = {
  'q4-launch': [
    'Book the launch webinar',
    'Write the launch blog post',
    'Record the product demo video',
    'Update the changelog for launch',
    'Prepare the launch FAQ',
    'Brief the support team on launch',
    'Translate the launch page',
    'Set up launch day monitoring',
    'Schedule the launch newsletter',
    'Collect customer quotes for launch',
    'Plan the launch retro',
    'Check launch analytics events',
  ],
  'q4-launch-retro': ['Collect retro feedback', 'Write the retro summary', 'Schedule the retro meeting'],
  'website-redesign': [
    'Pick the new type scale',
    'Redesign the pricing table',
    'Audit image sizes on the homepage',
    'Build the new footer',
    'Write alt text for product shots',
    'Fix the mobile nav overlap',
    'Test the signup form on Safari',
    'Move the blog to the new layout',
    'Review the color contrast report',
    'Ship the new favicon',
  ],
  'website-redesign-2025': ['Archive the 2025 mockups', 'Export the 2025 style guide'],
  hiring: [
    'Screen backend engineer applicants',
    'Schedule onsite for the designer candidate',
    'Write the support lead job post',
    'Send offer letter template to legal',
    'Update the interview loop doc',
    'Follow up with the recruiting agency',
  ],
  onboarding: [
    'Record the setup walkthrough',
    'Write the first-week email sequence',
    'Review the empty states',
    'Add a sample project for new teams',
    'Measure time to first message',
  ],
  infra: [
    'Upgrade the database to the next minor version',
    'Rotate the staging API keys',
    'Add alerts for queue depth',
    'Clean up unused buckets',
    'Move cron jobs to the scheduler',
    'Load test the search endpoint',
    'Document the backup restore steps',
    'Raise the worker memory limit',
  ],
};

const LOOSE_VERBS = ['Follow up on', 'Review', 'Draft', 'Update', 'Check', 'Plan', 'Fix', 'Prepare'];
const LOOSE_OBJECTS = [
  'the quarterly board deck',
  'the vendor contract',
  'the team offsite agenda',
  'the API rate limit docs',
  'the security questionnaire',
  'the onboarding checklist',
  'the referral program terms',
  'the holiday support rota',
  'the partner integration notes',
  'the billing page copy',
  'the accessibility audit',
  'the analytics dashboard',
  'the customer survey questions',
  'the release notes',
  'the shared drive cleanup',
  'the conference talk proposal',
  'the expense policy',
  'the incident postmortem',
  'the data retention policy',
  'the travel booking',
  'the meeting notes template',
  'the sales one-pager',
  'the support macros',
  'the desk move plan',
];

/** A small fixed-seed generator, so every seed is identical. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: Status[] = ['not_started', 'not_started', 'in_progress', 'in_review', 'completed', 'completed', 'canceled'];

/** Every task in the workspace, by seed key. */
export function tasks(): Record<string, TaskSeed> {
  const next = random(20261112);
  const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
  const people = Object.keys(PEOPLE);
  const out: Record<string, TaskSeed> = { ...NAMED_TASKS };
  const add = (key: string, name: string, project?: string) => {
    const assignees = next() < 0.4 ? ['riley'] : [pick(people.filter((p) => p !== 'riley'))];
    if (next() < 0.15) assignees.push(pick(people.filter((p) => !assignees.includes(p))));
    const status = pick(STATUSES);
    const roll = next();
    // About a quarter have due dates, from two weeks overdue to a month out;
    // none of Riley's are due today, so the due-today case knows its answer.
    let due: number | undefined;
    if (roll < 0.25) {
      due = Math.round(next() * 44) - 14;
      if (due === 0 && assignees.includes('riley')) due = 1;
    }
    out[key] = { name, project, status, assignees, due };
  };
  for (const [project, names] of Object.entries(FILLER)) {
    names.forEach((name, i) => add(`${project}-${i}`, name, project));
  }
  // The rest are loose tasks, outside any folder, for a few hundred in all.
  let i = 0;
  for (const verb of LOOSE_VERBS) {
    for (const object of LOOSE_OBJECTS) {
      add(`loose-${i++}`, `${verb} ${object}`);
    }
  }
  return out;
}

type Message = { channel: string; from: string; text: string };

const MESSAGES: Message[] = [
  { channel: 'engineering', from: 'sam', text: 'The search index migration finished overnight.' },
  { channel: 'engineering', from: 'riley', text: 'Nice. Next up is the pagination bug on the tasks list.' },
  { channel: 'engineering', from: 'eric', text: 'I can pair on pagination after lunch.' },
  { channel: 'engineering', from: 'marcus', text: 'Heads up: the worker deploy is moving to Thursday.' },
  { channel: 'design-feedback', from: 'sam', text: 'Can we make the empty state on the inbox friendlier?' },
  { channel: 'design-feedback', from: 'erica', text: 'The new icons read small on Windows.' },
  { channel: 'design-review', from: 'priya', text: 'Hero copy options are in the Website Redesign folder.' },
  { channel: 'support', from: 'nina', text: 'Three tickets today about export to CSV timing out.' },
  { channel: 'support', from: 'tom', text: 'I tagged the export ones so we can count them.' },
  { channel: 'launch', from: 'dana', text: 'Press kit goes to the agency on Monday.' },
  { channel: 'finance', from: 'lena', text: 'Reminder: October expenses close this Friday.' },
  { channel: 'incidents', from: 'marcus', text: 'Status page certificate expires soon, someone grab it.' },
  { channel: 'standup', from: 'jordan-lee', text: 'Yesterday: billing tests. Today: invoice emails.' },
  { channel: 'dm-eric', from: 'eric', text: 'Morning! Did you see the pagination thread?' },
  { channel: 'dm-eric', from: 'riley', text: 'Yes, looking after standup.' },
  { channel: 'dm-erica', from: 'erica', text: 'Can you look at the icon set before Friday?' },
  { channel: 'dm-jordan-lee', from: 'jordan-lee', text: 'The invoice emails are ready for review.' },
  { channel: 'dm-jordan-patel', from: 'jordan-patel', text: 'Two new leads from the webinar.' },
  { channel: 'dm-dana', from: 'dana', text: 'Can we move our 1:1 to Thursday?' },
];

const EMAILS: Record<string, { subject: string; from: string; body: string; unread: boolean }> = {
  contract: {
    subject: 'Contract renewal',
    from: 'legal@example.com',
    body: 'The renewal is attached. Could you confirm the start date by end of day?',
    unread: true,
  },
  newsletter: { subject: 'This week in design', from: 'news@example.com', body: 'Ten interfaces we liked this week.', unread: true },
  invoice: {
    subject: 'Invoice 4471 for November',
    from: 'billing@supplies.example.com',
    body: 'Your November invoice is due on the 30th.',
    unread: true,
  },
  'agency-question': {
    subject: 'Question about the press kit',
    from: 'hello@agency.example.com',
    body: 'Which logo files should we use? We need them by Monday.',
    unread: true,
  },
  receipt: { subject: 'Your receipt', from: 'receipts@example.com', body: 'Thanks for your order.', unread: false },
  webinar: { subject: 'Webinar recording', from: 'events@example.com', body: 'The recording is ready.', unread: false },
};

/** The seed CLI scenario (tooling/seed_cli/src/entity/scenario/spec.rs). */
export function scenario() {
  const users = Object.fromEntries(
    Object.entries(PEOPLE).map(([key, [first, last]]) => [
      key,
      {
        email: email(key),
        first_name: first,
        last_name: last,
        // Paid, so drafts and the judge run on the paid models.
        ...(key === OWNER ? { roles: ['professional_subscriber'] } : {}),
      },
    ]),
  );
  users[JUDGE] = { email: email(JUDGE), first_name: 'Eval', last_name: 'Judge', roles: ['professional_subscriber'] };
  const channels: Record<string, unknown> = Object.fromEntries(
    Object.entries(CHANNELS).map(([name, members]) => [name, { type: 'private', owner: OWNER, members }]),
  );
  for (const person of DMS) channels[`dm-${person}`] = { type: 'direct_message', members: [OWNER, person] };
  return {
    scenario: SCENARIO_NAME,
    description:
      "The routine drafting eval's workspace: Riley, an individually paid user, with eleven colleagues (two named Jordan), " +
      'thirty-odd channels in near-duplicate families, direct messages, seven folders, a few hundred tasks and unread email. ' +
      'Nothing is named marketing.',
    users,
    channels,
    projects: Object.fromEntries(Object.entries(PROJECTS).map(([key, name]) => [key, { owner: OWNER, name }])),
    documents: Object.fromEntries(
      Object.entries(DOCUMENTS).map(([key, doc]) => [
        key,
        { owner: OWNER, name: doc.name, content: doc.content, ...(doc.project ? { project: doc.project } : {}) },
      ]),
    ),
    tasks: Object.fromEntries(
      Object.entries(tasks()).map(([key, task]) => [
        key,
        {
          owner: OWNER,
          name: task.name,
          status: task.status,
          assignees: task.assignees,
          ...(task.project ? { project: task.project } : {}),
        },
      ]),
    ),
    emails: {
      'riley-inbox': {
        owner: OWNER,
        threads: Object.fromEntries(
          Object.entries(EMAILS).map(([key, thread], i) => [key, { ...thread, sent_minutes_ago: 30 + i * 90 }]),
        ),
      },
    },
    messages: MESSAGES,
  };
}

/**
 * The seeded items requests name, by the name a request uses: the seed
 * scenario's entity kind and key, from which its id is derived.
 */
export const FIXTURE: Record<string, { kind: string; key: string }> = {
  ...Object.fromEntries(Object.keys(CHANNELS).map((name) => [name, { kind: 'channel', key: name }])),
  ...Object.fromEntries(DMS.map((person) => [`dm-${person}`, { kind: 'channel', key: `dm-${person}` }])),
  ...Object.fromEntries(Object.entries(PROJECTS).map(([key, name]) => [name, { kind: 'project', key }])),
  ...Object.fromEntries(Object.entries(DOCUMENTS).map(([key, doc]) => [doc.name, { kind: 'document', key }])),
  ...Object.fromEntries(Object.keys(NAMED_TASKS).map((key) => [`task:${key}`, { kind: 'task', key }])),
};

/** What a seeded item is, in words: the judge's glossary. */
/** Words too common in requests to say which item is meant. */
const COMMON = new Set(
  'the and for with every each any all when from that this into them their about after before task tasks message messages channel project document database routine step new open'.split(
    ' ',
  ),
);

/**
 * The people and items whose names share a word with `text`: what a careful
 * reader of the request would look through, look-alikes included, so a
 * judge can tell a right guess from a lucky one and asking from friction.
 */
export function lookalikes(text: string): { people: string[]; items: string[] } {
  const words = new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((word) => !COMMON.has(word)));
  const named = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).some((word) => words.has(word));
  const people = Object.values(PEOPLE)
    .filter(([first, last]) => named(`${first} ${last}`))
    .map(([first, last]) => `the person ${first} ${last}`);
  const items = Object.keys(FIXTURE)
    .filter((name) => !name.startsWith('dm-') && !name.startsWith('task:') && named(name))
    .map(describe);
  const databases = DATABASES.filter(named).map((name) => `the database "${name}"`);
  return { people, items: [...items, ...databases] };
}

export function describe(name: string): string {
  const { kind, key } = FIXTURE[name];
  if (kind === 'channel') {
    return key.startsWith('dm-') ? `the direct message with ${PEOPLE[key.slice(3)].join(' ')}` : `the channel #${name}`;
  }
  if (kind === 'task') return `the task "${tasks()[key].name}"`;
  return `the ${kind} "${name}"`;
}

/** A person's user id, as triggers and code name them. */
export const userId = (person: string) => `macro|${email(person)}`;

export const PERSON_KEYS = Object.keys(PEOPLE);

export const COUNTS = {
  people: Object.keys(PEOPLE).length,
  channels: Object.keys(CHANNELS).length,
  dms: DMS.length,
  projects: Object.keys(PROJECTS).length,
  documents: Object.keys(DOCUMENTS).length,
  databases: DATABASES.length,
  tasks: Object.keys(tasks()).length,
};
