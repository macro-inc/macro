import type { CompanyFile } from '../../core/workspace-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import type { SampleCall } from '../calls/call-fixtures';
import type { DemoPullRequest } from '../reviews/review-fixtures';

export const followupIds = {
  company: 'meadow',
  email: 'followup-email',
  file: 'followup-guide',
  task: 'followup-check',
  chat: 'customer-followup',
  call: 'followup-call',
} as const;
export const followupPrompt =
  'Open Parlor Studio’s record and review the linked customer work. Draft a reply to Ava about Thursday’s demo and tell me what we need to do next. Don’t send it.';
export const followupDraft = {
  subject: 'Re: Thursday demo',
  to: 'Ava Chen <ava@parlorstudio.example>',
  cc: 'Julia <julia@macro.com>',
  body: 'Hi Ava,\n\nThursday at 9 works. The folder-upload fix has merged, and Teo is checking the production release. I’ll confirm once it’s ready to try.\n\nJulia can help with setup. Could you send her the names of the people joining?\n\nSee you Thursday,\nJacob',
};
export const followupPr: DemoPullRequest = {
  id: 'followup-pr',
  title: 'Fix folder uploads',
  repo: 'team/workspace',
  number: 248,
  status: 'merged',
  author: 'teo',
  login: 'teo',
  additions: 24,
  deletions: 8,
  checksPassed: 6,
  description:
    '## What changed\n\nFolder uploads now preserve nested folders. This addresses the issue reported in the customer demo.\n\n## Release\n\nThe change is merged. Production verification is still assigned to Teo; do not promise that it is available until that check is complete.',
  comments: [],
};
export const followupCall: SampleCall = {
  title: 'Thursday demo prep',
  ended: 'Oct 19, 2026 · 9:20 AM',
  duration: 420,
  people: ['jacob', 'julia', 'teo'],
  participantEmails: {
    jacob: 'jacob@macro.com',
    julia: 'julia@macro.com',
    teo: 'teo@macro.com',
  },
  poster: [
    { person: 'jacob', video: false },
    { person: 'julia', video: false },
    { person: 'teo', video: false },
  ],
  summary:
    '- Thursday’s customer demo is at 9.\n- Julia will help with setup and needs the attendee names.\n- Teo must verify the folder-upload fix in production before Jacob confirms it is ready.',
  segments: [
    {
      id: 'time',
      person: 'jacob',
      at: 12,
      text: 'Ava confirmed Thursday at 9. She asked if the folder-upload issue is fixed.',
    },
    {
      id: 'release',
      person: 'teo',
      at: 45,
      text: 'The pull request is merged. I still need to verify it in production before we tell her it’s ready.',
    },
    {
      id: 'setup',
      person: 'julia',
      at: 80,
      text: 'I can help with setup. Ask Ava for the names of the people joining, and send her the setup guide.',
    },
  ],
};

/** Local evidence is consistent across the company, sources, and drafted reply. */
export function seedCrmFollowup(w: DummyWorkspace) {
  w.setData('emails', (emails) => [
    ...emails,
    {
      id: followupIds.email,
      sender: 'Ava Chen',
      subject: 'Thursday demo',
      snippet: 'Thursday at 9 works. Is the folder-upload issue fixed?',
      time: '9:35 AM',
      account: 'work',
      folder: 'inbox',
      unread: true,
      body: 'Hi Jacob,\n\nThursday at 9 works. Is the folder-upload issue fixed? Could you send the setup guide and let us know what you need before the demo?\n\nThanks,\nAva',
      replies: [],
    },
    {
      id: 'followup-attendees',
      sender: 'Ava Chen',
      subject: 'Who is joining on Thursday',
      snippet: 'Three people from our design team will join.',
      time: 'Yesterday',
      account: 'work',
      folder: 'inbox',
      unread: false,
      body: 'Hi Julia, three people from our design team will join on Thursday. I will send their names once everyone confirms.',
      replies: [],
    },
    {
      id: 'followup-upload-report',
      sender: 'Ava Chen',
      subject: 'Folder upload issue',
      snippet: 'Nested folders are missing after upload.',
      time: 'Mon',
      account: 'work',
      folder: 'inbox',
      unread: false,
      body: 'Hi Jacob, we tried uploading a sample project. The top-level files appear, but the nested folders are missing. Can your team take a look?',
      replies: [],
    },
    {
      id: 'followup-intro',
      sender: 'Jacob',
      subject: 'Getting started with Macro',
      snippet: 'A short walkthrough for your team.',
      time: 'Fri',
      account: 'work',
      folder: 'inbox',
      unread: false,
      body: 'Hi Ava, happy to walk your team through shared files and email. Bring a sample project and we can try it together.',
      replies: [],
    },
  ]);
  w.setData('documents', (docs) => [
    ...docs,
    {
      id: followupIds.file,
      title: 'Setup guide',
      body: '# Before the demo\n\n1. Connect your work email.\n2. Send Julia the names of the people joining.\n3. Bring a sample folder to try after the upload fix is verified.\n\nJulia will help with setup on Thursday at 9.',
      comments: [],
    },
  ]);
  w.setData('documents', (docs) => [
    ...docs,
    {
      id: 'followup-agenda',
      title: 'Thursday demo agenda',
      body: '# Thursday demo\n\n## Plan\n- Connect the team’s work email.\n- Share a customer thread.\n- Try a sample project folder after Teo confirms the fix.\n\n## Attendees\nAva is confirming three people from the design team.',
      comments: [],
    },
    {
      id: 'followup-notes',
      title: 'Customer discovery notes',
      body: '# Discovery notes\n\nThe team shares project files and customer feedback across email. They want one place to find the latest conversation and the right version of each file.\n\n## Next step\nUse a real project in Thursday’s walkthrough.',
      comments: [],
    },
  ]);
  w.setData('tasks', (tasks) => [
    ...tasks,
    {
      id: followupIds.task,
      title: 'Verify folder uploads in production',
      description:
        'Check that nested folders upload correctly in production after PR #248. Tell Jacob when the fix is ready so he can confirm with Ava before Thursday’s demo.',
      status: 'In Progress',
      priority: 'High',
      owner: 'teo',
      creator: 'jacob',
      tags: [],
      channel: followupIds.chat,
      relatedDocumentIds: [followupIds.file],
      steps: [],
      comments: [],
    },
  ]);
  w.setData('tasks', (tasks) => [
    ...tasks,
    {
      id: 'followup-attendees-task',
      title: 'Confirm Thursday’s attendees',
      description:
        'Ask Ava for the three attendee names and send the calendar invite.',
      status: 'Not Started',
      priority: 'Medium',
      owner: 'julia',
      creator: 'jacob',
      tags: [],
      channel: followupIds.chat,
      steps: [],
      comments: [],
    },
    {
      id: 'followup-agenda-task',
      title: 'Prepare the demo project',
      description:
        'Pick a small project with nested folders for the walkthrough.',
      status: 'In Progress',
      priority: 'Medium',
      owner: 'jacob',
      creator: 'jacob',
      tags: [],
      channel: followupIds.chat,
      steps: [],
      comments: [],
    },
    {
      id: 'followup-repro-task',
      title: 'Reproduce the folder upload issue',
      description:
        'Confirmed that nested folders were missing. Fix merged in PR #248; production verification is tracked separately.',
      status: 'Completed',
      priority: 'High',
      owner: 'teo',
      creator: 'jacob',
      tags: [],
      channel: followupIds.chat,
      steps: [],
      comments: [],
    },
  ]);
  w.setData('channels', (channels) => [
    ...channels,
    {
      id: followupIds.chat,
      messages: [
        {
          id: 'followup-chat-1',
          person: 'jacob',
          body: 'Ava asked if folder uploads will be ready for Thursday. Can we confirm?',
          time: '9:25 AM',
        },
        {
          id: 'followup-chat-2',
          person: 'teo',
          body: 'PR #248 is merged. I’m checking the production release now. Please wait for that check before promising it is ready.',
          time: '9:27 AM',
        },
        {
          id: 'followup-chat-3',
          person: 'julia',
          body: 'I can help with setup at 9. Please ask Ava for the attendee names and send the setup guide.',
          time: '9:30 AM',
        },
      ],
    },
  ]);
  w.setData('companies', (c) => c.id === followupIds.company, {
    description:
      'A design studio trying Macro for shared files and team communication.',
    lastInteracted: 'today',
    updated: '9:40 AM',
    contacts: [{ name: 'Ava Chen', email: 'ava@parlorstudio.example' }],
    emailIds: [
      followupIds.email,
      'followup-attendees',
      'followup-upload-report',
      'followup-intro',
    ],
    emails: [],
    files: w.data.documents
      .filter((doc) =>
        [followupIds.file, 'followup-agenda', 'followup-notes'].includes(doc.id)
      )
      .map(
        (doc): CompanyFile => ({
          id: doc.id,
          title: doc.title,
          kind: 'document',
          time: doc.id === followupIds.file ? 'Today' : 'Yesterday',
          documentId: doc.id,
        })
      ),
    tasks: w.data.tasks
      .filter((task) =>
        [
          followupIds.task,
          'followup-attendees-task',
          'followup-agenda-task',
          'followup-repro-task',
        ].includes(task.id)
      )
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        owner: task.owner,
      })),
    calls: [
      {
        id: followupIds.call,
        title: followupCall.title,
        time: 'Yesterday',
        duration: '7m',
        people: ['jacob', 'julia', 'teo'],
        guests: [],
      },
    ],
    comments: [
      {
        id: 'followup-note',
        person: 'jacob',
        body: 'Ava wants to try folder uploads at Thursday’s demo. Check the release with Teo before confirming. Julia is helping with setup.',
        time: '9:40 AM',
      },
    ],
  });
  w.setCompanyLayout('List');
  w.setQuery('Parlor Studio');
}
