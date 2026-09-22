/**
 * @vitest-environment jsdom
 */

import {
  clearAllDebugSettings,
  DEBUG_SETTING_KEYS,
  setDebugSetting,
} from '@app/lib/debugSettings';
import {
  fireEvent,
  render as renderSolid,
  screen,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedView } from './ConnectedView';
import { toConnectionsModel } from './model';
import {
  ConnectionsViewProvider,
  createConnectionsViewState,
} from './view-state';

let view = createConnectionsViewState();
const render = (ui: () => JSX.Element) =>
  renderSolid(() => (
    <ConnectionsViewProvider value={view}>{ui()}</ConnectionsViewProvider>
  ));

vi.mock('@ui', async (importOriginal) => {
  const { mockUiWithDropdown } = await import('./mock-dropdown');
  return mockUiWithDropdown(() => importOriginal<typeof import('@ui')>());
});

const connectedLinear = toConnectionsModel({
  pipedream: [{ app_slug: 'linear', server_name: 'Linear', enabled: true }],
  nativeMcp: [],
});

afterEach(() => {
  clearAllDebugSettings();
  view = createConnectionsViewState();
});

describe('ConnectedView', () => {
  it('lists connected providers when the debug setting is off', () => {
    render(() => <ConnectedView model={connectedLinear} />);
    expect(screen.getByText('Linear')).toBeTruthy();
    expect(screen.queryByText('Start with a connection')).toBeNull();
  });

  it('shows the empty starters when Force empty states is on', () => {
    setDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES, true);
    render(() => <ConnectedView model={connectedLinear} />);
    expect(screen.getByText('Start with a connection')).toBeTruthy();
    expect(screen.getByText('Browse all Connections')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Add a connection' })
    ).toBeNull();
  });

  it('lists native leftovers in a Custom MCP section', () => {
    const leftoverNative = toConnectionsModel({
      pipedream: [{ app_slug: 'linear', server_name: 'Linear', enabled: true }],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: true,
          enabled: true,
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(() => (
      <QueryClientProvider client={client}>
        <ConnectedView model={leftoverNative} />
      </QueryClientProvider>
    ));
    expect(screen.getByText('Linear')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Custom MCP' })).toBeTruthy();
    expect(screen.getByText('Servers you added by URL.')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText('example.com/mcp')).toBeTruthy();
    expect(screen.queryByText('Enabled')).toBeNull();
    expect(screen.queryByText('Disabled')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.queryByText('Other Connections')).toBeNull();
  });

  it('hides the connectors card when only a custom MCP is connected', () => {
    const onlyCustom = toConnectionsModel({
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: true,
          enabled: true,
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(() => (
      <QueryClientProvider client={client}>
        <ConnectedView model={onlyCustom} />
      </QueryClientProvider>
    ));
    expect(screen.queryByText('Cursor')).toBeNull();
    expect(screen.queryByText('Start with a connection')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Custom MCP' })).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('puts Connect on the row when a custom MCP is not authenticated', () => {
    const unauthenticated = toConnectionsModel({
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: false,
          enabled: false,
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(() => (
      <QueryClientProvider client={client}>
        <ConnectedView model={unauthenticated} />
      </QueryClientProvider>
    ));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Connect' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Disconnect' })).toBeNull();
  });

  it('shows Enable for a paused custom MCP', () => {
    const paused = toConnectionsModel({
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: true,
          enabled: false,
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(() => (
      <QueryClientProvider client={client}>
        <ConnectedView model={paused} />
      </QueryClientProvider>
    ));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Off' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeTruthy();
  });

  it('opens a provider when the empty starter card is clicked', () => {
    setDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES, true);
    render(() => <ConnectedView model={connectedLinear} />);
    fireEvent.click(screen.getByRole('button', { name: /Linear/ }));
    expect(view.provider()).toBe('linear');
    expect(screen.queryByText('Cursor')).toBeNull();
  });
});
