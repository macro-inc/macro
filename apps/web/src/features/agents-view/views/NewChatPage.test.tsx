import type { InputAttachmentData } from '@channel/Input/types';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgentRoster, type PersistedAgentLike } from '../core/roster';
import { NewChatPage } from './NewChatPage';

const mocks = vi.hoisted(() => ({
  openSettings: vi.fn(),
  attachments: [] as InputAttachmentData[],
  recentIds: [] as string[],
  recentUrls: [] as string[],
  repositories: [] as { url: string; defaultBranch?: string }[],
}));
vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@channel/Input', async () => ({
  ...(await import('../../channel/Input/attachment-tracker')),
  uploadInputAttachments: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
}));
vi.mock('@app/features/block-agent/context/recent-agent-selections', () => ({
  createRecentAgentSelections: () => ({
    ids: () => mocks.recentIds,
    remember: vi.fn(),
  }),
}));
vi.mock('../primitives/recent-repositories', () => ({
  createRecentRepositories: () => ({
    urls: () => mocks.recentUrls,
    remember: vi.fn(),
  }),
}));
vi.mock('../queries/reachable-repositories', () => ({
  createReachableRepositories: () => ({
    repositories: () => mocks.repositories,
    loading: () => false,
    error: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('../components/AgentGlyph', () => ({ AgentIcon: () => <span /> }));

vi.mock('@queries/agents/models', () => ({
  useAgentModelsQueries: (targets: () => { harness: string }[]) => [
    {
      get isSuccess() {
        return targets().length > 0;
      },
      get data() {
        const harness = targets()[0]?.harness;
        return {
          status: 'available',
          currentModel:
            harness === 'cursor' ? 'cursor-default' : 'chat-default',
          models:
            harness === 'cursor'
              ? [
                  { id: 'cursor-default', name: 'Cursor default' },
                  { id: 'gpt-5', name: 'GPT-5' },
                ]
              : [
                  { id: 'chat-default', name: 'Chat default' },
                  { id: 'claude-sonnet-4', name: 'Sonnet 4' },
                  {
                    id: 'anthropic/claude-sonnet-5',
                    name: 'anthropic/claude-sonnet-5',
                  },
                ],
        };
      },
    },
  ],
}));

// Keep the real picker and send wiring; substitute only the Lexical editor.
type ComposerProps = {
  selector: JSX.Element;
  drawer: JSX.Element;
  drawerOpen: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (prompt: string, attachments: InputAttachmentData[]) => void;
};
vi.mock('../components/ChatComposer', () => ({
  ChatComposer: (props: ComposerProps) => (
    <>
      {props.selector}
      <div data-testid="drawer" hidden={!props.drawerOpen}>
        {props.drawer}
      </div>
      <input
        aria-label="Draft"
        value={props.draft}
        onInput={(event) => props.onDraftChange(event.currentTarget.value)}
      />
      <button
        onClick={() =>
          props.onSend(
            props.draft || (mocks.attachments.length ? '' : 'Prompt'),
            mocks.attachments
          )
        }
      >
        Send
      </button>
    </>
  ),
}));

function page(connected = true, agents: PersistedAgentLike[] = []) {
  const onStart = vi.fn();
  render(() => (
    <NewChatPage
      roster={buildAgentRoster({
        agents,
        runtimes: [],
        cursorConnected: connected,
        cursorNeedsConnection: !connected,
        macroDefaultModel: 'chat-default',
        cursorDefaultModel: 'cursor-default',
      })}
      rosterLoading={false}
      onStart={onStart}
      onOpenRoster={vi.fn()}
    />
  ));
  return onStart;
}
function openAgents() {
  const trigger = screen.getByRole('button', { name: 'Agent' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}
async function selectAgent(name: RegExp) {
  const trigger = openAgents();
  const item = screen.getByRole('menuitem', { name });
  if (item.hasAttribute('aria-haspopup')) fireEvent.click(item);
  else fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() =>
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  );
}
async function hoverAgent(name: string) {
  openAgents();
  const event = new MouseEvent('pointermove', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  screen
    .getByRole('menuitem', { name: new RegExp(`^${name}`) })
    .dispatchEvent(event);
  const search = await screen.findByRole('textbox', { name: 'Search models' });
  return within(search.closest('[role="menu"]') as HTMLElement);
}

describe('agent-led new conversation', () => {
  let motionStyles: HTMLStyleElement;
  beforeEach(() => {
    mocks.attachments = [];
    mocks.recentIds = [MACRO_CODER_BOT_ID];
    mocks.recentUrls = [];
    mocks.repositories = [
      { url: 'https://github.com/macro-inc/macro', defaultBranch: 'develop' },
    ];
    vi.clearAllMocks();
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
  it('offers both kinds without a mode or model control and starts with the agent default', async () => {
    const send = page();
    expect(
      screen.getByRole('heading', { name: 'What should we work on?' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^(Chat|Code) mode$/ })
    ).toBeNull();
    openAgents();
    expect(screen.queryByRole('menuitem', { name: /Macro/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Cursor/ })).toBeTruthy();
    expect(screen.queryByText('Macro Coding Agent')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
    });
  });
  it('selects a coding agent, keeps the draft, and only sends the repository to coding agents', async () => {
    const send = page();
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Shared draft' },
    });
    await selectAgent(/Cursor/);
    expect(
      screen.getByRole('heading', { name: 'What should we build?' })
    ).toBeTruthy();
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
    fireEvent.click(screen.getByRole('option', { name: 'macro-inc/macro' }));
    // The listed repository's own default branch, until one is chosen.
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Starting branch' }), {
      target: { value: 'feature/home' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use branch' }));
    await selectAgent(/^Chat default$/);
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(true);
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Shared draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      prompt: 'Shared draft',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'chat-default',
    });
    await selectAgent(/Cursor/);
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      prompt: 'Shared draft',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
  });
  it('starts a new conversation on Choose repository, not the last used one', async () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    mocks.recentUrls = ['https://github.com/macro-inc/macro'];
    const send = page();
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).toContain('Choose repository');
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).not.toContain('macro-inc/macro');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      prompt: 'Prompt',
      repoUrl: undefined,
    });
  });
  it('refuses an unlisted repository and starts a listed one on its default branch', async () => {
    const send = page();
    await selectAgent(/Cursor/);
    fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
    fireEvent.input(
      screen.getByRole('combobox', { name: 'Search repositories' }),
      {
        target: { value: 'macro-inc/other' },
      }
    );
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No repositories match/).textContent).toContain(
      'macro-inc/other'
    );
    fireEvent.input(
      screen.getByRole('combobox', { name: 'Search repositories' }),
      { target: { value: '' } }
    );
    fireEvent.click(screen.getByRole('option', { name: 'macro-inc/macro' }));
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Starting branch' }), {
      target: { value: 'feature/home' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      prompt: 'Prompt',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
  });
  it('uses a saved agent without sending a per-session model override', async () => {
    const send = page(true, [
      {
        bot: { id: 'saved-agent', name: 'Reviewer', handle: 'reviewer' },
        harness: 'in-memory',
        default_model: 'saved-default',
      },
    ]);
    await selectAgent(/Reviewer/);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: 'saved-agent',
      repoUrl: undefined,
    });
    expect(send.mock.calls[0][0]).not.toHaveProperty('modelOverride');
  });
  it.each(['claude-cloud', 'codex-cloud', 'future-runtime'])(
    'shows the drawer for a saved %s coding agent without forwarding unsupported repository overrides',
    async (harness) => {
      const send = page(true, [
        {
          bot: {
            id: 'saved-cloud-agent',
            name: 'Cloud reviewer',
            handle: 'cloud-reviewer',
          },
          harness,
          default_model: 'saved-default',
        },
      ]);
      await selectAgent(/Cursor/);
      fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
      fireEvent.click(screen.getByRole('option', { name: 'macro-inc/macro' }));
      await selectAgent(/Cloud reviewer/);
      expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(false);
      expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Branch' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(send).toHaveBeenCalledWith({
        prompt: 'Prompt',
        botId: 'saved-cloud-agent',
        repoUrl: undefined,
      });
    }
  );

  it('keeps a disconnected paired agent visible with its availability reason', () => {
    page(true, [
      {
        bot: { id: 'paired-agent', name: 'Laptop agent', handle: 'laptop' },
        harness: 'macrod',
        harness_id: 'offline-machine',
        default_model: 'saved-default',
      },
    ]);
    openAgents();
    const row = screen.getByRole('menuitem', { name: /Laptop agent/ });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Its runtime is disconnected');
  });

  it('shows the model beside the agent and sends a hovered model choice only once', async () => {
    const send = page();
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Chat default'
    );
    await hoverAgent('Cursor');
    expect(screen.queryByText('Use agent default')).toBeNull();
    expect(
      screen
        .getByRole('menuitem', { name: /Cursor default/ })
        .querySelector('.text-accent')
    ).toBeTruthy();
    const model = screen.getByRole('menuitem', { name: /GPT-5/ });
    expect(model.querySelector('.text-accent')).toBeNull();
    expect(model.querySelector('[data-ai-provider="openai"] svg')).toBeTruthy();
    fireEvent.keyDown(model, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'GPT-5'
    );
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(false);
    openAgents();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Cursor/ }), {
      key: 'ArrowRight',
    });
    await screen.findByRole('textbox', { name: 'Search models' });
    expect(
      screen
        .getByRole('menuitem', { name: /GPT-5/ })
        .querySelector('.text-accent')
    ).toBeTruthy();
    expect(
      screen
        .getByRole('menuitem', { name: /Cursor default/ })
        .querySelector('.text-accent')
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      prompt: 'Prompt',
      botId: CURSOR_BOT_ID,
      repoUrl: undefined,
      modelOverride: 'gpt-5',
    });
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Cursor default'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send.mock.calls[1][0]).not.toHaveProperty('modelOverride');
  });
  it('clears a temporary model choice when selecting another agent', async () => {
    page();
    openAgents();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Sonnet 4/ }), {
      key: 'Enter',
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Sonnet 4'
    );
    await selectAgent(/Cursor/);
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Cursor default'
    );
  });
  it('groups by kind and selects direct models through Macro with readable names and icons', async () => {
    const send = page(true, [
      {
        bot: { id: 'saved-agent', name: 'Reviewer', handle: 'reviewer' },
        harness: 'in-memory',
        default_model: 'saved-default',
      },
    ]);
    await selectAgent(/Cursor/);
    openAgents();
    const modelsGroup = screen.getByRole('group', { name: 'Models' });
    const agentsGroup = screen.getByRole('group', { name: 'Agents' });
    const codingGroup = screen.getByRole('group', { name: 'Coding agents' });
    expect(
      modelsGroup.compareDocumentPosition(agentsGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      agentsGroup.compareDocumentPosition(codingGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const coding = within(codingGroup);
    const models = within(modelsGroup);
    expect(coding.getByRole('menuitem', { name: /Cursor/ })).toBeTruthy();
    expect(coding.queryByRole('menuitem', { name: /Macro/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Macro/ })).toBeNull();
    expect(
      models.queryByRole('menuitem', { name: /Cursor default|GPT-5/ })
    ).toBeNull();
    const sonnet = models.getByRole('menuitem', { name: 'Sonnet 5' });
    expect(
      sonnet.querySelector('[data-ai-provider="anthropic"] svg')
    ).toBeTruthy();
    expect(screen.queryByText('anthropic/claude-sonnet-5')).toBeNull();
    fireEvent.keyDown(sonnet, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toBe(
      'Sonnet 5'
    );
    const trigger = screen.getByRole('button', { name: 'Agent' });
    expect(trigger.title).toBe('Sonnet 5');
    expect(
      trigger.querySelector('[data-ai-provider="anthropic"] svg')
    ).toBeTruthy();
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'anthropic/claude-sonnet-5',
    });
  });
  it('restores the most recently used supported agent', async () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    page();
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Cursor'
    );
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(false);
  });
  it('offers Cursor setup when disconnected without switching to an unavailable agent', async () => {
    page(false);
    await selectAgent(/Cursor/);
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Chat default'
    );
    expect(screen.getByTestId('drawer').hasAttribute('hidden')).toBe(true);
  });
});

it('starts a conversation with an uploaded image and no text', () => {
  mocks.attachments = [
    {
      id: 'sfs-image',
      name: 'pasted.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 123,
    },
  ];
  const start = page();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: '',
      attachments: [
        {
          uri: expect.stringContaining('sfs-image'),
          name: 'pasted.png',
          mimeType: 'image/png',
          size: 123,
        },
      ],
    })
  );
});
