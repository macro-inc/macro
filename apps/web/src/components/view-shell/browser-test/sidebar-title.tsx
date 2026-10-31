import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { SidebarPrefsProvider } from '@components/app/sidebar-next/use-sidebar-prefs';
import { ViewSwitcher } from '@components/app/sidebar-next/view-switcher';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import BookmarkIcon from '@phosphor/bookmark-simple.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ListHeader } from '../ListHeader';
import { ViewBreadcrumbs } from '../ViewBreadcrumbs';
import {
  ViewSidebar,
  ViewSwitcherContext,
  ViewSwitchTrigger,
} from '../ViewSidebar';

function Fixture() {
  const search = new URLSearchParams(window.location.search);
  const title = search.get('title') ?? 'Chat';
  const [content, setContent] = createSignal({
    type: 'component',
    id: 'chat',
  });
  const panel = {
    handle: {
      content,
      setContent,
      isPopover: () => false,
    },
  } as unknown as SplitPanelContextType;
  const label = () => (
    <Show when={search.has('saved')} fallback={title}>
      <BookmarkIcon class="size-4 shrink-0" aria-hidden="true" />
      <span class="truncate">{title}</span>
    </Show>
  );

  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <SidebarPrefsProvider>
          <SplitPanelContext.Provider value={panel}>
            <ViewSwitcherContext.Provider value={ViewSwitcher}>
              <div class="min-h-screen bg-page p-8 text-ink">
                <aside
                  class="rounded-xl border border-edge-muted bg-panel"
                  style={{ width: `${search.get('width') ?? 280}px` }}
                >
                  <Show
                    when={search.has('list')}
                    fallback={
                      <ViewSidebar.Header
                        searchLabel="Search conversations"
                        search={() => (
                          <input
                            aria-label="Search conversations"
                            class="w-full"
                          />
                        )}
                      >
                        <div class="flex min-w-0 items-center gap-1">
                          <ViewSidebar.Title>{label()}</ViewSidebar.Title>
                        </div>
                      </ViewSidebar.Header>
                    }
                  >
                    <ViewBreadcrumbs.Root
                      value="tasks-view"
                      onChange={() => {}}
                    >
                      <ViewBreadcrumbs.Item value="tasks-view" metadata={{}}>
                        <ViewSwitchTrigger>{label()}</ViewSwitchTrigger>
                      </ViewBreadcrumbs.Item>
                      <ListHeader
                        title={
                          <div class="flex min-w-0 items-center gap-1">
                            <ViewBreadcrumbs.Outlet />
                          </div>
                        }
                      >
                        <For
                          each={[
                            'Filters',
                            'Layout',
                            'Sort',
                            'Group',
                            'New',
                            'Search',
                          ]}
                        >
                          {(name) => (
                            <Button variant="secondary">{name}</Button>
                          )}
                        </For>
                      </ListHeader>
                    </ViewBreadcrumbs.Root>
                  </Show>
                </aside>
              </div>
            </ViewSwitcherContext.Provider>
          </SplitPanelContext.Provider>
        </SidebarPrefsProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
