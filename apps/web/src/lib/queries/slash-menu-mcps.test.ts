import type { Connector } from '@queries/connectors';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlashMenuMcps } from './slash-menu-mcps';

const data = vi.hoisted(() => ({
  ready: true,
  error: false,
  list: [] as Connector[],
}));

vi.mock('@queries/connectors', () => ({
  useConnectors: () => ({
    list: () => (data.ready ? data.list : []),
    ready: () => data.ready,
    error: () => data.error,
  }),
}));

function connector(
  overrides: Partial<Connector> & Pick<Connector, 'key' | 'target' | 'name'>
): Connector {
  return {
    status: 'connected',
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
    ...overrides,
  };
}

function slashMenu() {
  return createRoot((dispose) => {
    const result = useSlashMenuMcps(() => true);
    const value = {
      mcps: result.mcps(),
      loading: result.loading(),
      error: result.error(),
    };
    dispose();
    return value;
  });
}

beforeEach(() => {
  data.ready = true;
  data.error = false;
  data.list = [];
});

describe('useSlashMenuMcps', () => {
  it('lists connected servers before connected apps', () => {
    data.list = [
      connector({
        key: 'app/linear',
        target: { type: 'app', slug: 'linear' },
        name: 'Linear',
      }),
      connector({
        key: 'server/c2VudHJ5',
        target: { type: 'server', url: 'https://mcp.sentry.dev/mcp' },
        name: 'Sentry',
      }),
    ];
    expect(slashMenu().mcps).toEqual([
      { id: 'server/c2VudHJ5', name: 'Sentry', appSlug: null },
      { id: 'app/linear', name: 'Linear', appSlug: 'linear' },
    ]);
  });

  it('leaves out what is not connected or gives no tools', () => {
    data.list = (['disabled', 'needsReauth', 'notConnected'] as const).map(
      (status) =>
        connector({
          key: `app/${status}`,
          target: { type: 'app', slug: status },
          name: status,
          status,
        })
    );
    data.list.push(
      connector({
        key: 'app/apionly',
        target: { type: 'app', slug: 'apionly' },
        name: 'API only',
        mcp: false,
      })
    );
    expect(slashMenu().mcps).toEqual([]);
  });

  it('is loading until the list arrives, and reports a failed read', () => {
    data.ready = false;
    expect(slashMenu()).toMatchObject({ mcps: [], loading: true });
    data.error = true;
    expect(slashMenu()).toMatchObject({ loading: false, error: true });
  });
});
