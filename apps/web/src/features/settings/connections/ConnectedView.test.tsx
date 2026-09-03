/**
 * @vitest-environment jsdom
 */

import {
  clearAllDebugSettings,
  DEBUG_SETTING_KEYS,
  setDebugSetting,
} from '@app/lib/debugSettings';
import {
  connectionsRest,
  setConnectionsRest,
} from '@core/signal/connectionsRest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedView } from './ConnectedView';
import { toConnectionsModel } from './model';

vi.mock('@ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui')>();
  const Dropdown = Object.assign(
    (p: { children?: JSX.Element }) => <>{p.children}</>,
    {
      Trigger: (p: { 'aria-label'?: string; children?: JSX.Element }) => (
        <button type="button" aria-label={p['aria-label']}>
          {p.children}
        </button>
      ),
      Content: (p: { children?: JSX.Element }) => <div>{p.children}</div>,
      Group: (p: { children?: JSX.Element }) => <div>{p.children}</div>,
      Item: (p: { children?: JSX.Element; onSelect?: () => void }) => (
        <div role="menuitem" onClick={() => p.onSelect?.()}>
          {p.children}
        </div>
      ),
    }
  );
  return { ...actual, Dropdown };
});

const connectedCursor = toConnectionsModel({
  userId: 'macro|self',
  emailEnabled: true,
  calendarEnabled: true,
  emailLinks: [],
  github: { status: 'unlinked', username: undefined },
  pipedream: [],
  nativeMcp: [],
  cursorRegistered: true,
});

afterEach(() => {
  clearAllDebugSettings();
  setConnectionsRest(null);
});

describe('ConnectedView', () => {
  it('lists connected providers when the debug setting is off', () => {
    render(() => <ConnectedView model={connectedCursor} />);
    expect(screen.getByText('Cursor')).toBeTruthy();
    expect(screen.queryByText('Start with Google')).toBeNull();
  });

  it('shows the empty starters when Force empty states is on', () => {
    setDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES, true);
    render(() => <ConnectedView model={connectedCursor} />);
    expect(screen.getByText('Start with Google')).toBeTruthy();
    expect(screen.getByText('Browse all Connections')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Add a connection' })
    ).toBeNull();
  });

  it('lists native leftovers in a Custom MCP section', () => {
    const leftoverNative = toConnectionsModel({
      userId: 'macro|self',
      emailEnabled: true,
      calendarEnabled: true,
      emailLinks: [],
      github: { status: 'unlinked', username: undefined },
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: true,
          enabled: true,
        },
      ],
      cursorRegistered: true,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(() => (
      <QueryClientProvider client={client}>
        <ConnectedView model={leftoverNative} />
      </QueryClientProvider>
    ));
    expect(screen.getByText('Cursor')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Custom MCP' })).toBeTruthy();
    expect(screen.getByText('Servers you added by URL.')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.queryByText('Enabled')).toBeNull();
    expect(screen.queryByText('Disabled')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Turn off' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.queryByText('Other Connections')).toBeNull();
  });

  it('hides the connectors card when only a custom MCP is connected', () => {
    const onlyCustom = toConnectionsModel({
      userId: 'macro|self',
      emailEnabled: true,
      calendarEnabled: true,
      emailLinks: [],
      github: { status: 'unlinked', username: undefined },
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: true,
          enabled: true,
        },
      ],
      cursorRegistered: false,
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
    expect(screen.queryByText('Start with Google')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Custom MCP' })).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('puts Connect on the row when a custom MCP is not authenticated', () => {
    const unauthenticated = toConnectionsModel({
      userId: 'macro|self',
      emailEnabled: true,
      calendarEnabled: true,
      emailLinks: [],
      github: { status: 'unlinked', username: undefined },
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: false,
          enabled: false,
        },
      ],
      cursorRegistered: false,
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
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeTruthy();
  });

  it('shows Turn on and Off for a paused custom MCP', () => {
    const paused = toConnectionsModel({
      userId: 'macro|self',
      emailEnabled: true,
      calendarEnabled: true,
      emailLinks: [],
      github: { status: 'unlinked', username: undefined },
      pipedream: [],
      nativeMcp: [
        {
          server_name: 'Unknown',
          url: 'https://example.com/mcp',
          authenticated: true,
          enabled: false,
        },
      ],
      cursorRegistered: false,
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
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Off' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Turn off' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeTruthy();
  });

  it('opens Google when the empty starter card is clicked', () => {
    setDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES, true);
    render(() => <ConnectedView model={connectedCursor} />);
    fireEvent.click(screen.getByRole('button', { name: /Start with Google/ }));
    expect(connectionsRest()).toBe('google');
  });
});
