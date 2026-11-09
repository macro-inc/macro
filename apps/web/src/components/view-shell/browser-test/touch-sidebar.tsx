import '@app/index.css';
import { ListViewport } from '@app/components/list/ListViewport';
import { ChannelsViewMain } from '@app/features/channels-view/components/ChannelsViewMain';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { MobileListLayout } from '../MobileListLayout';
import { useViewShell, ViewShell } from '../ViewShell';
import { ViewSidebar } from '../ViewSidebar';

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

function Fixture() {
  const [tab, setTab] = createSignal('all');
  const channels = new URLSearchParams(location.search).has('channels');
  const collection = new URLSearchParams(location.search).has('list');
  return (
    <div
      class="h-dvh bg-panel text-ink"
      style={collection ? { '--safe-top': '24px' } : undefined}
    >
      <ViewShell.Root asidePreferenceKey="touch-fixture" resizable>
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
              </ViewShell.Main>
            }
          >
            <ChannelsFixtureMain />
          </Show>
        </Show>
      </ViewShell.Root>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
