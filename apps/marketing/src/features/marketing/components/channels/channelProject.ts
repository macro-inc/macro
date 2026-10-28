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
    person: 'julia',
    time: '8:18 AM',
    body: 'morning, doing a last pass on the site',
  },
  {
    id: 'history-images',
    person: 'valentina',
    time: '8:19 AM',
    body: 'new screenshots are in. use the ones from today',
    replyTo: 'history-morning',
  },
  {
    id: 'history-thanks',
    person: 'julia',
    time: '8:20 AM',
    body: 'thank you',
    replyTo: 'history-morning',
  },
  {
    id: 'history-logo',
    person: 'gabriel',
    time: '8:27 AM',
    body: 'anyone else getting the old logo on the preview?',
  },
  {
    id: 'history-refresh',
    person: 'teo',
    time: '8:28 AM',
    body: 'hard refresh. i had the same thing',
    replyTo: 'history-logo',
  },
  {
    id: 'history-fixed',
    person: 'gabriel',
    time: '8:30 AM',
    body: 'yep that did it',
    replyTo: 'history-logo',
  },
  {
    id: 'history-copy',
    person: 'jacob',
    time: '8:41 AM',
    body: 'intro feels a bit long on a phone',
  },
  {
    id: 'history-cut',
    person: 'julia',
    time: '8:43 AM',
    body: 'cutting the second paragraph',
    replyTo: 'history-copy',
  },
  {
    id: 'history-quote',
    person: 'valentina',
    time: '8:45 AM',
    body: 'keep the customer quote though',
    replyTo: 'history-copy',
  },
  {
    id: 'history-keep',
    person: 'jacob',
    time: '8:46 AM',
    body: 'yeah keep that',
    replyTo: 'history-copy',
  },
  {
    id: 'history-links',
    person: 'teo',
    time: '8:54 AM',
    body: 'pricing links are good now. footer next',
  },
  {
    id: 'history-email',
    person: 'gabriel',
    time: '8:57 AM',
    body: 'i’ll check the email that goes out after signup',
    replyTo: 'history-links',
  },
  {
    id: 'history-untested',
    person: 'julia',
    time: '8:58 AM',
    body: 'nice, that’s the one i haven’t tested',
    replyTo: 'history-links',
  },
  {
    id: 'history-export',
    person: 'valentina',
    time: '9:03 AM',
    body: 'last image export is up',
  },
  {
    id: 'history-sharp',
    person: 'jacob',
    time: '9:04 AM',
    body: 'much sharper',
    replyTo: 'history-export',
  },
  {
    id: 'history-finally',
    person: 'valentina',
    time: '9:05 AM',
    body: 'finally 😅',
    replyTo: 'history-export',
  },
];

export const projectMessages: WorkspaceComment[] = [
  ...channelHistory,
  {
    id: 'start',
    person: 'julia',
    time: '9:12 AM',
    body: 'can we ship the site tomorrow?',
  },
  {
    id: 'shared-plan',
    person: 'jacob',
    time: '9:14 AM',
    body: 'copy’s ready. updated @[Homepage copy](demo-mention:plan)',
    documentId: 'plan',
    replyTo: 'start',
  },
  {
    id: 'training',
    person: 'teo',
    time: '9:18 AM',
    body: 'just need to finish @[Check the mobile layout](demo-mention:invite)',
    taskId: 'invite',
  },
  {
    id: 'customer-email',
    person: 'jacob',
    time: '9:19 AM',
    body: 'did you catch the signup button in @[Website feedback](demo-mention:dana)?',
    emailId: 'dana',
    replyTo: 'training',
  },
  {
    id: 'training-reply',
    person: 'teo',
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
    sender: 'Valentina',
    snippet: 'The signup button is still hard to tap on a phone.',
    body: 'Hi Jacob,\n\nThe new homepage looks good on desktop. I checked it on my phone too, and the signup button is still hard to tap.\n\nCan we make it the same height as the other buttons before we publish?\n\nThanks,\nValentina',
    shared: 'launch',
    replies: [
      {
        id: 'website-reply',
        person: 'jacob',
        to: 'Valentina',
        body: 'Agreed. We’ll fix the button before launch. Julia is checking the signup flow too.',
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
        person: 'gabriel',
        body: 'intro reads much better now',
        time: 'Yesterday',
      },
    ],
  });
  w.setData('tasks', (item) => item.id === 'invite', {
    title: CHANNEL_TASK,
    owner: 'teo',
    creator: 'jacob',
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
      person: 'teo',
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
      person: 'julia',
      body: 'what should we work on next week?',
      time: '10:12 AM',
    },
    {
      id: 'p2',
      person: 'teo',
      body: 'search. heard that from a few people this week',
      time: '10:14 AM',
      replyTo: 'p1',
    },
    {
      id: 'p3',
      person: 'jacob',
      body: 'agreed. let’s talk tomorrow',
      time: '10:15 AM',
      replyTo: 'p1',
    },
  ]);
  w.setData('channels', (channel) => channel.id === 'design', 'messages', [
    {
      id: 'd1',
      person: 'valentina',
      body: 'new icons are ready 👀',
      time: '11:02 AM',
    },
    {
      id: 'd2',
      person: 'julia',
      body: 'love these',
      time: '11:04 AM',
      replyTo: 'd1',
    },
  ]);
  w.setData('channels', (channel) => channel.id === 'dm-julia', 'messages', [
    {
      id: 'j1',
      person: 'julia',
      body: 'can you look at the intro in @[Homepage copy](demo-mention:plan)?',
      time: '9:18 AM',
      documentId: 'plan',
    },
    { id: 'j2', person: 'jacob', body: 'yep, looking now', time: '9:20 AM' },
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
        person: 'julia',
        body: 'i’ll check signup again once the button fix is in',
        time: '10:02 AM',
      },
    ],
    body: 'Final checks for tomorrow’s website launch. Update this as each part is signed off.\n\n## Before we publish\n\n- [x] Homepage copy reviewed\n- [x] New images exported\n- [ ] Mobile layout checked\n- [ ] Signup and confirmation email tested\n\n## Owners\n\nTeo is checking mobile. Julia is handling signup. Jacob will publish once both are ready.\n\n## After launch\n\nCheck the first signups and confirm the welcome email arrives.',
  });
  w.setData('channels', (channel) => channel.id === 'launch', 'messages', [
    ...structuredClone(channelHistory),
    {
      id: 'last-pass',
      person: 'julia',
      time: '9:40 AM',
      body: 'copy is done. mobile and signup left',
    },
    {
      id: 'last-pass-reply',
      person: 'teo',
      time: '9:41 AM',
      body: 'looking now',
      replyTo: 'last-pass',
    },
    {
      id: 'confirmation',
      person: 'gabriel',
      time: '9:49 AM',
      body: 'confirmation email is landing. subject line still needs checking',
    },
    {
      id: 'confirmation-reply',
      person: 'jacob',
      time: '9:50 AM',
      body: 'keep it short pls',
      replyTo: 'confirmation',
    },
    {
      id: 'shared-plan',
      person: 'julia',
      body: 'added the last few things to @[Launch checklist](demo-mention:plan)',
      documentId: 'plan',
      time: '10:02 AM',
    },
    {
      id: 'welcome',
      person: 'jacob',
      body: 'can you check the signup note in @[Website feedback](demo-mention:dana)?',
      emailId: 'dana',
      time: '10:05 AM',
    },
    {
      id: 'opened',
      person: 'teo',
      body: 'working through @[Check the mobile layout](demo-mention:invite). signup is next',
      taskId: 'invite',
      time: '10:06 AM',
    },
    {
      id: 'phone-check',
      person: 'julia',
      time: '10:08 AM',
      body: 'i’ll do one more signup on my phone',
    },
    {
      id: 'phone-check-reply',
      person: 'teo',
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
          person: 'julia',
          time: '9:02 AM',
          body: 'quick reminder: team sync at 11',
        },
        {
          id: 'general-reply',
          person: 'teo',
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
          person: 'teo',
          time: '9:22 AM',
          body: 'mobile fix is ready. checking android now',
        },
        {
          id: 'engineering-ios',
          person: 'gabriel',
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
          person: 'gabriel',
          time: '9:30 AM',
          body: 'a few people asked for the signup link',
        },
        {
          id: 'customers-send',
          person: 'julia',
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
          person: 'julia',
          time: '9:35 AM',
          body: 'screenshots and copy are ready',
        },
        {
          id: 'website-export',
          person: 'valentina',
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
          person: 'valentina',
          time: '10:02 AM',
          body: 'coffee?',
        },
        {
          id: 'random-reply',
          person: 'gabriel',
          time: '10:03 AM',
          body: 'always',
          replyTo: 'random-coffee',
        },
      ],
    },
    {
      id: 'dm-gabriel',
      person: 'gabriel',
      messages: [
        {
          id: 'gabriel-email',
          person: 'gabriel',
          time: '9:37 AM',
          body: 'welcome email looks good. did you check it on mobile?',
        },
        {
          id: 'gabriel-reply',
          person: 'jacob',
          time: '9:38 AM',
          body: 'yep, one more pass before we publish',
        },
      ],
    },
    {
      id: 'dm-valentina',
      person: 'valentina',
      messages: [
        {
          id: 'valentina-images',
          person: 'valentina',
          time: '9:40 AM',
          body: 'new images are in. refreshed the ones in @[Homepage copy](demo-mention:plan)',
          documentId: 'plan',
        },
        {
          id: 'valentina-reply',
          person: 'jacob',
          time: '9:41 AM',
          body: 'looks much sharper, thanks',
        },
      ],
    },
  ]);
  const extraChats: Record<string, [WorkspaceComment['person'], string][]> = {
    launch: [
      [
        'gabriel',
        'anyone got the final link? i have about six preview tabs open',
      ],
      ['julia', 'same one as this morning'],
      ['gabriel', 'found it. closing the other five for my own sanity'],
      ['teo', 'mobile check is done btw'],
    ],
    product: [
      ['gabriel', 'two people asked if search can remember the last filter'],
      ['julia', 'i keep expecting that too'],
      ['teo', 'can do. should it reset when you switch projects?'],
      [
        'jacob',
        'yeah probably. otherwise i’ll forget why nothing is showing up',
      ],
      ['julia', 'put it on the list for tomorrow'],
    ],
    design: [
      ['teo', 'which folder has the small versions?'],
      ['valentina', 'exports / 24. ignore the folder called final lol'],
      ['teo', 'very reassuring'],
      ['valentina', 'there is also final2. do not go in there'],
      ['julia', 'the new search icon is much clearer'],
    ],
    general: [
      ['jacob', 'running 5 late, start without me'],
      ['gabriel', 'we’re still finding the call link so you’re fine'],
      ['valentina', 'it’s in the calendar invite 😭'],
      ['julia', 'also who left a charger in the meeting room'],
      ['teo', 'mine! please don’t let it become the office charger'],
    ],
    engineering: [
      ['gabriel', 'ios looks good. keyboard isn’t covering the button anymore'],
      ['teo', 'finally'],
      ['jacob', 'did we check landscape too?'],
      ['teo', '...one sec'],
      ['teo', 'yep we’re good'],
    ],
    customers: [
      [
        'julia',
        'sent the link. they’re trying it with the rest of the team today',
      ],
      ['gabriel', 'nice. did they need help importing anything?'],
      ['julia', 'just their contacts. i’ll walk them through it after lunch'],
      ['jacob', 'ask how the first invite went too'],
    ],
    website: [
      ['valentina', 'tiny thing: the footer still has the old icon'],
      ['teo', 'good catch, fixed'],
      ['julia', 'i’m still seeing it'],
      ['teo', 'hard refresh?'],
      ['julia', 'yep. sorry. classic'],
    ],
    random: [
      ['jacob', 'where are we getting lunch'],
      ['valentina', 'anything except the salad place'],
      ['gabriel', 'noodle place?'],
      ['teo', 'yes'],
      ['julia', 'can someone grab mine? call until 12:30'],
      ['gabriel', 'send me your order'],
    ],
    'dm-teo': [
      ['jacob', 'yep. the second paragraph is a bit long'],
      ['teo', 'cut it or split it?'],
      ['jacob', 'cut it. the screenshot already explains most of it'],
      ['teo', 'done. much better actually'],
      ['jacob', 'also you left your charger upstairs'],
      ['teo', 'i know 😅'],
    ],
    'dm-julia': [
      ['jacob', 'left a couple comments. nothing big'],
      ['julia', 'saw them, thanks'],
      ['julia', 'do we still want the quote at the top?'],
      ['jacob', 'yeah keep it. just shorten the intro above it'],
      ['julia', 'on it'],
    ],
    'dm-gabriel': [
      ['gabriel', 'cool. i’ll send myself one after the change goes out'],
      ['jacob', 'thanks. check the reply address too'],
      ['gabriel', 'yep'],
      ['gabriel', 'btw are you on the customer call tomorrow?'],
      ['jacob', 'first 15 mins. then i have to drop'],
      ['gabriel', 'works, i can take the rest'],
    ],
    'dm-valentina': [
      [
        'valentina',
        'can you check the crop on your laptop? looks different on mine',
      ],
      ['jacob', 'top is a little tight'],
      ['valentina', 'ok gave it more room'],
      ['jacob', 'that’s it 👍'],
      ['valentina', 'leaving the old export in the folder just in case'],
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
