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

export type ProviderId =
  | 'google'
  | 'github'
  | 'linear'
  | 'notion'
  | 'slack'
  | 'cursor'
  | 'other';

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

export type Leftover = {
  id: string;
  title: string;
  note: string;
  facts: string;
  mechanism: CapabilityMechanism;
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

const CURATED_AI: Record<
  CuratedAiProvider,
  { title: string; outcome: string }
> = {
  github: {
    title: 'Use GitHub with Macro AI',
    outcome:
      'Let Macro AI answer questions about repositories, pull requests, and issues.',
  },
  linear: {
    title: 'Use Linear with Macro AI',
    outcome: 'Let Macro AI create, read, and update Linear issues.',
  },
  notion: {
    title: 'Use Notion with Macro AI',
    outcome: 'Let Macro AI search pages and wikis.',
  },
  slack: {
    title: 'Use Slack with Macro AI',
    outcome: 'Let Macro AI search conversations and post updates.',
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
      title: 'Use Gmail in Macro',
      outcome:
        scope === 'shared'
          ? 'Read and send mail from this shared inbox in Macro.'
          : 'Read and send mail from this Google account in Macro.',
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
      title: 'Use Google Calendar in Macro',
      outcome:
        'Show this calendar in Macro. Disconnect drops calendar access and keeps mail.',
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
      title: 'Connect your GitHub account',
      outcome: 'Show pull requests in Macro where this is supported.',
      account: handle,
      scope: 'personal',
      status: accountStatus,
      mechanism: 'macro',
    },
    {
      id: 'github-team',
      provider: 'github',
      title: 'Sync GitHub work for your team',
      outcome:
        'Associate branches and pull requests with Macro tasks, and update task state.',
      account: 'Team organization',
      scope: 'team',
      status: 'not-connected',
      mechanism: 'github-app',
    },
  ];
}

function leftoverNative(server: ServerResponse, note: string): Leftover {
  return {
    id: `mcp:${server.url}`,
    title: server.server_name,
    note,
    facts: `Name: ${server.server_name} · URL: ${server.url} · Mechanism: native MCP`,
    mechanism: 'native-mcp',
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
        leftovers.push(
          leftoverNative(
            native,
            provider === 'github'
              ? 'A GitHub AI relationship that does not match the curated capability. Outcome, account, or lifecycle did not line up.'
              : 'A native MCP server that does not match the Pipedream-backed capability.'
          )
        );
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
    leftovers.push(
      leftoverNative(
        server,
        'A native MCP server that disappeared from Settings after Pipedream shipped. Macro still has the grant.'
      )
    );
  }

  for (const row of input.pipedream) {
    if (row.app_slug in CURATED_AI) continue;
    leftovers.push({
      id: `pipedream:${row.app_slug}`,
      title: row.server_name,
      note: 'A Pipedream connection that is not a curated provider page yet.',
      facts: `Name: ${row.server_name} · Slug: ${row.app_slug} · Mechanism: Pipedream`,
      mechanism: 'pipedream',
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
      title: 'Run @cursor sessions on your Cursor account',
      outcome: 'Macro AI can start Cursor Cloud Agents for @cursor.',
      account: 'Personal',
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
        .filter((row) => row.status !== 'not-connected')
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
  } else if (readyRows[0]) {
    summary = readyRows[0].title;
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
