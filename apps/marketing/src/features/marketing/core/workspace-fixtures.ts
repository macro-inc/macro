import type { WorkspaceComment } from './dummy-workspace';
import type { HomepagePersonId } from './homepage-demo-people';

export const dealStages = [
  'Lead',
  'Demo',
  'Customer',
  'Churned',
  'No stage',
] as const;
export type DealStage = (typeof dealStages)[number];
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
  emailIds: string[];
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
export function sampleCompanies(): SampleCompany[] {
  return [
    {
      id: 'meadow',
      name: 'The Meadow',
      domain: 'meadow.example',
      description: 'A shared workspace for the Meadow team.',
      stage: 'Customer',
      owner: 'julia',
      revenue: '12,000',
      contacts: [
        { name: 'Dana Whitfield', email: 'dana@meadow.example' },
        { name: 'Alex Chen', email: 'alex@meadow.example' },
      ],
      comments: [
        {
          id: 'company-comment',
          person: 'julia',
          body: 'The rollout plan is ready for Thursday. Dana will introduce the rest of the team.',
          time: '9:45 AM',
        },
      ],
      emailIds: ['dana'],
    },
    {
      id: 'northstar',
      name: 'Northstar Design',
      domain: 'northstar.example',
      description: 'Product design and research.',
      stage: 'Lead',
      owner: 'jacob',
      revenue: '',
      contacts: [{ name: 'Jamie Park', email: 'jamie@northstar.example' }],
      comments: [],
      emailIds: [],
    },
    {
      id: 'orbit',
      name: 'Orbit Labs',
      domain: 'orbit.example',
      description: 'Tools for distributed teams.',
      stage: 'Demo',
      owner: 'teo',
      revenue: '6,000',
      contacts: [],
      comments: [],
      emailIds: [],
    },
    {
      id: 'cedar',
      name: 'Cedar Studio',
      domain: 'cedar.example',
      description: 'Independent creative studio.',
      stage: 'Churned',
      owner: 'jacob',
      revenue: '',
      contacts: [],
      comments: [],
      emailIds: [],
    },
    {
      id: 'fieldwork',
      name: 'Fieldwork',
      domain: 'fieldwork.example',
      description: 'Research that connects people.',
      stage: 'No stage',
      owner: '',
      revenue: '',
      contacts: [],
      comments: [],
      emailIds: [],
    },
    {
      id: 'lumen',
      name: 'Lumen Works',
      domain: 'lumen.example',
      description: 'Software for small businesses.',
      stage: 'No stage',
      owner: '',
      revenue: '',
      contacts: [],
      comments: [],
      emailIds: [],
    },
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
