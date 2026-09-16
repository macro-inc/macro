import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgentRoster } from '../core/roster';
import { NewChatPage } from './NewChatPage';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user',
  useAuthor: () => () => 'Test User',
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@app/features/block-agent/context/recent-agent-selections', () => ({
  // An old sandbox selection must not keep Code from selecting Cursor.
  createRecentAgentSelections: () => ({
    ids: () => [MACRO_CODER_BOT_ID],
    remember: vi.fn(),
  }),
}));
vi.mock('../primitives/recent-repositories', () => ({
  createRecentRepositories: () => ({ urls: () => [], remember: vi.fn() }),
}));
vi.mock('../components/AgentGlyph', () => ({
  AgentIcon: () => <span />,
  AgentAvatar: () => <span />,
}));

// Exercise the page's actual model menu and send wiring without Lexical.
type ComposerProps = {
  modelSelector: JSX.Element;
  agentSelector: JSX.Element;
  modeSelector: JSX.Element;
  drawer: JSX.Element;
  drawerOpen: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (prompt: string) => void;
};
vi.mock('../components/ChatComposer', () => ({
  ChatComposer: (props: ComposerProps) => (
    <>
      {props.modeSelector}
      {props.agentSelector}
      {props.modelSelector}
      <div data-testid="drawer" hidden={!props.drawerOpen}>
        {props.drawer}
      </div>
      <input
        aria-label="Draft"
        value={props.draft}
        onInput={(event) => props.onDraftChange(event.currentTarget.value)}
      />
      <button onClick={() => props.onSend(props.draft || 'Prompt')}>
        Send
      </button>
    </>
  ),
}));
vi.mock('@queries/agents/models', () => ({
  useAgentModelsQueries: (targets: () => { harness: string }[]) => [
    {
      get isSuccess() {
        return targets().length > 0;
      },
      get data() {
        const target = targets()[0];
        if (!target)
          throw new Error('Cannot read a disabled discovery request');
        return {
          status: 'available',
          currentModel: `${target.harness}-default`,
          models: [
            { id: `${target.harness}-default`, name: 'Discovered default' },
            {
              id: `${target.harness}-alternative`,
              name: 'Discovered alternative',
            },
          ],
        };
      },
    },
  ],
}));

function page(initialMode: 'chat' | 'code', connected = true) {
  const onStart = vi.fn();
  const [mode, setMode] = createSignal(initialMode);
  render(() => (
    <NewChatPage
      mode={mode()}
      onModeChange={setMode}
      roster={buildAgentRoster({
        agents: [],
        runtimes: [],
        cursorConnected: connected,
        cursorNeedsConnection: !connected,
      })}
      rosterLoading={false}
      onStart={onStart}
      onOpenRoster={vi.fn()}
    />
  ));
  return onStart;
}

describe('new conversation model selection', () => {
  let motionStyles: HTMLStyleElement;
  beforeEach(() => {
    // jsdom omits the CSS motion defaults required by Kobalte's presence tracking.
    motionStyles = document.createElement('style');
    motionStyles.textContent =
      '[role="menu"] { animation-name: none; transition-duration: 0s; }';
    document.head.append(motionStyles);
    vi.stubGlobal('scrollTo', vi.fn());
  });
  afterEach(() => {
    cleanup();
    motionStyles.remove();
    vi.unstubAllGlobals();
  });
  it('defaults Code to Cursor and sends the model chosen from discovery', async () => {
    const send = page('code');
    expect(
      screen.getByRole('heading', { name: 'What should we build?' })
    ).toBeTruthy();
    const model = screen.getByRole('button', { name: 'Model' });
    expect(model.textContent).toBe('default (Discovered default)');
    expect(screen.queryByText('Macro Coding Agent')).toBeNull();
    fireEvent.keyDown(model, { key: 'Enter' });
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: /Discovered alternative/ }),
      { key: 'Enter' }
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(model.textContent).toBe('Discovered alternative');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: CURSOR_BOT_ID,
      modelOverride: 'cursor-alternative',
      repoUrl: undefined,
    });
  });

  it('uses in-memory discovery for Chat', async () => {
    const send = page('chat');
    expect(
      screen.getByRole('heading', { name: 'What should we work on?' })
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: /Discovered alternative/ }),
      { key: 'Enter' }
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: undefined,
      modelOverride: 'in-memory-alternative',
      repoUrl: undefined,
    });
  });

  it('requires connecting Cursor instead of falling back to a sandbox', async () => {
    const send = page('code', false);
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toBe(
      'Select model'
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
      key: 'Enter',
    });
    expect(screen.getByRole('status').textContent).toBe(
      'Connect the runtime to load models.'
    );
    expect(
      screen.getByRole('menuitem', { name: 'Connect Cursor' })
    ).toBeTruthy();
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'Connect Cursor' }),
      { key: 'Enter' }
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).not.toHaveBeenCalled();
  });
  it('switches mode in the composer, filters agents, and restores each draft and model', async () => {
    const send = page('chat');
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Chat draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('option', { name: /Macro/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Cursor/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Code mode' }));
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Add repository/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Add repository' }), {
      target: { value: 'macro-inc/macro' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add repository' }), {
      key: 'Enter',
    });
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('');
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Code draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('option', { name: /Cursor/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Macro/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: /Discovered alternative/ }),
      { key: 'Enter' }
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Chat mode' }));
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(true);
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Chat draft');
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain(
      'Discovered default'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Code mode' }));
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Code draft');
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toBe(
      'Discovered alternative'
    );
    expect(
      screen.getByRole('button', { name: /macro-inc\/macro/ })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        botId: CURSOR_BOT_ID,
        prompt: 'Code draft',
        repoUrl: 'https://github.com/macro-inc/macro',
        modelOverride: 'cursor-alternative',
      })
    );
  });
});
