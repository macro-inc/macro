import type { PipedreamConnectionResponse } from '@service-cognition/client';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentProviderItem } from './integration-items';
import type { ConnectionsModel } from './model';

const mocks = vi.hoisted(() => ({ status: 'not-connected' }));

vi.mock('./view-state', () => ({
  useConnectionsView: () => ({ openProvider: vi.fn() }),
}));
vi.mock('./import-action', () => ({
  ImportAction: (props: { name: string }) => (
    <button>Import from {props.name}</button>
  ),
}));
vi.mock('./reconnect-rows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reconnect-rows')>()),
  ReconnectAction: (props: { connection: PipedreamConnectionResponse }) => (
    <button>Reconnect {props.connection.server_name}</button>
  ),
}));
vi.mock('./model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./model')>()),
  capabilitiesFor: () => [{ status: mocks.status }],
}));

const LINEAR = {
  app_slug: 'linear',
  server_name: 'Linear',
} as PipedreamConnectionResponse;

function renderLinear(reconnects: PipedreamConnectionResponse[]) {
  let item: ReturnType<typeof useAgentProviderItem> | undefined;
  render(() => {
    item = useAgentProviderItem(
      () => ({}) as ConnectionsModel,
      'linear',
      () => reconnects
    );
    return <item.Actions />;
  });
  if (!item) throw new Error('item not rendered');
  return item;
}

beforeEach(() => {
  mocks.status = 'not-connected';
});

describe('useAgentProviderItem reconnect', () => {
  it('asks to reconnect on the app row and keeps the importer', () => {
    const item = renderLinear([LINEAR]);

    expect(item.status).toBe('attention');
    expect(item.statusLabel).toBe('Reconnect required');
    expect(
      screen.getByRole('button', { name: 'Reconnect Linear' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Import from Linear' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Linear' })).toBeNull();
  });

  it('offers Connect when there is nothing to reconnect', () => {
    const item = renderLinear([]);

    expect(item.status).toBe('available');
    expect(item.statusLabel).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeTruthy();
  });

  it('stays Manage once the app is connected again', () => {
    mocks.status = 'connected';
    const item = renderLinear([LINEAR]);

    expect(item.status).toBe('connected');
    expect(screen.getByRole('button', { name: 'Manage Linear' })).toBeTruthy();
  });
});
