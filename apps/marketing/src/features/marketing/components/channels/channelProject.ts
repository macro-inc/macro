import type { DummyData, WorkspaceComment } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';

export const CHANNEL_DOC = 'Homepage copy';
export const CHANNEL_EMAIL = 'Website feedback';
export const CHANNEL_TASK = 'Check the mobile layout';
export const FOLLOW_UP_TASK = 'Fix the signup button';

/** Original fictional conversation, with earlier exchanges left available to scroll. */
export const channelHistory: WorkspaceComment[] = [
  {
    id: 'history-morning',
    person: 'eric',
    time: '8:18 AM',
    body: 'morning, doing a last pass on the site',
  },
  {
    id: 'history-images',
    person: 'austin',
    time: '8:19 AM',
    body: 'new screenshots are in. use the ones from today',
    replyTo: 'history-morning',
  },
  {
    id: 'history-thanks',
    person: 'eric',
    time: '8:20 AM',
    body: 'thank you',
    replyTo: 'history-morning',
  },
  {
    id: 'history-logo',
    person: 'wolf',
    time: '8:27 AM',
    body: 'anyone else getting the old logo on the preview?',
  },
  {
    id: 'history-refresh',
    person: 'rahul',
    time: '8:28 AM',
    body: 'hard refresh. i had the same thing',
    replyTo: 'history-logo',
  },
  {
    id: 'history-fixed',
    person: 'wolf',
    time: '8:30 AM',
    body: 'yep that did it',
    replyTo: 'history-logo',
  },
  {
    id: 'history-copy',
    person: 'peter',
    time: '8:41 AM',
    body: 'intro feels a bit long on a phone',
  },
  {
    id: 'history-cut',
    person: 'eric',
    time: '8:43 AM',
    body: 'cutting the second paragraph',
    replyTo: 'history-copy',
  },
  {
    id: 'history-quote',
    person: 'austin',
    time: '8:45 AM',
    body: 'keep the customer quote though',
    replyTo: 'history-copy',
  },
  {
    id: 'history-keep',
    person: 'peter',
    time: '8:46 AM',
    body: 'yeah keep that',
    replyTo: 'history-copy',
  },
  {
    id: 'history-links',
    person: 'rahul',
    time: '8:54 AM',
    body: 'pricing links are good now. footer next',
  },
  {
    id: 'history-email',
    person: 'wolf',
    time: '8:57 AM',
    body: 'i’ll check the email that goes out after signup',
    replyTo: 'history-links',
  },
  {
    id: 'history-untested',
    person: 'eric',
    time: '8:58 AM',
    body: 'nice, that’s the one i haven’t tested',
    replyTo: 'history-links',
  },
  {
    id: 'history-export',
    person: 'austin',
    time: '9:03 AM',
    body: 'last image export is up',
  },
  {
    id: 'history-sharp',
    person: 'peter',
    time: '9:04 AM',
    body: 'much sharper',
    replyTo: 'history-export',
  },
  {
    id: 'history-finally',
    person: 'austin',
    time: '9:05 AM',
    body: 'finally 😅',
    replyTo: 'history-export',
  },
];

export const projectMessages: WorkspaceComment[] = [
  ...channelHistory,
  {
    id: 'start',
    person: 'eric',
    time: '9:12 AM',
    body: 'can we ship the site tomorrow?',
  },
  {
    id: 'shared-plan',
    person: 'peter',
    time: '9:14 AM',
    body: 'copy’s ready. updated @[Homepage copy](demo-mention:plan)',
    documentId: 'plan',
    replyTo: 'start',
  },
  {
    id: 'training',
    person: 'rahul',
    time: '9:18 AM',
    body: 'just need to finish @[Check the mobile layout](demo-mention:invite)',
    taskId: 'invite',
  },
  {
    id: 'customer-email',
    person: 'peter',
    time: '9:19 AM',
    body: 'did you catch the signup button in @[Website feedback](demo-mention:dana)?',
    emailId: 'dana',
    replyTo: 'training',
  },
  {
    id: 'training-reply',
    person: 'rahul',
    time: '9:20 AM',
    body: 'yep, fixing it now',
    replyTo: 'training',
  },
];

/** Page-local website launch content; other marketing pages keep their own data. */
export function createChannelProject() {
  const w = createDummyWorkspace('messages');
  w.setData('emails', (item) => item.id === 'dana', {
    subject: CHANNEL_EMAIL,
    sender: 'Austin Barron',
    snippet: 'The signup button is still hard to tap on a phone.',
    body: 'Hi Peter,\n\nThe new homepage looks good on desktop. I checked it on my phone too, and the signup button is still hard to tap.\n\nCan we make it the same height as the other buttons before we publish?\n\nThanks,\nAustin Barron',
    shared: 'launch',
    replies: [
      {
        id: 'website-reply',
        person: 'peter',
        to: 'Austin Barron',
        body: 'Agreed. We’ll fix the button before launch. Eric is checking the signup flow too.',
        time: '9:52 AM',
      },
    ],
  });
  w.setData('documents', (item) => item.id === 'plan', {
    title: CHANNEL_DOC,
    tags: ['Launch'],
    body: '## A simpler way to work\n\nEverything your team needs to get things done.\n\n## What’s new\n\n- A shorter intro\n- New customer stories\n- One clear signup button',
    comments: [
      {
        id: 'copy-comment',
        person: 'wolf',
        body: 'intro reads much better now',
        time: 'Yesterday',
      },
    ],
  });
  w.setData('tasks', (item) => item.id === 'invite', {
    title: CHANNEL_TASK,
    owner: 'rahul',
    creator: 'peter',
    description:
      'Check the homepage on a phone. Make sure the text is readable and the signup button is easy to tap.',
    status: 'In Progress',
    priority: 'High',
    tags: ['Launch'],
    relatedDocumentIds: ['plan'],
    steps: [
      { id: 'agenda', text: 'Check the text size', done: true },
      { id: 'examples', text: 'Test the signup button', done: false },
    ],
    comments: [],
  });
  w.setData(
    'channels',
    (item) => item.id === 'launch',
    'messages',
    structuredClone(projectMessages)
  );
  w.setData('channels', (item) => item.id === 'dm-teo', 'messages', [
    {
      id: 'teo-question',
      person: 'rahul',
      body: 'got a sec to look at @[Homepage copy](demo-mention:plan)?',
      time: '9:32 AM',
      documentId: 'plan',
    },
  ]);
  w.setData('channels', (channels) =>
    channels.filter((channel) =>
      ['launch', 'design', 'product', 'dm-teo', 'dm-julia'].includes(channel.id)
    )
  );
  w.setData('channels', (channel) => channel.id === 'product', 'messages', [
    {
      id: 'p1',
      person: 'eric',
      body: 'what should we work on next week?',
      time: '10:12 AM',
    },
    {
      id: 'p2',
      person: 'rahul',
      body: 'search. heard that from a few people this week',
      time: '10:14 AM',
      replyTo: 'p1',
    },
    {
      id: 'p3',
      person: 'peter',
      body: 'agreed. let’s talk tomorrow',
      time: '10:15 AM',
      replyTo: 'p1',
    },
  ]);
  w.setData('channels', (channel) => channel.id === 'design', 'messages', [
    {
      id: 'd1',
      person: 'austin',
      body: 'new icons are ready 👀',
      time: '11:02 AM',
    },
    {
      id: 'd2',
      person: 'eric',
      body: 'love these',
      time: '11:04 AM',
      replyTo: 'd1',
    },
  ]);
  w.setData('channels', (channel) => channel.id === 'dm-julia', 'messages', [
    {
      id: 'j1',
      person: 'eric',
      body: 'can you look at the intro in @[Homepage copy](demo-mention:plan)?',
      time: '9:18 AM',
      documentId: 'plan',
    },
    { id: 'j2', person: 'peter', body: 'yep, looking now', time: '9:20 AM' },
  ]);
  w.open('messages', 'launch');
  return w;
}

/** The opening and access stories use the same shared checklist. */
export function createChannelChecklist() {
  const w = createChannelProject();
  w.setData('documents', (doc) => doc.id === 'plan', {
    title: 'Launch checklist',
    comments: [
      {
        id: 'checklist-comment',
        person: 'eric',
        body: 'i’ll check signup again once the button fix is in',
        time: '10:02 AM',
      },
    ],
    body: 'Final checks for tomorrow’s website launch. Update this as each part is signed off.\n\n## Before we publish\n\n- [x] Homepage copy reviewed\n- [x] New images exported\n- [ ] Mobile layout checked\n- [ ] Signup and confirmation email tested\n\n## Owners\n\nRahul is checking mobile. Eric is handling signup. Peter will publish once both are ready.\n\n## After launch\n\nCheck the first signups and confirm the welcome email arrives.',
  });
  w.setData('channels', (channel) => channel.id === 'launch', 'messages', [
    ...structuredClone(channelHistory),
    {
      id: 'last-pass',
      person: 'eric',
      time: '9:40 AM',
      body: 'copy is done. mobile and signup left',
    },
    {
      id: 'last-pass-reply',
      person: 'rahul',
      time: '9:41 AM',
      body: 'looking now',
      replyTo: 'last-pass',
    },
    {
      id: 'confirmation',
      person: 'wolf',
      time: '9:49 AM',
      body: 'confirmation email is landing. subject line still needs checking',
    },
    {
      id: 'confirmation-reply',
      person: 'peter',
      time: '9:50 AM',
      body: 'keep it short pls',
      replyTo: 'confirmation',
    },
    {
      id: 'shared-plan',
      person: 'eric',
      body: 'added the last few things to @[Launch checklist](demo-mention:plan)',
      documentId: 'plan',
      time: '10:02 AM',
    },
    {
      id: 'welcome',
      person: 'peter',
      body: 'can you check the signup note in @[Website feedback](demo-mention:dana)?',
      emailId: 'dana',
      time: '10:05 AM',
    },
    {
      id: 'opened',
      person: 'rahul',
      body: 'working through @[Check the mobile layout](demo-mention:invite). signup is next',
      taskId: 'invite',
      time: '10:06 AM',
    },
    {
      id: 'phone-check',
      person: 'eric',
      time: '10:08 AM',
      body: 'i’ll do one more signup on my phone',
    },
    {
      id: 'phone-check-reply',
      person: 'rahul',
      time: '10:09 AM',
      body: 'thanks, i’ll check android',
      replyTo: 'phone-check',
    },
  ]);
  return w;
}

/** A fuller chat sidebar using the same people as the visible conversation. */
export function createChannelHeroProject() {
  const w = createChannelProject();
  w.setData('channels', (channels): DummyData['channels'] => [
    ...channels,
    {
      id: 'general',
      messages: [
        {
          id: 'general-sync',
          person: 'eric',
          time: '9:02 AM',
          body: 'quick reminder: team sync at 11',
        },
        {
          id: 'general-reply',
          person: 'rahul',
          time: '9:03 AM',
          body: 'i’ll be there',
          replyTo: 'general-sync',
        },
      ],
    },
    {
      id: 'engineering',
      messages: [
        {
          id: 'engineering-mobile',
          person: 'rahul',
          time: '9:22 AM',
          body: 'mobile fix is ready. checking android now',
        },
        {
          id: 'engineering-ios',
          person: 'wolf',
          time: '9:24 AM',
          body: 'i’ll check ios',
          replyTo: 'engineering-mobile',
        },
      ],
    },
    {
      id: 'customers',
      messages: [
        {
          id: 'customers-link',
          person: 'wolf',
          time: '9:30 AM',
          body: 'a few people asked for the signup link',
        },
        {
          id: 'customers-send',
          person: 'eric',
          time: '9:32 AM',
          body: 'sending it after the mobile check',
          replyTo: 'customers-link',
        },
      ],
    },
    {
      id: 'website',
      messages: [
        {
          id: 'website-ready',
          person: 'eric',
          time: '9:35 AM',
          body: 'screenshots and copy are ready',
        },
        {
          id: 'website-export',
          person: 'austin',
          time: '9:36 AM',
          body: 'last export looks good',
          replyTo: 'website-ready',
        },
      ],
    },
    {
      id: 'random',
      messages: [
        {
          id: 'random-coffee',
          person: 'austin',
          time: '10:02 AM',
          body: 'coffee?',
        },
        {
          id: 'random-reply',
          person: 'wolf',
          time: '10:03 AM',
          body: 'always',
          replyTo: 'random-coffee',
        },
      ],
    },
    {
      id: 'dm-gabriel',
      person: 'wolf',
      messages: [
        {
          id: 'gabriel-email',
          person: 'wolf',
          time: '9:37 AM',
          body: 'welcome email looks good. did you check it on mobile?',
        },
        {
          id: 'gabriel-reply',
          person: 'peter',
          time: '9:38 AM',
          body: 'yep, one more pass before we publish',
        },
      ],
    },
    {
      id: 'dm-austin',
      person: 'austin',
      messages: [
        {
          id: 'austin-images',
          person: 'austin',
          time: '9:40 AM',
          body: 'new images are in. refreshed the ones in @[Homepage copy](demo-mention:plan)',
          documentId: 'plan',
        },
        {
          id: 'austin-reply',
          person: 'peter',
          time: '9:41 AM',
          body: 'looks much sharper, thanks',
        },
      ],
    },
  ]);
  const extraChats: Record<string, [WorkspaceComment['person'], string][]> = {
    launch: [
      ['wolf', 'anyone got the final link? i have about six preview tabs open'],
      ['eric', 'same one as this morning'],
      ['wolf', 'found it. closing the other five for my own sanity'],
      ['rahul', 'mobile check is done btw'],
    ],
    product: [
      ['wolf', 'two people asked if search can remember the last filter'],
      ['eric', 'i keep expecting that too'],
      ['rahul', 'can do. should it reset when you switch projects?'],
      [
        'peter',
        'yeah probably. otherwise i’ll forget why nothing is showing up',
      ],
      ['eric', 'put it on the list for tomorrow'],
    ],
    design: [
      ['rahul', 'which folder has the small versions?'],
      ['austin', 'exports / 24. ignore the folder called final lol'],
      ['rahul', 'very reassuring'],
      ['austin', 'there is also final2. do not go in there'],
      ['eric', 'the new search icon is much clearer'],
    ],
    general: [
      ['peter', 'running 5 late, start without me'],
      ['wolf', 'we’re still finding the call link so you’re fine'],
      ['austin', 'it’s in the calendar invite 😭'],
      ['eric', 'also who left a charger in the meeting room'],
      ['rahul', 'mine! please don’t let it become the office charger'],
    ],
    engineering: [
      ['wolf', 'ios looks good. keyboard isn’t covering the button anymore'],
      ['rahul', 'finally'],
      ['peter', 'did we check landscape too?'],
      ['rahul', '...one sec'],
      ['rahul', 'yep we’re good'],
    ],
    customers: [
      [
        'eric',
        'sent the link. they’re trying it with the rest of the team today',
      ],
      ['wolf', 'nice. did they need help importing anything?'],
      ['eric', 'just their contacts. i’ll walk them through it after lunch'],
      ['peter', 'ask how the first invite went too'],
    ],
    website: [
      ['austin', 'tiny thing: the footer still has the old icon'],
      ['rahul', 'good catch, fixed'],
      ['eric', 'i’m still seeing it'],
      ['rahul', 'hard refresh?'],
      ['eric', 'yep. sorry. classic'],
    ],
    random: [
      ['peter', 'where are we getting lunch'],
      ['austin', 'anything except the salad place'],
      ['wolf', 'noodle place?'],
      ['rahul', 'yes'],
      ['eric', 'can someone grab mine? call until 12:30'],
      ['wolf', 'send me your order'],
    ],
    'dm-teo': [
      ['peter', 'yep. the second paragraph is a bit long'],
      ['rahul', 'cut it or split it?'],
      ['peter', 'cut it. the screenshot already explains most of it'],
      ['rahul', 'done. much better actually'],
      ['peter', 'also you left your charger upstairs'],
      ['rahul', 'i know 😅'],
    ],
    'dm-julia': [
      ['peter', 'left a couple comments. nothing big'],
      ['eric', 'saw them, thanks'],
      ['eric', 'do we still want the quote at the top?'],
      ['peter', 'yeah keep it. just shorten the intro above it'],
      ['eric', 'on it'],
    ],
    'dm-gabriel': [
      ['wolf', 'cool. i’ll send myself one after the change goes out'],
      ['peter', 'thanks. check the reply address too'],
      ['wolf', 'yep'],
      ['wolf', 'btw are you on the customer call tomorrow?'],
      ['peter', 'first 15 mins. then i have to drop'],
      ['wolf', 'works, i can take the rest'],
    ],
    'dm-austin': [
      [
        'austin',
        'can you check the crop on your laptop? looks different on mine',
      ],
      ['peter', 'top is a little tight'],
      ['austin', 'ok gave it more room'],
      ['peter', 'that’s it 👍'],
      ['austin', 'leaving the old export in the folder just in case'],
    ],
  };
  for (const [id, messages] of Object.entries(extraChats)) {
    w.setData(
      'channels',
      (channel) => channel.id === id,
      'messages',
      (existing) => [
        ...existing,
        ...messages.map(
          ([person, body], index): WorkspaceComment => ({
            id: `${id}-extra-${index}`,
            person,
            body,
            time: `11:${String(12 + index * 2).padStart(2, '0')} AM`,
          })
        ),
      ]
    );
  }
  return w;
}
