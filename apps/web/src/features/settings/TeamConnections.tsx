import { SlackImport } from '@app/features/slack-import/slack-import';
import { useSettingsState } from '@core/constant/SettingsState';
import { SERVER_HOSTS } from '@core/constant/servers';
import GithubIcon from '@icon/mcp-github.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { useGithubLinkStatusQuery } from '@queries/auth';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import { Show } from 'solid-js';
import { ConnectAction } from './integration-ui';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from './primitives';
import { useTeamViewer } from './Team';

/** Team › Connections: team-wide Slack import and the GitHub App. */
export function TeamConnections(props: { team: TeamSummary }) {
  const { isAdminOrOwner } = useTeamViewer(() => props.team);
  const githubLink = useGithubLinkStatusQuery();
  const { openSettings } = useSettingsState();

  return (
    <SettingsPage title="Team connections">
      <SettingsSection title="Connections">
        <SettingsCard>
          <SlackImport teamId={props.team.id} isAdmin={isAdminOrOwner()} />
          <IntegrationRow
            icon={<GithubIcon />}
            title="GitHub App"
            description="Connect your team's repositories for pull request sync."
          >
            {/* The install callback rejects users without a linked GitHub
                  account, so don't offer the flow until they've connected one
                  on the Integrations page. */}
            <Show
              when={githubLink.data?.status === 'linked'}
              fallback={
                <Show
                  when={!githubLink.isLoading}
                  fallback={
                    <span class="text-xs text-ink-muted">Loading…</span>
                  }
                >
                  <ConnectAction
                    label="Connect your GitHub account first"
                    onClick={() => openSettings('Connected')}
                  />
                </Show>
              }
            >
              <a
                href={`${SERVER_HOSTS['document-storage-service']}/github/install-sync`}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
              >
                Configure app
                <ArrowUpRightIcon class="size-3.5 opacity-70" />
              </a>
            </Show>
          </IntegrationRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
