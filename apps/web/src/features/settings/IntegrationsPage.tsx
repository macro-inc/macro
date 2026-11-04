import { SlackImport } from '@app/features/slack-import/slack-import';
import { ENABLE_EMAIL } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import GearIcon from '@icon/system/regular/gear.svg';
import { useUserTeamsQuery } from '@queries/team/teams';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { IntegrationsView } from './connections/integrations-view';
import { EmailCard } from './Email';
import { GitHubCard } from './GitHub';
import { GranolaCard } from './Granola';
import { Harness } from './Harness';
import { IntegrationsSection } from './Integrations';
import { IntegrationGroup } from './integration-ui';
import { SettingsPage } from './primitives';
import { useTeamViewer } from './Team';

/** Personal accounts, team imports and agent tools share one Integrations settings page. */
export function IntegrationsPage() {
  const pipedreamMcp = usePipedreamMcpFlag();
  const isTabAvailable = useSettingsTabAvailable();
  const { openSettings } = useSettingsState();
  const [showLocalAgents, setShowLocalAgents] = createSignal(false);
  return (
    <Show
      when={pipedreamMcp()}
      fallback={
        <SettingsPage title="Integrations" bodyClass="mt-6 gap-8">
          <AccountConnections />
          <Suspense>
            <IntegrationsSection />
          </Suspense>
        </SettingsPage>
      }
    >
      <Show
        when={showLocalAgents() && isTabAvailable('Harness')}
        fallback={
          <IntegrationsView
            onOpenEmailSettings={() => openSettings('Email')}
            onOpenMacroMcp={() => openSettings('Agent')}
            onOpenLocalAgents={
              isTabAvailable('Harness')
                ? () => setShowLocalAgents(true)
                : undefined
            }
          />
        }
      >
        <Harness
          onBack={() => setShowLocalAgents(false)}
          backLabel="Integrations"
        />
      </Show>
    </Show>
  );
}

function AccountConnections() {
  const { openSettings } = useSettingsState();
  return (
    <>
      <Show when={ENABLE_EMAIL}>
        <IntegrationGroup
          title="Email"
          actions={
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="Email settings"
              tooltip="Email settings"
              onClick={() => openSettings('Email')}
              class="touch:min-h-11 touch:min-w-11"
            >
              <GearIcon class="size-4" />
            </Button>
          }
        >
          <Suspense>
            <EmailCard />
          </Suspense>
        </IntegrationGroup>
      </Show>
      <IntegrationGroup title="Accounts">
        <Suspense>
          <GitHubCard />
        </Suspense>
        <Suspense>
          <GranolaCard />
        </Suspense>
        <Suspense>
          <TeamSlackImport />
        </Suspense>
      </IntegrationGroup>
    </>
  );
}

/** The team's Slack export import, offered to team admins. */
function TeamSlackImport() {
  const teams = useUserTeamsQuery();
  const team = () => (teams.isSuccess ? teams.data[0] : undefined);
  return (
    <Show when={team()} keyed>
      {(found) => <TeamSlackImportRow team={found} />}
    </Show>
  );
}

function TeamSlackImportRow(props: { team: TeamSummary }) {
  const { isAdminOrOwner } = useTeamViewer(() => props.team);
  return <SlackImport teamId={props.team.id} isAdmin={isAdminOrOwner()} />;
}
