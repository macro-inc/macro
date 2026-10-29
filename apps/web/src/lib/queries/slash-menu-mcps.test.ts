import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlashMenuMcps } from './slash-menu-mcps';

const data = vi.hoisted(() => ({
  nativePending: false,
  pipedreamPending: false,
  nativeError: false,
  pipedreamError: false,
  pipedream: [] as {
    app_slug: string;
    server_name: string;
    enabled: boolean;
  }[],
  native: [] as {
    url: string;
    server_name: string;
    enabled: boolean;
    authenticated: boolean;
  }[],
}));

vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectionsQuery: () => ({
    get data() {
      return data.pipedream;
    },
    get isPlaceholderData() {
      return data.pipedreamPending;
    },
    get isPending() {
      return data.pipedreamPending;
    },
    get isError() {
      return data.pipedreamError;
    },
  }),
}));
vi.mock('@queries/mcp-servers', () => ({
  useMcpServersQuery: () => ({
    get data() {
      return data.native;
    },
    get isPlaceholderData() {
      return data.nativePending;
    },
    get isPending() {
      return data.nativePending;
    },
    get isError() {
      return data.nativeError;
    },
  }),
}));

function listMcps() {
  return createRoot((dispose) => {
    const result = useSlashMenuMcps(() => true).mcps();
    dispose();
    return result;
  });
}

beforeEach(() => {
  data.nativePending = false;
  data.pipedreamPending = false;
  data.nativeError = false;
  data.pipedreamError = false;
  data.pipedream = [];
  data.native = [
    {
      url: 'https://mcp.sentry.dev/mcp',
      server_name: 'Sentry',
      enabled: true,
      authenticated: true,
    },
    {
      url: 'https://mcp.notion.com/mcp',
      server_name: 'Unauthed',
      enabled: true,
      authenticated: false,
    },
    {
      url: 'https://off.example.com/mcp',
      server_name: 'Off',
      enabled: false,
      authenticated: true,
    },
  ];
});

describe('useSlashMenuMcps', () => {
  it('lists enabled, authenticated native servers when there are no Pipedream connections', () => {
    expect(listMcps()).toEqual([
      { id: 'mcp:https://mcp.sentry.dev/mcp', name: 'Sentry', appSlug: null },
    ]);
  });

  it('lists enabled hosted connectors alongside native connections', () => {
    data.pipedream = [
      { app_slug: 'linear', server_name: 'Linear', enabled: true },
      { app_slug: 'asana', server_name: 'Asana', enabled: false },
    ];
    expect(listMcps()).toEqual([
      { id: 'mcp:https://mcp.sentry.dev/mcp', name: 'Sentry', appSlug: null },
      { id: 'pipedream:linear', name: 'Linear', appSlug: 'linear' },
    ]);
  });

  it('keeps native connections when every hosted connector is disabled', () => {
    data.pipedream = [
      { app_slug: 'asana', server_name: 'Asana', enabled: false },
    ];
    expect(listMcps()).toEqual([
      { id: 'mcp:https://mcp.sentry.dev/mcp', name: 'Sentry', appSlug: null },
    ]);
  });
});

it('prefers native credentials per provider and deduplicates endpoint and hosted aliases', () => {
  data.native = [
    {
      url: 'https://mcp.linear.app/mcp/',
      server_name: 'Issue tracker',
      enabled: true,
      authenticated: true,
    },
    {
      url: 'https://mcp.linear.app/mcp',
      server_name: 'Duplicate',
      enabled: true,
      authenticated: true,
    },
  ];
  data.pipedream = [
    { app_slug: 'linear', server_name: 'Linear hosted', enabled: true },
    { app_slug: 'slack_v2', server_name: 'Slack v2', enabled: true },
    { app_slug: 'slack', server_name: 'Slack', enabled: true },
  ];
  expect(listMcps()).toEqual([
    {
      id: 'mcp:https://mcp.linear.app/mcp',
      name: 'Issue tracker',
      appSlug: 'linear',
    },
    { id: 'pipedream:slack', name: 'Slack', appSlug: 'slack' },
  ]);
});

it('includes enabled custom servers that do not require credentials', () => {
  data.native = [
    {
      url: 'https://custom.example.com/mcp',
      server_name: 'Custom',
      enabled: true,
      authenticated: false,
    },
  ];
  expect(listMcps()).toEqual([
    { id: 'mcp:https://custom.example.com/mcp', name: 'Custom', appSlug: null },
  ]);
});

it('does not offer a hosted duplicate while native connections are unresolved', () => {
  data.nativePending = true;
  data.pipedream = [
    { app_slug: 'linear', server_name: 'Linear', enabled: true },
  ];
  expect(listMcps()).toEqual([]);
});

it('retains loaded native connections while hosted connections load', () => {
  data.pipedreamPending = true;
  expect(listMcps()).toEqual([
    { id: 'mcp:https://mcp.sentry.dev/mcp', name: 'Sentry', appSlug: null },
  ]);
});

it('reports initial failures separately from loading', () => {
  data.native = [];
  data.nativeError = true;
  data.pipedreamError = true;
  createRoot((dispose) => {
    const result = useSlashMenuMcps(() => true);
    expect(result.error()).toBe(true);
    expect(result.loading()).toBe(false);
    expect(result.mcps()).toEqual([]);
    dispose();
  });
});
