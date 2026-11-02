import { ViewShell } from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { HomeListSkeleton } from './components/HomeListSkeleton';

export function HomePendingView() {
  const listSkeleton = (
    <div class="mt-3 min-h-0 min-w-0 flex-1 overflow-hidden touch:mt-0 touch:pt-(--mobile-content-inset-top)">
      <HomeListSkeleton grouped />
    </div>
  );

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <Show
          when={isTouchDevice()}
          fallback={
            <div class="size-full min-h-0 bg-panel">
              <ViewShell.Root
                asidePreferenceKey="home"
                aside={{ preserveDuringResize: false }}
                main={{ preferredWidth: 640 }}
                resizable
              >
                <ViewShell.Aside class="flex flex-col bg-panel">
                  <SidebarCreateHeader
                    title="Home"
                    label="New chat"
                    onCreate={() => {}}
                  />
                  {listSkeleton}
                </ViewShell.Aside>
                <ViewShell.Main class="overflow-hidden" />
              </ViewShell.Root>
            </div>
          }
        >
          {listSkeleton}
        </Show>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
