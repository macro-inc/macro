import type {
  BrainEmailReader,
  BrainEmailScope,
  BrainEmailThreadSummary,
} from './brain-email-reader';

const address = 'finch@example.com';

export const brainEmailFixtureScope: BrainEmailScope = {
  viewer: 'sample-viewer',
  team: 'sample-team',
  agent: 'finch',
};

type FixtureMessage = Readonly<
  BrainEmailThreadSummary & { from: string; text: string }
>;

// Each inbox row represents a distinct synthetic inbound message.
const messages: readonly FixtureMessage[] = [
  {
    id: 'mail-01',
    sender: 'Acme Security Desk',
    from: 'security@example.com',
    subject: 'Q4 vendor security questionnaire follow-up',
    receivedAt: '2026-11-25T16:53:00Z',
    text: `Hello,

We finished reviewing the questionnaire and have two items to close before we can mark it complete.

Could you point us to the current access review procedure and confirm which roles can approve exceptions? A link to the approved policy is enough. Please include the revision date so we can cite the correct version.

We also need the maintenance window for the staging environment. The checklist lists two windows and does not identify which one applies to the current release.

If these belong to separate owners, please forward the owner names so we can update our review notes. We'll keep the remaining checks in the same review and send a single summary after both items are confirmed.

The rest of the questionnaire is complete. Thanks for helping us close the review.`,
  },
  {
    id: 'mail-02',
    sender: 'Design Operations',
    from: 'design@example.com',
    subject: 'Design review agenda for Thursday',
    receivedAt: '2026-11-25T14:18:00Z',
    text: 'The agenda covers navigation, narrow layouts, and keyboard focus. Please bring one example of an unresolved interaction.',
  },
  {
    id: 'mail-03',
    sender: 'Contracts Desk',
    from: 'contracts@example.com',
    subject: 'Updated data processing exhibit',
    receivedAt: '2026-11-25T12:41:00Z',
    text: 'The updated exhibit is ready for review. The changes are confined to the retention and access review sections.',
  },
  {
    id: 'mail-04',
    sender: 'Capacity Planning',
    from: 'capacity@example.com',
    subject: 'November compute usage summary',
    receivedAt: '2026-11-25T10:26:00Z',
    text: 'The monthly report is available. The staging pool stayed within its allocated hours and can retain its current schedule.',
  },
  {
    id: 'mail-05',
    sender: 'Release Engineering',
    from: 'release@example.com',
    subject: 'Staging release candidate verified',
    receivedAt: '2026-11-25T09:09:00Z',
    text: 'The release candidate passed the staging smoke tests. A fresh sign-in and a return visit both restored the selected workspace.',
  },
  {
    id: 'mail-06',
    sender: 'Service Operations',
    from: 'operations@example.com',
    subject: 'Resolved webhook relay latency spike',
    receivedAt: '2026-11-24T17:12:00Z',
    text: 'Relay latency has returned to its normal range. The incident timeline records the backlog and when deliveries caught up.',
  },
  {
    id: 'mail-07',
    sender: 'Launch Desk',
    from: 'launch@example.com',
    subject: 'Pilot launch notes',
    receivedAt: '2026-11-24T15:04:00Z',
    text: 'The launch checklist now includes workspace setup, the welcome materials, and the rollout feedback window.',
  },
  {
    id: 'mail-08',
    sender: 'Software Purchasing',
    from: 'purchasing@example.com',
    subject: 'Design seat renewal reminder',
    receivedAt: '2026-11-24T11:45:00Z',
    text: 'Please confirm the number of active design seats for the renewal. The current allocation is in the purchasing worksheet.',
  },
  {
    id: 'mail-09',
    sender: 'Accessibility Review',
    from: 'accessibility@example.com',
    subject: 'Nightly accessibility audit',
    receivedAt: '2026-11-24T08:30:00Z',
    text: 'The nightly audit found no critical issues. The review still calls for a manual pass with keyboard and touch input.',
  },
  {
    id: 'mail-10',
    sender: 'Documentation Desk',
    from: 'docs@example.com',
    subject: 'Copy edits for the onboarding guide',
    receivedAt: '2026-11-23T16:20:00Z',
    text: 'The proposed edits replace internal terminology and add a short explanation of the workspace invitation step.',
  },
  {
    id: 'mail-11',
    sender: 'Privacy Desk',
    from: 'privacy@example.com',
    subject: 'Quarterly subprocessor list update',
    receivedAt: '2026-11-23T13:00:00Z',
    text: 'The quarterly list has been reviewed. The archived revision remains available for contracts signed before the update.',
  },
  {
    id: 'mail-12',
    sender: 'Design Operations',
    from: 'design@example.com',
    subject: 'Design freeze handoff checkpoint',
    receivedAt: '2026-11-23T10:18:00Z',
    text: 'The handoff packet includes the approved layouts and a list of issues that can be resolved after the freeze.',
  },
  {
    id: 'mail-13',
    sender: 'Acme Security Desk',
    from: 'security@example.com',
    subject: 'Weekly scoped token rotation reminder',
    receivedAt: '2026-11-22T17:33:00Z',
    text: 'This is the scheduled reminder to review temporary tokens. Please record the completed review in the maintenance log.',
  },
  {
    id: 'mail-14',
    sender: 'Design Systems',
    from: 'systems@example.com',
    subject: 'Surface token bundle published',
    receivedAt: '2026-11-22T14:00:00Z',
    text: 'The published bundle includes updated background, divider, and focus tokens. The example surfaces have been refreshed.',
  },
  {
    id: 'mail-15',
    sender: 'Migration Desk',
    from: 'migration@example.com',
    subject: 'Workspace migration checklist',
    receivedAt: '2026-11-22T11:15:00Z',
    text: 'The checklist now includes an archive review and a final comparison of permissions after the move.',
  },
  {
    id: 'mail-16',
    sender: 'Contracts Desk',
    from: 'contracts@example.com',
    subject: 'Annual privacy addendum receipt',
    receivedAt: '2026-11-21T16:50:00Z',
    text: 'We received the updated addendum and recorded the revision in the contracts register.',
  },
  {
    id: 'mail-17',
    sender: 'Interface Quality',
    from: 'quality@example.com',
    subject: 'Desktop viewport regression summary',
    receivedAt: '2026-11-21T13:45:00Z',
    text: 'The regression pass covered the inbox split, horizontal overflow, and layout at increased browser zoom.',
  },
  {
    id: 'mail-18',
    sender: 'Mailbox Operations',
    from: 'mailbox@example.com',
    subject: 'Mailbox routing check completed',
    receivedAt: '2026-11-21T09:25:00Z',
    text: 'The sample routing check is complete. The inbox view shows this message as the earliest entry in the sample.',
  },
];

const summaries: readonly BrainEmailThreadSummary[] = messages.map(
  ({ id, sender, subject, receivedAt }) => ({ id, sender, subject, receivedAt })
);

export function createFixtureBrainEmailReader(): BrainEmailReader {
  const { viewer, team, agent } = brainEmailFixtureScope;
  const allowed = (scope: BrainEmailScope) =>
    scope.viewer === viewer && scope.team === team && scope.agent === agent;

  return {
    async readInbox(scope, signal) {
      if (signal.aborted || !allowed(scope)) return { status: 'unavailable' };

      return {
        status: 'provisioned',
        source: 'fixture',
        address,
        threads: summaries,
      };
    },
    async readThread(scope, id, signal) {
      if (signal.aborted || !allowed(scope)) return;

      const message = messages.find((entry) => entry.id === id);
      if (!message) return;

      return {
        from: message.from,
        to: address,
        messages: [
          {
            id: message.id,
            author: message.sender,
            address: message.from,
            sentAt: message.receivedAt,
            text: message.text,
          },
        ],
      };
    },
  };
}
