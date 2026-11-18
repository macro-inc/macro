import { CollectionPanes } from '../CollectionPanes';
import '@app/index.css';
import { ListViewport } from '@app/components/list/ListViewport';
import { ChannelsTouchSidebar } from '@app/features/channels-view/components/ChannelsTouchSidebar';
import { ChannelsViewMain } from '@app/features/channels-view/components/ChannelsViewMain';
import { driveDestination } from '@app/features/drive-view/drive-route-navigation';
import { HomeListLayout } from '@app/features/home/components/HomeListLayout';
import { HomeViewLayout } from '@app/features/home/components/HomeViewLayout';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  routeParams,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import {
  appRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  legacyContentRoute,
} from '@app/routes/routes';
import { ChannelDetailLayout } from '@channel/Channel/ChannelDetailLayout';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAppSplitRouterMiddleware } from '@components/app/split-layout/split-router/app-middleware';
import { SplitPanel } from '@components/app/split-panel';
import { fireAndForget } from '@core/util/fireAndForget';
import { createWindowSize } from '@solid-primitives/resize-observer';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { MobileListLayout } from '../MobileListLayout';
import { ViewShell } from '../ViewShell';
import { ViewSidebar } from '../ViewSidebar';
import { DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS } from '../view-shell-layout';

document.documentElement.dataset.touchDevice = 'true';
document.documentElement.dataset.platform = 'ios';

function ChannelMessagesFixture(props: { index: number }) {
  const panel = useSplitPanelOrThrow();
  return (
    <div data-testid="messages-scroll" class="size-full min-h-0 overflow-auto">
      <div
        aria-hidden="true"
        style={{ height: `${panel.contentOffsetTop()}px` }}
      />
      <p data-testid="channel-preview">
        Conversation {props.index + 1} preview
      </p>
      <For each={Array.from({ length: 40 }, (_, index) => index)}>
        {(index) => (
          <div data-message={index} class="h-18 border-b border-edge p-4">
            Message {index + 1}
          </div>
        )}
      </For>
    </div>
  );
}

function ChannelPreviewFixture(props: { index: number }) {
  // Only the inherited inset is needed by this layout fixture.
  const panel = {
    contentOffsetTop: () => 24,
    isPanelActive: () => true,
  } as SplitPanelContextType;
  return (
    <SplitPanelContext.Provider value={panel}>
      <ChannelDetailLayout
        scrollBehindHeader
        header={
          <ViewShell.TopBar class="gap-2 py-0 touch:flex touch:h-10 touch:px-0 touch:py-0">
            <HeaderIsland>
              <button type="button">Channel menu</button>
            </HeaderIsland>
            <HeaderIsland class="ml-auto">
              <button type="button">Call</button>
            </HeaderIsland>
          </ViewShell.TopBar>
        }
      >
        <ChannelMessagesFixture index={props.index} />
        <FloatRegion region="accessory">
          <div class="pointer-events-auto px-(--mobile-chrome-gutter)">
            <input
              class="island block h-10 w-full rounded-full px-3"
              aria-label="Channel reply"
            />
          </div>
        </FloatRegion>
      </ChannelDetailLayout>
    </SplitPanelContext.Provider>
  );
}

function ChannelsWorkspaceFixture() {
  const size = createWindowSize();
  const wide = () =>
    size.width > DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS.narrow;
  const [selected, setSelected] = createSignal<number>();
  const list = () => (
    <div
      role="tree"
      aria-label="Recent conversations"
      data-testid="channel-scroll"
      class="size-full min-h-0 overflow-y-auto"
    >
      <div aria-hidden="true" class="h-(--mobile-content-inset-top)" />
      <For each={Array.from({ length: 30 }, (_, index) => index)}>
        {(index) => (
          <button
            type="button"
            data-channel-row={index}
            onClick={() => setSelected(index)}
            class="h-18 w-full shrink-0 border-b border-edge p-4 text-left"
          >
            Conversation {index + 1}
          </button>
        )}
      </For>
    </div>
  );
  return (
    <div
      class="relative h-dvh bg-panel text-ink"
      style={{
        '--safe-top': wide() ? '24px' : '0px',
        'padding-right': wide() ? '64px' : undefined,
      }}
    >
      <SplitPanel.Root
        controller={{
          canGoBack: () => false,
          goBack: () => {},
          canGoForward: () => false,
          goForward: () => {},
          canClose: () => false,
          close: () => {},
        }}
      >
        <ViewShell.Root
          asidePreferenceKey="channels-fixture"
          aside={wide() ? {} : false}
          resizable
        >
          <Show when={wide()}>
            <ViewShell.Aside>
              <ChannelsTouchSidebar>{list()}</ChannelsTouchSidebar>
            </ViewShell.Aside>
          </Show>
          <ChannelsViewMain
            mobileLayout={!wide()}
            sidebarToggle={wide() && selected() === undefined}
          >
            <Show when={wide()} fallback={list()}>
              <Show
                when={selected() !== undefined}
                fallback={
                  <p data-testid="channel-preview">Select a conversation</p>
                }
              >
                <ChannelPreviewFixture index={selected()!} />
              </Show>
            </Show>
          </ChannelsViewMain>
        </ViewShell.Root>
      </SplitPanel.Root>
      <FloatRegionHost navigationEdge="right" />
    </div>
  );
}

function ReaderWorkspaceFixture() {
  const [width, setWidth] = createSignal(403);
  return (
    <div class="h-dvh bg-panel text-ink">
      <ViewShell.Root
        contentLayout="collection"
        asidePreferenceKey="reader-workspace-fixture"
        resizable
        main={{ width: width(), min: 320, max: 720 }}
        detail={{ initialWidth: 'auto', min: 320, width: 640, max: 4000 }}
      >
        <ViewShell.Aside>
          <ViewSidebar.Root aria-label="Reader navigation" />
        </ViewShell.Aside>
        <ViewShell.Main onWidthChangeEnd={setWidth}>
          <MobileListLayout
            header={<ViewSidebar.Toggle action="expand" presentation="pill" />}
          >
            <div data-testid="reader-list" class="flex-1">
              Reading-pane list
            </div>
          </MobileListLayout>
        </ViewShell.Main>
        <ViewShell.Detail>
          <textarea class="size-full" aria-label="Reader draft" />
        </ViewShell.Detail>
      </ViewShell.Root>
    </div>
  );
}

function DriveRoutingFixture() {
  const history = createMemoryHistory('/drive');
  const router = createSplitRouter({
    routes: {
      definitions: [
        {
          ...appRoute,
          children: [
            { ...driveSplitRoute, children: [driveRootDocumentRoute] },
            legacyContentRoute,
          ],
        },
      ],
      defaultRoute: () => ({
        matches: [
          { id: 'app', params: {} },
          { id: 'drive', params: {} },
        ],
      }),
    },
    history,
    paneStore: createMemoryPaneStore(),
    policy: createTestPolicy().policy,
    middleware: createAppSplitRouterMiddleware({ isTouchDevice: () => true }),
  });
  onCleanup(() => router.dispose());
  const selected = () => {
    const entry = router.entry(router.panes()[0]!);
    const id = entry && routeParams(entry.location.route).documentId;
    return typeof id === 'string' ? id : undefined;
  };
  return (
    <>
      <output data-testid="drive-route" class="sr-only">
        {router
          .entry(router.panes()[0]!)
          ?.location.route.matches.map((match) => match.id)
          .join('/')}
      </output>
      <output data-testid="drive-pane-count" class="sr-only">
        {router.panes().length}
      </output>
      <CollectionWorkspaceFixture
        selected={selected}
        onSelect={(id) =>
          fireAndForget(
            router.navigatePane(
              router.panes()[0]!,
              driveDestination(
                { kind: 'tab', tab: 'owned' },
                { id, type: 'md' }
              )
            ),
            'drive-routing-fixture'
          )
        }
      />
    </>
  );
}

function CollectionWorkspaceFixture(
  props: {
    selected?: () => string | undefined;
    onSelect?: (id: string) => void;
  } = {}
) {
  const [localSelected, setSelected] = createSignal<string>();
  const selected = props.selected ?? localSelected;
  const [view, setView] = createSignal('all');
  const [dockPresses, setDockPresses] = createSignal(0);
  const sheetChrome = new URLSearchParams(location.search).has('sheet-chrome');
  const selectView = (next: string) => {
    setView(next);
    setSelected(undefined);
  };
  return (
    <div
      class="relative isolate h-dvh bg-panel text-ink"
      style={{
        '--safe-top': '24px',
        'padding-left': new URLSearchParams(location.search).has('offset')
          ? '64px'
          : undefined,
      }}
    >
      <SplitPanel.Root
        controller={{
          canGoBack: () => false,
          goBack: () => {},
          canGoForward: () => false,
          goForward: () => {},
          canClose: () => false,
          close: () => {},
        }}
      >
        <ViewShell.Root
          contentLayout="collection"
          asidePreferenceKey="collection-workspace-fixture"
          resizable
        >
          <ViewShell.Aside>
            <ViewSidebar.Root aria-label="Collection navigation">
              <ViewSidebar.Header>
                <ViewSidebar.Title caret={false}>Collection</ViewSidebar.Title>
              </ViewSidebar.Header>
              <ViewSidebar.Content>
                <ViewSidebar.Item
                  active={view() === 'all'}
                  onClick={() => selectView('all')}
                >
                  All items
                </ViewSidebar.Item>
                <ViewSidebar.Item
                  active={view() === 'recent'}
                  onClick={() => selectView('recent')}
                >
                  Recent items
                </ViewSidebar.Item>
              </ViewSidebar.Content>
              <ViewSidebar.Footer>
                <button type="button" class="h-10">
                  Sidebar footer
                </button>
              </ViewSidebar.Footer>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <CollectionPanes
            hasDetail={selected() !== undefined}
            onBack={() => setSelected(undefined)}
            list={
              <MobileListLayout
                header={
                  <div class="flex h-10 items-center gap-2">
                    <ViewSidebar.Toggle action="expand" presentation="pill" />
                    <span class="island flex h-10 items-center rounded-full px-3">
                      {view()}
                    </span>
                  </div>
                }
              >
                <div
                  data-testid="workspace-list"
                  class="size-full min-h-0 overflow-auto"
                >
                  <div
                    aria-hidden="true"
                    class="h-(--mobile-content-inset-top)"
                  />
                  <For
                    each={Array.from({ length: 40 }, (_, index) =>
                      String(index)
                    )}
                  >
                    {(id) => (
                      <button
                        type="button"
                        data-workspace-row={id}
                        class="block h-18 w-full border-b border-edge p-4 text-left"
                        onClick={() => (props.onSelect ?? setSelected)(id)}
                      >
                        Item {id}
                      </button>
                    )}
                  </For>
                </div>
              </MobileListLayout>
            }
          >
            <div
              class="flex size-full min-h-0 flex-col"
              data-testid="workspace-preview"
            >
              <ViewShell.TopBar class="touch:flex">
                <span>Preview {selected()}</span>
              </ViewShell.TopBar>
              <textarea
                class="ml-12 min-h-0 flex-1"
                aria-label="Preview draft"
              />
              <FloatRegion region="accessory">
                <div class="pointer-events-auto px-(--mobile-chrome-gutter)">
                  <input
                    class="island block h-10 w-full rounded-full"
                    aria-label="Collection reply"
                  />
                </div>
              </FloatRegion>
            </div>
          </CollectionPanes>
        </ViewShell.Root>
      </SplitPanel.Root>
      <FloatRegionHost navigationEdge="bottom" />
      <Show when={sheetChrome}>
        <FloatRegion region="dock">
          <button
            type="button"
            class="pointer-events-auto island mx-3 h-10 w-32 rounded-full"
            data-testid="background-dock"
            data-presses={dockPresses()}
            onClick={() => setDockPresses((count) => count + 1)}
          >
            App navigation
          </button>
        </FloatRegion>
      </Show>
    </div>
  );
}

function CollectionFixture() {
  const [extra, setExtra] = createSignal(false);
  const [tab, setTab] = createSignal('all');
  const rows = Array.from({ length: 60 }, (_, index) => index);
  const list = () => (
    <ListViewport
      touchInset
      items={rows}
      focusedIndex={-1}
      viewportRef={(element) =>
        element.setAttribute('data-testid', 'collection-scroll')
      }
    >
      {(index) => (
        <div data-collection-row={index} class="h-18 border-b border-edge p-4">
          Item {index + 1}
        </div>
      )}
    </ListViewport>
  );
  return (
    <MobileListLayout
      header={
        <>
          <PillTabs
            scrollable
            items={[
              { value: 'all', label: 'All' },
              { value: 'recent', label: 'Recent' },
            ]}
            value={tab()}
            onChange={setTab}
            leading={
              <button
                type="button"
                class="island h-10 rounded-full px-3"
                onClick={() => setExtra(!extra())}
              >
                More controls
              </button>
            }
          />
          <Show when={extra()}>
            <div class="h-10" data-extra-controls>
              Additional controls
            </div>
          </Show>
        </>
      }
    >
      <Show
        when={new URLSearchParams(location.search).has('nested')}
        fallback={list()}
      >
        <MobileListLayout
          header={
            <button class="island h-10 rounded-full" type="button">
              Activity controls
            </button>
          }
        >
          {list()}
        </MobileListLayout>
      </Show>
    </MobileListLayout>
  );
}

function HomeFixture(props: { onSelect: (id: number) => void }) {
  const [tab, setTab] = createSignal('signal');
  return (
    <HomeListLayout
      onNewChat={() => {}}
      tabs={
        <PillTabs
          items={[
            { value: 'signal', label: 'Signal' },
            { value: 'noise', label: 'Noise' },
          ]}
          value={tab()}
          onChange={setTab}
        />
      }
    >
      <div
        data-testid="notifications-scroll"
        class="size-full min-h-0 overflow-y-auto"
      >
        <div aria-hidden="true" class="h-(--mobile-content-inset-top)" />
        <For each={Array.from({ length: 30 }, (_, index) => index)}>
          {(index) => (
            <button
              type="button"
              data-notification-row={index}
              class="h-18 w-full border-b border-edge p-4 text-left"
              onClick={() => props.onSelect(index)}
            >
              Notification {index + 1}
            </button>
          )}
        </For>
        <p>Selected: {tab()}</p>
      </div>
    </HomeListLayout>
  );
}

function HomeWorkspaceFixture() {
  const size = createWindowSize();
  const [selected, setSelected] = createSignal<number>();
  return (
    <div class="h-dvh bg-panel text-ink" style={{ '--safe-top': '24px' }}>
      <HomeViewLayout
        inlinePreview={
          size.width > DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS.narrow
        }
        list={<HomeFixture onSelect={setSelected} />}
      >
        <ViewShell.Header class="empty:hidden">
          <ViewSidebar.Toggle action="expand" presentation="pill" />
        </ViewShell.Header>
        <p data-testid="notification-preview">
          {selected() === undefined
            ? 'Choose a notification'
            : `Preview ${selected()! + 1}`}
        </p>
      </HomeViewLayout>
    </div>
  );
}

function Fixture() {
  if (new URLSearchParams(location.search).has('drive-workspace'))
    return <DriveRoutingFixture />;
  if (new URLSearchParams(location.search).has('reader-workspace'))
    return <ReaderWorkspaceFixture />;
  if (new URLSearchParams(location.search).has('workspace'))
    return <CollectionWorkspaceFixture />;
  const [tab, setTab] = createSignal('all');
  const channels = new URLSearchParams(location.search).has('channels');
  if (channels) return <ChannelsWorkspaceFixture />;
  const home = new URLSearchParams(location.search).has('home');
  if (home) return <HomeWorkspaceFixture />;
  const collection = new URLSearchParams(location.search).has('list');
  const chrome = new URLSearchParams(location.search).has('chrome');
  const [detailOpen, setDetailOpen] = createSignal(false);
  // Real composers keep drafts in their owner while another action takes the slot.
  const [draft, setDraft] = createSignal('');
  const edge =
    new URLSearchParams(location.search).get('edge') === 'right'
      ? 'right'
      : 'bottom';
  return (
    <div
      class="h-dvh bg-panel text-ink"
      style={{
        '--safe-top': collection ? '24px' : '0px',
        '--native-navigation-content-inset': '64px',
        'padding-right': chrome && edge === 'right' ? '64px' : undefined,
      }}
    >
      <ViewShell.Root
        asidePreferenceKey="touch-fixture"
        detailOpen={detailOpen()}
        detail={{ width: 320, min: 240 }}
        resizable
      >
        <ViewShell.Aside>
          <ViewSidebar.Root aria-label="Workspace navigation">
            <ViewSidebar.Header>
              <ViewSidebar.Title>Drive</ViewSidebar.Title>
            </ViewSidebar.Header>
            <ViewSidebar.Content>
              <ViewSidebar.Item onClick={() => setTab('all')}>
                All files
              </ViewSidebar.Item>
            </ViewSidebar.Content>
          </ViewSidebar.Root>
        </ViewShell.Aside>
        <Show
          when={!collection}
          fallback={
            <ViewShell.Main>
              <CollectionFixture />
            </ViewShell.Main>
          }
        >
          <ViewShell.Main>
            <ViewShell.Header>
              <PillTabs
                scrollable
                leading={
                  <>
                    <ViewSidebar.Toggle action="expand" presentation="pill" />
                    <button
                      type="button"
                      class="island size-10 rounded-full"
                      aria-label="Filters"
                    >
                      Filters
                    </button>
                  </>
                }
                items={[
                  { value: 'all', label: 'All' },
                  { value: 'recent', label: 'Recent' },
                ]}
                value={tab()}
                onChange={setTab}
              />
            </ViewShell.Header>
            <p>Selected: {tab()}</p>
            <Show when={chrome}>
              <button type="button" onClick={() => setDetailOpen(true)}>
                Open detail
              </button>
              <FloatRegion region="accessory">
                <div class="pointer-events-auto px-(--mobile-chrome-gutter)">
                  <textarea
                    class="w-full bg-surface"
                    aria-label="Preview reply"
                    value={draft()}
                    onInput={(event) => setDraft(event.currentTarget.value)}
                  />
                </div>
              </FloatRegion>
            </Show>
          </ViewShell.Main>
        </Show>
        <ViewShell.Detail>
          <button type="button" onClick={() => setDetailOpen(false)}>
            Close detail
          </button>
          <FloatRegion region="accessory" priority={1}>
            <div class="pointer-events-auto px-(--mobile-chrome-gutter)">
              <textarea class="w-full bg-surface" aria-label="Detail reply" />
            </div>
          </FloatRegion>
        </ViewShell.Detail>
      </ViewShell.Root>
      <Show when={chrome}>
        <FloatRegionHost navigationEdge={edge} />
        <FloatRegion region="dock">
          <button type="button" class="pointer-events-auto island h-10">
            App navigation
          </button>
        </FloatRegion>
      </Show>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
