import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { SidebarPrefsProvider } from '@components/app/sidebar-next/use-sidebar-prefs';
import { ViewSwitcher } from '@components/app/sidebar-next/view-switcher';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ViewSidebar, ViewSwitcherContext } from '../ViewSidebar';

function Fixture() {
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

  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <SidebarPrefsProvider>
          <SplitPanelContext.Provider value={panel}>
            <ViewSwitcherContext.Provider value={ViewSwitcher}>
              <div class="min-h-screen bg-page p-8 text-ink">
                <aside class="w-[280px] rounded-xl border border-edge-muted bg-panel">
                  <ViewSidebar.Header
                    searchLabel="Search conversations"
                    search={() => (
                      <input aria-label="Search conversations" class="w-full" />
                    )}
                  >
                    <div class="flex min-w-0 items-center gap-1">
                      <ViewSidebar.Title>Chat</ViewSidebar.Title>
                    </div>
                  </ViewSidebar.Header>
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
