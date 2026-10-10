import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { taskChannelHistory } from './taskChannelHistory';

export const PROPOSAL_TASK = 'Prepare the customer proposal';

/** One substantive job with the sources needed to complete it. */
export function createProposalWorkspace() {
  const w = createDummyWorkspace('tasks');
  w.setData('documents', [
    {
      id: 'brief',
      title: 'Customer brief',
      body: '## Scope\n\nUpdate the homepage and pricing page.\n\n## Delivery\n\nShare a first draft next week. Include one round of changes.',
      tags: ['Customers'],
      comments: [],
    },
  ]);
  w.setData('emails', (email) => email.id === 'dana', {
    subject: 'Proposal request',
    sender: 'Customer',
    snippet:
      'Please send a proposal by Friday, with pricing and a delivery date.',
    body: 'Hi Julia,\n\nPlease send a proposal by Friday for the homepage and pricing page updates. Include the price and when you can deliver the first draft.\n\nThanks!',
    replies: [],
    shared: 'sales',
  });
  w.setData('tasks', [
    {
      id: 'proposal',
      title: PROPOSAL_TASK,
      description: 'Prepare a proposal with pricing and a delivery timeline.',
      status: 'In Progress',
      priority: 'High',
      owner: 'julia',
      creator: 'jacob',
      channel: 'sales',
      tags: ['Customers'],
      relatedDocumentIds: ['brief'],
      steps: [],
      comments: [],
    },
  ]);
  w.setData('channels', [
    {
      id: 'sales',
      messages: [
        {
          id: 'request',
          person: 'jacob',
          time: '9:10 AM',
          body: 'The customer wants the homepage and pricing page updated. Their request is attached.',
          emailId: 'dana',
          documentId: 'brief',
        },
        {
          id: 'owner',
          person: 'julia',
          time: '9:14 AM',
          body: 'I’ll draft the proposal. Can you review the pricing before we send it?',
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
  w.open('tasks', 'proposal');
  return w;
}
