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
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectedView } from './ConnectedView';
import { toConnectionsModel } from './model';

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
    expect(screen.queryByRole('button', { name: 'Add a connection' })).toBeNull();
  });

  it('lists leftover grants in the same card as providers', () => {
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
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.queryByText('Other Connections')).toBeNull();
    expect(screen.queryByText(/other connection/)).toBeNull();
  });

  it('opens Google when the empty starter card is clicked', () => {
    setDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES, true);
    render(() => <ConnectedView model={connectedCursor} />);
    fireEvent.click(screen.getByRole('button', { name: /Start with Google/ }));
    expect(connectionsRest()).toBe('google');
  });
});
