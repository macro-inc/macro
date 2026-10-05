import type { DemoEmail } from './demo-email';
import { demoEmails } from './demo-email';
import type { HomepagePersonId } from './homepage-demo-people';
import { sampleWorkspaceChannels } from './workspace-chat-fixtures';
import {
  type SampleCompany,
  type SampleEvent,
  sampleCompanies,
  sampleEvents,
} from './workspace-fixtures';
import { extraWorkspaceDocuments } from './workspace-parity-fixtures';

export type WorkspaceView =
  | 'home'
  | 'tasks'
  | 'email'
  | 'messages'
  | 'documents'
  | 'agents'
  | 'calendar'
  | 'crm'
  | 'spreadsheet';
export type TaskStatus =
  | 'Not Started'
  | 'In Progress'
  | 'In Review'
  | 'Completed'
  | 'Canceled';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type WorkspaceComment = {
  id: string;
  person: HomepagePersonId;
  body: string;
  time: string;
  emailId?: string;
  taskId?: string;
  /** An agent reply can reference several tasks it created. */
  taskIds?: string[];
  documentId?: string;
  replyTo?: string;
  reactions?: string[];
};
export type WorkspaceTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: HomepagePersonId;
  creator: HomepagePersonId;
  tags: string[];
  channel: string;
  steps: { id: string; text: string; done: boolean }[];
  comments: WorkspaceComment[];
};
export type EmailRecipients = { to?: string; cc?: string; bcc?: string };
export type WorkspaceEmail = DemoEmail &
  EmailRecipients & {
    folder: 'inbox' | 'sent' | 'drafts' | 'scheduled';
    body: string;
    replies: (WorkspaceComment & EmailRecipients)[];
    scheduled?: string;
    shared?: string;
    archived?: boolean;
  };
export type WorkspaceDocument = {
  kind?: 'document' | 'spreadsheet' | 'canvas' | 'code';
  updated?: string;
  tags?: string[];
  id: string;
  title: string;
  body: string;
  comments: WorkspaceComment[];
};
export type DummyData = {
  companies: SampleCompany[];
  events: SampleEvent[];
  tasks: WorkspaceTask[];
  emails: WorkspaceEmail[];
  documents: WorkspaceDocument[];
  channels: {
    id: string;
    person?: HomepagePersonId;
    messages: WorkspaceComment[];
  }[];
  activity: { id: string; text: string; time: string }[];
};

export function dummyData(): DummyData {
  const definitions: [
    string,
    string,
    TaskStatus,
    TaskPriority,
    HomepagePersonId,
    string,
  ][] = [
    [
      'announcement',
      'Write the launch announcement',
      'In Review',
      'High',
      'julia',
      'Prepare the announcement for Thursday’s launch. Link the rollout plan and the product demo.',
    ],
    [
      'invite',
      'Fix the team invite handoff',
      'In Progress',
      'Urgent',
      'teo',
      'Keep the invited team selected through sign-up. New and existing accounts should land in the right workspace.',
    ],
    [
      'checklist',
      'Prepare the launch checklist',
      'Not Started',
      'High',
      'jacob',
      'Confirm the owners, launch date, and final checks for Thursday.',
    ],
    [
      'follow-up',
      'Send Dana the rollout plan',
      'Not Started',
      'Medium',
      'jacob',
      'Share the rollout plan with Dana and confirm the follow-up meeting.',
    ],
    [
      'deploy',
      'Fix the deploy pipeline',
      'In Progress',
      'High',
      'cursor',
      'Investigate the flaky deploy, add regression coverage, and open a pull request for review.',
    ],
    [
      'demo',
      'Record the product demo',
      'Completed',
      'Medium',
      'julia',
      'Record the team workflow for the launch announcement.',
    ],
    [
      'pricing',
      'Review the pricing page',
      'Not Started',
      'Low',
      'jacob',
      'Check the team plan and the questions from our last customer call.',
    ],
    [
      'release',
      'Review the deploy pull request',
      'In Review',
      'High',
      'teo',
      'Review Cursor’s retry changes and run the release checks.',
    ],
    [
      'support',
      'Answer onboarding questions',
      'Not Started',
      'Medium',
      'julia',
      'Respond to the questions from the Meadow team.',
    ],
    [
      'changelog',
      'Publish the changelog',
      'Not Started',
      'Medium',
      'teo',
      'Document the features in this release and link the product demo.',
    ],
    [
      'design',
      'Review the mobile navigation',
      'In Progress',
      'High',
      'valentina',
      'Review touch targets and the task detail on smaller screens.',
    ],
    [
      'metrics',
      'Check launch metrics',
      'Completed',
      'Low',
      'jacob',
      'Compare sign-ups and activation from the previous release.',
    ],
  ];
  return {
    companies: sampleCompanies(),
    events: sampleEvents(),
    tasks: definitions.map(
      ([id, title, status, priority, owner, description], i) => ({
        id,
        title,
        status,
        priority,
        owner,
        description,
        creator: i % 3 === 0 ? 'julia' : 'jacob',
        tags: [i < 6 ? 'Launch' : 'Product'],
        channel: i < 6 ? 'launch' : 'product',
        steps: [
          {
            id: 'review',
            text: 'Review the changes with the team',
            done: status === 'Completed',
          },
          {
            id: 'verify',
            text: 'Verify before Thursday’s launch',
            done: false,
          },
        ],
        comments:
          i === 0
            ? [
                {
                  id: 'announcement-comment',
                  person: 'julia',
                  body: 'The first draft is ready for review.',
                  time: '9:32 AM',
                },
              ]
            : [],
      })
    ),
    emails: (
      [
        ...demoEmails,
        {
          id: 'feedback',
          sender: 'Maya Chen',
          subject: 'Feedback from the pilot team',
          snippet:
            'The shared inbox is already saving us a few hours every week.',
          time: '8:32 AM',
          account: 'work',
          tags: ['customers'],
        },
        {
          id: 'assets',
          sender: 'Julia Westphal',
          subject: 'Final launch assets',
          snippet: 'The new screenshots and product walkthrough are ready.',
          time: '8:10 AM',
          account: 'work',
          tags: ['launch'],
        },
        {
          id: 'research',
          sender: 'Alex Rivera',
          subject: 'Notes from our customer interviews',
          snippet:
            'I pulled together the themes we heard across the five sessions.',
          time: 'Sep 28',
          account: 'work',
          yesterday: true,
          tags: ['product', 'customers'],
        },
        {
          id: 'coffee',
          sender: 'Sam Parker',
          subject: 'Coffee next week?',
          snippet:
            'Would love to hear how the launch went. Tuesday works for me.',
          time: 'Sep 28',
          account: 'personal',
          yesterday: true,
        },
      ] satisfies DemoEmail[]
    ).map((email) => ({
      ...email,
      folder: 'inbox',
      body: `Hi Jacob,\n\n${email.snippet}\n\nThanks,\n${email.sender.split(' ')[0]}`,
      replies: [],
    })),
    documents: [
      {
        id: 'plan',
        tags: ['Launch', 'Product'],
        title: 'Q3 launch plan',
        body: 'One shared workspace. One great launch.\n\n## Launch checklist\n\n- [x] Finalize the product story\n- [x] Review the launch announcement\n- [ ] Send the customer email\n- [ ] Publish the changelog\n\n## Owners\n\n**Julia** — announcement and customer email\n**Teo** — deploy and release checks\n**Jacob** — customer conversations',
        comments: [],
      },
      {
        id: 'rollout',
        tags: ['Launch', 'Customers'],
        title: 'Team rollout plan',
        body: '## Setup\n\nConnect your work email, invite your team, and bring your existing documents into Macro.\n\n## Next steps\n\n- Confirm the workspace owner\n- Invite the Meadow team\n- Schedule the Thursday check-in',
        comments: [],
      },
      {
        id: 'notes',
        tags: ['Customers', 'Follow up'],
        title: 'Demo call notes',
        body: '## The Meadow\n\nDana’s team wants email, tasks, and documents in one workspace.\n\n## Follow-up\n\nShare the rollout plan. Julia will help with setup. Thursday at 9 works for the follow-up.',
        comments: [],
      },
      ...extraWorkspaceDocuments(),
    ],
    channels: sampleWorkspaceChannels(),
    activity: [
      {
        id: 'a1',
        text: 'Julia updated Write the launch announcement',
        time: '9:32 AM',
      },
      {
        id: 'a2',
        text: 'Cursor started Fix the deploy pipeline',
        time: '9:30 AM',
      },
    ],
  };
}
