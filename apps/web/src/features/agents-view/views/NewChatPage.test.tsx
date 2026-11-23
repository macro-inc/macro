import type { InputAttachmentData } from '@channel/Input/types';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createRoot, createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposerMode } from '../core/mode';
import {
  buildAgentRoster,
  type PersistedAgentLike,
  type RuntimeLike,
} from '../core/roster';
import { UnifiedModelSelector } from '../model-selector';
import {
  createPersistedComposerDraft,
  HOME_CONVERSATION_ATTACHMENTS_KEY,
  NEW_CONVERSATION_ATTACHMENTS_KEY,
} from '../primitives/composer-draft';
import { createPreferredRepository } from '../primitives/preferred-repository';
import { AgentPicker } from './AgentPicker';
import { type AgentRequest, NewChatPage } from './NewChatPage';

const mocks = vi.hoisted(() => ({
  userId: () => 'user' as string | undefined,
  touch: false,
  freePlan: false,
  modelsPending: false,
  tier: 'max',
  currentEffort: 'low',
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
  autoEnabled: true,
  setFlagsLoaded: (_loaded: boolean) => {},
  chooseAgentMode: vi.fn(async (_prompt: string) => 'chat' as 'chat' | 'code'),
}));
vi.mock('@app/lib/analytics/posthog', async () => {
  const { createSignal } = await import('solid-js');
  const [loaded, setLoaded] = createSignal(true);
  mocks.setFlagsLoaded = setLoaded;
  return {
    useFeatureFlag: () => () => ({
      enabled: loaded() && mocks.autoEnabled,
      loading: !loaded(),
    }),
  };
});
vi.mock('@queries/agents/mode-choice', () => ({
  chooseAgentMode: (prompt: string) => mocks.chooseAgentMode(prompt),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@channel/Input', async () => ({
  ...(await import('../../channel/Input/attachment-tracker')),
  uploadInputAttachments: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => mocks.userId(),
}));
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
vi.mock('../components/AgentGlyph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/AgentGlyph')>()),
  AgentIcon: () => <span />,
}));

vi.mock('@queries/auth/ai-billing', () => ({
  useAiBillingSummaryQuery: () => ({
    isSuccess: true,
    get data() {
      return { tier: mocks.tier };
    },
  }),
}));
vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: (
    target: () => { model?: string } | undefined
  ) => ({
    get isSuccess() {
      return !mocks.capabilitiesPending;
    },
    isFetching: false,
    get data() {
      if (target()?.model !== 'gpt-5' && target()?.model !== 'openai/gpt-5.6')
        return { configOptions: [] };
      return {
        configOptions: [
          {
            id: 'cursor_effort',
            name: 'Effort',
            category: 'thought_level',
            type: 'select',
            currentValue: mocks.currentEffort,
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
      return enabled() && !mocks.modelsPending;
    },
    get isPending() {
      return mocks.modelsPending;
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
                { id: 'cursor-default', name: 'Cursor Default' },
                { id: 'gpt-5', name: 'GPT-5' },
              ]
            : [
                { id: 'chat-default', name: 'Chat Default' },
                { id: 'claude-sonnet-4', name: 'Sonnet 4' },
                {
                  id: 'anthropic/claude-sonnet-5-5',
                  name: 'anthropic/claude-sonnet-5-5',
                },
                { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5' },
                { id: 'openai/gpt-5.6', name: 'GPT-5.6' },
                { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra' },
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

vi.mock('@components/app/mobile/float-regions/FloatRegion', () => ({
  FloatRegionOrInline: (props: { children: JSX.Element }) => props.children,
}));

// Keep the real picker and send wiring; substitute only the Lexical editor.
type ComposerProps = {
  corner: JSX.Element;
  selector: JSX.Element;
  drawer: JSX.Element;
  drawerOpen: boolean;
  settingsPlacement?: 'inside' | 'below';
  draft: string;
  attachments: InputAttachmentData[];
  onRemoveAttachment: (attachment: InputAttachmentData) => void;
  onDraftChange: (draft: string) => void;
  onSend: (prompt: string, attachments: InputAttachmentData[]) => void;
  onMentionUser?: (userId: string) => void;
};
vi.mock('../components/ChatComposer', () => ({
  ChatComposer: (props: ComposerProps) => (
    <>
      {props.corner}
      {props.selector}
      <output data-testid="attachments">
        {props.attachments.map((a) => a.name).join(',')}
      </output>
      <For each={props.attachments}>
        {(attachment) => (
          <button onClick={() => props.onRemoveAttachment(attachment)}>
            Remove {attachment.name}
          </button>
        )}
      </For>
      <div
        data-testid="drawer"
        data-placement={props.settingsPlacement}
        hidden={!props.drawerOpen}
      >
        {props.drawer}
      </div>
      <input
        aria-label="Draft"
        value={props.draft}
        onInput={(event) => props.onDraftChange(event.currentTarget.value)}
      />
      <input
        aria-label="Mention"
        onChange={(event) => props.onMentionUser?.(event.currentTarget.value)}
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

/** Most cases exercise an explicit Chat or Code choice; Auto has its own. */
let startInChat = true;

beforeEach(() => {
  localStorage.clear();
  startInChat = true;
  mocks.userId = () => 'user';
  mocks.chooseAgentMode.mockClear();
  mocks.autoEnabled = true;
  mocks.setFlagsLoaded(true);
});

function page(
  connected = true,
  agents: PersistedAgentLike[] = [],
  availabilityLoading = false,
  runtimes: RuntimeLike[] = [],
  mode?: ComposerMode
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
  const chat = screen.queryByRole('radio', { name: 'Chat' });
  if (mode === undefined && startInChat && chat) fireEvent.click(chat);
  return onStart;
}
function openAgents() {
  const trigger = screen.getByRole('button', {
    name: /^(Agent|Choose an agent or model)$/,
  });
  if (trigger.getAttribute('aria-label') === 'Agent') {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  } else {
    if (trigger.getAttribute('aria-expanded') !== 'true')
      fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    if (!within(dialog).queryByRole('textbox'))
      fireEvent.click(within(dialog).getAllByRole('button')[0]);
  }
  return trigger;
}
async function selectAgent(name: RegExp) {
  const trigger = openAgents();
  fireEvent.click(screen.getByRole('button', { name: /See all/ }));
  fireEvent.click(screen.getByRole('button', { name }));
  if (trigger.getAttribute('aria-expanded') === 'true') {
    fireEvent.keyDown(document, { key: 'Escape' });
  }
  await waitFor(() =>
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  );
}
async function openAgentModels(name: string) {
  await selectAgent(new RegExp(`^${name}`));
  fireEvent.click(
    screen.getByRole('button', { name: 'Choose an agent or model' })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Cursor Default' })
  );
  return within(await screen.findByRole('dialog'));
}

describe('agent-led new conversation', () => {
  let motionStyles: HTMLStyleElement;
  beforeEach(() => {
    mocks.capabilitiesPending = false;
    mocks.freePlan = false;
    mocks.modelsPending = false;
    mocks.tier = 'max';
    mocks.currentEffort = 'low';
    mocks.touch = false;
    localStorage.clear();
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
  it.each([false, true])(
    'uses Home settings placement for a full new session (touch: %s)',
    (touch) => {
      mocks.touch = touch;
      render(() => (
        <NewChatPage
          roster={buildAgentRoster({
            agents: [],
            runtimes: [],
            cursorConnected: true,
            cursorNeedsConnection: false,
            macroDefaultModel: 'chat-default',
            cursorDefaultModel: 'cursor-default',
          })}
          rosterLoading={false}
          onStart={vi.fn()}
          onOpenRoster={vi.fn()}
        />
      ));
      expect(screen.getByTestId('drawer').getAttribute('data-placement')).toBe(
        'below'
      );
      expect(
        screen.getByRole('radiogroup', { name: 'Conversation mode' })
      ).toBeTruthy();
    }
  );
  it('selects a coding model from the phone sheet without hover and preserves the draft', async () => {
    mocks.touch = true;
    const send = page(true, [], false, [], 'code');
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Phone draft' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cursor Default' }));
    fireEvent.click(screen.getByRole('button', { name: 'GPT-5' }));
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
    openAgents();
    const search = await screen.findByRole('textbox', {
      name: 'Search agents and models',
    });
    expect(screen.getByRole('button', { name: 'More models' })).toBeTruthy();
    fireEvent.input(search, { target: { value: 'Sonnet 5.5' } });
    expect(
      screen
        .queryAllByRole('button', { name: 'Chat Default' })
        .filter((button) => button.hasAttribute('data-model-choice'))
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sonnet 5.5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: 'anthropic/claude-sonnet-5-5' })
    );
  });
  it('opens the phone card first and reaches search through its name', async () => {
    mocks.touch = true;
    page();
    const trigger = screen.getByRole('button', {
      name: 'Choose an agent or model',
    });
    for (const type of ['pointerdown', 'mousedown']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      trigger.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    fireEvent.click(trigger);
    expect(
      screen.queryByRole('textbox', { name: 'Search agents and models' })
    ).toBeNull();
    const card = screen.getByRole('dialog');
    expect(card.classList.contains('p-0')).toBe(true);
    const name = within(card).getAllByRole('button')[0];
    const content = name.parentElement?.parentElement;
    expect(content?.parentElement).toBe(card);
    expect(content?.className).not.toMatch(/m-2|bg-ink\/8|rounded-/);
    expect(content?.classList.contains('p-3')).toBe(true);
    expect(content?.classList.contains('gap-2')).toBe(true);
    expect(name.classList.contains('rounded-full')).toBe(true);
    fireEvent.click(name);
    expect(
      await screen.findByRole('textbox', { name: 'Search agents and models' })
    ).toBeTruthy();
  });
  it('focuses desktop search on opening and reopening the model selector', async () => {
    page();
    for (let attempt = 0; attempt < 2; attempt++) {
      openAgents();
      const search = screen.getByRole('textbox', {
        name: /Search (agents and )?models/,
      });
      await waitFor(() => expect(document.activeElement).toBe(search));
      fireEvent.input(search, { target: { value: 'Sonnet' } });
      expect(screen.getByRole('button', { name: 'Sonnet 5.5' })).toBeTruthy();
      fireEvent.keyDown(search, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
  });
  it('starts in Auto without an agent, model, or effort to pick', () => {
    startInChat = false;
    page();
    expect(
      (screen.getByRole('radio', { name: 'Auto' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(
      screen.getByRole('heading', { name: 'What should we work on?' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Choose an agent or model' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Repository' })).toBeNull();
  });
  it('offers only Chat and Code without the Auto flag', () => {
    mocks.autoEnabled = false;
    const send = page();
    expect(screen.queryByRole('radio', { name: 'Auto' })).toBeNull();
    expect(
      (screen.getByRole('radio', { name: 'Chat' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(mocks.chooseAgentMode).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: undefined,
        modelOverride: 'chat-default',
      })
    );
  });
  it('sends a coding prompt in Auto to the usual coding agent with its defaults', async () => {
    mocks.chooseAgentMode.mockResolvedValueOnce('code');
    const send = page(true, [], false, [], undefined);
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Fix the login bug' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(mocks.chooseAgentMode).toHaveBeenCalledWith('Fix the login bug');
    expect(send).toHaveBeenCalledWith({
      onFailure: expect.any(Function),
      prompt: 'Fix the login bug',
      botId: CURSOR_BOT_ID,
      repoUrl: undefined,
    });
  });
  it('sends any other prompt in Auto to the chat agent with its model', async () => {
    mocks.chooseAgentMode.mockResolvedValueOnce('chat');
    const send = page();
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'chat-default',
    });
  });
  it('skips the choice in Auto when no coding agent can start', () => {
    const send = page(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(mocks.chooseAgentMode).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: undefined,
        modelOverride: 'chat-default',
      })
    );
  });
  it('starts in a remembered Chat and switches to Code from the composer', async () => {
    const send = page();
    expect(
      screen.getByRole('heading', { name: 'What should we work on?' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toContain('Chat Default');
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
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(
      within(screen.getByRole('group', { name: 'Built-in' })).getByRole(
        'button',
        { name: /Cursor/ }
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Chat default$/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelOverride: 'chat-default',
    });
  });
  it('flags a send before the model catalog loads as a model fallback', () => {
    mocks.modelsPending = true;
    const send = page();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      botId: undefined,
      repoUrl: undefined,
      modelFallback: true,
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
    fireEvent.keyDown(screen.getByRole('button', { name: 'Repository' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('option', { name: 'macro-inc/macro' }), {
      key: 'Enter',
    });
    // The listed repository's own default branch, until one is chosen.
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Branch' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('option', { name: 'feature/home' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    expect(screen.queryByRole('button', { name: 'Repository' })).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Shared draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      onFailure: expect.any(Function),
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
      onFailure: expect.any(Function),
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
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cursor/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      onFailure: expect.any(Function),
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
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(
      within(screen.getByRole('group', { name: 'Built-in' })).getByRole(
        'button',
        { name: /Cursor/ }
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Chat default$/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Prompt', botId: CURSOR_BOT_ID })
    );
  });
  it('makes an @mentioned agent the active agent, switching to its mode', () => {
    const send = page();
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: `bot|${CURSOR_BOT_ID}` },
    });
    expect(
      (screen.getByRole('radio', { name: 'Code' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'Prompt', botId: CURSOR_BOT_ID })
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: `bot|${MACRO_NEW_BOT_ID}` },
    });
    expect(
      (screen.getByRole('radio', { name: 'Chat' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'Prompt', botId: undefined })
    );
  });
  it('keeps a model picked for the agent an @mention names again', async () => {
    mocks.touch = true;
    const send = page(true, [], false, [], 'code');
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cursor Default' }));
    fireEvent.click(screen.getByRole('button', { name: 'GPT-5' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: `bot|${CURSOR_BOT_ID}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ botId: CURSOR_BOT_ID, modelOverride: 'gpt-5' })
    );
  });
  it('applies an @mention made while the roster loads once it arrives', () => {
    const [loading, setLoading] = createSignal(true);
    const [connected, setConnected] = createSignal(false);
    const send = vi.fn();
    render(() => (
      <NewChatPage
        roster={
          connected()
            ? buildAgentRoster({
                agents: [],
                runtimes: [],
                cursorConnected: true,
                cursorNeedsConnection: false,
                macroDefaultModel: 'chat-default',
                cursorDefaultModel: 'cursor-default',
              })
            : []
        }
        rosterLoading={loading()}
        onStart={send}
        onOpenRoster={vi.fn()}
      />
    ));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: `bot|${CURSOR_BOT_ID}` },
    });
    // A person mentioned meanwhile leaves the agent's mention waiting.
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: 'macro|person@example.com' },
    });
    setConnected(true);
    setLoading(false);
    expect(
      (screen.getByRole('radio', { name: 'Code' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ botId: CURSOR_BOT_ID })
    );
  });
  it('lets a pick made while the roster loads win over an earlier @mention', async () => {
    const computerAgent: PersistedAgentLike = {
      bot: { id: 'computer-agent', name: "Maya's Agent", handle: 'maya' },
      harness: 'macrod',
      harness_id: 'computer',
      default_model: 'default',
    };
    const [agents, setAgents] = createSignal<PersistedAgentLike[]>([]);
    const [loading, setLoading] = createSignal(true);
    const send = vi.fn();
    render(() => (
      <NewChatPage
        mode="code"
        roster={buildAgentRoster({
          agents: agents(),
          runtimes: [{ id: 'computer', name: 'Agent Box', connected: true }],
          cursorConnected: true,
          cursorNeedsConnection: false,
        })}
        rosterLoading={loading()}
        onStart={send}
        onOpenRoster={vi.fn()}
      />
    ));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: 'bot|computer-agent' },
    });
    await selectAgent(/Cursor/);
    setAgents([computerAgent]);
    setLoading(false);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ botId: CURSOR_BOT_ID })
    );
  });
  describe('a mention waiting for the roster gives way to a later decision', () => {
    const saved = (id: string, name: string): PersistedAgentLike => ({
      bot: { id, name, handle: id },
      harness: 'macrod',
      harness_id: 'computer',
      default_model: 'default',
    });
    function loadingPage(request?: () => AgentRequest | undefined) {
      const [agents, setAgents] = createSignal<PersistedAgentLike[]>([]);
      const [loading, setLoading] = createSignal(true);
      const send = vi.fn();
      render(() => (
        <NewChatPage
          requestedAgent={request?.()}
          roster={buildAgentRoster({
            agents: agents(),
            runtimes: [{ id: 'computer', name: 'Agent Box', connected: true }],
            cursorConnected: true,
            cursorNeedsConnection: false,
            macroDefaultModel: 'chat-default',
          })}
          rosterLoading={loading()}
          onStart={send}
          onOpenRoster={vi.fn()}
        />
      ));
      const mention = (value: string) =>
        fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
          target: { value },
        });
      const load = () => {
        setAgents([
          saved('maya-agent', "Maya's Agent"),
          saved('ben-agent', "Ben's Agent"),
        ]);
        setLoading(false);
      };
      const sendNow = () =>
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      return { send, mention, load, sendNow };
    }

    it('a later mention of the active agent', () => {
      const { send, mention, load, sendNow } = loadingPage();
      fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
      mention('bot|maya-agent');
      mention(`bot|${MACRO_NEW_BOT_ID}`);
      load();
      sendNow();
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({ botId: undefined })
      );
    });

    it('a mode switch', () => {
      const { send, mention, load, sendNow } = loadingPage();
      fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
      mention('bot|maya-agent');
      fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
      load();
      expect(
        (screen.getByRole('radio', { name: 'Chat' }) as HTMLInputElement)
          .checked
      ).toBe(true);
      sendNow();
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({ botId: undefined })
      );
    });

    it('but not the flags loading', () => {
      mocks.setFlagsLoaded(false);
      const { send, mention, load, sendNow } = loadingPage();
      mention('bot|maya-agent');
      mocks.setFlagsLoaded(true);
      load();
      expect(
        (screen.getByRole('radio', { name: 'Code' }) as HTMLInputElement)
          .checked
      ).toBe(true);
      sendNow();
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({ botId: 'maya-agent' })
      );
    });

    it('a requested agent', () => {
      const [request, setRequest] = createSignal<AgentRequest>();
      const { send, mention, load, sendNow } = loadingPage(request);
      fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
      mention('bot|maya-agent');
      setRequest({ agentId: 'ben-agent', request: 'set up' });
      load();
      sendNow();
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({ botId: 'ben-agent' })
      );
    });
  });
  it('selects an @mentioned agent from Auto, showing its selector', () => {
    startInChat = false;
    const send = page();
    expect(
      screen.queryByRole('button', { name: 'Choose an agent or model' })
    ).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: `bot|${CURSOR_BOT_ID}` },
    });
    expect(
      (screen.getByRole('radio', { name: 'Code' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toContain('Cursor');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(mocks.chooseAgentMode).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'Prompt', botId: CURSOR_BOT_ID })
    );
  });
  it('blocks the send on an @mentioned unavailable agent instead of sending it elsewhere', () => {
    const send = page(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: `bot|${CURSOR_BOT_ID}` },
    });
    expect(
      (screen.getByRole('radio', { name: 'Code' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).not.toHaveBeenCalled();
  });
  it('leaves the active agent alone when a person is mentioned', () => {
    const send = page();
    fireEvent.change(screen.getByRole('textbox', { name: 'Mention' }), {
      target: { value: 'macro|person@example.com' },
    });
    expect(
      (screen.getByRole('radio', { name: 'Chat' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'Prompt', botId: undefined })
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
  it('restores a parent-owned Agents draft and its attachments after remount', () => {
    mocks.attachments = [
      { id: 'kept-file', name: 'notes.txt', kind: 'document' },
    ];
    localStorage.setItem(
      `${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`,
      JSON.stringify(mocks.attachments)
    );
    const host = () => {
      const persisted = createPersistedComposerDraft(undefined, () => 'user');
      return (
        <NewChatPage
          draft={persisted.draft()}
          onDraftChange={persisted.setDraft}
          roster={buildAgentRoster({
            agents: [],
            runtimes: [],
            cursorConnected: true,
            cursorNeedsConnection: false,
            macroDefaultModel: 'chat-default',
            cursorDefaultModel: 'cursor-default',
          })}
          rosterLoading={false}
          onStart={vi.fn()}
          onOpenRoster={vi.fn()}
        />
      );
    };
    render(host);
    fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Keep the Agents prompt' },
    });
    expect(screen.getByTestId('attachments').textContent).toBe('notes.txt');
    cleanup();
    render(host);
    expect(
      (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Keep the Agents prompt');
    expect(screen.getByTestId('attachments').textContent).toBe('notes.txt');
  });
  it('shows the Agents page and the list composer the same unsent draft', () => {
    localStorage.setItem(
      `${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`,
      JSON.stringify([{ id: 'kept-file', name: 'notes.txt', kind: 'document' }])
    );
    const roster = buildAgentRoster({
      agents: [],
      runtimes: [],
      cursorConnected: true,
      cursorNeedsConnection: false,
      macroDefaultModel: 'chat-default',
      cursorDefaultModel: 'cursor-default',
    });
    render(() => {
      const persisted = createPersistedComposerDraft(undefined, () => 'user');
      return (
        <>
          <section aria-label="Agents page">
            <NewChatPage
              draft={persisted.draft()}
              onDraftChange={persisted.setDraft}
              roster={roster}
              rosterLoading={false}
              onStart={vi.fn()}
              onOpenRoster={vi.fn()}
            />
          </section>
          <section aria-label="List composer">
            <NewChatPage
              compact
              roster={roster}
              rosterLoading={false}
              onStart={vi.fn()}
              onOpenRoster={vi.fn()}
            />
          </section>
        </>
      );
    });
    const agentsPage = within(
      screen.getByRole('region', { name: 'Agents page' })
    );
    const list = within(screen.getByRole('region', { name: 'List composer' }));

    fireEvent.input(agentsPage.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Typed on the page' },
    });
    expect(
      (list.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
    ).toBe('Typed on the page');

    fireEvent.input(list.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Typed on the page, then in the list' },
    });
    expect(
      (agentsPage.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement)
        .value
    ).toBe('Typed on the page, then in the list');

    fireEvent.click(
      agentsPage.getByRole('button', { name: 'Remove notes.txt' })
    );
    expect(list.getByTestId('attachments').textContent).toBe('');
  });
  it('keeps Home attachments off the Agents store when the parent owns the draft', () => {
    mocks.attachments = [
      { id: 'home-file', name: 'home-only.txt', kind: 'document' },
    ];
    localStorage.setItem(
      `${HOME_CONVERSATION_ATTACHMENTS_KEY}:user`,
      JSON.stringify(mocks.attachments)
    );
    localStorage.setItem(
      `${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`,
      JSON.stringify([{ id: 'agents-file', name: 'agents.txt', kind: 'file' }])
    );
    render(() => {
      const persisted = createPersistedComposerDraft(undefined, () => 'user');
      return (
        <NewChatPage
          draft={persisted.draft()}
          onDraftChange={persisted.setDraft}
          attachmentsKey={HOME_CONVERSATION_ATTACHMENTS_KEY}
          roster={buildAgentRoster({
            agents: [],
            runtimes: [],
            cursorConnected: true,
            cursorNeedsConnection: false,
            macroDefaultModel: 'chat-default',
            cursorDefaultModel: 'cursor-default',
          })}
          rosterLoading={false}
          onStart={vi.fn()}
          onOpenRoster={vi.fn()}
        />
      );
    });
    expect(screen.getByTestId('attachments').textContent).toBe('home-only.txt');
  });
  it('starts a new conversation on Auto-detect, not the last used one', async () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    mocks.recentUrls = ['https://github.com/macro-inc/macro'];
    const send = page(true, [], false, [], 'code');
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).toContain('Auto-detect');
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).not.toContain('macro-inc/macro');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      repoUrl: undefined,
    });
  });
  it('preselects the saved default and sends its default branch', () => {
    createRoot((dispose) => {
      createPreferredRepository('user').select(
        'https://github.com/macro-inc/macro'
      );
      dispose();
    });
    mocks.recentIds = [CURSOR_BOT_ID];
    const send = page(true, [], false, [], 'code');
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).toContain('macro-inc/macro');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'develop',
    });
  });

  it('lets a conversation override the default with Auto-detect without changing settings', () => {
    createRoot((dispose) => {
      createPreferredRepository('user').select(
        'https://github.com/macro-inc/macro'
      );
      dispose();
    });
    mocks.recentIds = [CURSOR_BOT_ID];
    const send = page(true, [], false, [], 'code');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Repository' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('option', { name: 'Auto-detect' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      repoUrl: undefined,
    });
    createRoot((dispose) => {
      expect(createPreferredRepository('user').repository()).toBe(
        'https://github.com/macro-inc/macro'
      );
      dispose();
    });
  });

  it('uses Auto-detect when the saved repository is no longer accessible', () => {
    createRoot((dispose) => {
      createPreferredRepository('user').select(
        'https://github.com/org/removed'
      );
      dispose();
    });
    mocks.recentIds = [CURSOR_BOT_ID];
    const send = page(true, [], false, [], 'code');
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).toContain('Auto-detect');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      repoUrl: undefined,
    });
  });

  it('updates the mounted composer when settings change until the caller overrides it', () => {
    mocks.recentIds = [CURSOR_BOT_ID];
    const send = page(true, [], false, [], 'code');
    const settings = createRoot((dispose) => ({
      ...createPreferredRepository('user'),
      dispose,
    }));
    settings.select('https://github.com/macro-inc/macro');
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).toContain('macro-inc/macro');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Repository' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('option', { name: 'Auto-detect' }), {
      key: 'Enter',
    });
    settings.select(undefined);
    settings.select('https://github.com/macro-inc/macro');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      repoUrl: undefined,
    });
    settings.dispose();
  });

  it('refuses an unlisted repository and starts a listed one on its default branch', async () => {
    const send = page(true, [], false, [], 'code');
    await selectAgent(/Cursor/);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Repository' }), {
      key: 'Enter',
    });
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
    fireEvent.keyDown(screen.getByRole('option', { name: 'macro-inc/macro' }), {
      key: 'Enter',
    });
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Branch' }), {
      key: 'Enter',
    });
    fireEvent.input(screen.getByRole('combobox', { name: 'Search branches' }), {
      target: { value: 'feature/other' },
    });
    fireEvent.keyDown(
      screen.getByRole('option', { name: 'Use feature/other' }),
      { key: 'Enter' }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith({
      botId: CURSOR_BOT_ID,
      onFailure: expect.any(Function),
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
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      botId: 'saved-agent',
      repoUrl: undefined,
      modelOverride: 'google/gemini-3.8-flash',
    });
  });
  it.each(['codex-cloud', 'future-runtime'])(
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
      fireEvent.keyDown(screen.getByRole('button', { name: 'Repository' }), {
        key: 'Enter',
      });
      fireEvent.keyDown(
        screen.getByRole('option', { name: 'macro-inc/macro' }),
        { key: 'Enter' }
      );
      await selectAgent(/Cloud reviewer/);
      expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Repository' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Branch' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(send).toHaveBeenCalledWith({
        onFailure: expect.any(Function),
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
    fireEvent.keyDown(screen.getByRole('button', { name: 'Repository' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('option', { name: 'macro-inc/macro' }), {
      key: 'Enter',
    });
    expect(
      screen.getByRole('button', { name: 'Branch' }).textContent
    ).toContain('develop');
    await selectAgent(/Laptop agent/);
    const branch = screen.getByRole('button', { name: 'Branch' });
    expect(branch.textContent).toContain('main');
    expect(branch.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith({
      onFailure: expect.any(Function),
      prompt: 'Prompt',
      botId: 'local-agent',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'main',
    });
  });

  it('selects a requested agent once the roster has it, and again on every request', async () => {
    const computerAgent: PersistedAgentLike = {
      bot: { id: 'computer-agent', name: "Maya's Agent", handle: 'maya' },
      harness: 'macrod',
      harness_id: 'computer',
      default_model: 'default',
    };
    const [agents, setAgents] = createSignal<PersistedAgentLike[]>([]);
    const [requested, setRequested] = createSignal<AgentRequest>({
      agentId: 'computer-agent',
      request: 'first',
    });
    const send = vi.fn();
    render(() => (
      <NewChatPage
        mode="code"
        requestedAgent={requested()}
        roster={buildAgentRoster({
          agents: agents(),
          runtimes: [{ id: 'computer', name: 'Agent Box', connected: true }],
          cursorConnected: true,
          cursorNeedsConnection: false,
        })}
        rosterLoading={false}
        onStart={send}
        onOpenRoster={vi.fn()}
      />
    ));
    const trigger = () =>
      screen.getByRole('button', { name: 'Choose an agent or model' });
    // The agent list was cached before the computer created its agent.
    expect(trigger().textContent).not.toContain("Maya's Agent");

    setAgents([computerAgent]);
    expect(trigger().textContent).toContain("Maya's Agent");

    await selectAgent(/Cursor/);
    expect(trigger().textContent).toContain('Cursor');
    setRequested({ agentId: 'computer-agent', request: 'second' });
    expect(trigger().textContent).toContain("Maya's Agent");

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ botId: 'computer-agent' })
    );
  });

  it('keeps a disconnected paired agent visible and offers to reconnect it', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    const row = screen.getByRole('button', { name: /Laptop agent/ });
    // The row stays clickable: selecting it opens Settings → Runtimes, where
    // the runtime can be restarted (one click on desktop) or re-paired.
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    expect(row.textContent).toContain('Reconnect machine');
    fireEvent.click(row);
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
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
      const onConnect = vi.fn();
      render(() => (
        <AgentPicker
          agents={roster}
          selected={roster[0]}
          loading={false}
          onSelect={onSelect}
          onConnect={onConnect}
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
      // The disconnected row stays clickable: it offers to reconnect the
      // runtime (opens Settings → Runtimes) and keeps the reason as a tooltip.
      expect(offline.textContent).toContain('Reconnect machine');
      expect(
        within(picker).queryByText('Connect the machine to load models.')
      ).toBeNull();
      expect(within(picker).queryByText('Models')).toBeNull();
      const unavailable = within(offline).getByRole(
        touch ? 'button' : 'menuitem'
      );
      // The desktop row keeps the reason as a tooltip; the drawer row has no
      // title attribute.
      if (!touch) {
        expect(unavailable.getAttribute('title')).toBe(
          'Its machine is disconnected'
        );
      }
      expect(
        touch
          ? unavailable.hasAttribute('disabled')
          : unavailable.getAttribute('aria-disabled') === 'true'
      ).toBe(false);
      if (touch) {
        fireEvent.click(unavailable);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onConnect).toHaveBeenCalledOnce();
        // Connecting closes the drawer; reopen it for the create assertion.
        fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
        await screen.findByRole('dialog');
      }
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
  it('checks custom-agent models only in their dedicated page', () => {
    page(true, [], false, [], 'code');
    openAgents();
    fireEvent.input(
      screen.getByRole('textbox', { name: 'Search agents and models' }),
      { target: { value: 'Cursor Default' } }
    );
    expect(
      screen
        .getByRole('button', { name: 'Cursor Default' })
        .querySelector('[data-macro-icon="check"]')
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cursor Default' }));
    expect(
      screen
        .getByRole('button', { name: 'Cursor Default' })
        .querySelector('[data-macro-icon="check"]')
    ).not.toBeNull();
  });

  it.each([
    ['list', false],
    ['all', false],
    ['agents', false],
    ['agentModels', false],
    ['list', true],
    ['all', true],
    ['agents', true],
    ['agentModels', true],
  ] as const)(
    'clears empty search and restores focus on %s (touch: %s)',
    async (target, touch) => {
      mocks.touch = touch;
      const user = userEvent.setup();
      page(true, [], false, [], 'code');
      if (target === 'agentModels') await openAgentModels('Cursor');
      else {
        openAgents();
        if (target === 'all')
          fireEvent.click(screen.getByRole('button', { name: 'More models' }));
        if (target === 'agents')
          fireEvent.click(screen.getByRole('button', { name: 'See all' }));
      }
      const search = screen.getByRole('textbox', {
        name:
          target === 'agentModels'
            ? 'Search models'
            : 'Search agents and models',
      });
      if (touch) search.focus({ preventScroll: true });
      else await waitFor(() => expect(document.activeElement).toBe(search));
      fireEvent.input(search, { target: { value: 'no-such-choice' } });
      const menu = within(search.closest('[role="dialog"]')!);
      expect(menu.getByRole('status').textContent).toBe(
        'No matches for “no-such-choice”'
      );
      const clear = menu.getByRole('button', { name: 'Clear search' });
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(clear);
      await user.keyboard('{Enter}');
      await waitFor(() => expect((search as HTMLInputElement).value).toBe(''));
      await waitFor(() => expect(document.activeElement).toBe(search));
      expect(menu.queryByRole('status')).toBeNull();
    }
  );

  it('keeps desktop card, catalog, search and More models open through focused page changes', async () => {
    const user = userEvent.setup();
    page(true, [], false, [], 'code');
    await user.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    const card = screen.getByRole('dialog');
    const stableFocus = vi.spyOn(card, 'focus');
    await user.click(within(card).getByRole('button', { name: 'Cursor' }));
    expect(stableFocus).toHaveBeenCalledWith({ preventScroll: true });
    const search = screen.getByRole('textbox', {
      name: 'Search agents and models',
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.type(search, 'GPT');
    expect(screen.getByRole('button', { name: 'GPT-5' })).toBeTruthy();
    await user.clear(search);
    await user.click(screen.getByRole('button', { name: 'More models' }));
    expect(screen.getByRole('dialog')).toBe(card);
    await waitFor(() => expect(document.activeElement).toBe(search));
    for (const avatar of document.querySelectorAll('[data-agent-avatar]')) {
      expect(avatar.className).toContain('bg-surface-1');
      expect(avatar.className).toContain('text-ink-muted');
      expect(avatar.className).toContain('rounded-full');
    }
    fireEvent.keyDown(search, { key: 'Escape' });
    const modelButton = screen.getByRole('button', { name: 'Cursor Default' });
    await user.click(modelButton);
    expect(screen.getByRole('textbox', { name: 'Search models' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'GPT-5' })).toBeTruthy();
  });

  it.each([false, true])(
    'keeps rejected async model selections open (touch: %s)',
    async (touch) => {
      mocks.touch = touch;
      let settle: ((applied: boolean) => void) | undefined;
      const pending = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      const onOpenChange = vi.fn();
      render(() => (
        <UnifiedModelSelector
          state={{
            model: 'openai/gpt-5.6',
            models: [
              { id: 'openai/gpt-5.6', label: 'GPT-5.6' },
              { id: 'anthropic/claude-sonnet-5-5', label: 'Sonnet 5.5' },
            ],
            suggestedModels: [
              { id: 'openai/gpt-5.6', label: 'GPT-5.6' },
              { id: 'anthropic/claude-sonnet-5-5', label: 'Sonnet 5.5' },
            ],
            onModel: () => pending,
            onEffort: () => {},
            onSpeed: () => {},
            onOpenChange,
          }}
        />
      ));
      fireEvent.click(
        screen.getByRole('button', { name: 'Choose an agent or model' })
      );
      fireEvent.click(await screen.findByRole('button', { name: 'GPT-5.6' }));
      const search = await screen.findByRole('textbox');
      fireEvent.click(screen.getByRole('button', { name: 'Sonnet 5.5' }));
      expect(screen.getByRole('textbox')).toBe(search);
      settle?.(false);
      await pending;
      await waitFor(() => expect(screen.getByRole('textbox')).toBe(search));
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    }
  );

  it('focuses the shared search and filters the selected agent catalog', async () => {
    page(true, [], false, [], 'code');
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cursor Default' }));
    const search = screen.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.input(search, { target: { value: 'GPT' } });
    expect(screen.getByRole('button', { name: 'GPT-5' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cursor Default' })).toBeNull();
  });
  it('retains custom-agent model overrides for one send', async () => {
    const send = page(true, [], false, [], 'code');
    const models = await openAgentModels('Cursor');
    expect(
      models
        .getByRole('button', { name: /Cursor Default/ })
        .querySelector('.text-accent')
    ).toBeTruthy();
    fireEvent.click(models.getByRole('button', { name: 'GPT-5' }));
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toContain('Cursor');
    fireEvent.click(screen.getByRole('button', { name: 'GPT-5' }));
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('button', { name: 'GPT-5' })
        .querySelector('.text-accent')
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ botId: CURSOR_BOT_ID, modelOverride: 'gpt-5' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send.mock.calls[1][0]).not.toHaveProperty('modelOverride');
  });
  it.each([false, true])(
    'pins and unpins a picked agent model without changing the agent (touch: %s)',
    async (touch) => {
      mocks.touch = touch;
      const send = page(true, [], false, [], 'code');
      const models = await openAgentModels('Cursor');
      fireEvent.click(models.getByRole('button', { name: 'GPT-5' }));
      const trigger = screen.getByRole('button', {
        name: 'Choose an agent or model',
      });
      if (touch) fireEvent.click(trigger);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Keep GPT-5 for Cursor' })
      );
      expect(
        screen
          .getByRole('button', { name: 'Stop keeping GPT-5' })
          .getAttribute('aria-pressed')
      ).toBe('true');
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(send.mock.lastCall?.[0]).toMatchObject({
        botId: CURSOR_BOT_ID,
        modelOverride: 'gpt-5',
      });
      fireEvent.click(trigger);
      fireEvent.click(
        screen.getByRole('button', { name: 'Stop keeping GPT-5' })
      );
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(send.mock.lastCall?.[0]).not.toHaveProperty('modelOverride');
    }
  );
  it.each([false, true])(
    'keeps an agent model across sends and remounts (touch: %s)',
    (touch) => {
      mocks.touch = touch;
      localStorage.setItem(
        'agents-view-kept-model-v1:user',
        JSON.stringify({
          [CURSOR_BOT_ID]: 'gpt-5',
        })
      );
      const send = page(true, [], false, [], 'code');
      expect(
        screen.getByRole('button', { name: 'Choose an agent or model' })
          .textContent
      ).toContain('GPT-5');
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      for (const [request] of send.mock.calls) {
        expect(request).toMatchObject({
          botId: CURSOR_BOT_ID,
          modelOverride: 'gpt-5',
        });
      }
      cleanup();
      const remountedSend = page(true, [], false, [], 'code');
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(remountedSend).toHaveBeenCalledWith(
        expect.objectContaining({ modelOverride: 'gpt-5' })
      );
    }
  );

  it('isolates kept models across account changes without leaking one-shot choices', () => {
    const [identity, setIdentity] = createSignal<string | undefined>('user-a');
    mocks.userId = identity;
    localStorage.setItem(
      'agents-view-kept-model-v1:user-a',
      JSON.stringify({
        [CURSOR_BOT_ID]: 'gpt-5',
      })
    );
    const send = page(true, [], false, [], 'code');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelOverride: 'gpt-5' })
    );
    setIdentity('user-b');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send.mock.lastCall?.[0]).not.toHaveProperty('modelOverride');
    setIdentity('user-a');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelOverride: 'gpt-5' })
    );
  });

  it('sends a kept in-memory model while its catalog is pending', () => {
    mocks.modelsPending = true;
    mocks.recentIds = ['saved-agent'];
    localStorage.setItem(
      'agents-view-kept-model-v1:user',
      JSON.stringify({ 'saved-agent': 'openai/gpt-5.6' })
    );
    const send = page(
      true,
      [
        {
          bot: { id: 'saved-agent', name: 'Reviewer', handle: 'reviewer' },
          harness: 'in-memory',
          default_model: 'chat-default',
        },
      ],
      false,
      [],
      'chat'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        botId: 'saved-agent',
        modelOverride: 'openai/gpt-5.6',
      })
    );
    expect(send.mock.lastCall?.[0]).not.toHaveProperty('modelFallback');
  });

  it('forgets retired kept models only after a complete catalog arrives', () => {
    mocks.modelsPending = true;
    localStorage.setItem(
      'agents-view-kept-model-v1:user',
      JSON.stringify({
        [CURSOR_BOT_ID]: 'retired-model',
      })
    );
    page(true, [], false, [], 'code');
    expect(
      JSON.parse(localStorage.getItem('agents-view-kept-model-v1:user')!)[
        CURSOR_BOT_ID
      ]
    ).toBe('retired-model');
    cleanup();
    mocks.modelsPending = false;
    const send = page(true, [], false, [], 'code');
    expect(
      JSON.parse(localStorage.getItem('agents-view-kept-model-v1:user')!)[
        CURSOR_BOT_ID
      ]
    ).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send.mock.lastCall?.[0]).not.toHaveProperty('modelOverride');
  });

  it('clears a kept choice when it becomes the agent default', () => {
    localStorage.setItem(
      'agents-view-kept-model-v1:user',
      JSON.stringify({
        [CURSOR_BOT_ID]: 'cursor-default',
      })
    );
    page(true, [], false, [], 'code');
    expect(
      JSON.parse(localStorage.getItem('agents-view-kept-model-v1:user')!)[
        CURSOR_BOT_ID
      ]
    ).toBeUndefined();
  });
  it('clears a temporary model choice when switching to Code', async () => {
    page();
    openAgents();
    const model = screen.getByRole('button', { name: 'Sonnet 5.5' });
    model.focus();
    fireEvent.click(model);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toContain('Sonnet 5.5');
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toContain('Cursor');
  });
  it('groups the complete catalog and selects models with readable names and icons', async () => {
    const send = page(true, [
      {
        bot: { id: 'saved-agent', name: 'Reviewer', handle: 'reviewer' },
        harness: 'in-memory',
        default_model: 'saved-default',
      },
    ]);
    openAgents();
    expect(screen.getByRole('button', { name: 'See all' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More models' }));
    const search = screen.getByRole('textbox', {
      name: 'Search agents and models',
    });
    fireEvent.input(search, { target: { value: 'GLM' } });
    expect(screen.getByRole('button', { name: 'GLM 5.3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'GLM 5.3 Flash' })).toBeTruthy();
    fireEvent.input(search, { target: { value: 'Sonnet 5.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sonnet 5.5' }));
    expect(mocks.rememberInmemModel).toHaveBeenCalledWith(
      'anthropic/claude-sonnet-5-5'
    );
    const trigger = screen.getByRole('button', {
      name: 'Choose an agent or model',
    });
    expect(trigger.textContent).toContain('Sonnet 5.5');
    expect(
      trigger.querySelector('[data-ai-provider="anthropic"] svg')
    ).toBeTruthy();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        botId: undefined,
        modelOverride: 'anthropic/claude-sonnet-5-5',
      })
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

    const search = screen.getByRole('textbox', {
      name: /Search (agents and )?models/,
    });
    fireEvent.input(search, { target: { value: 'GLM' } });
    const flash = screen.getByTitle('GLM 5.3 Flash');
    expect(flash.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(flash);
    fireEvent.input(search, { target: { value: '' } });

    const more = screen.getByRole('menuitem', { name: 'More models' });
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
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toBe('Sonnet 5.5');
  });
  it('uses the free catalog default instead of a persisted paid model', async () => {
    mocks.freePlan = true;
    mocks.preferredInmemModel = 'anthropic/claude-sonnet-5-5';
    const send = page();
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toBe('Gemini 3.8 Flash');
    openAgents();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Sonnet 5.5' })).toBeNull();
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('button', {
          name: 'Gemini 3.8 Flash',
        })
        .find((button) => button.hasAttribute('data-model-choice'))
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
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
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toContain('Cursor');
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
    const before = screen.getByRole('button', {
      name: 'Choose an agent or model',
    }).textContent;
    await selectAgent(/Cursor/);
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
    expect(
      screen.getByRole('button', { name: 'Choose an agent or model' })
        .textContent
    ).toBe(before);
  });
  it.each(['free', 'premium', 'max'])(
    'uses the correct initial effort for %s',
    async (tier) => {
      mocks.tier = tier;
      mocks.currentEffort = 'ultra';
      const send = page(true, [], false, [], 'code');
      const models = await openAgentModels('Cursor');
      fireEvent.click(models.getByRole('button', { name: /^GPT-5/ }));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          effortOverride:
            tier === 'max'
              ? undefined
              : { configId: 'cursor_effort', value: 'low' },
        })
      );
    }
  );
  it('passes opaque Thinking choices while discovery refreshes', async () => {
    const send = page();
    openAgents();
    fireEvent.click(screen.getByRole('button', { name: 'GPT-5.6' }));
    const slider = screen.getByRole('slider', { name: 'Thinking' });
    slider.focus();
    fireEvent.keyDown(slider, { key: 'End' });
    mocks.capabilitiesPending = true;
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modelOverride: 'openai/gpt-5.6',
        effortOverride: { configId: 'cursor_effort', value: 'ultra' },
      })
    );
  });
  it.each([false, true])(
    'shows Thinking only after a non-default choice (touch: %s)',
    async (touch) => {
      mocks.touch = touch;
      page();
      openAgents();
      fireEvent.click(screen.getByRole('button', { name: 'GPT-5.6' }));
      const trigger = screen.getByRole('button', {
        name: 'Choose an agent or model',
      });
      expect(trigger.textContent).not.toContain('Low');
      if (touch) fireEvent.click(trigger);
      const slider = await screen.findByRole('slider', { name: 'Thinking' });
      slider.focus();
      fireEvent.keyDown(slider, { key: 'End' });
      expect(trigger.textContent).toContain('Ultra');
      fireEvent.keyDown(slider, { key: 'Home' });
      expect(trigger.textContent).not.toContain('Low');
      expect(trigger.textContent).not.toContain('Ultra');
    }
  );
  it('retains Thinking on reopen and resets it on a new model pick', async () => {
    const send = page();
    openAgents();
    fireEvent.click(screen.getByRole('button', { name: 'GPT-5.6' }));
    const slider = screen.getByRole('slider', { name: 'Thinking' });
    slider.focus();
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        effortOverride: { configId: 'cursor_effort', value: 'ultra' },
      })
    );
    openAgents();
    fireEvent.input(
      screen.getByRole('textbox', { name: 'Search agents and models' }),
      { target: { value: 'Sonnet 5.5' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sonnet 5.5' }));
    openAgents();
    fireEvent.click(screen.getByRole('button', { name: 'GPT-5.6' }));
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
      onFailure: expect.any(Function),
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

it('restores a text-only draft when startup configuration fails', () => {
  mocks.attachments = [];
  const start = page();
  fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
    target: { value: 'Keep my unsent prompt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Draft' }), {
    target: { value: '' },
  });
  start.mock.calls[0][0].onFailure();
  expect(
    (screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value
  ).toBe('Keep my unsent prompt');
});

it('retains uploaded attachments until first delivery is accepted', () => {
  mocks.attachments = [
    {
      id: 'retained-file',
      name: 'keep.txt',
      kind: 'document',
      mimeType: 'text/plain',
      size: 12,
    },
  ];
  localStorage.setItem(
    `${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`,
    JSON.stringify(mocks.attachments)
  );
  const start = page();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(
    JSON.parse(
      localStorage.getItem(`${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`)!
    )
  ).toEqual(mocks.attachments);
  start.mock.calls[0][0].onFailure();
  expect(
    JSON.parse(
      localStorage.getItem(`${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`)!
    )
  ).toEqual(mocks.attachments);
  start.mock.calls[0][0].onDelivered();
  expect(
    JSON.parse(
      localStorage.getItem(`${NEW_CONVERSATION_ATTACHMENTS_KEY}:user`)!
    )
  ).toEqual([]);
});

it('isolates drafts and attachment projections as identity arrives and changes', () => {
  const [identity, setIdentity] = createSignal<string>();
  mocks.userId = identity;
  const base = 'attachment-tracker-agents-new-conversation-persist-v0';
  const attachment = { id: 'private', name: 'alice-only.txt', kind: 'file' };
  localStorage.setItem(`${base}:`, JSON.stringify([attachment]));
  localStorage.setItem(`${base}:alice`, JSON.stringify([attachment]));
  page();
  expect(screen.getByTestId('attachments').textContent).toBe('');
  fireEvent.input(screen.getByLabelText('Draft'), {
    target: { value: 'anonymous' },
  });
  setIdentity('alice');
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('');
  expect(screen.getByTestId('attachments').textContent).toBe('alice-only.txt');
  fireEvent.input(screen.getByLabelText('Draft'), {
    target: { value: 'Alice private' },
  });
  setIdentity('bob');
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('');
  expect(screen.getByTestId('attachments').textContent).toBe('');
  setIdentity('alice');
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe(
    'Alice private'
  );
});

it('does not restore a failed first prompt into another account', () => {
  const [identity, setIdentity] = createSignal<string | undefined>('alice');
  mocks.userId = identity;
  mocks.attachments = [];
  const start = page(true, [], false, [], 'chat');
  fireEvent.input(screen.getByLabelText('Draft'), {
    target: { value: 'Alice prompt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  setIdentity('bob');
  start.mock.calls[0][0].onFailure();
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('');
});

it('drops an Auto prompt when another account signs in while it is being routed', async () => {
  const [identity, setIdentity] = createSignal<string | undefined>('alice');
  mocks.userId = identity;
  mocks.attachments = [];
  let route!: (mode: 'chat' | 'code') => void;
  mocks.chooseAgentMode.mockReturnValueOnce(
    new Promise((resolve) => {
      route = resolve;
    })
  );
  const start = page(true, [], false, [], 'auto');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(mocks.chooseAgentMode).toHaveBeenCalledWith('Prompt');
  setIdentity('bob');
  route('code');
  await Promise.resolve();
  await Promise.resolve();
  expect(start).not.toHaveBeenCalled();
});

it('clears delivered attachments after switching away and back to the submitting account', () => {
  const [identity, setIdentity] = createSignal<string | undefined>('alice');
  mocks.userId = identity;
  mocks.attachments = [{ id: 'sent-file', name: 'sent.txt', kind: 'document' }];
  localStorage.setItem(
    `${NEW_CONVERSATION_ATTACHMENTS_KEY}:alice`,
    JSON.stringify(mocks.attachments)
  );
  const start = page();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  setIdentity('bob');
  setIdentity('alice');
  expect(screen.getByTestId('attachments').textContent).toBe('sent.txt');
  start.mock.calls[0][0].onDelivered();
  expect(screen.getByTestId('attachments').textContent).toBe('');
});
