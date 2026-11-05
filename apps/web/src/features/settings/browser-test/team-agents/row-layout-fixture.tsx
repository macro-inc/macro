import '@fontsource-variable/inter';
import '../../../../index.css';
import { Avatar, Tooltip } from '@ui';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { MemberRowLayout } from '../../components/member-row-layout';
import { TeamAgentRow } from '../../components/team-agent-row';
import { SettingsCard, SettingsPage } from '../../primitives';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';
const noop = () => {};
render(
  () => (
    <SettingsPage title="Members" description="Shared member row alignment">
      <SettingsCard>
        <MemberRowLayout
          kind="human"
          avatar={
            <Avatar size="lg">
              <Avatar.Fallback>M</Avatar.Fallback>
            </Avatar>
          }
          name={
            <Tooltip label="Team member with a long name" class="min-w-0">
              <span class="truncate" data-member-name>
                Team member with a long name
              </span>
            </Tooltip>
          }
          detail={<span>Member</span>}
          status={<span class="text-xs text-ink-muted">—</span>}
          actions={null}
        />
        <TeamAgentRow
          agent={{
            userId: 'agent-1',
            teamId: 'team-1',
            name: 'Assistant with a long name',
            email: 'agent@example.com',
            createdAt: '2026-01-01',
            status: 'running',
            payment: 'paid',
            retryable: false,
          }}
          avatar={
            <Avatar size="lg">
              <Avatar.Fallback>A</Avatar.Fallback>
            </Avatar>
          }
          retrying={false}
          onRetry={noop}
          onRemove={noop}
        />
        <TeamAgentRow
          agent={{
            userId: 'agent-2',
            teamId: 'team-1',
            name: 'Research agent',
            email: 'research@example.com',
            createdAt: '2026-01-01',
            status: 'provisioning',
            payment: 'comped',
            retryable: false,
            setup: { step: 'connecting', position: 4, total: 5 },
          }}
          avatar={
            <Avatar size="lg">
              <Avatar.Fallback>R</Avatar.Fallback>
            </Avatar>
          }
          retrying={false}
          onRetry={noop}
          onRemove={noop}
        />
      </SettingsCard>
    </SettingsPage>
  ),
  document.getElementById('root')!
);
