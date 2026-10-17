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

import { MessageProvider } from '@app/features/channel/Message/context';
import type { MessageData } from '@core/messages/types';
import { AppConnectionContext } from '@core/pipedream/connection-context';
import {
  $createConnectAppNode,
  ConnectAppNode,
} from '@macro-inc/lexical-core/nodes/ConnectAppNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import {
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { ConnectApp } from './ConnectApp';

/** An editor holding one connect button, alone on its line or in a sentence. */
function editorWithButton(alone: boolean): {
  editor: LexicalEditor;
  key: string;
} {
  const editor = createEditor({
    nodes: [ConnectAppNode],
    onError: (error) => {
      throw error;
    },
  });
  let key = '';
  editor.update(
    () => {
      const node = $createConnectAppNode('linear', 'Linear', 'connections');
      key = node.getKey();
      const paragraph = $createParagraphNode();
      if (!alone) paragraph.append($createTextNode('You can also '));
      paragraph.append(node);
      $getRoot().append(paragraph);
    },
    { discrete: true }
  );
  return { editor, key };
}

/** A reply from the agent Ada, which `askedBy` prompted. */
function agentReply(askedBy: string): MessageData {
  return {
    id: 'reply',
    content: '',
    sender_id: 'bot|ada',
    sender: { id: 'ada', type: 'bot', name: 'Ada', triggered_by: askedBy },
    created_at: '2026-10-12T10:00:00Z',
    updated_at: '2026-10-12T10:00:00Z',
    attachments: [],
    reactions: [],
  };
}

/** A card for Linear inside Ada's reply, connecting in place. */
function renderCard(
  connection: Partial<{
    connecting: () => string | undefined;
    failed: () => string | undefined;
    resumed: () => ReadonlySet<string>;
  }> = {},
  askedBy = 'macro|reader@example.com'
) {
  const connect = vi.fn(async () => {});
  render(() => (
    <MessageProvider value={() => agentReply(askedBy)}>
      <AppConnectionContext.Provider
        value={{ connect, disabled: () => false, ...connection }}
      >
        <ConnectApp
          appSlug="linear"
          name="Linear"
          target="connections"
          key="node"
          theme={{}}
          standalone
        />
      </AppConnectionContext.Provider>
    </MessageProvider>
  ));
  return connect;
}

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
  it('connects in place when an agent session owns the continuation', () => {
    const connect = vi.fn(async () => {});
    render(() => (
      <AppConnectionContext.Provider value={{ connect, disabled: () => false }}>
        <ConnectApp
          appSlug="linear"
          name="Linear"
          target="connections"
          key="node"
          theme={{}}
        />
      </AppConnectionContext.Provider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    expect(connect).toHaveBeenCalledExactlyOnceWith(
      { appSlug: 'linear', name: 'Linear' },
      undefined
    );
    expect(mocks.openAgentsPage).not.toHaveBeenCalled();
    expect(mocks.requestConnectApp).not.toHaveBeenCalled();
  });

  it('disables connection while the agent session cannot safely continue', () => {
    const connect = vi.fn(async () => {});
    render(() => (
      <AppConnectionContext.Provider value={{ connect, disabled: () => true }}>
        <ConnectApp
          appSlug="linear"
          name="Linear"
          target="connections"
          key="node"
          theme={{}}
        />
      </AppConnectionContext.Provider>
    ));
    expect(
      screen
        .getByRole('button', { name: 'Connect Linear' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(connect).not.toHaveBeenCalled();
  });

  it('is a card when the reply is waiting on it, a chip inside a sentence', () => {
    for (const alone of [true, false]) {
      const { editor, key } = editorWithButton(alone);
      const view = render(() => (
        <LexicalWrapperContext.Provider
          value={{ editor } as unknown as LexicalWrapper}
        >
          <ConnectApp
            appSlug="linear"
            name="Linear"
            target="connections"
            key={key}
            theme={{}}
          />
        </LexicalWrapperContext.Provider>
      ));
      const card = view.container.querySelector('[data-agent-card="connect"]');
      expect(!!card).toBe(alone);
      if (alone) {
        expect(view.getByText('Needed to continue')).toBeTruthy();
        fireEvent.click(view.getByRole('button', { name: 'Connect' }));
        expect(mocks.requestConnectApp).toHaveBeenCalledWith('linear');
      }
      view.unmount();
    }
  });

  it('opens Connections where the surface does not connect in place', () => {
    const connect = vi.fn(async () => {});
    render(() => (
      <AppConnectionContext.Provider
        value={{ connect, disabled: () => false, enabled: () => false }}
      >
        <ConnectApp
          appSlug="linear"
          name="Linear"
          target="connections"
          key="node"
          theme={{}}
        />
      </AppConnectionContext.Provider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    expect(connect).not.toHaveBeenCalled();
    expect(mocks.requestConnectApp).toHaveBeenCalledWith('linear');
  });

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

  it('asks for the app in the agent’s name, on a line of its own', () => {
    const connect = renderCard();
    expect(screen.getByText('Connect Linear')).toBeTruthy();
    expect(screen.getByText('Ada needs it to continue')).toBeTruthy();
    expect(screen.getByText("Ada carries on once it's connected")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    // The reply it sits in, so the surface can tell whether the agent is
    // still waiting on this reply once the app is connected.
    expect(connect).toHaveBeenCalledExactlyOnceWith(
      { appSlug: 'linear', name: 'Linear' },
      { messageId: 'reply', postedAt: '2026-10-12T10:00:00Z' }
    );
  });

  it('says the sign-in is open, and takes no second click', () => {
    const connect = renderCard({ connecting: () => 'linear' });
    const button = screen.getByRole('button', { name: 'Connecting…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Finish signing in to Linear')).toBeTruthy();
    fireEvent.click(button);
    expect(connect).not.toHaveBeenCalled();
  });

  it('says a failed attempt failed, and offers it again', () => {
    const connect = renderCard({ failed: () => 'linear' });
    expect(screen.getByRole('alert').textContent).toBe(
      "Couldn't connect Linear"
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(connect).toHaveBeenCalledOnce();
  });

  it('shrinks to a receipt once connected, and says the agent carried on', () => {
    mocks.pipedreamSlugs.add('linear');
    renderCard({ resumed: () => new Set(['linear']) });
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Ada is carrying on')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows someone the agent does not work for who it is waiting on', () => {
    const connect = renderCard({}, 'macro|maya@example.com');
    expect(screen.getByText(/^Waiting on .+ to connect it$/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(connect).not.toHaveBeenCalled();
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
