import type { ConnectionsProviderSlug } from '@core/constant/settingsConnectionsUrl';
import type { GithubLink } from '@queries/auth';
import type { PipedreamConnectionResponse } from '@service-cognition/client';
import type { ServerResponse } from '@service-cognition/generated/schemas';
import type { Link as EmailLink } from '@service-email/generated/schemas';

export type CapabilityStatus =
  | 'connected'
  | 'off'
  | 'action-required'
  | 'not-connected';

export type CapabilityScope = 'personal' | 'shared' | 'team';

export type CapabilityMechanism =
  | 'macro'
  | 'pipedream'
  | 'native-mcp'
  | 'github-app'
  | 'cursor-key';

export type ProviderId = ConnectionsProviderSlug;

export type CuratedAiProvider = 'github' | 'linear' | 'notion' | 'slack';

export type Capability = {
  id: string;
  provider: ProviderId;
  title: string;
  outcome: string;
  account: string;
  scope: CapabilityScope;
  status: CapabilityStatus;
  mechanism: CapabilityMechanism;
  /** Dest native MCP URL, when this row is that server. */
  sourceUrl?: string;
};

export type Leftover =
  | {
      kind: 'native-mcp';
      id: string;
      title: string;
      subtitle: string;
      url: string;
      enabled: boolean;
      authenticated: boolean;
    }
  | {
      kind: 'pipedream';
      id: string;
      title: string;
      subtitle: string;
      appSlug: string;
      enabled: boolean;
    };

export type ProviderSummary = {
  id: Exclude<ProviderId, 'other'>;
  name: string;
  ready: number;
  total: number;
  summary: string;
  accounts: string;
};

export type ConnectionsModel = {
  capabilities: Capability[];
  leftovers: Leftover[];
  providers: ProviderSummary[];
};

export type ConnectionsInput = {
  userId: string | undefined;
  emailEnabled: boolean;
  calendarEnabled: boolean;
  emailLinks: EmailLink[];
  github?: GithubLink;
  pipedream: PipedreamConnectionResponse[];
  nativeMcp: ServerResponse[];
  cursorRegistered: boolean;
};

export const CURATED_AI: Record<
  CuratedAiProvider,
  { title: string; outcome: string }
> = {
  github: {
    title: 'GitHub',
    outcome:
      'Macro AI can answer questions about your repos, pull requests, and issues.',
  },
  linear: {
    title: 'Linear',
    outcome:
      'Macro AI can create, read, and update Linear issues without leaving Macro.',
  },
  notion: {
    title: 'Notion',
    outcome: 'Macro AI can search your pages and wikis.',
  },
  slack: {
    title: 'Slack',
    outcome: 'Macro AI can search conversations and post updates for you.',
  },
};

const NATIVE_CURATED: {
  provider: CuratedAiProvider;
  url: string;
}[] = [
  { provider: 'github', url: 'https://api.githubcopilot.com/mcp' },
  { provider: 'linear', url: 'https://mcp.linear.app/mcp' },
  { provider: 'notion', url: 'https://mcp.notion.com/mcp' },
  { provider: 'slack', url: 'https://mcp.slack.com/mcp' },
];

/** Shared Discover + Connected overview line for Google. */
export const GOOGLE_PROVIDER_NOTE = 'Connect Gmail and Calendar to Macro.';

const PROVIDER_NAMES: Record<Exclude<ProviderId, 'other'>, string> = {
  google: 'Google',
  github: 'GitHub',
  linear: 'Linear',
  notion: 'Notion',
  slack: 'Slack',
  cursor: 'Cursor',
};

function nativeCuratedProvider(
  server: ServerResponse
): CuratedAiProvider | null {
  const url = server.url.replace(/\/$/, '');
  return NATIVE_CURATED.find((row) => row.url === url)?.provider ?? null;
}

function pipedreamBySlug(
  connections: PipedreamConnectionResponse[]
): Map<string, PipedreamConnectionResponse> {
  return new Map(connections.map((row) => [row.app_slug, row]));
}

function aiStatus(enabled: boolean): CapabilityStatus {
  return enabled ? 'connected' : 'off';
}

function googleCapabilities(input: ConnectionsInput): Capability[] {
  if (!input.emailEnabled) return [];
  return input.emailLinks.flatMap((link) => {
    const scope: CapabilityScope =
      input.userId && link.macro_id !== input.userId ? 'shared' : 'personal';
    const gmail: Capability = {
      id: `gmail:${link.id}`,
      provider: 'google',
      title: 'Gmail',
      outcome:
        scope === 'shared'
          ? 'Read, organize, and act on this shared inbox.'
          : 'Read, organize, and act on your email.',
      account: link.email_address,
      scope,
      status: link.needs_reauth ? 'action-required' : 'connected',
      mechanism: 'macro',
    };
    if (!input.calendarEnabled) return [gmail];
    const calendarStatus: CapabilityStatus = link.needs_reauth
      ? 'action-required'
      : link.calendar_disabled
        ? 'off'
        : link.needs_calendar_permission
          ? 'not-connected'
          : 'connected';
    const calendar: Capability = {
      id: `calendar:${link.id}`,
      provider: 'google',
      title: 'Calendar',
      outcome:
        'Show your calendar events in Macro. Disconnect drops calendar access and keeps mail.',
      account: link.email_address,
      scope,
      status: calendarStatus,
      mechanism: 'macro',
    };
    return [gmail, calendar];
  });
}

function githubCapabilities(input: ConnectionsInput): Capability[] {
  const accountStatus: CapabilityStatus =
    input.github?.status === 'linked'
      ? 'connected'
      : input.github?.status === 'reauthentication_required'
        ? 'action-required'
        : 'not-connected';
  const handle = input.github?.username
    ? `@${input.github.username}`
    : 'GitHub account';

  return [
    {
      id: 'github-account',
      provider: 'github',
      title: 'Account',
      outcome: 'Pull requests show up in Macro.',
      account: handle,
      scope: 'personal',
      status: accountStatus,
      mechanism: 'macro',
    },
    {
      id: 'github-team',
      provider: 'github',
      title: 'GitHub App',
      outcome: 'Choose repositories for Macro to sync.',
      account: 'Team organization',
      scope: 'team',
      status: 'not-connected',
      mechanism: 'github-app',
    },
  ];
}

function mcpUrlPreview(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    return path ? `${parsed.host}${path}` : parsed.host;
  } catch {
    return url;
  }
}

function leftoverNative(server: ServerResponse): Leftover {
  return {
    kind: 'native-mcp',
    id: `mcp:${server.url}`,
    title: server.server_name,
    subtitle: mcpUrlPreview(server.url),
    url: server.url,
    enabled: server.enabled,
    authenticated: server.authenticated,
  };
}

function curatedAiAndLeftovers(input: ConnectionsInput): {
  capabilities: Capability[];
  leftovers: Leftover[];
} {
  const pipedream = pipedreamBySlug(input.pipedream);
  const usedNative = new Set<string>();
  const capabilities: Capability[] = [];
  const leftovers: Leftover[] = [];

  for (const provider of Object.keys(CURATED_AI) as CuratedAiProvider[]) {
    const copy = CURATED_AI[provider];
    const pd = pipedream.get(provider);
    const native = input.nativeMcp.find(
      (server) => nativeCuratedProvider(server) === provider
    );

    if (pd) {
      capabilities.push({
        id: `${provider}-ai`,
        provider,
        title: copy.title,
        outcome: copy.outcome,
        account: pd.server_name,
        scope: 'personal',
        status: aiStatus(pd.enabled),
        mechanism: 'pipedream',
      });
      if (native) {
        usedNative.add(native.url);
        leftovers.push(leftoverNative(native));
      }
      continue;
    }

    if (native) {
      usedNative.add(native.url);
      capabilities.push({
        id: `${provider}-ai`,
        provider,
        title: copy.title,
        outcome: copy.outcome,
        account: native.server_name,
        scope: 'personal',
        status: native.authenticated
          ? aiStatus(native.enabled)
          : 'action-required',
        mechanism: 'native-mcp',
        sourceUrl: native.url,
      });
    }
  }

  for (const server of input.nativeMcp) {
    if (usedNative.has(server.url)) continue;
    leftovers.push(leftoverNative(server));
  }

  for (const row of input.pipedream) {
    if (row.app_slug in CURATED_AI) continue;
    leftovers.push({
      kind: 'pipedream',
      id: `pipedream:${row.app_slug}`,
      title: row.server_name,
      subtitle: row.app_slug,
      appSlug: row.app_slug,
      enabled: row.enabled,
    });
  }

  return { capabilities, leftovers };
}

function cursorCapabilities(input: ConnectionsInput): Capability[] {
  if (!input.cursorRegistered) return [];
  return [
    {
      id: 'cursor',
      provider: 'cursor',
      title: 'Cursor',
      outcome: 'Use your Cursor account to run agent sessions in Macro.',
      account: '',
      scope: 'personal',
      status: 'connected',
      mechanism: 'cursor-key',
    },
  ];
}

function providerSummary(
  id: Exclude<ProviderId, 'other'>,
  rows: Capability[]
): ProviderSummary | null {
  const counted = rows.filter((row) => row.mechanism !== 'github-app');
  const readyRows = counted.filter((row) => row.status === 'connected');
  if (
    readyRows.length === 0 &&
    !counted.some((row) => row.status !== 'not-connected')
  ) {
    return null;
  }

  const accounts = [
    ...new Set(
      counted
        .filter(
          (row) =>
            row.status !== 'not-connected' && row.mechanism !== 'pipedream'
        )
        .map((row) => row.account)
    ),
  ].join(' · ');

  const action = counted.find((row) => row.status === 'action-required');
  const needsCalendar = counted.some(
    (row) => row.id.startsWith('calendar:') && row.status === 'not-connected'
  );

  let summary = rows[0]?.title ?? PROVIDER_NAMES[id];
  if (id === 'github' && action?.id === 'github-account') {
    summary = 'GitHub account needs reconnect';
  } else if (id === 'google' && needsCalendar) {
    const inbox = rows.find(
      (row) => row.id.startsWith('calendar:') && row.status === 'not-connected'
    )?.account;
    summary = inbox
      ? `Calendar needs a grant for ${inbox}`
      : 'Calendar needs a grant';
  } else if (id === 'google' && readyRows[0]) {
    summary = GOOGLE_PROVIDER_NOTE;
  } else if (readyRows[0]) {
    summary = readyRows[0].outcome;
  }

  return {
    id,
    name: PROVIDER_NAMES[id],
    ready: readyRows.length,
    total: counted.length,
    summary,
    accounts,
  };
}

/** Map dest records into the Connections presentation model. */
export function toConnectionsModel(input: ConnectionsInput): ConnectionsModel {
  const curated = curatedAiAndLeftovers(input);
  const capabilities = [
    ...googleCapabilities(input),
    ...githubCapabilities(input),
    ...curated.capabilities,
    ...cursorCapabilities(input),
  ];

  const order: Exclude<ProviderId, 'other'>[] = [
    'google',
    'github',
    'linear',
    'notion',
    'slack',
    'cursor',
  ];
  const providers = order.flatMap((id) => {
    const summary = providerSummary(
      id,
      capabilities.filter((row) => row.provider === id)
    );
    return summary ? [summary] : [];
  });

  return {
    capabilities,
    leftovers: curated.leftovers,
    providers,
  };
}

export function capabilitiesFor(
  model: ConnectionsModel,
  provider: ProviderId
): Capability[] {
  return model.capabilities.filter((row) => row.provider === provider);
}

export function isConnectionsEmpty(model: ConnectionsModel): boolean {
  return model.providers.length === 0 && model.leftovers.length === 0;
}
