import type { TeamAgent } from '@service-auth/generated/schemas';
import { Avatar } from '@ui';
import { createSignal, For } from 'solid-js';
import { MemberInviteActions } from '../../components/member-invite-actions';
import { TeamAgentRow } from '../../components/team-agent-row';
import { SettingsCard, SettingsPage, SettingsSection } from '../../primitives';

export function MembersFixture() {
  const [action, setAction] = createSignal('');
  const [retries, setRetries] = createSignal(0);
  const [removals, setRemovals] = createSignal(0);
  const agents: TeamAgent[] = [
    {
      userId: 'agent-1',
      teamId: 'team-1',
      name: 'Assistant',
      email: 'agent@example.com',
      createdAt: '2026-01-01',
      status: 'running',
      payment: 'paid',
      retryable: false,
      lastTurnAt: '2026-01-01T12:00:00Z',
    },
    {
      userId: 'agent-2',
      teamId: 'team-1',
      name: 'Research agent',
      email: 'research@example.com',
      createdAt: '2026-01-01',
      status: 'provisioning',
      payment: 'paid',
      retryable: false,
      setup: { step: 'creating', position: 2, total: 5 },
    },
    {
      userId: 'agent-3',
      teamId: 'team-1',
      name: 'Included agent',
      email: 'included@example.com',
      createdAt: '2026-01-01',
      status: 'failed',
      payment: 'comped',
      retryable: true,
      statusReason: 'Computer disconnected',
    },
  ];
  return (
    <SettingsPage
      title="Members"
      description="Invite people and agents to your team."
      actions={
        <MemberInviteActions
          canInvitePeople
          canInviteAgents
          onInvitePerson={() => setAction('person')}
          onInviteAgent={() => setAction('agent')}
        />
      }
    >
      <SettingsSection title="Team members" description="3 agents">
        <SettingsCard>
          <For each={agents}>
            {(agent) => (
              <TeamAgentRow
                avatar={
                  <Avatar size="lg">
                    <Avatar.Fallback>{agent.name[0]}</Avatar.Fallback>
                  </Avatar>
                }
                agent={agent}
                retrying={false}
                onRetry={() => setRetries((n) => n + 1)}
                onRemove={() => setRemovals((n) => n + 1)}
              />
            )}
          </For>
        </SettingsCard>
      </SettingsSection>
      <p role="status">
        Invitation: {action()} · Retries: {retries()} · Removals: {removals()}
      </p>
    </SettingsPage>
  );
}
