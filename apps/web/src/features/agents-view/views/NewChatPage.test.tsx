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
import type { AgentsMode } from '../core/mode';
import {
  buildAgentRoster,
  type PersistedAgentLike,
  type RuntimeLike,
} from '../core/roster';
import { AgentPicker } from './AgentPicker';
import { NewChatPage } from './NewChatPage';

const mocks = vi.hoisted(() => ({
  touch: false,
  freePlan: false,
  openSettings: vi.fn(),
  capabilitiesPending: false,
  attachments: [] as InputAttachmentData[],
  recentIds: [] as string[],
  recentUrls: [] as string[],
  preferredInmemModel: undefined as string | undefined,
  rememberInmemModel: vi.fn((id: string) => {
    mocks.preferredInmemModel = id;
  }),
  repositories: [] as { url: string; defaultBranch?: string }[],
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
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
vi.mock('../primitives/preferred-inmem-model', () => ({
  createPreferredInmemModel: () => ({
    model: () => mocks.preferredInmemModel,
    remember: mocks.rememberInmemModel,
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
vi.mock('../queries/repository-branches', () => ({
  createRepositoryBranches: () => ({
    branches: () => ['main', 'develop', 'feature/home'],
    loading: () => false,
    error: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('../components/AgentGlyph', () => ({ AgentIcon: () => <span /> }));

vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: (
    target: () => { model?: string } | undefined
  ) => ({
    get isSuccess() {
      return !mocks.capabilitiesPending;
    },
    isFetching: false,
    get data() {
      if (target()?.model !== 'gpt-5') return { configOptions: [] };
      return {
        configOptions: [
          {
            id: 'cursor_effort',
            name: 'Effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'low',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'ultra', name: 'Ultra' },
            ],
          },
        ],
      };
    },
  }),
}));

vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: (
    target: () => { harness: string },
    enabled: () => boolean
  ) => ({
    get isSuccess() {
      return enabled();
    },
    get isPending() {
      return false;
    },
    get isError() {
      return false;
    },
    get data() {
      if (!enabled()) throw new Error('Pending resource must not be read');
      const harness = target().harness;
      if (harness === 'in-memory' && mocks.freePlan) {
        return {
          status: 'available',
          currentModel: 'google/gemini-3.8-flash',
          models: [{ id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        };
      }
      return {
        status: 'available',
        currentModel: harness === 'cursor' ? 'cursor-default' : 'chat-default',
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
                  id: 'anthropic/claude-sonnet-5-5',
                  name: 'anthropic/claude-sonnet-5-5',
                },
                { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5' },
                { id: 'openai/gpt-5.6', name: 'GPT-5.6' },
                { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
                { id: 'fireworks/kimi-k3', name: 'Kimi K3' },
                { id: 'fireworks/glm-5p3', name: 'GLM 5.3' },
                {
                  id: 'fireworks/glm-5p3-flash',
                  name: 'GLM 5.3 Flash',
                },
                { id: 'fireworks/qwen3p8-max', name: 'Qwen 3.8 Max' },
                { id: 'fireworks/minimax-m3', name: 'MiniMax M3' },
                { id: 'cerebras/gpt-oss-120b', name: 'GPT OSS 120B' },
              ],
      };
    },
  }),
}));

// Keep the real picker and send wiring; substitute only the Lexical editor.
type ComposerProps = {
  corner: JSX.Element;
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
      {props.corner}
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

beforeEach(() => {
  localStorage.clear();
});

function page(
  connected = true,
  agents: PersistedAgentLike[] = [],
  availabilityLoading = false,
  runtimes: RuntimeLike[] = [],
  mode?: AgentsMode
) {
  const onStart = vi.fn();
  render(() => (
    <NewChatPage
      compact={mocks.touch}
      mode={mode}
      roster={buildAgentRoster({
        agents,
        runtimes,
        cursorConnected: connected,
        cursorNeedsConnection: !connected,
        macroDefaultModel: 'chat-default',
        cursorDefaultModel: 'cursor-default',
      })}
      rosterLoading={false}
      availabilityLoading={availabilityLoading}
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
  // Chat mode's root menu has its own model search; Code mode's does not.
  const before = screen.queryAllByRole('textbox', {
    name: 'Search models',
  }).length;
  const event = new MouseEvent('pointermove', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  screen
    .getByRole('menuitem', { name: new RegExp(`^${name}`) })
    .dispatchEvent(event);
  await waitFor(() =>
    expect(
      screen.getAllByRole('textbox', { name: 'Search models' })
    ).toHaveLength(before + 1)
  );
  const search = screen
    .getAllByRole('textbox', { name: 'Search models' })
    .at(-1);
  if (!search) throw new Error('Agent model search did not open');
  return within(search.closest('[role="menu"]') as HTMLElement);
}

describe('agent-led new conversation', () => {
  let motionStyles: HTMLStyleElement;
  beforeEach(() => {
    mocks.capabilitiesPending = false;
    mocks.freePlan = false;
    mocks.touch = false;
    mocks.attachments = [];
    mocks.recentIds = [MACRO_CODER_BOT_ID];
    mocks.recentUrls = [];
    mocks.preferredInmemModel = undefined;
    mocks.repositories = [
      { url: 'https://github.com/macro-inc/macro', defaultBranch: 'develop' },
    ];
    vi.clearAllMocks();
    mocks.rememberInmemModel.mockImplementation((id: string) => {
      mocks.preferredInmemModel = id;
    });
    motionStyles = document.createElement('style');
    motionStyles.textContent =
      '[role="menu"], [data-corvu-drawer-content], [data-corvu-drawer-overlay] { animation-name: none; transition-duration: 0s; }';
    document.head.append(motionStyles);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    Element.prototype.scrollTo = vi.fn();
  });
  afterEach(() => {
    cleanup();
    mocks.touch = false;
    motionStyles.remove();
    vi.unstubAllGlobals();
  });
  it('selects a coding model from the phone sheet without hover and preserves the draft', async () => {
    mocks.touch = true;
    const send = page(true, [], false, [], 'code');
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Phone draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Models for Cursor' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'GPT-5' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Phone draft',
        botId: CURSOR_BOT_ID,
        modelOverride: 'gpt-5',
      })
    );
  });
  it('filters models in the phone sheet and selects an in-memory model', async () => {
    mocks.touch = true;
    const send = page();
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.input(
      await screen.findByRole('textbox', { name: 'Search agents and models' }),
      {
        target: { value: 'Sonnet 5.5' },
      }
    );
    expect(screen.queryByRole('button', { name: 'Chat default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sonnet 5.5' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: 'anthropic/claude-sonnet-5-5',
      })
    );
  });
  it('opens and focuses the mobile model search on the first tap', async () => {
    mocks.touch = true;
    page();
    const trigger = screen.getByRole('button', { name: 'Agent' });
    for (const type of ['pointerdown', 'mousedown']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      trigger.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    fireEvent.pointerUp(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);
    const search = await screen.findByRole('textbox', {
      name: 'Search agents and models',
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
  });
  it('starts in Chat and switches to Code from the composer', async () => {
    const send = page();
    expect(
      screen.getByRole('heading', { name: 'What should we work on?' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
    expect(
      (screen.getByRole('radio', { name: 'Chat' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Repository' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(
      screen.getByRole('heading', { name: 'What should we build?' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
    openAgents();
    expect(screen.getByRole('menuitem', { name: /Cursor/ })).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: /^Chat default$/ })
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'chat-default',
    });
  });
  it('selects a coding agent, keeps the draft, and only sends the repository to coding agents', async () => {
    const send = page();
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Shared draft' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    await selectAgent(/Cursor/);
    expect(
      screen.getByRole('heading', { name: 'What should we build?' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
    fireEvent.click(screen.getByRole('option', { name: 'macro-inc/macro' }));
    // The listed repository's own default branch, until one is chosen.
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.click(screen.getByRole('option', { name: 'feature/home' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    expect(screen.queryByRole('button', { name: 'Repository' })).toBeNull();
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
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      prompt: 'Shared draft',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
  });
  it('offers only chat agents in Work and keeps the composer compact', async () => {
    const send = page(true, [], false, [], 'chat');
    expect(
      screen.getByRole('heading', { name: 'What should we work on?' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repository' })).toBeNull();
    openAgents();
    expect(
      screen.getByRole('menuitem', { name: /^Chat default$/ })
    ).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Cursor/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'chat-default',
    });
  });
  it('offers only coding agents in Code and opens the repository drawer', async () => {
    const send = page(true, [], false, [], 'code');
    expect(
      screen.getByRole('heading', { name: 'What should we build?' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
    openAgents();
    expect(screen.getByRole('menuitem', { name: /Cursor/ })).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: /^Chat default$/ })
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Prompt', botId: CURSOR_BOT_ID })
    );
  });
  it('restores an unsent draft after the page remounts', () => {
    page();
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Keep this prompt' },
    });
    cleanup();
    page();
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Keep this prompt');
  });
  it('starts a new conversation on Choose repository, not the last used one', async () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    mocks.recentUrls = ['https://github.com/macro-inc/macro'];
    const send = page(true, [], false, [], 'code');
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
    const send = page(true, [], false, [], 'code');
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
    fireEvent.input(screen.getByRole('combobox', { name: 'Search branches' }), {
      target: { value: 'feature/other' },
    });
    fireEvent.click(screen.getByRole('option', { name: 'Use feature/other' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      prompt: 'Prompt',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/other',
    });
  });
  it('uses Gemini for a free user starting a saved in-memory agent', async () => {
    mocks.freePlan = true;
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
      modelOverride: 'google/gemini-3.8-flash',
    });
  });
  it.each(['claude-cloud', 'codex-cloud', 'future-runtime'])(
    'shows the drawer for a saved %s coding agent without forwarding unsupported repository overrides',
    async (harness) => {
      const send = page(
        true,
        [
          {
            bot: {
              id: 'saved-cloud-agent',
              name: 'Cloud reviewer',
              handle: 'cloud-reviewer',
            },
            harness,
            default_model: 'saved-default',
          },
        ],
        false,
        [],
        'code'
      );
      await selectAgent(/Cursor/);
      fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
      fireEvent.click(screen.getByRole('option', { name: 'macro-inc/macro' }));
      await selectAgent(/Cloud reviewer/);
      expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
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

  it('dispatches the chosen repository from main to a paired local runtime', async () => {
    const send = page(
      true,
      [
        {
          bot: { id: 'local-agent', name: 'Laptop agent', handle: 'laptop' },
          harness: 'macrod',
          harness_id: 'laptop',
          default_model: 'default',
        },
      ],
      false,
      [{ id: 'laptop', name: 'Laptop', connected: true }],
      'code'
    );
    await selectAgent(/Cursor/);
    fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
    fireEvent.click(screen.getByRole('option', { name: 'macro-inc/macro' }));
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    await selectAgent(/Laptop agent/);
    const branch = screen.getByRole('button', { name: 'Branch' });
    expect(branch.textContent).toContain('main');
    expect(branch.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      prompt: 'Prompt',
      botId: 'local-agent',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'main',
    });
  });

  it('keeps a disconnected paired agent visible with its availability reason', () => {
    page(
      true,
      [
        {
          bot: { id: 'paired-agent', name: 'Laptop agent', handle: 'laptop' },
          harness: 'macrod',
          harness_id: 'offline-machine',
          default_model: 'saved-default',
        },
      ],
      false,
      [],
      'code'
    );
    openAgents();
    const row = screen.getByRole('menuitem', { name: /Laptop agent/ });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Its runtime is disconnected');
  });

  it.each([false, true])(
    'clusters coding agents by availability without an empty model catalog (touch: %s)',
    async (touch) => {
      mocks.touch = touch;
      const roster = buildAgentRoster({
        agents: [
          {
            bot: { id: 'reviewer', name: 'Reviewer', handle: 'reviewer' },
            harness: 'macrod',
            harness_id: 'laptop',
            default_model: 'claude-sonnet-5-5',
          },
          {
            bot: { id: 'offline', name: 'Offline agent', handle: 'offline' },
            harness: 'macrod',
            harness_id: 'offline',
            default_model: 'default',
          },
        ],
        runtimes: [{ id: 'laptop', name: 'Laptop', connected: true }],
        cursorConnected: true,
        cursorNeedsConnection: false,
      }).filter((agent) => agent.kind === 'coder');
      const onCreate = vi.fn();
      const onSelect = vi.fn();
      render(() => (
        <AgentPicker
          agents={roster}
          selected={roster[0]}
          loading={false}
          onSelect={onSelect}
          onConnect={vi.fn()}
          onCreate={onCreate}
        />
      ));
      if (touch) fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
      else openAgents();
      const picker = await screen.findByRole(touch ? 'dialog' : 'menu');
      const builtIn = within(picker).getByRole('group', { name: 'Built-in' });
      const saved = within(picker).getByRole('group', { name: 'Your agents' });
      const offline = within(picker).getByRole('group', {
        name: 'Needs connection',
      });
      expect(builtIn.textContent).toContain('Cursor');
      expect(saved.textContent).toContain('Reviewer');
      expect(saved.textContent).toContain('Laptop · Sonnet 5.5');
      expect(offline.textContent).toContain('Offline agent');
      expect(offline.textContent).toContain('Its runtime is disconnected');
      expect(
        within(picker).queryByText('Connect the runtime to load models.')
      ).toBeNull();
      expect(within(picker).queryByText('Models')).toBeNull();
      const unavailable = within(offline).getByRole(
        touch ? 'button' : 'menuitem'
      );
      expect(
        touch
          ? unavailable.hasAttribute('disabled')
          : unavailable.getAttribute('aria-disabled') === 'true'
      ).toBe(true);
      fireEvent.click(unavailable);
      expect(onSelect).not.toHaveBeenCalled();
      const create = within(picker).getByRole(touch ? 'button' : 'menuitem', {
        name: 'Create agent',
      });
      if (touch) fireEvent.click(create);
      else {
        create.focus();
        fireEvent.keyDown(create, { key: 'Enter' });
      }
      expect(onCreate).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(screen.queryByRole(touch ? 'dialog' : 'menu')).toBeNull()
      );
    }
  );
  it('focuses model search when hovering an agent submenu', async () => {
    page(true, [], false, [], 'code');
    const submenu = await hoverAgent('Cursor');
    const search = submenu.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.input(search, { target: { value: 'GPT' } });
    expect((search as HTMLInputElement).value).toBe('GPT');
    expect(submenu.getByRole('menuitem', { name: /GPT-5/ })).toBeTruthy();
    expect(
      submenu.queryByRole('menuitem', { name: /Cursor default/ })
    ).toBeNull();
  });

  it('shows the model beside the agent and sends a hovered model choice only once', async () => {
    const send = page(true, [], false, [], 'code');
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'Cursor default'
    );
    await hoverAgent('Cursor');
    expect(screen.queryByText('Use agent default')).toBeNull();
    expect(
      screen
        .getByRole('menuitem', { name: /Cursor default/ })
        .querySelector('.text-accent')
    ).toBeTruthy();
    const model = screen.getByTitle('GPT-5');
    expect(model.querySelector('.text-accent')).toBeNull();
    expect(model.querySelector('[data-ai-provider="openai"] svg')).toBeTruthy();
    fireEvent.keyDown(model, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'GPT-5'
    );
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
    openAgents();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Cursor/ }), {
      key: 'ArrowRight',
    });
    await waitFor(() =>
      expect(
        screen.getAllByRole('textbox', { name: 'Search models' })
      ).toHaveLength(1)
    );
    expect(
      screen.getByTitle('GPT-5').querySelector('.text-accent')
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
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'Cursor default'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send.mock.calls[1][0]).not.toHaveProperty('modelOverride');
  });
  it('clears a temporary model choice when switching to Code', async () => {
    page();
    openAgents();
    const model = screen.getByTitle('Sonnet 5.5');
    model.focus();
    fireEvent.keyDown(model, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'Sonnet 5.5'
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'Cursor default'
    );
  });
  it('groups the Macro catalog and selects direct models with readable names and icons', async () => {
    const send = page(true, [
      {
        bot: { id: 'saved-agent', name: 'Reviewer', handle: 'reviewer' },
        harness: 'in-memory',
        default_model: 'saved-default',
      },
    ]);
    openAgents();
    const modelsGroup = screen.getByRole('group', { name: 'Recommended' });
    const agentsGroup = screen.getByRole('group', { name: 'Your agents' });
    expect(
      modelsGroup.compareDocumentPosition(agentsGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole('group', { name: 'Coding agents' })).toBeNull();
    const search = screen.getByRole('textbox', { name: 'Search models' });
    expect(screen.getByRole('menuitem', { name: /More models/ })).toBeTruthy();
    fireEvent.input(search, { target: { value: 'GLM' } });
    expect(screen.getByTitle('GLM 5.3')).toBeTruthy();
    expect(screen.getByTitle('GLM 5.3 Flash')).toBeTruthy();
    fireEvent.input(search, { target: { value: '' } });
    expect(screen.queryByRole('menuitem', { name: /Cursor/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Macro/ })).toBeNull();
    const models = within(screen.getByRole('group', { name: 'Recommended' }));
    expect(
      models.queryByRole('menuitem', { name: /Cursor default|GPT-5/ })
    ).toBeNull();
    const sonnet = models.getByTitle('Sonnet 5.5');
    expect(
      sonnet.querySelector('[data-ai-provider="anthropic"] svg')
    ).toBeTruthy();
    expect(screen.queryByText('anthropic/claude-sonnet-5-5')).toBeNull();
    sonnet.focus();
    fireEvent.keyDown(sonnet, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(mocks.rememberInmemModel).toHaveBeenCalledWith(
      'anthropic/claude-sonnet-5-5'
    );
    expect(screen.getByRole('button', { name: 'Agent' }).title).toBe(
      'Sonnet 5.5'
    );
    const trigger = screen.getByRole('button', { name: 'Agent' });
    expect(trigger.title).toBe('Sonnet 5.5');
    expect(
      trigger.querySelector('[data-ai-provider="anthropic"] svg')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repository' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'anthropic/claude-sonnet-5-5',
    });
    // Macro Models picks stick: a second send still uses the preferred model.
    expect(screen.getByRole('button', { name: 'Agent' }).title).toBe(
      'Sonnet 5.5'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send.mock.calls[1][0]).toMatchObject({
      modelOverride: 'anthropic/claude-sonnet-5-5',
    });
  });
  it('keeps unavailable Macro models disabled throughout the catalog', async () => {
    const roster = buildAgentRoster({
      agents: [],
      runtimes: [],
      cursorConnected: true,
      cursorNeedsConnection: false,
    });
    const macro = {
      ...roster[0],
      unavailableReason: 'Temporarily unavailable',
    };
    const onSelect = vi.fn();
    render(() => (
      <AgentPicker
        agents={[macro]}
        selected={macro}
        loading={false}
        onSelect={onSelect}
        onSelectEffort={onSelect}
        onConnect={vi.fn()}
        onCreate={vi.fn()}
      />
    ));
    openAgents();
    const sonnet = screen.getByTitle('Sonnet 5.5');
    expect(sonnet.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(sonnet);
    fireEvent.keyDown(sonnet, { key: 'Enter' });

    const search = screen.getByRole('textbox', { name: 'Search models' });
    fireEvent.input(search, { target: { value: 'GLM' } });
    const flash = screen.getByTitle('GLM 5.3 Flash');
    expect(flash.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(flash);
    fireEvent.input(search, { target: { value: '' } });

    const more = screen.getByRole('menuitem', { name: /More models/ });
    more.focus();
    fireEvent.keyDown(more, { key: 'ArrowRight' });
    const extra = await screen.findByTitle('GLM 5.3 Flash');
    expect(extra.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(extra);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('restores a preferred Macro model on a fresh composer', () => {
    mocks.preferredInmemModel = 'anthropic/claude-sonnet-5-5';
    page();
    expect(screen.getByRole('button', { name: 'Agent' }).title).toBe(
      'Sonnet 5.5'
    );
  });
  it('uses the free catalog default instead of a persisted paid model', async () => {
    mocks.freePlan = true;
    mocks.preferredInmemModel = 'anthropic/claude-sonnet-5-5';
    const send = page();
    expect(screen.getByRole('button', { name: 'Agent' }).title).toBe(
      'Gemini 3.8 Flash'
    );
    openAgents();
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    expect(screen.queryByTitle('Sonnet 5.5')).toBeNull();
    expect(
      within(screen.getByRole('menu')).getByTitle('Gemini 3.8 Flash')
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: 'google/gemini-3.8-flash',
      })
    );
  });
  it('restores the most recently used supported agent', async () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    page(true, [], false, [], 'code');
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'Cursor'
    );
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
  });
  it('keeps the most recent agent while its connection status loads', () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    page(false, [], true, [], 'code');
    expect(
      screen.getByRole('heading', { name: 'What should we build?' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
  });
  it('offers Cursor setup when disconnected without switching to an unavailable agent', async () => {
    page(false, [], false, [], 'code');
    const before = screen.getByRole('button', { name: 'Agent' }).title;
    await selectAgent(/Cursor/);
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
    expect(screen.getByRole('button', { name: 'Agent' }).title).toBe(before);
  });
  it('passes opaque effort and clears it with the model override after sending', async () => {
    const send = page(true, [], false, [], 'code');
    const models = await hoverAgent('Cursor');
    fireEvent.keyDown(models.getByRole('menuitem', { name: /^GPT-5/ }), {
      key: 'ArrowRight',
    });
    await screen.findByRole('menuitem', { name: 'Ultra' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Ultra' }), {
      key: 'Enter',
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    mocks.capabilitiesPending = true;
    expect(screen.getByRole('button', { name: 'Agent' }).title).toContain(
      'GPT-5 · Ultra'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modelOverride: 'gpt-5',
        effortOverride: { configId: 'cursor_effort', value: 'ultra' },
      })
    );
    expect(
      screen.queryByRole('button', { name: 'Reasoning effort' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ effortOverride: undefined })
    );
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
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
