import type { WorkspaceTask } from '../../core/dummy-workspace';

export type DemoProject = WorkspaceTask & { dueDate: string };
export type TaskMetadata = {
  projectId: string;
  updated: number;
  created: number;
  dueDate?: string;
};

/** Illustrative company work, using the native task/project properties. */
export function tasksWorkspaceData() {
  const projects: DemoProject[] = [
    {
      id: 'sales',
      title: 'Customer proposal',
      description:
        'Prepare a proposal for the homepage and pricing page updates.\n\nConfirm the requirements, draft the scope, and review pricing before Friday.',
      status: 'In Progress',
      priority: 'High',
      owner: 'julia',
      creator: 'jacob',
      dueDate: '2026-10-09',
      channel: 'sales',
      tags: [],
      steps: [],
      comments: [
        {
          id: 'sales-note',
          person: 'julia',
          body: 'The customer confirmed the scope. We can draft the proposal.',
          time: 'Yesterday',
        },
      ],
    },
    {
      id: 'customers',
      title: 'Customer follow-ups',
      description:
        'Close the loop with customers who asked for a proposal or a product walkthrough.\n\nKeep the original request attached to each task. Review outstanding replies together on Friday.',
      status: 'In Progress',
      priority: 'Medium',
      owner: 'jacob',
      creator: 'jacob',
      dueDate: '2026-10-30',
      channel: 'customers',
      tags: [],
      steps: [],
      comments: [
        {
          id: 'customers-note',
          person: 'teo',
          body: 'The proposal is ready for review. I’ve added the customer’s questions.',
          time: 'Today, 9:10 AM',
        },
      ],
    },
    {
      id: 'website',
      title: 'Website updates',
      description:
        'Update the customer stories and help new visitors find the right plan.\n\nJulia reviews the copy. Gabriel checks the pages on mobile before we publish.',
      status: 'Not Started',
      priority: 'Low',
      owner: 'gabriel',
      creator: 'julia',
      dueDate: '2026-10-23',
      channel: 'website',
      tags: [],
      steps: [],
      comments: [],
    },
  ];
  const rows: [
    string,
    string,
    string,
    WorkspaceTask['status'],
    WorkspaceTask['priority'],
    WorkspaceTask['owner'],
    string,
    string?,
  ][] = [
    [
      'delivery',
      'Confirm the requirements',
      'sales',
      'In Progress',
      'High',
      'jacob',
      'Confirm which pages the customer wants updated.',
      '2026-10-09',
    ],
    [
      'training',
      'Draft the customer proposal',
      'sales',
      'In Progress',
      'High',
      'teo',
      'Draft the scope and delivery timeline for the proposal.',
      '2026-10-09',
    ],
    [
      'pricing',
      'Review the pricing',
      'sales',
      'Not Started',
      'High',
      'julia',
      'Check the price and payment terms before we send the proposal.',
      '2026-10-09',
    ],
    [
      'access',
      'Approve the scope',
      'sales',
      'In Review',
      'Medium',
      'gabriel',
      'Check the proposal against the customer’s requirements.',
    ],
    [
      'contacts',
      'Collect customer feedback',
      'sales',
      'Completed',
      'Medium',
      'julia',
      'The customer’s feedback on the current website is attached.',
    ],
    [
      'proposal',
      'Review the proposal',
      'customers',
      'In Review',
      'High',
      'jacob',
      'Check the scope and pricing before sending the proposal.',
      '2026-10-09',
    ],
    [
      'questions',
      'Answer customer questions',
      'customers',
      'Not Started',
      'Medium',
      'julia',
      'Reply to the customer’s questions about getting started.',
    ],
    [
      'walkthrough',
      'Schedule a product demo',
      'customers',
      'Not Started',
      'Medium',
      'teo',
      'Find a time next week to show the product to the customer.',
    ],
    [
      'notes',
      'Send follow-up notes',
      'customers',
      'Completed',
      'Low',
      'jacob',
      'Sent the decisions and next steps from Tuesday’s customer calls.',
    ],
    [
      'stories',
      'Update the customer stories',
      'website',
      'Not Started',
      'Medium',
      'julia',
      'Add the latest customer quotes and get permission for the screenshots.',
    ],
    [
      'mobile',
      'Review pages on mobile',
      'website',
      'Not Started',
      'Low',
      'gabriel',
      'Check navigation, pricing, and the contact form at phone widths.',
    ],
    [
      'copy',
      'Approve the homepage copy',
      'website',
      'Completed',
      'Low',
      'jacob',
      'The revised headline and product descriptions are approved.',
    ],
  ];
  const metadata: Record<string, TaskMetadata> = {};
  const tasks = rows.map(
    (
      [id, title, projectId, status, priority, owner, description, dueDate],
      index
    ): WorkspaceTask => {
      metadata[id] = {
        projectId,
        updated: 100 - index,
        created: index,
        dueDate,
      };
      return {
        id,
        title,
        description,
        status,
        priority,
        owner,
        creator: index % 3 === 0 ? 'julia' : 'jacob',
        channel: projectId,
        tags: [projectId === 'website' ? 'Website' : 'Customers'],
        relatedDocumentIds: [],
        steps:
          id === 'training'
            ? [
                { id: 'outline', text: 'Confirm the scope', done: true },
                {
                  id: 'examples',
                  text: 'Add a delivery timeline',
                  done: false,
                },
              ]
            : [],
        comments:
          id === 'proposal'
            ? [
                {
                  id: 'proposal-comment',
                  person: 'teo',
                  body: 'They asked for a revised timeline. I’ve included it in the scope.',
                  time: 'Today, 9:10 AM',
                },
              ]
            : [],
      };
    }
  );
  return { projects, tasks, metadata };
}
