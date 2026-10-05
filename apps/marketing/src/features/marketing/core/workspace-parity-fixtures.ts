import type { WorkspaceDocument } from './dummy-workspace';

/** Fictional examples, shaped like the mixed files and sessions in Macro. */
export const sampleAgentSessions = [
  {
    id: 'deploy',
    title: 'Fix the deploy pipeline',
    time: '12m',
    runtime: 'Cursor',
    provider: 'cursor',
    branch: 'cursor/deploy-retries',
    pr: '#482',
    prompt: '',
    answer: '',
  },
  {
    id: 'launch-status',
    title: 'Launch workspace',
    time: '1h',
    runtime: 'Macro',
    provider: 'claude',
    prompt: 'What is left before Thursday’s launch?',
    answer:
      'The announcement and rollout plan are ready for review. The remaining launch tasks are in your task list.',
  },
  {
    id: 'invite-review',
    title: 'Review the team invite flow',
    time: '2h',
    runtime: 'Claude Code',
    provider: 'claude',
    branch: 'claude/team-invites',
    pr: '#481',
    prompt:
      'Review the team invite flow and check that existing members can accept an invitation.',
    answer:
      'Reviewed the invite flow. Existing members now return to their workspace, and new members see the setup steps. The changes are ready for review in PR #481.',
  },
  {
    id: 'customer-summary',
    title: 'Summarize customer conversations',
    time: '3h',
    runtime: 'Macro',
    provider: 'chatgpt',
    prompt: 'Summarize the Meadow conversation and suggest next steps.',
    answer:
      'Dana confirmed the Thursday check-in. Share the team rollout plan, introduce Julia, and confirm the workspace owner before the meeting.',
  },
  {
    id: 'release-notes',
    title: 'Prepare the release notes',
    time: '4h',
    runtime: 'Cursor',
    provider: 'cursor',
    branch: 'cursor/release-notes',
    pr: '#479',
    prompt: 'Draft release notes for the invite and deploy improvements.',
    answer:
      'The release notes cover simpler team invitations and more reliable deploys. I linked the launch checklist and included the verification results. Ready for your review in PR #479.',
  },
] as const;

export function extraWorkspaceDocuments(): WorkspaceDocument[] {
  return [
    {
      id: 'launch-metrics',
      kind: 'spreadsheet',
      title: 'Customers to reach',
      tags: ['Launch'],
      updated: '11:00 AM',
      body: '',
      comments: [],
    },
    {
      id: 'roadmap',
      title: 'Product roadmap — October',
      tags: ['Product'],
      updated: 'Yesterday',
      body: '## October priorities\n\n- Improve team onboarding\n- Bring customer conversations into one inbox\n- Simplify document sharing\n\n## Next up\n\nCalendar availability and customer follow-up.',
      comments: [],
    },
    {
      id: 'engineering-plan',
      title: 'Engineering priorities',
      tags: ['Engineering'],
      updated: 'Yesterday',
      body: '## This week\n\n- [x] Review deploy retries\n- [ ] Verify team invitations\n- [ ] Publish release notes\n\n## Owners\n\nTeo — release checks\nCursor — deploy reliability',
      comments: [],
    },
    {
      id: 'launch-map',
      kind: 'canvas',
      title: 'Launch — implementation map',
      tags: ['Launch'],
      updated: 'Sep 28',
      body: '## Launch map\n\nProduct story → announcement → customer email → team rollout\n\n## Dependencies\n\nThe deploy and invitation checks must pass before sending the announcement.',
      comments: [],
    },
    {
      id: 'customer-notes',
      title: 'Customer research notes',
      tags: ['Customers'],
      updated: 'Sep 28',
      body: '## What teams want\n\nEmail, documents, tasks, and messages in one place.\n\n## The Meadow\n\nStart with a small team, connect work email, and share the rollout plan.',
      comments: [],
    },
    {
      id: 'announcement-draft',
      title: 'Launch announcement draft',
      tags: ['Launch'],
      updated: 'Sep 28',
      body: '## One shared workspace\n\nYour emails, agents, tasks, and messages, together.\n\nJoin us on Thursday for the launch and a walkthrough with the team.',
      comments: [],
    },
    {
      id: 'design-review',
      title: 'Design review notes',
      tags: ['Design'],
      updated: 'Sep 27',
      body: '## Review\n\n- [x] Check desktop navigation\n- [x] Review email replies\n- [ ] Check mobile layouts\n\nValentina will share the final review with the team.',
      comments: [],
    },
    {
      id: 'release-checks',
      kind: 'code',
      title: 'Deploy retry checks.md',
      tags: ['Engineering'],
      updated: 'Sep 27',
      body: '## Deploy retry checks\n\n- [x] Retry transient registry errors\n- [x] Stop after the retry limit\n- [x] Fail immediately for permanent errors\n\nAll 12 checks pass.',
      comments: [],
    },
    {
      id: 'meeting-notes',
      title: 'Monday team sync',
      updated: 'Sep 27',
      body: '## Team sync\n\nJulia has the announcement ready. Teo is checking the invitation flow. Jacob will follow up with the Meadow team.\n\n## Decisions\n\nKeep Thursday’s launch focused on the shared inbox.',
      comments: [],
    },
    {
      id: 'onboarding',
      title: 'Workspace onboarding guide',
      tags: ['Customers'],
      updated: 'Sep 26',
      body: '## Welcome\n\n1. Connect your work email\n2. Invite your team\n3. Share a document\n4. Create your first task\n\nEverything stays together in your workspace.',
      comments: [],
    },
  ];
}
