import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSettings: vi.fn(),
  openAgentsPage: vi.fn(),
  requestConnectApp: vi.fn(),
  pipedreamSlugs: new Set<string>(),
  cursor: {
    isSuccess: true,
    isLoading: false,
    get isPending(): boolean {
      return this.isLoading;
    },
    data: { registered: false },
  },
  codex: {
    isLoading: false,
    get isPending(): boolean {
      return this.isLoading;
    },
    data: { connected: false, environmentId: null as string | null },
  },
  claude: {
    isLoading: false,
    get isPending(): boolean {
      return this.isLoading;
    },
    data: { connected: false },
  },
}));
vi.mock('@app/features/agents-view/primitives/open-page', () => ({
  openAgentsPage: mocks.openAgentsPage,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|reader@example.com',
}));
vi.mock('@queries/auth/codex', () => ({
  useCodexStatusQuery: vi.fn(() => mocks.codex),
}));
vi.mock('@queries/claude-auth/connection', () => ({
  useClaudeConnectionStatusQuery: vi.fn(() => mocks.claude),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
}));
vi.mock('@core/pipedream/pendingConnect', () => ({
  requestConnectApp: mocks.requestConnectApp,
}));
vi.mock('@core/pipedream/ConnectorIcon', () => ({
  PipedreamConnectorIcon: () => <span data-pipedream-icon />,
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectedSlugs: () => ({
    ready: () => true,
    slugs: () => mocks.pipedreamSlugs,
  }),
}));
vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: vi.fn(() => mocks.cursor),
}));
// Reached through LexicalWrapperContext; the plugin barrel is far heavier
// than the context object this chip reads its selection from.
vi.mock('../../plugins', () => ({}));

import { ConnectApp } from './ConnectApp';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pipedreamSlugs.clear();
  mocks.cursor.isLoading = false;
  mocks.codex.isLoading = false;
  mocks.codex.data = { connected: false, environmentId: null };
  mocks.claude.isLoading = false;
  mocks.claude.data = { connected: false };
  mocks.cursor.data = { registered: false };
});

describe('connect-app chip', () => {
  it('sends a Pipedream chip to Connections with the app queued', () => {
    render(() => (
      <ConnectApp
        appSlug="linear"
        name="Linear"
        target="connections"
        key="node"
        theme={{}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    expect(mocks.requestConnectApp).toHaveBeenCalledWith('linear');
    expect(mocks.openAgentsPage).toHaveBeenCalledWith({}, 'connections');
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });

  it('sends a harness chip to the Harness page without touching Pipedream', () => {
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="harness"
        key="node"
        theme={{}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cursor' }));
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
    expect(mocks.requestConnectApp).not.toHaveBeenCalled();
  });

  it('reads as connected once the reader has a Cursor key, and stops navigating', () => {
    mocks.cursor.data = { registered: true };
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="harness"
        key="node"
        theme={{}}
      />
    ));
    const chip = screen.getByRole('button', { name: 'Cursor connected' });
    fireEvent.click(chip);
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });

  it('keeps unknown harnesses connectable without fetching Cursor status', () => {
    mocks.cursor.data = { registered: true };
    render(() => (
      <ConnectApp
        appSlug="another-harness"
        name="Another harness"
        target="harness"
        key="node"
        theme={{}}
      />
    ));

    const enabled = vi.mocked(useCursorApiKeyStatusQuery).mock.calls[0][0];
    expect(enabled?.()).toBe(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Another harness' })
    );
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
  });

  it('renders a connect action while the harness status is loading', () => {
    mocks.cursor.isLoading = true;
    mocks.cursor.data = { registered: true };
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="harness"
        key="node"
        theme={{}}
      />
    ));

    expect(screen.getByRole('button', { name: 'Connect Cursor' })).toBeTruthy();
  });

  it.each([
    ['codex-cloud', 'Codex'],
    ['claude-cloud', 'Claude'],
  ])(
    'opens Harness settings for an unconnected %s account',
    (appSlug, name) => {
      render(() => (
        <ConnectApp
          appSlug={appSlug}
          name={name}
          target="harness"
          key="node"
          theme={{}}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: `Connect ${name}` }));
      expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
      expect(mocks.requestConnectApp).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['codex-cloud', 'Codex'],
    ['claude-cloud', 'Claude'],
  ])('recognizes the reader’s connected %s account', (appSlug, name) => {
    mocks.codex.data = { connected: true, environmentId: 'env-selected' };
    mocks.claude.data = { connected: true };
    render(() => (
      <ConnectApp
        appSlug={appSlug}
        name={name}
        target="harness"
        key="node"
        theme={{}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: `${name} connected` }));
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });

  it('keeps Codex setup available until an environment is selected', () => {
    mocks.codex.data = { connected: true, environmentId: null };
    render(() => (
      <ConnectApp
        appSlug="codex-cloud"
        name="Codex"
        target="harness"
        key="node"
        theme={{}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Codex' }));
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
  });

  it('does not let a Cursor key satisfy a Pipedream chip for an app of the same name', () => {
    mocks.cursor.data = { registered: true };
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="connections"
        key="node"
        theme={{}}
      />
    ));
    expect(screen.getByRole('button', { name: 'Connect Cursor' })).toBeTruthy();
  });
});
