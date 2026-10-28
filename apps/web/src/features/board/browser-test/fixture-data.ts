import type {
  BoardAuthor,
  BoardItem,
  BoardItemKind,
  BoardMessage,
  BoardZone,
} from '../core/item';

// A fictional company's afternoon, relative to a frozen clock so screenshots
// are repeatable.
export const FIXTURE_NOW = Date.UTC(2026, 9, 28, 21, 30);
const MINUTE = 60_000;

const person = (name: string, isSelf = false): BoardAuthor => ({
  id: `macro|${name.split(' ')[0].toLowerCase()}@example.com`,
  kind: 'person',
  name,
  isSelf,
});

export const ME = person('Jordan Lee', true);
const ANA = person('Ana Ruiz');
const BEN = person('Ben Ito');
const CHLOE = person('Chloe Park');
const DEV = person('Dev Patel');
const ELI = person('Eli Novak');
const FARAH = person('Farah Haddad');
const GUS = person('Gus Moreau');
const HANA = person('Hana Sato');
const IVAN = person('Ivan Petrov');
const MAYA = person('Maya Chen');
const PRIYA: BoardAuthor = {
  id: 'priya@northwind.example',
  kind: 'contact',
  name: 'Priya Shah',
  isSelf: false,
};
const TALENT: BoardAuthor = {
  id: 'jobs@talentdesk.example',
  kind: 'contact',
  name: 'Talentdesk',
  isSelf: false,
};
const BILLING: BoardAuthor = {
  id: 'billing@cloudvendor.example',
  kind: 'contact',
  name: 'Cloud Vendor Billing',
  isSelf: false,
};
const MACRO_AGENT: BoardAuthor = {
  id: 'bot-macro',
  kind: 'agent',
  name: 'Macro',
  isSelf: false,
};
const TRIAGE_AGENT: BoardAuthor = {
  id: 'bot-triage',
  kind: 'agent',
  name: 'Support triage',
  isSelf: false,
};
const GITHUB: BoardAuthor = {
  id: 'github',
  kind: 'agent',
  name: 'GitHub',
  isSelf: false,
};

type Said = [author: BoardAuthor | undefined, text: string, minutesAgo: number];

function conversation(spec: {
  key: string;
  zone: BoardZone;
  kind: BoardItemKind;
  title: string;
  context?: string;
  groupKey?: string;
  status?: string;
  face?: BoardAuthor;
  needsYou?: boolean;
  /** How many of the newest messages are unread. */
  unread?: number;
  said: Said[];
}): BoardItem {
  const messages: BoardMessage[] = spec.said.map(
    ([author, text, minutesAgo], index) => ({
      id: `${spec.key}:${index}`,
      author,
      text,
      at: FIXTURE_NOW - minutesAgo * MINUTE,
      unread: index >= spec.said.length - (spec.unread ?? 0),
    })
  );
  const participants: BoardAuthor[] = [];
  for (const message of [...messages].reverse()) {
    if (
      message.author &&
      !participants.some((p) => p.id === message.author?.id)
    )
      participants.push(message.author);
  }
  return {
    key: spec.key,
    zone: spec.zone,
    kind: spec.kind,
    title: spec.title,
    context: spec.context,
    groupKey: spec.groupKey,
    status: spec.status,
    face: spec.face,
    needsYou: spec.needsYou ?? false,
    messages,
    lastActivityAt: Math.max(...messages.map((message) => message.at)),
    unreadCount: spec.unread ?? 0,
    participants,
  };
}

export function fixtureItems(): BoardItem[] {
  return [
    conversation({
      key: 'channel:launch',
      zone: 'channels',
      kind: 'channel',
      title: 'launch',
      groupKey: 'launch',
      needsYou: true,
      unread: 2,
      said: [
        [
          DEV,
          'Release notes draft is in the doc — @Jordan need eyes on the pricing section',
          21,
        ],
        [CHLOE, 'On it, will leave comments inline', 9],
        [ME, 'Thanks! I’ll review before 4', 2],
      ],
    }),
    conversation({
      key: 'thread:launch-pricing',
      zone: 'channels',
      kind: 'thread',
      title: 'Pricing copy v2',
      context: 'Thread in #launch',
      groupKey: 'launch',
      unread: 2,
      said: [
        [DEV, 'Pricing copy v2 — thoughts?', 52],
        [ANA, 'Let’s lead with the free tier, then the team plan', 17],
        [DEV, 'Updated 👍', 14],
      ],
    }),
    conversation({
      key: 'channel:general',
      zone: 'channels',
      kind: 'channel',
      title: 'general',
      unread: 2,
      said: [
        [ANA, 'Office is open late Friday for the launch party 🎉', 31],
        [BEN, 'I’ll bring the speakers', 6],
      ],
    }),
    conversation({
      key: 'channel:support',
      zone: 'channels',
      kind: 'channel',
      title: 'support',
      unread: 3,
      said: [
        [TRIAGE_AGENT, '3 new tickets tagged billing since lunch', 41],
        [IVAN, 'Looking into the invoice export bug now', 25],
        [FARAH, 'Northwind is one of them, flagging as priority', 24],
      ],
    }),
    conversation({
      key: 'channel:design',
      zone: 'channels',
      kind: 'channel',
      title: 'design',
      unread: 1,
      said: [
        [HANA, 'New board explorations are up 👀', 63],
        [GUS, 'Love the bubbles one. The radar is wild', 48],
      ],
    }),
    conversation({
      key: 'channel:sales',
      zone: 'channels',
      kind: 'channel',
      title: 'sales',
      said: [
        [FARAH, 'Northwind wants a demo Thursday', 95],
        [ELI, 'I can take it', 80],
      ],
    }),
    conversation({
      key: 'channel:engineering',
      zone: 'channels',
      kind: 'channel',
      title: 'engineering',
      said: [
        [MAYA, 'Deploy is green ✅', 240],
        [BEN, 'Nice, removing the flag tomorrow', 220],
      ],
    }),
    conversation({
      key: 'channel:ideas',
      zone: 'channels',
      kind: 'channel',
      title: 'ideas',
      said: [[ELI, 'Customers keep asking for recurring tasks', 300]],
    }),
    conversation({
      key: 'channel:random',
      zone: 'channels',
      kind: 'channel',
      title: 'random',
      said: [[GUS, 'Who wants lunch tomorrow?', 1620]],
    }),
    conversation({
      key: 'dm:ana',
      zone: 'dms',
      kind: 'dm',
      title: 'Ana Ruiz',
      face: ANA,
      needsYou: true,
      unread: 2,
      said: [
        [ANA, 'Can you look at the offer letter before I send it?', 11],
        [ANA, 'No rush, today is fine', 9],
      ],
    }),
    conversation({
      key: 'dm:ben',
      zone: 'dms',
      kind: 'dm',
      title: 'Ben Ito',
      face: BEN,
      unread: 1,
      said: [
        [ME, 'Did the vendor get back to us?', 44],
        [BEN, 'Got it, signed this morning', 35],
      ],
    }),
    conversation({
      key: 'dm:chloe',
      zone: 'dms',
      kind: 'dm',
      title: 'Chloe Park',
      face: CHLOE,
      said: [
        [CHLOE, 'The big room is free tomorrow if you still need it 🙌', 130],
        [ME, 'Ha, I’ll grab it then', 118],
      ],
    }),
    conversation({
      key: 'dm:dev-maya',
      zone: 'dms',
      kind: 'dm',
      title: 'Dev Patel, Maya Chen',
      said: [[MAYA, 'Standup moved to 10:30 tomorrow', 250]],
    }),
    conversation({
      key: 'email:office-visit',
      zone: 'email',
      kind: 'email',
      title: 'Office visit next week',
      context: 'Priya Shah',
      unread: 1,
      said: [
        [ME, 'We’d love to host you — how does Tuesday look?', 190],
        [
          PRIYA,
          'Looking forward to stopping by Tuesday — is 2pm still good?',
          18,
        ],
      ],
    }),
    conversation({
      key: 'email:application',
      zone: 'email',
      kind: 'email',
      title: 'Application: Software Engineer',
      context: 'Talentdesk',
      unread: 1,
      said: [
        [TALENT, 'New application from Sam Rivera for Software Engineer', 61],
      ],
    }),
    conversation({
      key: 'email:renewal',
      zone: 'email',
      kind: 'email',
      title: 'Contract renewal — Northwind',
      context: 'Priya Shah',
      needsYou: true,
      unread: 1,
      said: [
        [PRIYA, 'Attached is the redline. Could you review by Friday?', 170],
      ],
    }),
    conversation({
      key: 'email:invoice',
      zone: 'email',
      kind: 'email',
      title: 'Your invoice is ready',
      context: 'Cloud Vendor Billing',
      said: [[BILLING, 'Invoice #2041 for October is available', 1800]],
    }),
    conversation({
      key: 'doc:roadmap',
      zone: 'docs',
      kind: 'document',
      title: 'Q4 roadmap',
      unread: 1,
      said: [[HANA, 'Should we move the board view to Q1?', 39]],
    }),
    conversation({
      key: 'doc:feedback',
      zone: 'docs',
      kind: 'document',
      title: 'Customer feedback roundup',
      needsYou: true,
      unread: 1,
      said: [[ELI, '@Jordan can you add the enterprise quotes?', 70]],
    }),
    conversation({
      key: 'task:board',
      zone: 'docs',
      kind: 'task',
      title: 'Ship the board view',
      status: 'In progress · due Friday',
      said: [[DEV, 'Assigned this to you', 140]],
    }),
    conversation({
      key: 'doc:spreadsheet',
      zone: 'docs',
      kind: 'document',
      title: 'Untitled spreadsheet',
      said: [[undefined, 'You edited this', 1560]],
    }),
    conversation({
      key: 'agent:tickets',
      zone: 'agents',
      kind: 'agent',
      title: 'Summarize support tickets',
      status: 'Finished',
      unread: 1,
      said: [[MACRO_AGENT, 'Done: 12 tickets summarized, 3 need a human', 12]],
    }),
    conversation({
      key: 'agent:checkout',
      zone: 'agents',
      kind: 'agent',
      title: 'Fix flaky checkout test',
      status: 'Waiting for you',
      needsYou: true,
      unread: 1,
      said: [
        [ME, 'Can you figure out why checkout.e2e flakes?', 75],
        [MACRO_AGENT, 'Should I skip the Safari run while I fix the race?', 28],
      ],
    }),
    conversation({
      key: 'event:design-review',
      zone: 'calendar',
      kind: 'event',
      title: 'Design review',
      status: 'Today 3:00 – 3:30 PM',
      unread: 1,
      said: [[undefined, 'Starts in 25 minutes', 4]],
    }),
    conversation({
      key: 'pr:board',
      zone: 'code',
      kind: 'pull-request',
      title: 'Add board view',
      status: 'Open · checks failing',
      needsYou: true,
      unread: 2,
      said: [
        [GITHUB, 'lint failed on 2 files', 50],
        [MAYA, 'Requested your review', 33],
      ],
    }),
    conversation({
      key: 'pr:channel-list',
      zone: 'code',
      kind: 'pull-request',
      title: 'Speed up channel list',
      status: 'Approved',
      said: [[MAYA, 'Approved with nits', 360]],
    }),
  ];
}

const daysAgo = (days: number, hours = 0) => (days * 24 + hours) * 60;

/** Pages of earlier activity a list loads as it scrolls back. */
export const OLDER_PAGES = 3;

/** One page of earlier activity, each further back than the last. */
export function olderActivity(page: number): BoardItem[] {
  const pages: BoardItem[][] = [
    [
      conversation({
        key: 'channel:help-desk',
        zone: 'channels',
        kind: 'channel',
        title: 'help-desk',
        said: [
          [
            FARAH,
            'Three tickets left in the queue for tomorrow',
            daysAgo(1, 2),
          ],
          [BEN, 'I’ll take the billing one first thing', daysAgo(1, 1)],
        ],
      }),
      conversation({
        key: 'dm:eli',
        zone: 'dms',
        kind: 'dm',
        title: ELI.name,
        face: ELI,
        said: [
          [ELI, 'Can you share the deck from Monday?', daysAgo(1, 5)],
          [ME, 'Sent it over, the appendix is new', daysAgo(1, 4)],
        ],
      }),
      conversation({
        key: 'doc:planning',
        zone: 'docs',
        kind: 'document',
        title: 'Planning: next quarter',
        said: [[HANA, 'Added the mobile milestones', daysAgo(1, 7)]],
      }),
      conversation({
        key: 'email:statement',
        zone: 'email',
        kind: 'email',
        title: 'Your October statement',
        face: BILLING,
        said: [
          [BILLING, 'Invoice 4821 for October is attached', daysAgo(1, 9)],
        ],
      }),
      conversation({
        key: 'task:onboarding',
        zone: 'docs',
        kind: 'task',
        title: 'Refresh the onboarding checklist',
        status: 'In progress',
        said: [[BEN, 'Moved this to In progress', daysAgo(2)]],
      }),
      conversation({
        key: 'channel:watercooler',
        zone: 'channels',
        kind: 'channel',
        title: 'watercooler',
        said: [
          [GUS, 'Who left the cake in the kitchen?', daysAgo(2, 3)],
          [MAYA, 'Guilty. Help yourselves', daysAgo(2, 2)],
        ],
      }),
      conversation({
        key: 'agent:weekly-digest',
        zone: 'agents',
        kind: 'agent',
        title: 'Weekly digest',
        status: 'Done',
        face: MACRO_AGENT,
        said: [
          [
            MACRO_AGENT,
            'Summarized 42 conversations from last week into the team notes',
            daysAgo(2, 6),
          ],
        ],
      }),
      conversation({
        key: 'pr:search-index',
        zone: 'code',
        kind: 'pull-request',
        title: 'Rebuild the search index nightly',
        status: 'Merged',
        said: [[IVAN, 'Merged after a green run', daysAgo(3)]],
      }),
    ],
    [
      conversation({
        key: 'channel:hiring',
        zone: 'channels',
        kind: 'channel',
        title: 'hiring',
        unread: 1,
        said: [
          [HANA, 'Two onsite loops booked for next week', daysAgo(4, 2)],
          [CHLOE, 'I can cover the design interview', daysAgo(4)],
        ],
      }),
      conversation({
        key: 'thread:support-sla',
        zone: 'channels',
        kind: 'thread',
        title: 'Response time targets',
        context: 'Thread in #support',
        groupKey: 'support',
        said: [
          [FARAH, 'Proposing four hours for paid plans', daysAgo(4, 6)],
          [ANA, 'Works for me if weekends are excluded', daysAgo(4, 5)],
        ],
      }),
      conversation({
        key: 'event:offsite',
        zone: 'calendar',
        kind: 'event',
        title: 'Team offsite planning',
        said: [[MAYA, 'Accepted the invitation', daysAgo(5, 3)]],
      }),
      conversation({
        key: 'dm:farah',
        zone: 'dms',
        kind: 'dm',
        title: FARAH.name,
        face: FARAH,
        said: [
          [ME, 'Nice work on the help center rewrite', daysAgo(5, 8)],
          [FARAH, 'Thank you! It was overdue', daysAgo(5, 7)],
        ],
      }),
      conversation({
        key: 'doc:brand-guide',
        zone: 'docs',
        kind: 'document',
        title: 'Brand guide',
        said: [
          [GUS, 'Updated the logo spacing rules', daysAgo(6, 1)],
          [undefined, 'Gus Moreau edited the document', daysAgo(6)],
        ],
      }),
      conversation({
        key: 'email:conference',
        zone: 'email',
        kind: 'email',
        title: 'Speaker confirmation',
        face: PRIYA,
        said: [
          [PRIYA, 'Confirming your talk slot on the second day', daysAgo(7, 4)],
        ],
      }),
      conversation({
        key: 'task:security-review',
        zone: 'docs',
        kind: 'task',
        title: 'Annual security review',
        status: 'Done',
        said: [[DEV, 'Closed the last finding', daysAgo(8)]],
      }),
      conversation({
        key: 'pr:dark-mode',
        zone: 'code',
        kind: 'pull-request',
        title: 'Dark mode for exported PDFs',
        status: 'Merged',
        said: [[CHLOE, 'Merged, thanks for the review', daysAgo(9, 2)]],
      }),
    ],
    [
      conversation({
        key: 'channel:announcements',
        zone: 'channels',
        kind: 'channel',
        title: 'announcements',
        said: [[ANA, 'Welcome to everyone who joined this month', daysAgo(11)]],
      }),
      conversation({
        key: 'dm:hana',
        zone: 'dms',
        kind: 'dm',
        title: HANA.name,
        face: HANA,
        said: [
          [HANA, 'Do you have the interview rubric?', daysAgo(13, 3)],
          [ME, 'Linked it in the hiring doc', daysAgo(13, 2)],
        ],
      }),
      conversation({
        key: 'doc:handbook',
        zone: 'docs',
        kind: 'document',
        title: 'Team handbook',
        said: [[ANA, 'Added the new leave policy', daysAgo(15)]],
      }),
      conversation({
        key: 'agent:triage-report',
        zone: 'agents',
        kind: 'agent',
        title: 'Monthly support report',
        status: 'Done',
        face: TRIAGE_AGENT,
        said: [
          [
            TRIAGE_AGENT,
            'Tagged 318 tickets; billing questions are up this month',
            daysAgo(18),
          ],
        ],
      }),
      conversation({
        key: 'email:newsletter',
        zone: 'email',
        kind: 'email',
        title: 'This month in hiring',
        face: TALENT,
        said: [[TALENT, 'Five tips for faster interview loops', daysAgo(20)]],
      }),
      conversation({
        key: 'project:website',
        zone: 'docs',
        kind: 'project',
        title: 'Website refresh',
        status: 'Planned',
        said: [[MAYA, 'Kicked off the project', daysAgo(24)]],
      }),
      conversation({
        key: 'call:quarterly-review',
        zone: 'calendar',
        kind: 'call',
        title: 'Quarterly review',
        said: [[undefined, 'Call ended after 48 minutes', daysAgo(27)]],
      }),
      conversation({
        key: 'pr:upgrade-deps',
        zone: 'code',
        kind: 'pull-request',
        title: 'Upgrade build dependencies',
        status: 'Closed',
        said: [[IVAN, 'Superseded by a smaller change', daysAgo(30)]],
      }),
    ],
  ];
  return pages[page] ?? [];
}

/** A new message arriving, for the "new activity" control. */
export function arrivingMessage(
  now: number,
  index: number
): {
  key: string;
  message: BoardMessage;
} {
  const lines: [string, BoardAuthor, string][] = [
    ['channel:design', GUS, 'Pushed the new radar colors'],
    ['dm:chloe', CHLOE, 'Are we still on for coffee?'],
    ['channel:engineering', IVAN, 'Invoice export fix is merged'],
    ['email:application', TALENT, 'Sam Rivera scheduled an interview'],
  ];
  const [key, author, text] = lines[index % lines.length];
  return {
    key,
    message: {
      id: `${key}:live-${index}`,
      author,
      text,
      at: now,
      unread: true,
    },
  };
}
