import type { Connector, ConnectorStatus } from '@queries/connectors';
import { describe, expect, it } from 'vitest';
import { capabilityFor, toConnectionsModel } from './model';

function app(
  slug: string,
  status: ConnectorStatus = 'connected',
  overrides: Partial<Connector> = {}
): Connector {
  return {
    key: `app/${slug}`,
    target: { type: 'app', slug },
    name: `${slug} account`,
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
    ...overrides,
  };
}

function server(
  url: string,
  status: ConnectorStatus = 'connected',
  name = 'My server'
): Connector {
  return {
    key: `server/${btoa(url).replace(/=+$/, '')}`,
    target: { type: 'server', url },
    name,
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
  };
}

describe('toConnectionsModel', () => {
  it.each([
    ['connected', 'connected'],
    ['disabled', 'off'],
    ['needsReauth', 'action-required'],
    ['notConnected', 'not-connected'],
  ] as const)('shows the server status %s as %s', (status, shown) => {
    const model = toConnectionsModel([
      app('linear', status),
      app('posthog', status),
      server('https://mcp.example.com/mcp', status),
    ]);
    expect(capabilityFor(model, 'linear')?.status).toBe(shown);
    expect(model.leftovers.map((row) => row.status)).toEqual([shown, shown]);
  });

  it('makes Slack one row with the status the server gave it', () => {
    // The server folds `slack` and `slack_v2` into one app; a disabled
    // `slack` never hides a usable `slack_v2` here (section 2, rule 4).
    const model = toConnectionsModel([app('slack', 'connected')]);
    expect(model.capabilities).toEqual([
      expect.objectContaining({
        provider: 'slack',
        key: 'app/slack',
        account: 'slack account',
        status: 'connected',
      }),
    ]);
    expect(model.leftovers).toEqual([]);
  });

  it('lists featured apps as capabilities and everything else as leftovers', () => {
    const model = toConnectionsModel([
      app('github'),
      app('notion', 'connected', { importAvailable: true }),
      app('stripe', 'disabled'),
      server('https://mcp.example.com/mcp/', 'notConnected', 'Example'),
    ]);
    expect(model.capabilities.map((row) => row.provider)).toEqual([
      'github',
      'notion',
    ]);
    expect(capabilityFor(model, 'notion')?.importAvailable).toBe(true);
    expect(capabilityFor(model, 'linear')).toBeUndefined();
    expect(model.leftovers).toEqual([
      {
        kind: 'app',
        id: 'app/stripe',
        key: 'app/stripe',
        title: 'stripe account',
        appSlug: 'stripe',
        status: 'off',
        importAvailable: false,
      },
      {
        kind: 'server',
        id: server('https://mcp.example.com/mcp/').key,
        key: server('https://mcp.example.com/mcp/').key,
        title: 'Example',
        subtitle: 'mcp.example.com/mcp',
        status: 'not-connected',
      },
    ]);
  });

  it('shows a native Linear server as a server added by URL', () => {
    // A native row counts as an app only at the app's overlay address; the
    // server lists any other as a server, whatever it points at (rule 5).
    const model = toConnectionsModel([
      server('https://mcp.linear.app/mcp', 'connected', 'Linear'),
    ]);
    expect(capabilityFor(model, 'linear')).toBeUndefined();
    expect(model.leftovers).toEqual([
      expect.objectContaining({ kind: 'server', title: 'Linear' }),
    ]);
  });
});
