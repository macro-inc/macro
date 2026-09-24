import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorStep } from './ConnectorStep';

const state = vi.hoisted(() => ({
  hosted: false,
  connecting: vi.fn(),
  enableNative: vi.fn(),
  enableHosted: vi.fn(),
}));
const [nativeAuthenticated, setNativeAuthenticated] = createSignal(false);
const [hostedEnabled, setHostedEnabled] = createSignal(false);
const [githubStatus, setGithubStatus] = createSignal('unlinked');
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/pipedream/flag', () => ({
  usePipedreamMcpFlag: () => () => state.hosted,
}));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogConnect: () => ({
    busy: () => false,
    connect: state.connecting,
  }),
}));
vi.mock('../useConnectorConnect', () => ({
  createConnectorConnect: () => ({
    busy: () => false,
    connect: state.connecting,
  }),
}));
vi.mock('@queries/mcp-servers', () => ({
  useMcpServersQuery: () => ({
    isSuccess: true,
    isPending: false,
    isPlaceholderData: false,
    get data() {
      return [
        {
          url: 'https://mcp.notion.com/mcp',
          authenticated: nativeAuthenticated(),
          enabled: true,
        },
      ];
    },
  }),
  useUpdateMcpServerMutation: () => ({ mutateAsync: state.enableNative }),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectionsQuery: () => ({
    isSuccess: true,
    isPending: false,
    isPlaceholderData: false,
    get data() {
      return [
        { app_slug: 'notion', enabled: hostedEnabled() },
        { app_slug: 'figma', enabled: hostedEnabled() },
      ];
    },
  }),
  useUpdatePipedreamConnectionMutation: () => ({
    mutateAsync: state.enableHosted,
  }),
}));
vi.mock('@queries/import', () => ({
  useImportQuery: () => ({ isSuccess: true, data: { runs: [], entities: [] } }),
  useRetryGatherMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@queries/auth', () => ({
  useGithubLinkStatusQuery: () => ({
    isSuccess: true,
    get data() {
      return { status: githubStatus() };
    },
  }),
  useInitGithubLinkMutation: () => ({ mutateAsync: vi.fn() }),
  useReauthenticateGithubMutation: () => ({ mutateAsync: vi.fn() }),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.hosted = false;
  setNativeAuthenticated(false);
  setHostedEnabled(false);
  setGithubStatus('unlinked');
});

describe('dedicated onboarding connections', () => {
  it('requires authenticated native credentials, not merely an MCP row', () => {
    const view = render(() => (
      <ConnectorStep
        integration={{ id: 'notion', name: 'Notion' }}
        onContinue={() => {}}
        onSkip={() => {}}
      />
    ));
    expect(view.getByRole('button', { name: 'Connect Notion' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(state.connecting).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Connect Notion' }));
    expect(state.connecting).toHaveBeenCalledOnce();
    setNativeAuthenticated(true);
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(
      view.getByText(/Pages are supported; Notion databases are not imported/)
    ).toBeTruthy();
  });
  it('re-enables an existing Pipedream connection instead of asking for OAuth again', () => {
    state.hosted = true;
    const view = render(() => (
      <ConnectorStep
        integration={{ id: 'notion', name: 'Notion' }}
        onContinue={() => {}}
        onSkip={() => {}}
      />
    ));
    fireEvent.click(view.getByRole('button', { name: 'Enable Notion' }));
    expect(state.enableHosted).toHaveBeenCalledWith({
      app_slug: 'notion',
      enabled: true,
    });
    expect(state.connecting).not.toHaveBeenCalled();
    setHostedEnabled(true);
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
  it('uses the generic catalog connection for integrations without an importer', () => {
    const view = render(() => (
      <ConnectorStep
        integration={{ id: 'figma', name: 'Figma' }}
        onContinue={() => {}}
        onSkip={() => {}}
      />
    ));
    expect(
      view.getByText(/does not automatically migrate your data/)
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Enable Figma' }));
    expect(state.enableHosted).toHaveBeenCalledWith({
      app_slug: 'figma',
      enabled: true,
    });
  });
  it('locks repository installation until the GitHub account is actually linked', () => {
    const view = render(() => (
      <ConnectorStep
        integration={{ id: 'github', name: 'GitHub' }}
        onContinue={() => {}}
        onSkip={() => {}}
      />
    ));
    expect(
      view.queryByRole('link', { name: 'Choose repositories on GitHub' })
    ).toBeNull();
    expect(view.getByText('Connect your account first')).toBeTruthy();
    setGithubStatus('reauthentication_required');
    expect(view.getByRole('button', { name: 'Reconnect GitHub' })).toBeTruthy();
    expect(
      view.queryByRole('link', { name: 'Choose repositories on GitHub' })
    ).toBeNull();
    setGithubStatus('linked');
    expect(
      view
        .getByRole('link', { name: 'Choose repositories on GitHub' })
        .getAttribute('href')
    ).toContain('/github/install-sync');
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});
