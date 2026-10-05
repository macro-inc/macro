import type { WorkspaceView } from './dummy-workspace';
import type { HomepagePersonId } from './homepage-demo-people';

export type HomeFeedItem = {
  view: WorkspaceView;
  id: string;
  title?: string;
  person?: HomepagePersonId;
  thread?: string;
  coding?: boolean;
};

/** Interleaved recent work, rather than separate inventories of each type. */
export const sampleHomeFeed: { title: string; items: HomeFeedItem[] }[] = [
  {
    title: 'Last hour',
    items: [
      {
        view: 'messages',
        id: 'dm-julia',
        person: 'julia',
        title: 'Julia Westphal',
      },
      {
        view: 'agents',
        id: 'deploy',
        coding: true,
        title: 'Cursor · Fix the deploy pipeline',
      },
      { view: 'messages', id: 'launch', title: 'launch' },
      {
        view: 'messages',
        id: 'engineers',
        thread: 'eng-release',
        title: 'Teo replied in #engineers',
      },
      { view: 'email', id: 'dana' },
      {
        view: 'agents',
        id: 'customer-summary',
        title: 'Summarize customer conversations',
      },
      { view: 'documents', id: 'plan' },
    ],
  },
  {
    title: 'This afternoon',
    items: [
      { view: 'messages', id: 'agents-team', title: 'agents-team' },
      { view: 'tasks', id: 'announcement' },
      {
        view: 'messages',
        id: 'launch',
        thread: 'm1',
        title: 'Julia and Teo in #launch',
      },
      {
        view: 'agents',
        id: 'invite-review',
        coding: true,
        title: 'Claude Code · Review the invite flow',
      },
      { view: 'spreadsheet', id: 'launch-metrics' },
      { view: 'messages', id: 'product', title: 'product' },
      {
        view: 'agents',
        id: 'launch-status',
        title: 'What’s left before launch?',
      },
      { view: 'messages', id: 'dm-teo', person: 'teo', title: 'Teo' },
      { view: 'documents', id: 'rollout' },
      {
        view: 'messages',
        id: 'design',
        thread: 'design-review',
        title: 'Valentina replied in #design',
      },
      { view: 'tasks', id: 'invite' },
      {
        view: 'agents',
        id: 'release-notes',
        coding: true,
        title: 'Cursor · Prepare the release notes',
      },
      { view: 'messages', id: 'customers', title: 'customers' },
    ],
  },
];
