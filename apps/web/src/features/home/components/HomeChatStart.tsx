import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { useIdeasFlag } from '@app/features/ideas/use-ideas-flag';
import { DebugSuspense } from '@channel/DebugSuspense';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { lazyNamed } from '@core/util/lazyNamed';
import { Show } from 'solid-js';
import { HomeAgentComposer } from '../home-agent-composer';
import { HomeSectionBoundary } from '../home-section-boundary';
import { HomeRecommendedActions } from './home-recommended-actions';

// Loaded only for people with ideas on.
const HomeIdeas = lazyNamed(
  () => import('@app/features/ideas/home-ideas'),
  'HomeIdeas'
);

/** Desktop Home's idle pane: the agent composer and suggested actions. */
export function HomeChatStart() {
  const shell = useViewShell();
  const ideas = useIdeasFlag();
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
        <div class="flex h-full min-h-0 min-w-0 flex-col">
          {/*
            Agents new conversation sits under ViewShell.TopBar (h-12) and
            anchors the greeting above center with .newchat padding 24/64. Home only renders that bar
            when the list is collapsed, so reserve the same offset here.
          */}
          <Show when={!showHomeTopBar()}>
            <div
              class="h-12 shrink-0"
              aria-hidden="true"
              data-home-composer-topbar-align=""
            />
          </Show>
          <div
            class="mx-auto grid min-h-64 min-w-0 w-full max-w-180 flex-1 grid-cols-1 pt-6 pb-16"
            classList={{
              'grid-rows-[max(0px,calc(40%-60px))_auto_1fr]': !ideas(),
              // Today and the priorities need the room below the composer.
              'grid-rows-[2.5rem_auto_1fr]': ideas(),
            }}
            data-home-composer-align="agents"
          >
            <div class="self-end" />
            <div class="min-w-0">
              <DebugSuspense
                name="Home.agent-composer"
                fallback={<div class="min-h-24" />}
              >
                <HomeAgentComposer autoFocus={false} />
              </DebugSuspense>
            </div>
            <div class="min-h-0 min-w-0 pb-8">
              {/* With ideas on, today and the top priorities take this place. */}
              <Show when={ideas()} fallback={<HomeRecommendedActions />}>
                <HomeSectionBoundary title="priorities" fallback={null}>
                  <HomeIdeas />
                </HomeSectionBoundary>
              </Show>
            </div>
          </div>
        </div>
      </DragDropWrapper>
    </ChatInputProvider>
  );
}
