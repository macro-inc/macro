/**
 * @vitest-environment jsdom
 */

import {
  clearPendingConnectApp,
  pendingConnectApp,
  requestConnectApp,
} from '@core/pipedream/pendingConnect';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsPage } from './ConnectionsPage';

const mocks = vi.hoisted(() => ({
  openSettings: vi.fn(),
  connect: vi.fn(async () => 'closed'),
  ready: true,
  error: null as Error | null,
}));

vi.mock('@queries/pipedream-connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/pipedream-connectors')>()),
  connectPipedreamApp: mocks.connect,
}));

vi.mock('./use-connections-model', () => ({
  useConnectionsModel: () => ({
    model: () => ({
      capabilities: [],
      leftovers: [],
      providers: [],
    }),
    ready: () => mocks.ready,
    error: () => mocks.error,
    retry: vi.fn(),
    partialError: () => false,
  }),
}));

afterEach(() => {
  mocks.openSettings.mockClear();
  mocks.connect.mockClear();
  clearPendingConnectApp();
  mocks.ready = true;
  mocks.error = null;
});

describe('ConnectionsPage', () => {
  it('consumes agent reply connection requests before and after mounting', async () => {
    requestConnectApp('linear');
    render(() => <ConnectionsPage onOpenMacroMcp={mocks.openSettings} />);
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ appSlug: 'linear' })
    );
    expect(pendingConnectApp()).toBeUndefined();
    requestConnectApp('notion');
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ appSlug: 'notion' })
    );
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('signposts outbound Macro MCP to the MCP server tab', () => {
    render(() => <ConnectionsPage onOpenMacroMcp={mocks.openSettings} />);

    fireEvent.click(screen.getByRole('button', { name: 'Macro MCP' }));

    expect(mocks.openSettings).toHaveBeenCalledOnce();
    expect(screen.queryByText('Cursor')).toBeNull();
  });
});
