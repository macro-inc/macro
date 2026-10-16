import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';

export const TRAINING_TITLE = 'Prepare Thursday’s training';

/** Calls-only sample data, so other pages keep their own demonstrations. */
export function createCallProject() {
  const w = createDummyWorkspace('tasks');
  w.setData('tasks', (task) => task.id === 'invite', {
    title: TRAINING_TITLE,
    description: 'Prepare Thursday’s training at 10. Teo leads the session.',
    owner: 'teo',
    priority: 'High',
    status: 'In Progress',
    tags: ['Customers'],
    relatedDocumentIds: ['plan'],
    steps: [],
    comments: [],
  });
  w.setData('documents', (doc) => doc.id === 'plan', {
    title: 'Training plan',
    tags: ['Customers', 'Launch'],
    body: '## Thursday’s training\n\nTeo leads the session at 10. Prepare the slides and send the invite.',
    comments: [],
  });
  w.setData('channels', (channel) => channel.id === 'launch', 'messages', [
    {
      id: 'training',
      person: 'teo',
      body: 'Can someone cover training on Thursday?',
      time: '9:20 AM',
    },
    {
      id: 'owner',
      person: 'julia',
      body: 'I can take it.',
      time: '9:24 AM',
      taskId: 'invite',
    },
    {
      id: 'plan',
      person: 'jacob',
      body: 'Here’s the plan.',
      time: '9:25 AM',
      documentId: 'plan',
    },
  ]);
  return w;
}
