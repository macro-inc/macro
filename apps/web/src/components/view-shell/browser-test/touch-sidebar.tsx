import '@app/index.css';
import { ListViewport } from '@app/components/list/ListViewport';
import { ChannelsViewMain } from '@app/features/channels-view/components/ChannelsViewMain';
import { HomeListLayout } from '@app/features/home/components/HomeListLayout';
import { HomeViewLayout } from '@app/features/home/components/HomeViewLayout';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { createWindowSize } from '@solid-primitives/resize-observer';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { MobileListLayout } from '../MobileListLayout';
import { useViewShell, ViewShell } from '../ViewShell';
import { ViewSidebar } from '../ViewSidebar';
import { DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS } from '../view-shell-layout';

document.documentElement.dataset.touchDevice = 'true';
document.documentElement.dataset.platform = 'ios';

function ChannelsFixtureMain() {
  const shell = useViewShell();
  return (
    <ChannelsViewMain mobileLayout={shell.breakpoints.narrow?.() ?? false}>
      <div
        data-testid="channel-scroll"
        class="size-full min-h-0 overflow-y-auto"
      >
        <div aria-hidden="true" class="h-(--mobile-content-inset-top)" />
        <For each={Array.from({ length: 30 }, (_, index) => index)}>
          {(index) => (
            <div
              data-channel-row={index}
              class="h-18 shrink-0 border-b border-edge p-4"
            >
              Conversation {index + 1}
            </div>
          )}
        </For>
      </div>
    </ChannelsViewMain>
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
  const [tab, setTab] = createSignal('all');
  const channels = new URLSearchParams(location.search).has('channels');
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
          <Show
            when={channels}
            fallback={
              <ViewShell.Main>
                <ViewShell.Header>
                  <PillTabs
                    scrollable
                    leading={
                      <>
                        <ViewSidebar.Toggle
                          action="expand"
                          presentation="pill"
                        />
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
            }
          >
            <ChannelsFixtureMain />
          </Show>
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
