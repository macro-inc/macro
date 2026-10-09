import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';

/** Fictional content based on observed workflows, never private customer records. */
export const FEEDBACK_BRIEF = 'feedback-brief';
export const MEETING_BRIEF = 'meeting-brief';
export const WORKFLOW_DOCUMENTS = [
  {
    id: FEEDBACK_BRIEF,
    title: 'Client file upload feedback',
    body: '## Next release\n\n- Upload recovery: keep selected files after an error.\n- Reviewer visibility: show who owns the next step.\n\nSize guidance is already in progress. Guest uploads still need an access decision.',
  },
  {
    id: 'portal-testing',
    title: 'File upload testing notes',
    body: '## File uploads\n\nSelecting multiple files works. If the connection drops, the selected files disappear. Reproduced twice on mobile.\n\n## Review\n\nClients cannot tell who owns the next step after uploading a file.\n\n## Existing work\n\nThe upload-help task already covers file size guidance.',
  },
  {
    id: 'support-notes',
    title: 'Customer support discussion',
    body: '## Beacon Studio\n\nThe upload failed halfway through and we had to select all the files again. Could we also see who is reviewing them?\n\n## Westlake Design\n\nWho should our clients contact after sending files? It would help to see the reviewer. Can someone send a file without creating an account?',
  },
  {
    id: MEETING_BRIEF,
    title: 'Friday meeting brief',
    body: '## 9:30 AM · Beacon Studio\n\nDecision: agree on the first trial for client file uploads.\n\nWhat changed: Tuesday’s call focused on 8 internal reviewers. Yesterday’s email adds 12 external clients who need to upload files without accounts.\n\nOpen question: guest uploads are not yet part of the agreed scope. Confirm the access rules before promising a launch date.\n\nAsk: should clients only upload, or also see the review discussion?\n\n## 11:00 AM · Westlake Design\n\nDecision: choose who owns client feedback.\n\nThey asked about reviewer visibility in customer-support. Bring the consolidated file upload feedback brief; their request is already included.',
  },
  {
    id: 'beacon-call',
    title: 'Beacon discovery call',
    body: '## Tuesday · Discovery call\n\nBeacon wants 8 people to review files from clients. Julia will demonstrate file uploads on Friday at 9:30 AM.\n\nThe initial scope assumes clients already have accounts. Guest uploads were not discussed.\n\n## Next step\n\nConfirm the pilot participants and access requirements.',
  },
];
export function seedAgentWorkflows(w: DummyWorkspace) {
  for (const doc of WORKFLOW_DOCUMENTS) {
    if (!w.data.documents.some((d) => d.id === doc.id))
      w.setData('documents', (all) => [
        ...all,
        { ...doc, tags: ['Customers'], comments: [] },
      ]);
  }
  if (!w.data.emails.some((e) => e.id === 'beacon-email'))
    w.setData('emails', (all) => [
      ...all,
      {
        id: 'beacon-email',
        sender: 'Dana <dana@beacon.example>',
        subject: 'One more thing before Friday',
        snippet: 'Can our 12 clients upload without accounts?',
        body: 'Hi Julia,\n\nWe talked about our 8 internal reviewers on Tuesday. We also need 12 clients to send us files without creating accounts. Can we include that in the trial?\n\nLet’s discuss on Friday.\nDana',
        time: 'Thursday',
        account: 'work',
        folder: 'inbox',
        replies: [],
      },
    ]);
  if (!w.data.channels.some((c) => c.id === 'product-feedback'))
    w.setData('channels', (all) => [
      { id: 'product-feedback', messages: [] },
      ...all,
    ]);
  if (!w.data.channels.some((c) => c.id === 'customer-support'))
    w.setData('channels', (all) => [
      ...all,
      {
        id: 'customer-support',
        messages: [
          {
            id: 'beacon-feedback',
            person: 'julia',
            time: 'Yesterday',
            body: 'Beacon’s upload failed halfway through. They had to select all the files again. They also asked who is reviewing each file.',
          },
          {
            id: 'westlake-feedback',
            person: 'valentina',
            time: 'Yesterday',
            body: 'Westlake asked the same thing about reviewer visibility. They also want clients to send files without creating an account.',
          },
        ],
      },
    ]);
  if (!w.data.tasks.some((t) => t.id === 'upload-help'))
    w.setData('tasks', (all) => [
      ...all,
      {
        id: 'upload-help',
        title: 'Add upload size guidance',
        description:
          'Show the maximum file size before a client selects files. This already covers the size-guidance request in file upload testing.',
        status: 'In Progress',
        priority: 'Medium',
        owner: 'teo',
        creator: 'jacob',
        tags: ['Customers'],
        channel: 'customer-support',
        relatedDocumentIds: ['portal-testing'],
        steps: [],
        comments: [],
      },
    ]);
  if (!w.data.events.some((e) => e.id === 'beacon-meeting'))
    w.setData('events', (all) => [
      ...all,
      {
        id: 'beacon-meeting',
        title: 'Beacon Studio · File uploads',
        date: '2026-10-09',
        start: 9.5,
        duration: 0.5,
        calendar: 'work',
        description:
          'Agree on the first trial for client file uploads with Dana. Julia hosts.',
      },
      {
        id: 'westlake-meeting',
        title: 'Westlake Design · Client feedback',
        date: '2026-10-09',
        start: 11,
        duration: 0.5,
        calendar: 'work',
        description: 'Choose who owns client feedback.',
      },
    ]);
}
