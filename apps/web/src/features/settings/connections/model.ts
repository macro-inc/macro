import type { PipedreamConnectionResponse } from '@service-cognition/client';
import type { ServerResponse } from '@service-cognition/generated/schemas';

export type CapabilityStatus =
  | 'connected'
  | 'off'
  | 'action-required'
  | 'not-connected';

export type CapabilityScope = 'personal' | 'shared';

export type CapabilityMechanism = 'pipedream' | 'native-mcp';

export type ProviderId = CuratedAiProvider;

export type CuratedAiProvider = 'github' | 'linear' | 'notion' | 'slack';

export type CapabilityKind = 'ai';

export type Capability = {
  id: string;
  kind: CapabilityKind;
  provider: ProviderId;
  title: string;
  outcome: string;
  account: string;
  scope: CapabilityScope;
  status: CapabilityStatus;
  mechanism: CapabilityMechanism;
  /** Native MCP URL, when this row is that server. */
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
  id: ProviderId;
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
  pipedream: PipedreamConnectionResponse[];
  nativeMcp: ServerResponse[];
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

const PROVIDER_NAMES: Record<ProviderId, string> = {
  github: 'GitHub',
  linear: 'Linear',
  notion: 'Notion',
  slack: 'Slack',
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
        kind: 'ai',
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
        kind: 'ai',
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

function providerSummary(
  id: ProviderId,
  rows: Capability[]
): ProviderSummary | null {
  const readyRows = rows.filter((row) => row.status === 'connected');
  if (
    readyRows.length === 0 &&
    !rows.some((row) => row.status !== 'not-connected')
  ) {
    return null;
  }

  const accounts = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.status !== 'not-connected' && row.mechanism !== 'pipedream'
        )
        .map((row) => row.account)
    ),
  ].join(' · ');

  const summary =
    readyRows[0]?.outcome ?? rows[0]?.outcome ?? PROVIDER_NAMES[id];

  return {
    id,
    name: PROVIDER_NAMES[id],
    ready: readyRows.length,
    total: rows.length,
    summary,
    accounts,
  };
}

/** Map connection records into the Connections presentation model. */
export function toConnectionsModel(input: ConnectionsInput): ConnectionsModel {
  const curated = curatedAiAndLeftovers(input);
  const capabilities = [...curated.capabilities];

  const order: ProviderId[] = ['github', 'linear', 'notion', 'slack'];
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
