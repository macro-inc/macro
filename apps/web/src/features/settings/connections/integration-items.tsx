import { SlackImport } from '@app/features/slack-import/slack-import';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_EMAIL,
  enableDialpad,
  enableMultiInbox,
  enableSlackArchiveImport,
} from '@core/constant/featureFlags';
import { useEmailLinks } from '@core/email-link';
import { OutlookBetaBadge } from '@core/email-link/OutlookBetaBadge';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import ClaudeIcon from '@icon/claude-color.svg';
import GmailIcon from '@icon/gmail-color.svg';
import OutlookIcon from '@icon/outlook-color.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { useOutlookAvailable } from '@queries/auth/outlook-link';
import { useUserTeamsQuery } from '@queries/team/teams';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Dropdown } from '@ui';
import { type Accessor, For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  DIALPAD_APP_SLUG,
  DIALPAD_BACKFILL_OPTIONS,
  DIALPAD_ICON_URL,
  dialpadIssueLabel,
} from '../../dialpad-connect/core/dialpad';
import { createDialpadConnection } from '../../dialpad-connect/primitives/create-dialpad-connection';
import {
  GRANOLA_APP_SLUG,
  GRANOLA_ICON_URL,
} from '../../granola-connect/core/granola';
import { createGranolaConnection } from '../../granola-connect/primitives/create-granola-connection';
import { useConnectInbox } from '../Email';
import { GITHUB_APP_INSTALL_URL, useGithubConnection } from '../GitHub';
import { ConnectAction } from '../integration-ui';
import { useTeamViewer } from '../Team';
import { ConnectionRowActions } from './connection-more';
import { ImportAction } from './import-action';
import type { IntegrationItem, IntegrationStatus } from './integrations-list';
import {
  type CapabilityStatus,
  type ConnectionsModel,
  CURATED_AI,
  type CuratedAiProvider,
  capabilitiesFor,
} from './model';
import { providerIcon } from './provider-meta';
import { useConnectionsView } from './view-state';

export type IntegrationItemHosts = {
  onOpenEmailSettings: () => void;
  onOpenMacroMcp: () => void;
  /** Absent when the Runtimes page is unavailable. */
  onOpenLocalAgents?: () => void;
};

function capabilityStatus(status: CapabilityStatus): IntegrationStatus {
  return match(status)
    .with('connected', () => 'connected' as const)
    .with('off', () => 'disconnected' as const)
    .with('action-required', () => 'attention' as const)
    .with('not-connected', () => 'available' as const)
    .exhaustive();
}

function agentToolStatus(
  model: Accessor<ConnectionsModel>,
  provider: CuratedAiProvider
): IntegrationStatus {
  const capability = capabilitiesFor(model(), provider)[0];
  return capabilityStatus(capability?.status ?? 'not-connected');
}

function emailItem(
  provider: EmailLink['provider'],
  links: Accessor<EmailLink[]>,
  actions: IntegrationItem['Actions']
): IntegrationItem {
  const outlook = provider === 'OUTLOOK';
  return {
    id: outlook ? 'outlook' : 'gmail',
    name: outlook ? 'Outlook' : 'Gmail',
    badge: outlook ? <OutlookBetaBadge /> : undefined,
    kind: 'native',
    icon: outlook ? <OutlookIcon /> : <GmailIcon />,
    get description() {
      if (links().length > 0)
        return links()
          .map((link) => link.email_address)
          .join(', ');
      return outlook
        ? 'Sync Outlook.com or Microsoft 365 inboxes into Email and Calendar.'
        : 'Sync Gmail or Google Workspace inboxes into Email and Calendar.';
    },
    categories: ['Email', 'Calendar'],
    get status() {
      if (links().some((link) => link.needs_reauth)) return 'attention';
      return links().length > 0 ? 'connected' : 'available';
    },
    get statusLabel() {
      return links().length > 1 ? `${links().length} accounts` : undefined;
    },
    Actions: actions,
  };
}

/**
 * Gmail and Outlook, one row per provider; accounts are managed in Email
 * settings. Outlook shows when the server offers it to this user, or to manage
 * Outlook inboxes already connected.
 */
export function useEmailItems(
  hosts: IntegrationItemHosts
): Accessor<IntegrationItem[]> {
  const { query } = useEmailLinks();
  const connectInbox = useConnectInbox();
  const multiInbox = useFeatureFlag(enableMultiInbox);
  const outlookOffered = useOutlookAvailable();
  const links = () => (query.isSuccess ? query.data.links : []);
  const linksFor = (provider: EmailLink['provider']) =>
    links().filter((link) =>
      provider === 'OUTLOOK'
        ? link.provider === 'OUTLOOK'
        : link.provider !== 'OUTLOOK'
    );
  // Further inboxes are behind multi-inbox; the first is always offered.
  const canAdd = () => links().length === 0 || multiInbox().enabled;

  const actionsFor = (provider: EmailLink['provider']) => () => (
    <>
      <Show when={canAdd() && (provider !== 'OUTLOOK' || outlookOffered())}>
        <ConnectAction
          label={linksFor(provider).length > 0 ? 'Add account' : 'Connect'}
          ariaLabel={
            provider === 'OUTLOOK'
              ? 'Connect an Outlook account'
              : 'Connect a Google Workspace account'
          }
          onClick={() => connectInbox(provider)}
        />
      </Show>
      <Show when={linksFor(provider).length > 0}>
        <ConnectAction
          label="Manage"
          variant="neutral"
          onClick={hosts.onOpenEmailSettings}
        />
      </Show>
    </>
  );
  if (!ENABLE_EMAIL) return () => [];
  const gmail = emailItem(
    'GMAIL',
    () => linksFor('GMAIL'),
    actionsFor('GMAIL')
  );
  const outlook = emailItem(
    'OUTLOOK',
    () => linksFor('OUTLOOK'),
    actionsFor('OUTLOOK')
  );
  return () =>
    outlookOffered() || linksFor('OUTLOOK').length > 0
      ? [gmail, outlook]
      : [gmail];
}

/**
 * One GitHub row for the account link (pull requests, reviews, repositories)
 * and the agent tools, which are managed from its menu.
 */
export function useGithubItem(
  model: Accessor<ConnectionsModel>
): IntegrationItem {
  const github = useGithubConnection();
  const view = useConnectionsView();
  const agentStatus = () => agentToolStatus(model, 'github');

  function Actions() {
    return (
      <Switch>
        <Match when={github.status() === 'linked'}>
          <ConnectionRowActions
            items={[
              {
                label: 'Configure GitHub App',
                icon: 'external',
                onSelect: () => openExternalUrl(GITHUB_APP_INSTALL_URL),
              },
              {
                label: 'Agent tools',
                icon: 'settings',
                onSelect: () => view.openProvider('github'),
              },
              {
                label: 'Disconnect',
                icon: 'disconnect',
                danger: true,
                disabled: github.disconnecting(),
                onSelect: () =>
                  fireAndForget(github.disconnect(), 'github-settings'),
              },
            ]}
          />
        </Match>
        <Match when={github.status() === 'reauthentication_required'}>
          <ConnectAction
            label="Reconnect"
            onClick={() => fireAndForget(github.reconnect(), 'github-settings')}
            disabled={github.reconnecting()}
          />
        </Match>
        <Match when={!github.loading()}>
          <ConnectAction
            label="Connect"
            ariaLabel="Connect GitHub"
            onClick={() => fireAndForget(github.connect(), 'github-settings')}
            disabled={github.connecting()}
          />
        </Match>
      </Switch>
    );
  }

  return {
    id: 'github',
    name: 'GitHub',
    kind: 'native',
    icon: providerIcon('github'),
    get description() {
      const summary =
        'Pull request reviews and status in Macro, and repository access for agents.';
      const username = github.username();
      return username ? `@${username} · ${summary}` : summary;
    },
    categories: ['Code', 'Agent tools'],
    get status() {
      return github.connectionState() ?? agentStatus();
    },
    get statusLabel() {
      return github.connectionState() === 'attention'
        ? 'Reconnect required'
        : undefined;
    },
    Actions,
  };
}

/** Slack export import for team admins, else the agent-led channel import. */
function SlackImportAction() {
  const teams = useUserTeamsQuery();
  const archiveImport = useFeatureFlag(enableSlackArchiveImport);
  const team = () => (teams.isSuccess ? teams.data[0] : undefined);
  return (
    <Show
      when={archiveImport().enabled && team()}
      keyed
      fallback={<ImportAction appSlug="slack" name="Slack" />}
    >
      {(found) => <TeamSlackImport team={found} />}
    </Show>
  );
}

function TeamSlackImport(props: { team: TeamSummary }) {
  const { isAdminOrOwner } = useTeamViewer(() => props.team);
  return (
    <Show
      when={isAdminOrOwner()}
      fallback={<ImportAction appSlug="slack" name="Slack" />}
    >
      <SlackImport
        teamId={props.team.id}
        isAdmin
        trigger={(onOpen) => (
          <ConnectAction
            label="Import"
            variant="neutral"
            ariaLabel="Import from Slack"
            onClick={() => {
              const active = document.activeElement;
              if (active instanceof HTMLButtonElement) onOpen(active);
            }}
          />
        )}
      />
    </Show>
  );
}

const AGENT_PROVIDER_CATEGORIES: Record<CuratedAiProvider, string[]> = {
  github: ['Code', 'Agent tools'],
  linear: ['Tasks', 'Agent tools'],
  notion: ['Docs', 'Agent tools'],
  slack: ['Chat', 'Agent tools'],
};

/** Slack, Linear and Notion: agent tools with Macro's importer beside them. */
export function useAgentProviderItem(
  model: Accessor<ConnectionsModel>,
  provider: Exclude<CuratedAiProvider, 'github'>
): IntegrationItem {
  const view = useConnectionsView();
  const name = CURATED_AI[provider].title;
  const status = () => agentToolStatus(model, provider);

  function Actions() {
    return (
      <>
        <Show
          when={provider === 'slack'}
          fallback={<ImportAction appSlug={provider} name={name} />}
        >
          <SlackImportAction />
        </Show>
        <ConnectAction
          label={status() === 'available' ? 'Connect' : 'Manage'}
          variant={status() === 'available' ? 'connect' : 'neutral'}
          ariaLabel={`${status() === 'available' ? 'Connect' : 'Manage'} ${name}`}
          onClick={() => view.openProvider(provider)}
        />
      </>
    );
  }

  return {
    id: provider,
    name,
    kind: 'mcp',
    icon: providerIcon(provider),
    description: CURATED_AI[provider].outcome,
    categories: AGENT_PROVIDER_CATEGORIES[provider],
    get status() {
      return status();
    },
    Actions,
  };
}

export function useGranolaItem(): IntegrationItem {
  const granola = createGranolaConnection();

  function Actions() {
    return (
      <Switch>
        <Match when={granola.status() === 'connected'}>
          <ConnectAction
            label="Disconnect"
            variant="danger"
            onClick={() =>
              fireAndForget(granola.disconnect(), 'granola-settings')
            }
            disabled={granola.disconnecting()}
          />
        </Match>
        <Match when={granola.status() === 'disabled'}>
          <ConnectAction
            label="Resume"
            onClick={() => fireAndForget(granola.connect(), 'granola-settings')}
            loading={granola.connecting()}
          />
        </Match>
        <Match when={granola.status() === 'available'}>
          <ConnectAction
            label="Connect"
            ariaLabel="Connect Granola"
            onClick={() => fireAndForget(granola.connect(), 'granola-settings')}
            loading={granola.connecting()}
          />
        </Match>
      </Switch>
    );
  }

  return {
    id: 'granola',
    name: 'Granola',
    kind: 'native',
    icon: (
      <PipedreamConnectorIcon
        appSlug={GRANOLA_APP_SLUG}
        iconUrl={GRANOLA_ICON_URL}
        class="size-5"
      />
    ),
    description:
      'Import Granola meetings into Calls to make transcripts available to agents and team-level memory.',
    categories: ['Meetings'],
    get status(): IntegrationStatus {
      const status = granola.status();
      if (status === 'connected') return 'connected';
      if (status === 'disabled') return 'disconnected';
      return 'available';
    },
    get statusLabel() {
      return granola.status() === 'disabled' ? 'Paused' : undefined;
    },
    Actions,
  };
}

/**
 * Dialpad call sync. Connecting asks how far back to import, then opens
 * Macro Connect; the row reads "Connecting" until setup finishes.
 */
export function useDialpadItem(): IntegrationItem {
  const flag = useFeatureFlag(enableDialpad);
  const dialpad = createDialpadConnection(() => flag().enabled);

  function ConnectMenu(props: { label: string }) {
    return (
      <Dropdown>
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          aria-label={`${props.label} Dialpad`}
          class="text-ink-muted hover:text-ink touch:min-h-11"
          disabled={dialpad.connecting()}
        >
          {props.label}
          <ArrowUpRightIcon class="size-3.5 opacity-70" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-60 max-w-80">
          <Dropdown.Group>
            <For each={DIALPAD_BACKFILL_OPTIONS}>
              {(option) => (
                <Dropdown.Item
                  onSelect={() =>
                    fireAndForget(
                      dialpad.connect(option.value),
                      'dialpad-settings'
                    )
                  }
                >
                  {option.label}
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    );
  }

  function Actions() {
    const state = () => dialpad.connection()?.state;
    return (
      <Switch>
        <Match when={state() === 'connected'}>
          <Show
            when={dialpad.connection()?.issue === 'needs_reauth'}
            fallback={
              <ConnectAction
                label="Disconnect"
                variant="danger"
                ariaLabel="Disconnect Dialpad. Imported calls stay, and Macro's access is not revoked in Dialpad."
                onClick={() =>
                  fireAndForget(dialpad.disconnect(), 'dialpad-settings')
                }
                disabled={dialpad.disconnecting()}
              />
            }
          >
            <ConnectMenu label="Reconnect" />
          </Show>
        </Match>
        <Match when={state() === 'connecting'}>
          <ConnectAction label="Connecting" variant="neutral" loading />
        </Match>
        <Match when={state() === 'failed'}>
          <ConnectMenu label="Reconnect" />
        </Match>
        <Match when={state() === 'not_connected'}>
          <ConnectMenu label="Connect" />
        </Match>
      </Switch>
    );
  }

  return {
    id: 'dialpad',
    name: 'Dialpad',
    kind: 'native',
    icon: (
      <PipedreamConnectorIcon
        appSlug={DIALPAD_APP_SLUG}
        iconUrl={DIALPAD_ICON_URL}
        class="size-5"
      />
    ),
    description:
      'Import Dialpad calls into Calls, with transcripts and summaries, linked to your CRM contacts.',
    categories: ['Meetings'],
    get status(): IntegrationStatus {
      const connection = dialpad.connection();
      if (connection?.state === 'connected')
        return connection.issue ? 'attention' : 'connected';
      if (connection?.state === 'failed') return 'attention';
      if (connection?.state === 'connecting') return 'disconnected';
      return 'available';
    },
    get statusLabel() {
      const connection = dialpad.connection();
      if (!connection) return undefined;
      if (connection.state === 'connecting') return 'Connecting';
      return dialpadIssueLabel(connection);
    },
    get hidden() {
      const state = dialpad.connection()?.state;
      return !flag().enabled || state === undefined || state === 'unavailable';
    },
    Actions,
  };
}

/** Macro MCP setup for AI apps, and local coding agents when available. */
export function aiAppItems(hosts: IntegrationItemHosts): IntegrationItem[] {
  const items: IntegrationItem[] = [
    {
      id: 'macro-mcp',
      name: 'Claude Code, Codex, and ChatGPT',
      kind: 'mcp',
      icon: <ClaudeIcon />,
      description:
        'Use your Macro workspace from Claude Code, Codex, ChatGPT, Claude.ai, and IDEs through the Macro MCP server.',
      categories: ['AI apps'],
      status: 'available',
      Actions: () => (
        <ConnectAction
          label="Set up"
          variant="neutral"
          ariaLabel="Set up Macro in AI apps"
          onClick={hosts.onOpenMacroMcp}
        />
      ),
    },
  ];
  const openLocal = hosts.onOpenLocalAgents;
  if (openLocal) {
    items.push({
      id: 'local-agents',
      name: 'Coding agents on your computer',
      kind: 'native',
      icon: <DesktopIcon />,
      description:
        'Pair your computer so Macro agents run on Claude Code, Codex, OpenCode, OpenClaw, or Hermes there, with each session streamed into Macro.',
      categories: ['AI apps'],
      status: 'available',
      Actions: () => (
        <ConnectAction
          label="Set up"
          variant="neutral"
          ariaLabel="Set up local agents"
          onClick={openLocal}
        />
      ),
    });
  }
  return items;
}
