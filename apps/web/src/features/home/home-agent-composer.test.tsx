import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createEditor, type LexicalEditor } from 'lexical';
import { type ComponentProps, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildAgentRoster } from '../agents-view/core/roster';
import type { StartConversation } from '../agents-view/views/NewChatPage';
import { HomeAgentComposer } from './home-agent-composer';

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => 'pending-session'),
  replace: vi.fn(),
  openStartedSession: vi.fn(),
  onStart: undefined as ((start: StartConversation) => void) | undefined,
  editor: undefined as LexicalEditor | undefined,
  realPage: false,
}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: mocks.start,
}));
vi.mock('./home-view-context', () => ({
  useHomeView: () => ({ openStartedSession: mocks.openStartedSession }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'viewer-1',
  useHasPermission: () => () => false,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('../agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({
    roster: () =>
      buildAgentRoster({
        agents: [],
        runtimes: [],
        cursorConnected: true,
        cursorNeedsConnection: false,
        macroDefaultModel: 'chat-default',
        cursorDefaultModel: 'cursor-default',
      }),
    loading: () => false,
    availabilityLoading: () => false,
  }),
}));
vi.mock('../agents-view/views/NewChatPage', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../agents-view/views/NewChatPage')>();
  return {
    ...actual,
    NewChatPage: (props: ComponentProps<typeof actual.NewChatPage>) => {
      if (mocks.realPage) return <actual.NewChatPage {...props} />;
      mocks.onStart = props.onStart;
      return (
        <input
          aria-label="Shared draft"
          value={props.draft}
          onInput={(e) => props.onDraftChange?.(e.currentTarget.value)}
        />
      );
    },
  };
});
vi.mock('@queries/agent-session/warm', () => ({
  useWarmAgentSessionQuery: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@channel/Input', async () => ({
  ...(await import('../channel/Input/attachment-tracker')),
  uploadInputAttachments: vi.fn(),
}));
vi.mock('@queries/connectors', () => ({
  useConnectors: () => ({
    list: () => [],
    ready: () => true,
    error: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('@app/features/block-agent/context/recent-agent-selections', () => ({
  createRecentAgentSelections: () => ({ ids: () => [], remember: vi.fn() }),
}));
vi.mock('../agents-view/primitives/recent-repositories', () => ({
  createRecentRepositories: () => ({ urls: () => [], remember: vi.fn() }),
}));
vi.mock('../agents-view/primitives/preferred-inmem-model', () => ({
  createPreferredInmemModel: () => ({
    model: () => undefined,
    remember: vi.fn(),
  }),
}));
vi.mock('../agents-view/queries/reachable-repositories', () => ({
  createReachableRepositories: () => ({
    repositories: () => [],
    loading: () => false,
    error: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('../agents-view/queries/repository-branches', () => ({
  createRepositoryBranches: () => ({
    branches: () => [],
    loading: () => false,
    error: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('@queries/auth/ai-billing', () => ({
  useAiBillingSummaryQuery: () => ({ isSuccess: true, data: { tier: 'max' } }),
}));
vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: () => ({
    isSuccess: true,
    isFetching: false,
    data: { configOptions: [] },
  }),
}));
vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: () => ({
    isSuccess: true,
    isPending: false,
    isError: false,
    data: {
      status: 'available',
      currentModel: 'chat-default',
      models: [
        { id: 'chat-default', name: 'Chat Default' },
        { id: 'claude-sonnet-4', name: 'Sonnet 4' },
      ],
    },
  }),
}));
vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const lexical = createEditor();
      mocks.editor = lexical;
      let markdown = '';
      const builder = {
        lexical,
        buildHandle: () => ({ lexical }),
        withAppLinkResolver: () => builder,
        namespace: () => builder,
        withMentions: () => builder,
        withEmojis: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withRestoreFocus: () => builder,
        withFilePaste: () => builder,
        withSkills: () => builder,
        onEnter: () => builder,
        onFocusLeave: () => builder,
        onChange: () => builder,
        controls: {
          getMarkdown: () => markdown,
          setMarkdown: (value: string) => {
            markdown = value;
          },
          clear: () => {
            markdown = '';
          },
          focus: () => lexical.getRootElement()?.focus(),
        },
      };
      return builder;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { ariaLabel?: string; onConnect?: () => void }) => {
    let root: HTMLDivElement | undefined;
    const editor = mocks.editor;
    onMount(() => {
      editor?.setRootElement(root ?? null);
      props.onConnect?.();
    });
    onCleanup(() => editor?.setRootElement(null));
    return (
      <div
        ref={root}
        contentEditable
        role="textbox"
        aria-label={props.ariaLabel}
      />
    );
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.realPage = false;
});
afterEach(cleanup);

it('opens the new session inside Home', () => {
  render(() => <HomeAgentComposer />);
  const start = {
    prompt: 'Build it',
    botId: 'selected-agent',
    modelOverride: 'model',
    repoUrl: 'https://github.com/macro-inc/macro',
    repoBranch: 'feature/home',
  };
  mocks.onStart?.(start);
  // The viewer rides along so the first prompt is attributed as the log will.
  expect(mocks.start).toHaveBeenCalledWith({
    ...start,
    userId: 'viewer-1',
    submitSurface: 'home',
  });
  // The session opens in Home's detail pane instead of replacing Home.
  expect(mocks.openStartedSession).toHaveBeenCalledWith('pending-session');
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('restores Home text after visiting an agent session and returning', () => {
  const first = render(() => <HomeAgentComposer />);
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Unsent Home prompt' },
  });
  first.unmount();
  render(() => <HomeAgentComposer />);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Unsent Home prompt'
  );
});

it('keeps a cleared Home draft empty on the next visit', () => {
  const first = render(() => <HomeAgentComposer />);
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Clear me' },
  });
  fireEvent.input(screen.getByRole('textbox'), { target: { value: '' } });
  first.unmount();
  render(() => <HomeAgentComposer />);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});

// Keep the real host, composer, selector, and focus scope in the regression.
it('keeps the Home model menu open while searching and reopening', async () => {
  mocks.realPage = true;
  const user = userEvent.setup();
  const styles = document.createElement('style');
  styles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(styles);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const originalScrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = vi.fn();
  try {
    render(() => <HomeAgentComposer />);
    const editor = screen.getByRole('textbox', { name: 'Message the agent' });
    editor.focus();
    const trigger = screen.getByRole('button', {
      name: 'Choose an agent or model',
    });
    await user.click(trigger);
    const card = await screen.findByRole('dialog');
    await user.click(
      within(card).getByRole('button', { name: 'Chat Default' })
    );
    const search = await screen.findByRole('textbox', {
      name: 'Search agents and models',
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.type(search, 'Sonnet');
    expect(screen.getByRole('button', { name: 'Sonnet 4' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(card);
    expect(document.activeElement).toBe(search);
    await user.click(trigger);
    await waitFor(() =>
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    );
    await user.click(trigger);
    await waitFor(() =>
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(editor.isConnected).toBe(true);
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Chat Default',
      })
    ).toBeTruthy();
  } finally {
    Element.prototype.scrollTo = originalScrollTo;
    styles.remove();
    vi.unstubAllGlobals();
  }
});
