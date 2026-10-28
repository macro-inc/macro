import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import type { DocMentionItem } from './DocMention';

export const PROJECT_TITLE = 'Website brief';
export const PROJECT_TAGS = ['Launch', 'Product'];
export const PROJECT_EMAIL = {
  kind: 'email',
  label: 'Pricing changes',
} satisfies DocMentionItem;
export const PROJECT_TASK = {
  kind: 'task',
  label: 'Update pricing page',
  status: 'In Progress',
} satisfies DocMentionItem;
export const PROJECT_INTRO =
  'Show monthly and annual prices together. Annual plans get two months free. Keep the free plan visible.';
export const PROJECT_STEPS = [
  'Update the pricing table',
  'Check the page on mobile',
  'Test the signup links',
];

/** Page-owned fixtures. The same document is opened from folders, tags and chat. */
export function createDocumentProject() {
  const w = createDummyWorkspace('documents');
  w.setData('emails', (email) => email.id === 'dana', {
    sender: 'Julia',
    subject: PROJECT_EMAIL.label,
    snippet: 'Let’s show monthly and annual prices together.',
    body: 'Hey Jacob,\n\nLet’s show monthly and annual prices together. Annual gets two months free.\n\nCan we keep the free plan visible too? People keep asking if we still have one.\n\nJulia',
    tags: ['launch'],
    replies: [],
  });
  w.setData('tasks', (task) => task.id === 'invite', {
    title: PROJECT_TASK.label,
    description:
      'Update the pricing page from the Website brief. Show both billing options and keep the free plan visible.',
    owner: 'teo',
    channel: 'website',
    priority: 'High',
    status: 'In Progress',
    tags: [...PROJECT_TAGS],
    steps: PROJECT_STEPS.map((text, index) => ({
      id: `pricing-${index}`,
      text,
      done: index === 0,
    })),
    comments: [
      {
        id: 'pricing-question',
        person: 'teo',
        time: '10:18 AM',
        body: 'table is done. checking mobile next',
      },
    ],
  });
  w.setData('documents', (doc) => doc.id === 'plan', {
    title: PROJECT_TITLE,
    tags: [...PROJECT_TAGS],
    body: `## What we’re changing\n\nMake the homepage easier to scan. Show what the product does before asking people to sign up.\n\n## Pricing\n\n${PROJECT_INTRO}\n\n## Before we publish\n\n${PROJECT_STEPS.map((step) => `- [ ] ${step}`).join('\n')}`,
    comments: [],
  });
  w.setData('channels', (c) => c.id === 'launch', {
    id: 'website',
    messages: [
      {
        id: 'monday',
        person: 'julia',
        body: 'can we get the new pricing page out this week?',
        time: '9:12 AM',
      },
      {
        id: 'mobile',
        person: 'teo',
        body: 'yep. mobile needs a little work first',
        time: '9:14 AM',
      },
      {
        id: 'email',
        person: 'julia',
        body: 'sent over the pricing changes',
        time: '9:17 AM',
      },
      {
        id: 'plan',
        person: 'jacob',
        body: 'put everything in here',
        documentId: 'plan',
        time: '9:31 AM',
      },
      {
        id: 'reply',
        person: 'teo',
        body: 'got it, i’ll take the pricing page',
        time: '9:33 AM',
      },
    ],
  });
  w.setChannel('website');
  w.open('documents', 'plan');
  return w;
}
