import type { Connector, ConnectorStatus } from '@queries/connectors';
import { Result } from 'neverthrow';
import { match } from 'ts-pattern';

export type CapabilityStatus =
  | 'connected'
  | 'off'
  | 'action-required'
  | 'not-connected';

export type CuratedAiProvider = 'github' | 'linear' | 'notion' | 'slack';

export type ProviderId = CuratedAiProvider;

/** A featured app the user holds a connection for. */
export type Capability = {
  id: string;
  provider: ProviderId;
  title: string;
  outcome: string;
  /** The connection's display name. */
  account: string;
  status: CapabilityStatus;
  /** Its connector key, `app/{provider}`. */
  key: string;
  /** Whether Macro can import from the app through this connection. */
  importAvailable: boolean;
};

/** A held connector without a featured row of its own. */
export type Leftover =
  | {
      /** A server added by URL. */
      kind: 'server';
      id: string;
      key: string;
      title: string;
      /** Its address, shortened for display. */
      subtitle: string;
      status: CapabilityStatus;
    }
  | {
      /** A catalog app. */
      kind: 'app';
      id: string;
      key: string;
      title: string;
      appSlug: string;
      status: CapabilityStatus;
      importAvailable: boolean;
    };

export type ConnectionsModel = {
  capabilities: Capability[];
  leftovers: Leftover[];
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

function isCurated(slug: string): slug is CuratedAiProvider {
  return slug in CURATED_AI;
}

/** The server's status as settings shows it. */
function capabilityStatus(status: ConnectorStatus): CapabilityStatus {
  return match(status)
    .with('connected', () => 'connected' as const)
    .with('disabled', () => 'off' as const)
    .with('needsReauth', () => 'action-required' as const)
    .with('notConnected', () => 'not-connected' as const)
    .exhaustive(() => 'not-connected' as const);
}

const parseUrl = Result.fromThrowable(
  (url: string) => new URL(url),
  () => ({ kind: 'invalid-url' as const })
);

function urlPreview(url: string): string {
  const parsed = parseUrl(url);
  if (parsed.isErr()) return url;
  const path = parsed.value.pathname.replace(/\/$/, '');
  return path ? `${parsed.value.host}${path}` : parsed.value.host;
}

/**
 * The connectors the server listed, as settings shows them: the featured
 * apps (GitHub, Linear, Notion, Slack) as capabilities, everything else as
 * leftovers. Statuses are the server's; nothing here decides them.
 */
export function toConnectionsModel(
  connectors: readonly Connector[]
): ConnectionsModel {
  const capabilities: Capability[] = [];
  const leftovers: Leftover[] = [];
  for (const connector of connectors) {
    const status = capabilityStatus(connector.status);
    match(connector.target)
      .with({ type: 'server' }, (target) =>
        leftovers.push({
          kind: 'server',
          id: connector.key,
          key: connector.key,
          title: connector.name,
          subtitle: urlPreview(target.url),
          status,
        })
      )
      .with({ type: 'app' }, (target) => {
        if (isCurated(target.slug)) {
          capabilities.push({
            id: `${target.slug}-ai`,
            provider: target.slug,
            title: CURATED_AI[target.slug].title,
            outcome: CURATED_AI[target.slug].outcome,
            account: connector.name,
            status,
            key: connector.key,
            importAvailable: connector.importAvailable,
          });
          return;
        }
        leftovers.push({
          kind: 'app',
          id: connector.key,
          key: connector.key,
          title: connector.name,
          appSlug: target.slug,
          status,
          importAvailable: connector.importAvailable,
        });
      })
      .exhaustive();
  }
  return { capabilities, leftovers };
}

/** The held connection for a featured app, if any. */
export function capabilityFor(
  model: ConnectionsModel,
  provider: ProviderId
): Capability | undefined {
  return model.capabilities.find((row) => row.provider === provider);
}
