import type { PipedreamProvider } from '@service-cognition/client';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toConnectionsModel } from './model';
import { PipedreamAiProvider } from './PipedreamAiProvider';
import {
  ConnectionsViewProvider,
  createConnectionsViewState,
} from './view-state';

const flag = vi.hoisted(() => ({ on: false }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (requested: { key: string }) => () => ({
    enabled: requested.key === 'macro-connect' && flag.on,
    loading: false,
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogConnect: () => ({
    connect: vi.fn(),
    busy: () => false,
  }),
}));
vi.mock('@queries/auth', () => ({
  useDeleteGithubLinkMutation: () => ({ isPending: false }),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  useDeletePipedreamConnectionMutation: () => ({ isPending: false }),
  useUpdatePipedreamConnectionMutation: () => ({ isPending: false }),
}));
vi.mock('./native-actions', () => ({
  useNativeMcpActions: () => ({
    authorize: { isPending: false },
    update: { isPending: false },
    remove: { isPending: false },
  }),
}));
vi.mock('./slack-channel-import/SlackChannelImportCard', () => ({
  SlackChannelImportCard: () => null,
}));

function renderLinear(provider?: PipedreamProvider) {
  const model = toConnectionsModel({
    pipedream: provider
      ? [{ app_slug: 'linear', server_name: 'Linear', enabled: true, provider }]
      : [],
    nativeMcp: [],
  });
  render(() => (
    <ConnectionsViewProvider value={createConnectionsViewState({})}>
      <PipedreamAiProvider model={model} provider="linear" />
    </ConnectionsViewProvider>
  ));
}

describe('PipedreamAiProvider label', () => {
  beforeEach(() => {
    flag.on = false;
  });
  afterEach(cleanup);

  it('says Macro Connect on a Connect grant with the macro-connect flag on', () => {
    flag.on = true;
    renderLinear('connect');
    expect(screen.getByText('Powered by Macro Connect')).toBeTruthy();
    expect(screen.queryByText(/Pipedream/)).toBeNull();
  });

  it('says Macro Connect before connecting with the flag on', () => {
    flag.on = true;
    renderLinear();
    expect(screen.getByText('Powered by Macro Connect')).toBeTruthy();
  });

  it('keeps the Pipedream label with the flag off', () => {
    renderLinear('pipedream');
    expect(screen.getByText('Powered by Pipedream')).toBeTruthy();
    expect(screen.queryByText(/Macro Connect/)).toBeNull();
  });
});
