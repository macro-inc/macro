import type { WorkspaceTask, WorkspaceView } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { taskChannelHistory } from './taskChannelHistory';

export const REQUEST_TASK = 'Prepare the customer proposal';
export const REQUEST_DOCUMENT = 'Customer brief';
export const REQUEST_MESSAGE =
  'Prepare the customer proposal @[Julia](demo-mention:julia) — ready by Friday.';
export const REQUEST_CONTEXT =
  'The customer wants the homepage and pricing page updated. They need a proposal by Friday.';

export function proposalTask(): WorkspaceTask {
  return {
    id: 'proposal',
    title: REQUEST_TASK,
    description: 'Prepare the scope, pricing, and a delivery timeline.',
    owner: 'julia',
    creator: 'jacob',
    priority: 'High',
    status: 'In Progress',
    channel: 'sales',
    tags: ['Customers'],
    steps: [],
    comments: [],
    relatedDocumentIds: ['customer-brief'],
  };
}

/** Tasks-page fixtures only; every demonstration owns its own editable copy. */
export function createTaskProject(view: WorkspaceView = 'tasks') {
  const w = createDummyWorkspace(view);
  w.setData('tasks', [proposalTask()]);
  w.setData('documents', [
    {
      id: 'customer-brief',
      title: REQUEST_DOCUMENT,
      body: 'Update the homepage and pricing page. Send a proposal by Friday.',
      comments: [],
      tags: ['Customers'],
    },
  ]);
  w.setData('channels', [
    {
      id: 'sales',
      messages: [
        {
          id: 'context',
          person: 'teo',
          body: REQUEST_CONTEXT,
          time: '9:16 AM',
        },
        {
          id: 'proposal-request',
          person: 'jacob',
          body: REQUEST_MESSAGE,
          time: '9:18 AM',
          taskId: 'proposal',
        },
      ],
    },
  ]);
  w.setData(
    'channels',
    (channel) => channel.id === 'sales',
    'messages',
    (messages) => [...messages, ...taskChannelHistory('sales')]
  );
  w.setChannel('sales');
  w.open(view, view === 'tasks' ? 'proposal' : 'sales');
  return w;
}
