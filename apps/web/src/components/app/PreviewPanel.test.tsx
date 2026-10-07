import { spreadsheetLocationUpdates } from '@app/features/block-spreadsheet/spreadsheet-route';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  defineRoutes,
  type SplitRouter,
} from '@app/lib/split-router';
import {
  PaneContext,
  SplitRouterProvider,
} from '@app/lib/split-router/solid/context';
import { chatLocationUpdates } from '@block-chat/chat-route';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import {
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PreviewPanel,
  type PreviewPanelProps,
  useMaybePreviewPanel,
} from './PreviewPanel';
import type {
  PreviewBlockTarget,
  PreviewPanelSelection,
} from './previewTarget';

const mocks = vi.hoisted(() => ({
  goToLocationFromParams: vi.fn(),
  goToLatest: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
  featureNavigations: vi.fn(),
  activate: vi.fn(),
}));

vi.mock('@block-chat/ChatBlock', () => ({
  ChatBlock: (props: {
    chatId: string;
    params?: Record<string, string>;
    navigationRequest?: number | string;
  }) => {
    onMount(mocks.mounts);
    onCleanup(mocks.unmounts);
    createEffect(() =>
      mocks.featureNavigations(props.params, props.navigationRequest)
    );
    return (
      <div>
        <span data-testid="location">{props.params?.message_id}</span>
        <input aria-label="Message draft" />
      </div>
    );
  },
}));
vi.mock('@app/features/block-spreadsheet/SpreadsheetBlock', () => ({
  default: (props: {
    documentId: string;
    params?: Record<string, string>;
    navigationRequest?: number | string;
  }) => {
    onMount(mocks.mounts);
    onCleanup(mocks.unmounts);
    createEffect(() =>
      mocks.featureNavigations(props.params, props.navigationRequest)
    );
    return (
      <div>
        <span data-testid="location">{props.params?.comment_id}</span>
        <input aria-label="Message draft" />
      </div>
    );
  },
}));

const routerDisposers: Array<() => void> = [];
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}, {}],
}));
vi.mock('./split-layout/components/PriorityCollapseOverflowSensor', () => ({
  createPriorityCollapseController: () => ({
    setRow: () => {},
    collapser: {},
  }),
  PriorityCollapseOverflowSensor: () => null,
}));

afterEach(() => {
  cleanup();
  for (const dispose of routerDisposers.splice(0)) dispose();
  vi.clearAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  initial: PreviewBlockTarget,
  entity?: PreviewPanelSelection,
  routing = false
) {
  const [target, setTarget] = createSignal(initial);
  const [selectedEntity, setSelectedEntity] = createSignal(entity);
  const [navigationRequest, setNavigationRequest] = createSignal(0);
  let preview: ReturnType<typeof useMaybePreviewPanel>;
  const createBlockInstance = vi.fn((type: string, id: string) => ({
    type,
    id,
    element: () => {
      onMount(mocks.mounts);
      onCleanup(mocks.unmounts);
      preview = useMaybePreviewPanel();
      return (
        <div>
          <span data-testid="block">{id}</span>
          <span data-testid="selection">{preview?.previewEntity()?.id}</span>
          <input aria-label="Message draft" />
        </div>
      );
    },
  }));
  const getBlockHandle = vi.fn(async () => ({
    goToLocationFromParams: mocks.goToLocationFromParams,
    goToLatest: mocks.goToLatest,
  }));
  const orchestrator = {
    isBlockMounted: () => false,
    createBlockInstance,
    getBlockHandle,
  } as unknown as PreviewPanelProps['orchestrator'];
  const onFocusOut = vi.fn();
  const router: SplitRouter | undefined = routing
    ? createRoot((dispose) => {
        const home = defineRoute({
          id: 'home',
          path: 'home',
          search: '*' as const,
        });
        const chat = defineRoute({
          id: 'chat',
          path: 'chat/:id',
          search: ['chat-detail'],
          claim: ({ id }) => ({ namespace: 'block', id: `chat:${id}` }),
        });
        const spreadsheet = defineRoute({
          id: 'spreadsheet',
          path: 'spreadsheet/:id',
          search: ['spreadsheet-detail'],
          claim: ({ id }) => ({ namespace: 'block', id: `spreadsheet:${id}` }),
        });
        const next = createSplitRouter({
          routes: defineRoutes({
            definitions: [home, chat, spreadsheet],
            defaultRoute: () => ({ matches: [{ id: 'home', params: {} }] }),
          }),
          history: createMemoryHistory('/home'),
          paneStore: createMemoryPaneStore(),
          policy: {
            placeNewPane: () => ({ insertAt: 1 }),
            closeAction: () => ({ type: 'remove' }),
            activate: mocks.activate,
          },
        });
        routerDisposers.push(() => {
          next.dispose();
          dispose();
        });
        return next;
      })
    : undefined;
  const pane = () => router!.panes()[0]!;
  const content = () => (
    <PreviewPanel
      target={target()}
      selectedEntity={selectedEntity()}
      navigationRequest={navigationRequest()}
      orchestrator={orchestrator}
      splitPanelContext={
        {
          handle: { activate: mocks.activate },
        } as unknown as PreviewPanelProps['splitPanelContext']
      }
      onFocusOut={onFocusOut}
    />
  );
  const view = render(() =>
    router ? (
      <SplitRouterProvider router={router}>
        <PaneContext.Provider
          value={{ pane, entry: () => router.entry(pane()), depth: () => 0 }}
        >
          {content()}
        </PaneContext.Provider>
      </SplitRouterProvider>
    ) : (
      content()
    )
  );
  return {
    ...view,
    setTarget,
    router,
    pane,
    setSelectedEntity,
    requestNavigation: () => setNavigationRequest((count) => count + 1),
    previewEntity: () => preview?.previewEntity(),
    createBlockInstance,
    getBlockHandle,
    onFocusOut,
  };
}

const channel = (
  id: string,
  params?: Record<string, string>
): PreviewBlockTarget => ({
  blockType: 'channel',
  blockId: id,
  aliasContext: undefined,
  params,
});

describe('preview block navigation', () => {
  it.each(['chat', 'spreadsheet'] as const)(
    'switches a legacy preview to %s without requesting a legacy instance or handle',
    async (blockType) => {
      const view = setup(channel('channel-1'));
      await flush();
      view.createBlockInstance.mockClear();
      view.getBlockHandle.mockClear();
      view.setTarget({
        blockType,
        blockId: 'direct-1',
        aliasContext: undefined,
        params:
          blockType === 'chat'
            ? { message_id: 'target' }
            : { comment_id: 'target' },
      });
      await flush();
      expect(view.getByTestId('location').textContent).toBe('target');
      expect(view.createBlockInstance).not.toHaveBeenCalled();
      expect(view.getBlockHandle).not.toHaveBeenCalled();
    }
  );
  it('does not relocate or remount when the same target arrives as a fresh object', async () => {
    const view = setup(channel('channel-1', { channel_message_id: 'm-1' }));
    await flush();
    const draft = view.getByLabelText('Message draft');
    fireEvent.input(draft, { target: { value: 'Unsent draft' } });
    expect(view.getBlockHandle).toHaveBeenCalledTimes(1);
    expect(mocks.goToLocationFromParams).toHaveBeenCalledTimes(1);

    // Hosts recompute targets from cache revisions unrelated to this block.
    view.setTarget(channel('channel-1', { channel_message_id: 'm-1' }));
    view.setTarget(channel('channel-1', { channel_message_id: 'm-1' }));
    await flush();

    expect(view.getBlockHandle).toHaveBeenCalledTimes(1);
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
    expect(mocks.unmounts).not.toHaveBeenCalled();
    expect(view.getByLabelText('Message draft')).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe('Unsent draft');
  });

  it('preserves focus ownership after interacting with a refreshed preview', () => {
    const view = setup(channel('channel-1'));
    const draft = view.getByLabelText('Message draft');
    fireEvent.pointerDown(draft);
    view.setTarget(channel('channel-1'));
    fireEvent.focusIn(draft);
    expect(view.onFocusOut).not.toHaveBeenCalled();
  });

  it('lands untargeted channels on their latest message', async () => {
    setup(channel('channel-1'));
    await flush();
    expect(mocks.goToLatest).toHaveBeenCalledTimes(1);
    expect(mocks.goToLocationFromParams).not.toHaveBeenCalled();
  });

  it('creates a new block when selecting another channel', async () => {
    const view = setup(channel('channel-1'));
    view.setTarget(channel('channel-2'));
    await flush();
    expect(view.createBlockInstance).toHaveBeenCalledTimes(2);
    expect(mocks.goToLatest).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('block').textContent).toBe('channel-2');
  });

  it('relocates within the same block without remounting it', async () => {
    const view = setup(
      channel('channel-1', {
        channel_message_id: 't-1',
        channel_thread_id: 't-1',
      })
    );
    view.setTarget(
      channel('channel-1', {
        channel_message_id: 't-2',
        channel_thread_id: 't-2',
      })
    );
    await flush();
    expect(mocks.goToLocationFromParams).toHaveBeenCalledTimes(2);
    expect(mocks.goToLocationFromParams).toHaveBeenLastCalledWith({
      channel_message_id: 't-2',
      channel_thread_id: 't-2',
    });
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });

  it('re-aims the same block on an explicit request without remounting', async () => {
    const view = setup(channel('channel-1', { channel_message_id: 'm-1' }));
    await flush();
    expect(mocks.goToLocationFromParams).toHaveBeenCalledTimes(1);

    view.requestNavigation();
    await flush();
    expect(mocks.goToLocationFromParams).toHaveBeenCalledTimes(2);
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });

  it('keeps live selection metadata in its preview context', () => {
    const view = setup(channel('channel-1'), {
      type: 'channel',
      id: 'channel-1',
    });
    const refreshed = { type: 'channel' as const, id: 'channel-1' };
    view.setSelectedEntity(refreshed);
    expect(view.previewEntity()).toBe(refreshed);
    expect(view.getByTestId('selection').textContent).toBe('channel-1');
  });

  it.each([
    ['chat', 'message_id'],
    ['spreadsheet', 'comment_id'],
  ] as const)(
    'delivers repeated route targets to a local %s preview without handles or remounts',
    async (blockType, key) => {
      const view = setup(
        {
          blockType,
          blockId: 'item-1',
          aliasContext: undefined,
          params: { [key]: 'initial' },
        },
        undefined,
        true
      );
      await flush();
      const draft = view.getByLabelText('Message draft');
      const updates =
        blockType === 'chat' ? chatLocationUpdates : spreadsheetLocationUpdates;
      for (const token of ['first', 'second']) {
        expect(
          view.router!.navigatePane(view.pane(), `/${blockType}/item-1`, {
            search: updates('item-1', { [key]: 'target' }, token),
          })
        ).toMatchObject({ status: 'activated' });
        await flush();
        expect(view.getByTestId('location').textContent).toBe('target');
      }
      expect(mocks.featureNavigations.mock.calls.at(-1)?.[1]).not.toBe(
        mocks.featureNavigations.mock.calls.at(-2)?.[1]
      );
      expect(view.getByLabelText('Message draft')).toBe(draft);
      expect(mocks.mounts).toHaveBeenCalledTimes(1);
      expect(view.createBlockInstance).not.toHaveBeenCalled();
      expect(view.getBlockHandle).not.toHaveBeenCalled();
      expect(
        view.router!.entry(view.pane())?.location.route.matches.at(-1)?.id
      ).toBe('home');
      view.unmount();
      expect(
        view.router!.claims.holderOf(`block:${blockType}:item-1`)
      ).toBeUndefined();
    }
  );

  it('keeps a local chat preview isolated from parent search targets and clears delivered targets', async () => {
    const view = setup(
      {
        blockType: 'chat',
        blockId: 'chat-1',
        aliasContext: undefined,
        params: { message_id: 'local' },
      },
      undefined,
      true
    );
    await flush();
    view.router!.updateSearch(view.pane(), 'chat-detail', {
      chatId: ['chat-1'],
      messageId: ['parent'],
      seek: ['parent'],
    });
    await flush();
    expect(view.getByTestId('location').textContent).toBe('local');
    view.router!.navigatePane(view.pane(), '/chat/chat-1', {
      search: chatLocationUpdates('chat-1', { message_id: 'delivered' }),
    });
    await flush();
    expect(view.getByTestId('location').textContent).toBe('delivered');
    view.router!.navigatePane(view.pane(), '/chat/chat-1', {
      search: chatLocationUpdates('chat-1', {}),
    });
    await flush();
    expect(view.getByTestId('location').textContent).toBe('');
    view.setTarget({
      blockType: 'chat',
      blockId: 'chat-1',
      aliasContext: undefined,
      params: { message_id: 'next-local' },
    });
    await flush();
    expect(view.getByTestId('location').textContent).toBe('next-local');
  });
});
