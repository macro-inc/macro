import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { LocalRuntimePrompt } from '@app/features/settings/components/local-runtime-prompt';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { ComposerGreeting } from '@core/component/ComposerGreeting';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableChatV3Agents, enableForYou } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazyNamed } from '@core/util/lazyNamed';
import { Show, Suspense } from 'solid-js';
import { HomeChatInput } from '../home-chat-input';
import { HomeRecommendedActions } from './home-recommended-actions';

const HomeFocus = lazyNamed(() => import('../home-focus'), 'HomeFocus');

/** The real Home composer above a live recommendation feed. */
function FocusHomeChatStart() {
  const shell = useViewShell();
  const panel = useSplitPanelOrThrow();
  const agents = useFeatureFlag(enableChatV3Agents);
  const showHomeTopBar = () =>
    shell.aside.isCollapsed() || shell.aside.isOverlay();
  let handleShortcut: ((event: KeyboardEvent) => boolean) | undefined;
  useHotkeyInterceptor((context) => {
    if (
      context.eventType !== 'keydown' ||
      context.isEditableFocused ||
      !panel.isPanelActive()
    )
      return false;
    if (
      !shell.aside.isCollapsed() &&
      !document.activeElement?.closest('[data-home-focus]')
    )
      return false;
    return handleShortcut?.(context.event) ?? false;
  });
  return (
    <ChatInputProvider>
      <Show when={showHomeTopBar()}>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>Home</ViewSidebar.Title>
        </ViewShell.TopBar>
      </Show>
      <DragDropWrapper class="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <HomeFocus
          active={panel.isPanelActive()}
          registerShortcuts={(handler) => {
            handleShortcut = handler;
          }}
        >
          <Show when={!agents().enabled}>
            <div class="mb-8">
              <ComposerGreeting>What should we work on?</ComposerGreeting>
            </div>
          </Show>
          <HomeChatInput
            variant="default"
            placeholder="Type @ to reference / for skills"
            autoFocusOnMount={false}
          />
        </HomeFocus>
      </DragDropWrapper>
    </ChatInputProvider>
  );
}

function LegacyHomeChatStart() {
  const shell = useViewShell();
  const agents = useFeatureFlag(enableChatV3Agents);
  const showHomeTopBar = () =>
    shell.aside.isCollapsed() || shell.aside.isOverlay();
  return (
    <ChatInputProvider>
      <Show when={showHomeTopBar()}>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>Home</ViewSidebar.Title>
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
                <div class="mb-6 min-h-0 min-w-0">
                  <ComposerGreeting as="h1">
                    What should we get done in Macro?
                  </ComposerGreeting>
                </div>
              </Show>
            </div>
            <div class="min-w-0">
              <Show when={!agents().enabled}>
                <LocalRuntimePrompt />
              </Show>
              <HomeChatInput
                variant="default"
                placeholder="Type @ to reference / for skills"
                autoFocusOnMount={false}
              />
            </div>
            <div class="min-h-0 min-w-0 pb-8">
              <HomeRecommendedActions />
            </div>
          </div>
        </div>
      </DragDropWrapper>
    </ChatInputProvider>
  );
}

/** Keep the existing Home unchanged outside the For you rollout. */
export function HomeChatStart() {
  const flag = useFeatureFlag(enableForYou);
  return (
    <Show
      when={flag().enabled && !isTouchDevice()}
      fallback={<LegacyHomeChatStart />}
    >
      <Suspense fallback={<LoadingBlock />}>
        <FocusHomeChatStart />
      </Suspense>
    </Show>
  );
}
