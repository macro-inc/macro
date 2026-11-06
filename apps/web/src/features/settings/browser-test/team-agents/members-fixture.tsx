import LinkIcon from '@icon/system/regular/link.svg';
import type { TeamAgent } from '@service-auth/generated/schemas';
import { Avatar, Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { MemberInviteActions } from '../../components/member-invite-actions';
import { TeamAgentRow } from '../../components/team-agent-row';
import { SettingsCard, SettingsPage, SettingsSection } from '../../primitives';

export function MembersFixture() {
  const unhealthy = new URLSearchParams(location.search).has('unhealthy');
  const [health, setHealth] = createSignal<TeamAgent['status']>('unhealthy');
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
      get status() {
        return unhealthy ? health() : 'running';
      },
      get statusReason() {
        return unhealthy && health() === 'unhealthy'
          ? 'Brain connection unavailable'
          : null;
      },
      payment: 'paid',
      retryable: unhealthy,
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
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => setAction('copy')}>
            <LinkIcon class="size-4" />
            Copy invite link
          </Button>
          <MemberInviteActions
            canInvitePeople
            canInviteAgents
            onInvitePerson={() => setAction('person')}
            onInviteAgent={() => setAction('agent')}
          />
        </div>
      }
    >
      {unhealthy && (
        <button type="button" onClick={() => setHealth('running')}>
          Restore agent health
        </button>
      )}
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
