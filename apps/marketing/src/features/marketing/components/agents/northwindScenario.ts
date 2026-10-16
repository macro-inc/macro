import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import type { SampleCall } from '../calls/call-fixtures';

export const NORTHWIND_PROMPT =
  'Are we ready for Northwind’s Friday rollout? Update the plan and assign anything missing.';
export const NORTHWIND_OLD_PLAN =
  '## Friday rollout\n\nLaunch for all 20 operations staff on Friday, October 9. Use password sign-in.\n\n## Training\n\nJacob prepares one training session for 20 people.\n\n## Before launch\n\nConfirm the participant list and send invitations.';
export const NORTHWIND_PLAN =
  '## Friday pilot\n\nStart with 10 operations staff on Friday, October 9. The remaining 30 join on Monday, October 12.\n\n## Access\n\nEveryone uses SSO. Teo verifies sign-in before the Friday pilot can start.\n\n## Training\n\nJulia prepares two sessions for the 40-person group.\n\n## Launch checks\n\nSSO verification is still open. Confirm access before sending invitations.';
export const NORTHWIND_COLLAB_PLAN = NORTHWIND_PLAN.replace(
  'SSO verification is still open. Confirm access before sending invitations.',
  '- [ ] Teo verifies SSO before the pilot.\n- [ ] Julia confirms both training sessions.\n- [ ] Send invitations after access is confirmed.'
);
export const NORTHWIND_HUMAN_NOTE =
  '\n\n## Customer coordination\n\nMarcus will send the names of the 10 pilot participants today.';
export const NORTHWIND_CALL: SampleCall = {
  title: 'Northwind rollout decision',
  ended: 'Oct 8, 2026 · 9:15 AM',
  duration: 180,
  people: ['jacob', 'teo', 'julia'],
  summary:
    '- Keep Friday for a 10-person pilot; the other 30 join Monday.\n- SSO must be verified before anyone joins. Teo owns that check.\n- Julia prepares two training sessions for the 40-person group.',
  poster: [
    { person: 'jacob', video: false },
    { person: 'teo', video: false },
    { person: 'julia', video: false },
  ],
  segments: [
    {
      id: 'scope',
      person: 'jacob',
      at: 8,
      text: 'Marcus now needs 40 seats and SSO. Let’s keep Friday for 10 people, with the other 30 joining Monday.',
    },
    {
      id: 'access',
      person: 'teo',
      at: 35,
      text: 'I’ll verify SSO before the pilot. We should not send invitations until that check passes.',
    },
    {
      id: 'training',
      person: 'julia',
      at: 62,
      text: 'I’ll take training from Jacob and split it into two sessions for the full group.',
    },
    {
      id: 'plan',
      person: 'jacob',
      at: 94,
      text: 'The plan and tasks still say 20 people on Friday. They need to reflect this decision.',
    },
  ],
};

/** This request changes the plan, not the real-world status of the SSO check. */
export function updateNorthwindPlan(w: DummyWorkspace) {
  w.setData(
    'documents',
    (d) => d.id === 'northwind-plan',
    'body',
    NORTHWIND_PLAN
  );
}
export function updateNorthwindTraining(w: DummyWorkspace) {
  w.setData('tasks', (t) => t.id === 'northwind-training', {
    title: 'Prepare Northwind training for 40 people',
    description:
      'Prepare two training sessions for 40 people: the 10-person Friday pilot, then the other 30 on Monday.',
    owner: 'julia',
    priority: 'High',
  });
}
export function createNorthwindAccessTask(w: DummyWorkspace) {
  if (w.data.tasks.some((t) => t.id === 'northwind-sso')) return;
  w.setData('tasks', (tasks) => [
    ...tasks,
    {
      id: 'northwind-sso',
      title: 'Verify Northwind SSO before the pilot',
      description:
        'Verify SSO for the 10-person Friday pilot. Confirm access before invitations go out; the remaining 30 join Monday.',
      status: 'Not Started',
      priority: 'Urgent',
      owner: 'teo',
      creator: 'jacob',
      tags: ['Customers'],
      channel: 'customers',
      relatedDocumentIds: ['northwind-plan'],
      steps: [
        {
          id: 'verify-signin',
          text: 'Verify sign-in for the pilot group',
          done: false,
        },
        {
          id: 'confirm-access',
          text: 'Confirm access before invitations go out',
          done: false,
        },
      ],
      comments: [],
    },
  ]);
}

/** Seed on first open only; reopening must preserve the visitor's edits. */
export function seedNorthwind(w: DummyWorkspace, completed = true) {
  if (w.data.documents.some((d) => d.id === 'northwind-plan')) return;
  w.setData('documents', (docs) => [
    ...docs,
    {
      id: 'northwind-plan',
      title: 'Northwind rollout plan',
      body: NORTHWIND_OLD_PLAN,
      tags: ['Customers'],
      comments: [],
    },
  ]);
  w.setData('tasks', (tasks) => [
    ...tasks,
    {
      id: 'northwind-training',
      title: 'Prepare Northwind training for 20 people',
      description:
        'Prepare one training session for all 20 operations staff joining on Friday.',
      status: 'Not Started',
      priority: 'Medium',
      owner: 'jacob',
      creator: 'jacob',
      tags: ['Customers'],
      channel: 'customers',
      relatedDocumentIds: ['northwind-plan'],
      steps: [],
      comments: [],
    },
  ]);
  w.setData('emails', (emails) => [
    ...emails,
    {
      id: 'northwind-email',
      sender: 'Marcus <marcus@northwind.example>',
      subject: 'Northwind rollout requirements',
      snippet:
        'We need 40 seats, and everyone must use single sign-on (SSO) before joining.',
      body: 'Hi Jacob,\n\nThe operations group has grown to 40 people. Everyone must use SSO before joining. We will need two training sessions for the full group.\n\nCan you confirm how this changes Friday’s rollout?\n\nMarcus',
      time: 'Wednesday',
      account: 'work',
      folder: 'inbox',
      replies: [],
    },
  ]);
  w.setData(
    'channels',
    (c) => c.id === 'customers',
    'messages',
    (messages) => [
      ...messages,
      {
        id: 'northwind-decision',
        person: 'jacob' as const,
        time: 'Thursday',
        body: 'Northwind now needs 40 seats and SSO. We agreed on a 10-person Friday pilot, with the other 30 joining Monday. Teo owns the access check; Julia takes training. The plan and tasks need updating.',
        emailId: 'northwind-email',
        documentId: 'northwind-plan',
        taskId: 'northwind-training',
      },
    ]
  );
  if (completed) {
    updateNorthwindPlan(w);
    updateNorthwindTraining(w);
    createNorthwindAccessTask(w);
  }
}
