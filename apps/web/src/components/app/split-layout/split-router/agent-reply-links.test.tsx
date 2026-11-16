/**
 * @vitest-environment jsdom
 *
 * A Macro app link in an agent's reply, in its session or in a channel, opens
 * in the app in a new split, the way the reply's mention chips do; other links
 * and people's messages still open a browser tab.
 */

import { Message } from '@app/features/block-agent/component/AgentMessage';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
  settingsRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { Content } from '@channel/Message/Content';
import { MessageProvider } from '@channel/Message/context';
import type { MessageData } from '@core/messages/types';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createRoot, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSplitLayout } from '../layoutManager';
import { createAppPanePolicy } from './app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from './legacy-route';

vi.mock('@app/features/block-agent/context/AgentSessionContext', () => ({
  useOptionalAgentSession: () => undefined,
}));
vi.mock('@channel/Message/MentionedImages', () => ({
  MentionedImages: () => null,
}));
vi.mock('@channel/Message/MentionedRoutineTemplates', () => ({
  MentionedRoutineTemplates: () => null,
}));
vi.mock('../componentRegistry', () => ({
  resolveComponent: () => ({ element: undefined }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: { md: {} },
  fileTypeToBlockName: (type: string) => type,
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/signal/unfurl', () => ({
  useUnfurl: () => [() => undefined],
}));
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  channelTheme: {},
}));
// The markdown renderer is not under test: it renders each link as the real
// `LinkWithPreview` anchor, as `StaticMarkdown` does.
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  async () => {
    const { LinkWithPreview } = await import(
      '@core/component/LexicalMarkdown/component/core/LinkWithPreview'
    );
    return {
      StaticMarkdown: (props: { markdown: string }) => {
        const links = [...props.markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
        return links.map(([, label, url]) => (
          <LinkWithPreview url={url!}>{label}</LinkWithPreview>
        ));
      },
    };
  }
);

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        homeSplitRoute,
        tasksSplitRoute,
        settingsRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

const orchestrator = {
  createBlockInstance: vi.fn((_type: string, id: string) => ({
    element: undefined,
    node: { id },
    detach: vi.fn(),
    dispose: vi.fn(),
  })),
  isBlockMounted: () => false,
  getBlockHandle: async () => undefined,
} as unknown as BlockOrchestrator;

function reply(text: string): FoldedMessage {
  return {
    agentSessionId: 'session',
    key: '0:agent',
    requestId: null,
    pending: false,
    postedAt: null,
    segments: [],
    phase: null,
    turn: 0,
    author: { kind: 'agent' },
    parts: [{ kind: 'text', text }],
    stop: { kind: 'end_turn' },
  };
}

const disposers: (() => void)[] = [];

function agentReply(text: string): JSX.Element {
  return <Message message={reply(text)} inFlight={false} />;
}

function channelMessage(senderId: string, text: string): JSX.Element {
  const message = {
    id: 'message-1',
    content: text,
    sender_id: senderId,
    created_at: '2026-11-09T00:00:00.000Z',
    updated_at: '2026-11-09T00:00:00.000Z',
    attachments: [],
    reactions: [],
  } as unknown as MessageData;
  return (
    <MessageProvider value={() => message}>
      <Content />
    </MessageProvider>
  );
}

function renderSplits(content: () => JSX.Element) {
  const { manager, router } = createRoot((dispose) => {
    disposers.push(dispose);
    let manager: ReturnType<typeof createSplitLayout> | undefined;
    const router = createSplitRouter({
      routes,
      history: createMemoryHistory('/home'),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({
          route: paneRoute({ id: 'view-home', params: {} }),
        }),
        stacked: () => false,
      }),
    });
    manager = createSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
      stacked: () => false,
    });
    return { manager, router };
  });
  setGlobalSplitManager(manager);
  const view = render(() => (
    <SplitRouterProvider router={router}>{content()}</SplitRouterProvider>
  ));
  const contents = () =>
    manager
      .splits()
      .map((split) => ({ type: split.content.type, id: split.content.id }));
  const lastRoute = () => {
    const pane = router.panes().at(-1);
    return pane && router.entry(pane)?.location.route.matches.at(-1);
  };
  return { view, contents, lastRoute };
}

let windowOpen: ReturnType<typeof vi.spyOn<Window, 'open'>>;

beforeEach(() => {
  windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  setGlobalSplitManager(undefined);
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

const HOME = { type: 'component', id: 'home' };
const NOTES = 'Read [the notes](https://dev.macro.com/app/md/doc-1).';

describe('links in an agent reply', () => {
  it('opens a Macro document link in a new split', async () => {
    const { view, contents } = renderSplits(() => agentReply(NOTES));

    fireEvent.click(view.getByText('the notes'));

    await vi.waitFor(() =>
      expect(contents()).toEqual([HOME, { type: 'md', id: 'doc-1' }])
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens a Macro list view link in a new split', async () => {
    const { view, contents } = renderSplits(() =>
      agentReply('See [your tasks](https://dev.macro.com/app/tasks).')
    );

    fireEvent.click(view.getByText('your tasks'));

    await vi.waitFor(() =>
      expect(contents()).toEqual([HOME, { type: 'component', id: 'tasks' }])
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens a nested Macro route at its full location', async () => {
    const { view, lastRoute } = renderSplits(() =>
      agentReply(
        'Change it in [appearance settings](https://dev.macro.com/app/settings/appearance).'
      )
    );

    fireEvent.click(view.getByText('appearance settings'));

    await vi.waitFor(() =>
      expect(lastRoute()).toEqual({
        id: 'settings',
        params: { tab: 'appearance' },
      })
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens other sites in a browser tab', () => {
    const { view, contents } = renderSplits(() =>
      agentReply('See [the docs](https://example.com/app/md/doc-1).')
    );

    fireEvent.click(view.getByText('the docs'));

    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/app/md/doc-1',
      '_blank',
      'noopener,noreferrer'
    );
    expect(contents()).toEqual([HOME]);
  });

  it('leaves a Macro link no route matches to a browser tab', () => {
    const { view, contents } = renderSplits(() =>
      agentReply('See [nothing](https://dev.macro.com/app/no-such-view/a/b/c).')
    );

    fireEvent.click(view.getByText('nothing'));

    expect(windowOpen).toHaveBeenCalledOnce();
    expect(contents()).toEqual([HOME]);
  });

  it('keeps native anchor behavior for modified clicks', () => {
    const { view, contents } = renderSplits(() => agentReply(NOTES));

    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    view.getByText('the notes').dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(contents()).toEqual([HOME]);
  });
});

describe('links in a channel message', () => {
  it('opens a Macro link from an agent in a new split', async () => {
    const { view, contents } = renderSplits(() =>
      channelMessage('bot|agent-1', NOTES)
    );

    fireEvent.click(view.getByText('the notes'));

    await vi.waitFor(() =>
      expect(contents()).toEqual([HOME, { type: 'md', id: 'doc-1' }])
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("opens a Macro link from a person's message in a browser tab", () => {
    const { view, contents } = renderSplits(() =>
      channelMessage('macro|person@example.com', NOTES)
    );

    fireEvent.click(view.getByText('the notes'));

    expect(windowOpen).toHaveBeenCalledOnce();
    expect(contents()).toEqual([HOME]);
  });
});
