import '@app/index.css';
import { ChannelsViewMain } from '@app/features/channels-view/components/ChannelsViewMain';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
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

function Fixture() {
  const [tab, setTab] = createSignal('all');
  const channels = new URLSearchParams(location.search).has('channels');
  return (
    <div class="h-dvh bg-panel text-ink">
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
          when={channels}
          fallback={
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
            </ViewShell.Main>
          }
        >
          <ChannelsFixtureMain />
        </Show>
      </ViewShell.Root>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
