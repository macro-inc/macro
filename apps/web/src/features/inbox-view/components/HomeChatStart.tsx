import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { HomeRecommendedActions } from '../../home/components/home-recommended-actions';
import { HomeChatInput } from '../../home/home-chat-input';
import { HomeGettingStartedLink } from '../../home/home-getting-started-link';
import { useHomePreferences } from '../../home/home-prefs';

/** Desktop Home's idle pane uses the single-line chat composer and send flow. */
export function HomeChatStart() {
  const shell = useViewShell();
  const agents = useFeatureFlag(enableChatV3Agents);
  const preferences = useHomePreferences();
  const showHomeTopBar = () =>
    shell.aside.isCollapsed() || shell.aside.isOverlay();
  return (
    <ChatInputProvider>
      <Show when={showHomeTopBar()}>
        <ViewShell.TopBar>
          <ViewSidebar.Title>Home</ViewSidebar.Title>
        </ViewShell.TopBar>
      </Show>
      <DragDropWrapper class="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-6">
        <div
          class={
            agents().enabled
              ? 'flex h-full min-h-0 min-w-0 flex-col'
              : 'h-full min-h-0 min-w-0'
          }
        >
          {/*
            Agents new conversation sits under ViewShell.TopBar (h-12) and
            anchors the greeting above center with .newchat padding 24/64. Home only renders that bar
            when the list is collapsed, so reserve the same offset here.
          */}
          <Show when={agents().enabled && !showHomeTopBar()}>
            <div
              class="h-12 shrink-0"
              aria-hidden="true"
              data-home-composer-topbar-align=""
            />
          </Show>
          <div
            class={
              agents().enabled
                ? 'mx-auto grid min-h-64 min-w-0 w-full max-w-180 flex-1 grid-cols-1 grid-rows-[max(0px,calc(40%-60px))_auto_1fr] pt-6 pb-16'
                : 'mx-auto grid h-full min-h-64 min-w-0 w-full max-w-180 grid-cols-1 grid-rows-[1fr_auto_1fr] pb-16'
            }
            data-home-composer-align={agents().enabled ? 'agents' : 'legacy'}
          >
            <div class="self-end">
              <Show when={!agents().enabled}>
                <h1 class="mb-6 min-h-0 min-w-0 self-end text-center text-2xl font-normal leading-[42px] text-ink">
                  What should we get done in Macro?
                </h1>
              </Show>
            </div>
            <HomeChatInput
              variant="default"
              placeholder="Type @ to reference / for skills"
              autoFocusOnMount={false}
            />
            <div class="min-h-0 min-w-0 pb-8">
              <HomeGettingStartedLink preferences={preferences} />
              <HomeRecommendedActions />
            </div>
          </div>
        </div>
      </DragDropWrapper>
    </ChatInputProvider>
  );
}
