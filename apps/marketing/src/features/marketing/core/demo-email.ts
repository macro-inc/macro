// Demonstration data only; no customer inbox content or app service access.
export const emailTags = [
  { id: 'launch', label: 'Launch', color: '#F5D90A' },
  { id: 'customers', label: 'Customers', color: '#E93D82' },
  { id: 'follow-up', label: 'Follow up', color: '#F76B15' },
  { id: 'product', label: 'Product', color: '#0091FF' },
  { id: 'calendar', label: 'Calendar', color: '#FFC53D' },
] as const;
export type EmailTagId = (typeof emailTags)[number]['id'];
export type DemoEmail = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  time: string;
  account: 'work' | 'personal';
  tags?: EmailTagId[];
  favorite?: boolean;
  unread?: boolean;
  noise?: boolean;
  yesterday?: boolean;
};
export const demoEmails: readonly DemoEmail[] = [
  {
    id: 'dana',
    tags: ['customers', 'follow-up'],
    favorite: true,
    sender: 'Dana Whitfield',
    subject: 'Next steps for our team',
    snippet: 'Thursday at 9 works. Could you share the rollout plan?',
    time: '9:41 AM',
    account: 'work',
    unread: true,
  },
  {
    id: 'julia',
    tags: ['launch'],
    sender: 'Julia Westphal',
    subject: 'Launch announcement',
    snippet: 'The first draft is ready for your review.',
    time: '9:32 AM',
    account: 'work',
    unread: true,
  },
  {
    id: 'teo',
    tags: ['product'],
    sender: 'Teo Nys',
    subject: 'Ready for Thursday',
    snippet: 'The invite flow is ready. Let’s run through the checklist.',
    time: '9:18 AM',
    account: 'work',
  },
  {
    id: 'updates',
    tags: ['product'],
    sender: 'Product updates',
    subject: 'September release notes',
    snippet: 'See what’s new this month.',
    time: '9:02 AM',
    account: 'work',
  },
  {
    id: 'design',
    sender: 'Design Weekly',
    subject: 'This week in design',
    snippet: 'A collection of new tools, projects, and ideas.',
    time: '8:40 AM',
    account: 'personal',
    noise: true,
  },
  {
    id: 'meadow',
    tags: ['calendar'],
    sender: 'The Meadow',
    subject: 'Your table is confirmed',
    snippet: 'We look forward to seeing you on Saturday.',
    time: 'Sep 28',
    account: 'personal',
    yesterday: true,
  },
  {
    id: 'plan',
    tags: ['launch', 'customers'],
    favorite: true,
    sender: 'Julia, Dana',
    subject: 'Team rollout plan',
    snippet: 'Here are the next steps we discussed on the call.',
    time: 'Sep 28',
    account: 'work',
    yesterday: true,
  },
  {
    id: 'digest',
    sender: 'Engineering Weekly',
    subject: 'Your weekly digest',
    snippet: 'Updates from the projects you follow.',
    time: 'Sep 28',
    account: 'work',
    noise: true,
    yesterday: true,
  },
  {
    id: 'receipt',
    sender: 'The Bookshop',
    subject: 'Thanks for your order',
    snippet: 'Your order is on its way.',
    time: 'Sep 28',
    account: 'personal',
    noise: true,
    yesterday: true,
  },
];
