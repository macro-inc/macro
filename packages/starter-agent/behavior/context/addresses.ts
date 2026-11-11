import type { MacroOpts } from '@macro-inc/sdk';
import type { Configured } from './startup.ts';

/** A service the SDK talks to. */
export type ServiceName = keyof NonNullable<MacroOpts['hosts']>;

export type Hosts = Partial<Record<ServiceName, string>>;

/** Where the agent reaches Macro: each service's host, and the socket its presence is kept on. */
export type Addresses = {
  readonly hosts: Hosts;
  readonly presence: string;
};

/** The public gateway origin enrollment gives, which every route below is under. */
export const gatewayKey = 'MACRO_GATEWAY';
const websocketKey = 'OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL';
const connectionService: ServiceName = 'connection';

/**
 * Each service the SDK knows: the `OVERRIDE_*` URL Macro's services are
 * configured with (`crates/macro_service_urls`), which enrollment writes for
 * the ones an agent needs, and the gateway's route to it otherwise.
 * `static-files` has neither (it isn't behind the gateway), so it is left to
 * the SDK.
 */
const services: ReadonlyArray<{
  readonly name: ServiceName;
  readonly override: string;
  readonly route: string;
}> = [
  {
    name: 'storage',
    override: 'OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL',
    route: '/dss',
  },
  {
    name: 'properties',
    override: 'OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL',
    route: '/dss',
  },
  {
    name: 'search',
    override: 'OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL',
    route: '/dss',
  },
  { name: 'auth', override: 'OVERRIDE_AUTH_SERVICE_URL', route: '/auth' },
  {
    name: 'cognition',
    override: 'OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL',
    route: '/cognition',
  },
  {
    name: 'agent-harness',
    override: 'OVERRIDE_AGENT_HARNESS_SERVICE_URL',
    route: '/agent-harness',
  },
  {
    name: 'scheduled-action',
    override: 'OVERRIDE_SCHEDULED_ACTION_SERVICE_URL',
    route: '/scheduled-action',
  },
  { name: 'email', override: 'OVERRIDE_EMAIL_SERVICE_URL', route: '/email' },
  {
    name: 'calendar',
    override: 'OVERRIDE_CALENDAR_SERVICE_URL',
    route: '/calendar',
  },
  {
    name: 'notification',
    override: 'OVERRIDE_NOTIFICATION_SERVICE_URL',
    route: '/notification',
  },
  {
    name: 'contacts',
    override: 'OVERRIDE_CONTACTS_SERVICE_URL',
    route: '/contacts',
  },
  { name: 'unfurl', override: 'OVERRIDE_UNFURL_SERVICE_URL', route: '/unfurl' },
  {
    name: connectionService,
    override: 'OVERRIDE_CONNECTION_GATEWAY_URL',
    route: '/connection-gateway',
  },
];

const trimmed = (url: string): string => url.replace(/\/+$/, '');

const parses = (url: string): boolean => {
  try {
    return new URL(url).host !== '';
  } catch {
    return false;
  }
};

/** The same address over the other protocol: `wss` for `https`, and back. */
const swapped = (url: string, from: string, to: string): string =>
  url.startsWith(from) ? `${to}${url.slice(from.length)}` : url;

/**
 * Where the agent reaches Macro, from its credentials (enrollment's
 * `agent.env`, or a self-hosted agent's secrets). It needs `MACRO_GATEWAY`;
 * nothing falls back to Macro's production hosts. A message names a key,
 * never its value.
 */
export const addresses = (
  values: Readonly<Record<string, string>>
): Configured<Addresses> => {
  const raw = values[gatewayKey];
  if (raw === undefined || raw === '')
    return {
      kind: 'invalid',
      message: `${gatewayKey} is not in the credentials`,
    };
  const named = [
    gatewayKey,
    websocketKey,
    ...services.map(({ override }) => override),
  ];
  const broken = named.find((key) => {
    const value = values[key];
    return value !== undefined && value !== '' && !parses(value);
  });
  if (broken !== undefined)
    return { kind: 'invalid', message: `${broken} is not a URL` };
  const gateway = trimmed(raw);
  const websocket = values[websocketKey];
  const presence =
    websocket === undefined || websocket === ''
      ? `${swapped(swapped(gateway, 'https:', 'wss:'), 'http:', 'ws:')}/connection-gateway`
      : trimmed(websocket);
  const hosts: Hosts = Object.fromEntries(
    services.map(({ name, override, route }) => {
      const given = values[override];
      if (given !== undefined && given !== '') return [name, trimmed(given)];
      // The connection gateway's HTTP API is where its socket is.
      if (
        name === connectionService &&
        websocket !== undefined &&
        websocket !== ''
      )
        return [
          name,
          swapped(swapped(presence, 'wss:', 'https:'), 'ws:', 'http:'),
        ];
      return [name, `${gateway}${route}`];
    })
  );
  return { kind: 'configured', value: { hosts, presence } };
};
