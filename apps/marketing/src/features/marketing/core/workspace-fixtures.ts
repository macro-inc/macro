import type {
  TaskPriority,
  TaskStatus,
  WorkspaceComment,
} from './dummy-workspace';
import type { HomepagePersonId } from './homepage-demo-people';

/** The app's default deal stages, in board order, plus its "No stage" column. */
export const dealStages = [
  'Lead',
  'Qualified',
  'Demo',
  'Trial',
  'Negotiation',
  'Customer',
  'Churned',
  'No stage',
] as const;
export type DealStage = (typeof dealStages)[number];
/** A row in a company's Emails tab. */
export type CompanyEmail = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  time: string;
  /** Shown under Signal; everything shows under All. */
  signal?: boolean;
  /** Your own thread, shown under Me; the team sees every thread. */
  mine?: boolean;
  unread?: boolean;
};
export type CompanyCall = {
  id: string;
  title: string;
  time: string;
  duration: string;
  people: HomepagePersonId[];
  guests: string[];
};
export type CompanyFile = {
  id: string;
  title: string;
  time: string;
  kind: 'document' | 'pdf';
  /** A workspace document the row opens. */
  documentId?: string;
};
export type CompanyTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: HomepagePersonId;
};
export type SampleCompany = {
  id: string;
  name: string;
  domain: string;
  description: string;
  stage: DealStage;
  owner: HomepagePersonId | '';
  revenue: string;
  contacts: { name: string; email: string }[];
  comments: WorkspaceComment[];
  /** Workspace emails (by id) exchanged with this company. */
  emailIds: string[];
  /** Board card time: the last interaction, formatted like the app's rows. */
  updated?: string;
  /** Relative time for the "Last interacted" pill. */
  lastInteracted?: string;
  emails?: CompanyEmail[];
  calls?: CompanyCall[];
  files?: CompanyFile[];
  tasks?: CompanyTask[];
  lists?: string[];
  /** New since you last looked: the list's unread indicator. */
  unread?: boolean;
};
export type SampleEvent = {
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  calendar: 'work' | 'personal';
  description: string;
};

/** formatRelativeTimestamp for a sample day whose clock reads 10:10 AM. */
function relative(updated: string) {
  const time = /^(\d+):(\d+) AM$/.exec(updated);
  if (!time) return updated === 'Sep 28' ? '5:40PM yesterday' : updated;
  const minutes = 610 - (Number(time[1]) * 60 + Number(time[2]));
  return minutes < 60
    ? `${minutes} minutes ago`
    : `${Math.floor(minutes / 60)} hour${minutes < 120 ? '' : 's'} ago`;
}

const company = (
  id: string,
  name: string,
  stage: DealStage,
  owner: HomepagePersonId | '',
  updated: string,
  description: string,
  revenue = ''
): SampleCompany => ({
  id,
  name,
  domain: `${id}.example`,
  description,
  stage,
  owner,
  revenue,
  updated,
  lastInteracted: relative(updated),
  contacts: [],
  comments: [],
  emailIds: [],
});

/** The Meadow carries the full record; the rest fill out a team's pipeline. */
export function sampleCompanies(): SampleCompany[] {
  return [
    company(
      'northstar',
      'Northstar Design',
      'Lead',
      'jacob',
      '8:20 AM',
      'Northstar Design is a product design and research consultancy for fintech and healthcare companies, with studios in Austin and Denver.'
    ),
    company(
      'harbor',
      'Harbor Analytics',
      'Lead',
      'julia',
      'Sep 28',
      'Harbor Analytics builds sales forecasting dashboards for regional grocery chains and independent retailers.'
    ),
    company(
      'ridgeline',
      'Ridgeline Outdoor',
      'Lead',
      '',
      'Sep 26',
      'Ridgeline Outdoor is a direct-to-consumer maker of camping and climbing gear based in Boulder, Colorado.'
    ),
    company(
      'copperleaf',
      'Copperleaf',
      'Lead',
      'teo',
      'Sep 25',
      'Copperleaf is a bookkeeping and tax firm for restaurants and small retailers in the Pacific Northwest.'
    ),
    company(
      'orbit',
      'Orbit Labs',
      'Qualified',
      'teo',
      '10:05 AM',
      'Orbit Labs makes scheduling and dispatch software for field service teams.',
      '6,000'
    ),
    company(
      'tidewater',
      'Tidewater Health',
      'Qualified',
      'jacob',
      'Sep 28',
      'Tidewater Health runs a network of physical therapy clinics across coastal Virginia and North Carolina.'
    ),
    company(
      'fernway',
      'Fernway Travel',
      'Qualified',
      'julia',
      'Sep 27',
      'Fernway plans group trips and company offsites for remote teams.'
    ),
    {
      ...company(
        'meadow',
        'The Meadow',
        'Demo',
        'jacob',
        '9:41 AM',
        'The Meadow is a Brooklyn design studio that builds brands, websites, and packaging for consumer companies. Its team of about 40 designers and strategists works with founders from naming through launch, and runs a small in-house print shop for packaging prototypes and limited-run merchandise.',
        '18,000'
      ),
      contacts: [
        { name: 'Dana Whitfield', email: 'dana@meadow.example' },
        { name: 'Alex Chen', email: 'alex@meadow.example' },
        { name: 'Priya Raman', email: 'priya@meadow.example' },
      ],
      comments: [
        {
          id: 'meadow-pricing',
          person: 'julia',
          body: 'Dana asked about pricing for 12 seats now and the studio team in November. I quoted the annual team rate. @[Jacob](demo-mention:jacob) can we hold it through the end of the year?',
          time: '8:47 AM',
        },
        {
          id: 'meadow-pricing-hold',
          person: 'jacob',
          body: 'Yes, if they start with 12 before Thursday’s demo.',
          time: '8:58 AM',
          replyTo: 'meadow-pricing',
        },
        {
          id: 'meadow-pricing-sent',
          person: 'julia',
          body: 'Sent. Order form is in Files.',
          time: '9:12 AM',
          replyTo: 'meadow-pricing',
        },
      ],
      emailIds: ['dana'],
      emails: [
        {
          id: 'meadow-seats',
          sender: 'Alex Chen',
          subject: 'Seats for the studio team',
          snippet: 'We’d start with 12 and add the print shop in November.',
          time: 'Sep 28',
          signal: true,
        },
        {
          id: 'meadow-order',
          sender: 'Julia Westphal',
          subject: 'Re: Pricing for 12 seats',
          snippet: 'Attached is the order form with the annual team rate.',
          time: 'Sep 27',
          signal: true,
        },
        {
          id: 'meadow-invite',
          sender: 'Dana Whitfield',
          subject: 'Invitation: The Meadow · Demo',
          snippet: 'Thursday, October 1 · 9:00 – 10:00 AM',
          time: 'Sep 26',
          mine: true,
        },
        {
          id: 'meadow-security',
          sender: 'Priya Raman',
          subject: 'Security questionnaire',
          snippet: 'Our IT contractor sent over a few questions about SSO.',
          time: 'Sep 25',
          signal: true,
        },
        {
          id: 'meadow-recap',
          sender: 'Jacob Beckerman',
          subject: 'Recap from today',
          snippet: 'Thanks for the time, Dana. Here’s what we covered.',
          time: 'Sep 22',
          signal: true,
          mine: true,
        },
        {
          id: 'meadow-intro',
          sender: 'Dana Whitfield',
          subject: 'Intro from Sam',
          snippet:
            'Sam mentioned you’re building something for studios like ours.',
          time: 'Sep 19',
          signal: true,
          mine: true,
        },
      ],
      calls: [
        {
          id: 'meadow-checkin',
          title: 'Rollout check-in with The Meadow',
          time: 'Sep 28',
          duration: '18m 40s',
          people: ['jacob', 'julia'],
          guests: ['Dana Whitfield', 'Alex Chen'],
        },
        {
          id: 'meadow-pricing-call',
          title: 'Pricing questions',
          time: 'Sep 25',
          duration: '12m 4s',
          people: ['julia'],
          guests: ['Dana Whitfield'],
        },
        {
          id: 'meadow-design-review',
          title: 'Studio workflow walkthrough',
          time: 'Sep 24',
          duration: '46m 31s',
          people: ['jacob', 'teo'],
          guests: ['Alex Chen', 'Priya Raman'],
        },
        {
          id: 'meadow-intro-call',
          title: 'Intro call: The Meadow',
          time: 'Sep 22',
          duration: '31m 12s',
          people: ['jacob'],
          guests: ['Dana Whitfield'],
        },
      ],
      files: [
        {
          id: 'meadow-rollout',
          title: 'Team rollout plan',
          time: '9:30 AM',
          kind: 'document',
          documentId: 'rollout',
        },
        {
          id: 'meadow-notes',
          title: 'Demo call notes',
          time: 'Sep 28',
          kind: 'document',
          documentId: 'notes',
        },
        {
          id: 'meadow-order-form',
          title: 'The Meadow order form.pdf',
          time: 'Sep 27',
          kind: 'pdf',
        },
      ],
      tasks: [
        {
          id: 'meadow-demo-prep',
          title: 'Prep Thursday’s demo for the studio',
          status: 'In Progress',
          priority: 'High',
          owner: 'jacob',
        },
        {
          id: 'meadow-order-task',
          title: 'Get the order form signed',
          status: 'Not Started',
          priority: 'Medium',
          owner: 'julia',
        },
        {
          id: 'meadow-invites',
          title: 'Invite the print shop in November',
          status: 'Not Started',
          priority: 'Low',
          owner: 'teo',
        },
      ],
      lists: ['Q4 pipeline'],
    },
    company(
      'bluebird',
      'Bluebird Logistics',
      'Demo',
      'julia',
      'Sep 28',
      'Bluebird Logistics is a freight brokerage that matches small carriers with regional shippers.'
    ),
    company(
      'sable',
      'Sable & Co',
      'Demo',
      'teo',
      'Sep 26',
      'Sable & Co is a brand and packaging agency for food and beverage startups.'
    ),
    company(
      'lumen',
      'Lumen Works',
      'Trial',
      'julia',
      '8:52 AM',
      'Lumen Works builds point-of-sale and inventory software for independent bookstores.',
      '9,000'
    ),
    company(
      'foxglove',
      'Foxglove Studio',
      'Trial',
      'jacob',
      'Sep 27',
      'Foxglove is an architecture and interiors studio that designs restaurants and boutique hotels.'
    ),
    company(
      'northwind',
      'Northwind',
      'Negotiation',
      'jacob',
      'Sep 28',
      'Northwind is a commercial HVAC contractor serving offices and schools in the Twin Cities.',
      '32,000'
    ),
    company(
      'granite',
      'Granite Legal',
      'Negotiation',
      'valentina',
      'Sep 24',
      'Granite Legal is a 25-attorney firm focused on employment law and startup financings.',
      '14,400'
    ),
    company(
      'relay',
      'Relay',
      'Customer',
      'julia',
      'Sep 28',
      'Relay makes customer support software for e-commerce brands.',
      '24,000'
    ),
    company(
      'pallet',
      'Pallet Coffee',
      'Customer',
      'teo',
      'Sep 23',
      'Pallet roasts and wholesales specialty coffee to cafés and offices in Portland, Oregon.',
      '6,000'
    ),
    company(
      'fieldnote',
      'Fieldnote',
      'Customer',
      'jacob',
      'Sep 22',
      'Fieldnote runs user research studies and recruits interview participants for product teams.',
      '9,600'
    ),
    company(
      'cedar',
      'Cedar Studio',
      'Churned',
      'jacob',
      'Aug 30',
      'Cedar Studio is an independent animation studio that makes commercials and explainer videos.'
    ),
    company(
      'fieldwork',
      'Fieldwork',
      'No stage',
      '',
      'Sep 21',
      'Fieldwork operates coworking spaces in three Chicago neighborhoods.'
    ),
    company(
      'brightline',
      'Brightline Tutoring',
      'No stage',
      '',
      'Sep 20',
      'Brightline offers online math and science tutoring for middle and high school students.'
    ),
  ];
}
export const sampleToday = '2026-09-29';
export function sampleEvents(): SampleEvent[] {
  return [
    ...[28, 29, 30].map((day) => ({
      id: `standup-${day}`,
      title: 'Team standup',
      date: `2026-09-${day}`,
      start: 10,
      duration: 0.5,
      calendar: 'work' as const,
      description: 'Share progress and discuss what is next.',
    })),
    {
      id: 'launch-review',
      title: 'Launch review',
      date: sampleToday,
      start: 13,
      duration: 1,
      calendar: 'work',
      description: 'Review the announcement, demo, and rollout plan.',
    },
    {
      id: 'customer-demo',
      title: 'The Meadow · Demo',
      date: '2026-10-01',
      start: 9,
      duration: 1,
      calendar: 'work',
      description: 'Walk Dana and the team through the new workspace.',
    },
    {
      id: 'design-review',
      title: 'Design review',
      date: '2026-09-30',
      start: 15,
      duration: 1,
      calendar: 'work',
      description: 'Review mobile layouts with Valentina.',
    },
    {
      id: 'lunch',
      title: 'Lunch with Julia',
      date: sampleToday,
      start: 12,
      duration: 1,
      calendar: 'personal',
      description: 'Catch up over lunch.',
    },
    {
      id: 'launch',
      title: 'Launch retrospective',
      date: '2026-10-02',
      start: 16,
      duration: 1,
      calendar: 'work',
      description: 'What worked, what we learned, and next steps.',
    },
  ];
}
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function weekDates(date: string) {
  const offset = new Date(`${date}T12:00:00`).getDay();
  return Array.from({ length: 7 }, (_, i) => shiftDate(date, i - offset));
}
