import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { CreateAgentSessionResponse } from '@service-agent-harness/generated/schemas';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeAgentSession } from './ComposeAgentSession';

const navigation = vi.hoisted(() => ({
  close: vi.fn(),
  open: vi.fn(),
  settings: vi.fn(),
  navigate: vi.fn(),
}));
const cursorConnection = vi.hoisted(() => ({
  registered: true,
  isPlaceholderData: false,
}));
const hotkeys = vi.hoisted(() => ({ submit: (): boolean => false }));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'test-user',
}));
vi.mock('@solidjs/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solidjs/router')>()),
  useNavigate: () => navigation.navigate,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: navigation.settings }),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: navigation.open }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      close: navigation.close,
      isPopover: () => true,
      setDisplayName: vi.fn(),
    },
  }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [vi.fn(), 'test'],
  registerHotkey: (options: { keyDownHandler: () => boolean }) => {
    hotkeys.submit = options.keyDownHandler;
  },
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    isSuccess: true,
    data: [
      {
        bot: {
          id: 'reviewer',
          name: 'Reviewer',
          handle: 'reviewer',
          has_agent: false,
        },
        harness: 'in-memory',
        default_model: 'anthropic/claude-sonnet-5',
      },
      {
        bot: { id: 'coder', name: 'Coder', handle: 'coder', has_agent: true },
        harness: 'in-memory',
        default_model: 'anthropic/claude-opus-5',
      },
    ],
  }),
}));
vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: () => ({
    isSuccess: true,
    data: {
      currentModel: 'anthropic/claude-sonnet-5',
      models: [{ id: 'anthropic/claude-sonnet-5', name: 'Sonnet 5' }],
    },
  }),
}));
vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => ({
    isSuccess: true,
    isPlaceholderData: cursorConnection.isPlaceholderData,
    data: { registered: cursorConnection.registered },
  }),
  useCursorModelsQuery: () => ({
    isSuccess: true,
    data: { models: [] },
  }),
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { create: vi.fn(), control: vi.fn() },
}));

// Keep the real composer and mutations; replace shared visual chrome only.
vi.mock('@ui', () => {
  const Container = (props: { children?: import('solid-js').JSX.Element }) =>
    props.children;
  const Button = (
    props: import('solid-js').JSX.ButtonHTMLAttributes<HTMLButtonElement>
  ) => (
    <button disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  );
  return {
    Button,
    Surface: (
      props: import('solid-js').JSX.HTMLAttributes<HTMLDivElement> & {
        depth?: number;
      }
    ) => (
      <div
        role={props.role}
        aria-label={props['aria-label']}
        data-depth={props.depth}
      >
        {props.children}
      </div>
    ),
    SendButton: (
      props: import('solid-js').JSX.ButtonHTMLAttributes<HTMLButtonElement>
    ) => (
      <button
        aria-label={props['aria-label']}
        disabled={props.disabled}
        onClick={props.onClick}
      />
    ),
    Avatar: Object.assign(Container, {
      Fallback: Container,
      Image: () => null,
    }),
    Dropdown: Object.assign(Container, {
      Trigger: Button,
      Content: Container,
      Group: Container,
      GroupLabel: Container,
      Item: (props: {
        children?: import('solid-js').JSX.Element;
        onSelect: () => void;
      }) => <button onClick={props.onSelect}>{props.children}</button>,
      Sub: Container,
      SubTrigger: Container,
      SubContent: Container,
    }),
    badgeTriggerClasses: () => '',
    cn: () => '',
  };
});

const sessionId = '01991aae-f05b-7000-8000-000000000001';
const created = { session: { id: sessionId } } as CreateAgentSessionResponse;
const failure = err([
  { code: 'SERVER_ERROR' as const, message: 'Request failed' },
]);
let client: QueryClient;

beforeEach(() => {
  cursorConnection.registered = true;
  cursorConnection.isPlaceholderData = false;
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  client = new QueryClient();
  vi.mocked(agentHarnessServiceClient.create).mockResolvedValue(ok(created));
  vi.mocked(agentHarnessServiceClient.control).mockResolvedValue(
    ok({ actionId: 'action-1', status: 'queued' })
  );
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function mount(preferNewSplit = false) {
  render(() => (
    <QueryClientProvider client={client}>
      <ComposeAgentSession preferNewSplit={preferNewSplit} />
    </QueryClientProvider>
  ));
}

function enterPrompt() {
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: '  Fix the tests  ' },
  });
}

describe('agent session creation', () => {
  it('keeps Create agent outside the slider and opens the new-agent form', () => {
    mount();
    const createAgent = screen.getByRole('button', { name: 'Create agent' });
    expect(
      within(screen.getByRole('radiogroup')).queryByRole('button', {
        name: 'Create agent',
      })
    ).toBeNull();
    fireEvent.click(createAgent);
    expect(navigation.close).toHaveBeenCalledOnce();
    expect(navigation.navigate).toHaveBeenCalledWith(
      '/settings/agents?createAgent=true'
    );
    expect(agentHarnessServiceClient.create).not.toHaveBeenCalled();
  });

  it('opens Harness settings from disconnected Cursor without creating a session', () => {
    cursorConnection.registered = false;
    mount();
    const connect = screen.getByRole('button', { name: 'Connect Cursor' });
    expect(connect.getAttribute('aria-disabled')).toBe('false');
    expect(connect.tabIndex).toBe(0);
    fireEvent.click(connect);
    expect(navigation.close).toHaveBeenCalledOnce();
    expect(navigation.settings).toHaveBeenCalledWith('Harness');
    expect(agentHarnessServiceClient.create).not.toHaveBeenCalled();
    expect(navigation.open).not.toHaveBeenCalled();
  });

  it('does not offer connection setup before the connection status is known', () => {
    cursorConnection.registered = false;
    cursorConnection.isPlaceholderData = true;
    mount();
    expect(screen.queryByRole('button', { name: 'Connect Cursor' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Cursor/ }));
    expect(navigation.settings).not.toHaveBeenCalled();
  });

  it('waits for creation and opens the real ID, preventing duplicate submissions', async () => {
    cursorConnection.registered = false;
    let finish!: (
      value: Awaited<ReturnType<typeof agentHarnessServiceClient.create>>
    ) => void;
    vi.mocked(agentHarnessServiceClient.create).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    mount(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    hotkeys.submit();
    await waitFor(() =>
      expect(agentHarnessServiceClient.create).toHaveBeenCalledTimes(1)
    );
    expect(navigation.close).not.toHaveBeenCalled();
    expect(navigation.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cursor' }));
    expect(navigation.settings).not.toHaveBeenCalled();

    const createAgent = screen.getByRole('button', {
      name: 'Create agent',
    }) as HTMLButtonElement;
    expect(createAgent.disabled).toBe(true);
    fireEvent.click(createAgent);
    expect(navigation.navigate).not.toHaveBeenCalled();

    finish(ok(created));
    await waitFor(() =>
      expect(navigation.open).toHaveBeenCalledWith(
        { type: 'agent', id: sessionId },
        { referredFrom: 'launcher', preferNewSplit: true }
      )
    );
    expect(navigation.close).toHaveBeenCalledTimes(1);
    expect(agentHarnessServiceClient.control).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        window.localStorage.getItem('agent-session-recent-v1:test-user') ?? '[]'
      )
    ).toEqual(['macro']);
  });

  it('keeps the prompt and offers retry when creation fails', async () => {
    vi.mocked(agentHarnessServiceClient.create).mockResolvedValueOnce(failure);
    mount();
    enterPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '  Fix the tests  '
    );
    expect(navigation.open).not.toHaveBeenCalled();
    expect(navigation.close).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem('agent-session-recent-v1:test-user')
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(navigation.open).toHaveBeenCalled());
    expect(agentHarnessServiceClient.create).toHaveBeenCalledTimes(2);
  });

  it('sends the selected persona', async () => {
    mount();
    const prompt = screen.getByRole('textbox') as HTMLTextAreaElement;
    const promptBox = within(
      screen.getByRole('group', { name: 'New session prompt' })
    );
    expect(promptBox.getByRole('textbox')).toBe(prompt);
    expect(prompt.rows).toBe(3);
    expect(
      screen
        .getByRole('group', { name: 'New session prompt' })
        .getAttribute('data-depth')
    ).toBe('1');
    expect(
      screen
        .getByRole('radiogroup')
        .closest('[data-depth]')
        ?.getAttribute('data-depth')
    ).toBe('1');
    expect(
      screen.getByRole('heading', { name: 'Start a session' })
    ).toBeTruthy();
    expect(promptBox.queryByRole('radiogroup')).toBeNull();
    expect(
      promptBox.getByRole('button', { name: 'Start session' })
    ).toBeTruthy();
    expect(
      promptBox.getAllByRole('button', { name: 'default (Sonnet 5)' })
    ).toHaveLength(2);
    expect(prompt.placeholder).toBe('What would you like Macro to work on?');
    expect(
      screen.getByRole('radiogroup').compareDocumentPosition(prompt) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(
      screen.getAllByRole('button', { name: 'default (Sonnet 5)' })
    ).toHaveLength(2);
    const macro = within(screen.getByRole('radio', { name: /Macro/ }));
    const cursor = within(screen.getByRole('radio', { name: /Cursor/ }));
    expect(macro.getByText('@macro')).toBeTruthy();
    expect(macro.queryByText(/default/)).toBeNull();
    expect(macro.queryByText('coding')).toBeNull();
    expect(cursor.getByText('@cursor')).toBeTruthy();
    expect(cursor.queryByText('coding')).toBeNull();
    const reviewer = within(screen.getByRole('radio', { name: /Reviewer/ }));
    const coder = within(screen.getByRole('radio', { name: /Coder/ }));
    expect(reviewer.getByText('@reviewer')).toBeTruthy();
    expect(reviewer.queryByText('coding')).toBeNull();
    expect(coder.getByText('@coder')).toBeTruthy();
    expect(coder.queryByText('coding')).toBeNull();
    expect(
      screen.getByText(
        'Starts quickly and runs in-memory. Great for workspace tasks'
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Cursor/ }));
    expect(
      screen.getByText('Bring in Cursor for some heavier coding work')
    ).toBeTruthy();
    expect(
      screen.queryByText(
        'Starts quickly and runs in-memory. Great for workspace tasks'
      )
    ).toBeNull();
    expect(prompt.placeholder).toBe('What would you like Cursor to work on?');
    hotkeys.submit();
    await waitFor(() => expect(navigation.open).toHaveBeenCalled());
    expect(agentHarnessServiceClient.create).toHaveBeenCalledWith({
      botId: CURSOR_BOT_ID,
    });
  });

  it('applies the model before the prompt and does not reapply it on prompt retry', async () => {
    vi.mocked(agentHarnessServiceClient.control)
      .mockResolvedValueOnce(ok({ actionId: 'model-action', status: 'queued' }))
      .mockResolvedValueOnce(failure);
    mount();
    enterPrompt();
    const model = Model.opus5;
    fireEvent.click(
      screen.getByRole('button', { name: MODEL_PRETTYNAME[model] })
    );
    hotkeys.submit();
    await screen.findByRole('alert');
    expect(navigation.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(navigation.open).toHaveBeenCalled());
    expect(agentHarnessServiceClient.control).toHaveBeenNthCalledWith(
      1,
      sessionId,
      { type: 'setModel', model }
    );
    expect(agentHarnessServiceClient.control).toHaveBeenNthCalledWith(
      2,
      sessionId,
      { type: 'prompt', prompt: 'Fix the tests' }
    );
    expect(agentHarnessServiceClient.control).toHaveBeenNthCalledWith(
      3,
      sessionId,
      { type: 'prompt', prompt: 'Fix the tests' }
    );
    expect(agentHarnessServiceClient.create).toHaveBeenCalledTimes(1);
  });

  it('retries a failed prompt on the already-created session', async () => {
    vi.mocked(agentHarnessServiceClient.control).mockResolvedValueOnce(failure);
    mount();
    enterPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Open session' })).toBeDefined();
    expect(navigation.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(navigation.open).toHaveBeenCalled());
    expect(agentHarnessServiceClient.create).toHaveBeenCalledTimes(1);
    expect(agentHarnessServiceClient.control).toHaveBeenCalledTimes(2);
  });

  it('does not send the prompt when model setup fails, and retries on the same session', async () => {
    vi.mocked(agentHarnessServiceClient.control).mockResolvedValueOnce(failure);
    mount();
    enterPrompt();
    const model = Model.opus5;
    fireEvent.click(
      screen.getByRole('button', { name: MODEL_PRETTYNAME[model] })
    );
    hotkeys.submit();
    await screen.findByRole('alert');
    expect(agentHarnessServiceClient.control).toHaveBeenCalledTimes(1);
    expect(navigation.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(navigation.open).toHaveBeenCalled());
    expect(agentHarnessServiceClient.create).toHaveBeenCalledTimes(1);
    expect(agentHarnessServiceClient.control).toHaveBeenNthCalledWith(
      2,
      sessionId,
      { type: 'setModel', model }
    );
    expect(agentHarnessServiceClient.control).toHaveBeenNthCalledWith(
      3,
      sessionId,
      { type: 'prompt', prompt: 'Fix the tests' }
    );
  });

  it('can open the created session even when prompt setup fails', async () => {
    vi.mocked(agentHarnessServiceClient.control).mockRejectedValueOnce(
      new Error('Network unavailable')
    );
    mount();
    enterPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
    expect(navigation.open).toHaveBeenCalledWith(
      { type: 'agent', id: sessionId },
      { referredFrom: 'launcher', preferNewSplit: false }
    );
    expect(agentHarnessServiceClient.create).toHaveBeenCalledTimes(1);
  });
});
