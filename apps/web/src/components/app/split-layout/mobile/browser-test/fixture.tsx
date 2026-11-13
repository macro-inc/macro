import '@fontsource-variable/inter';
import '../../../../../index.css';
import {
  SwipableRow,
  SwipableRowProvider,
} from '@components/app/mobile/SwipableRow';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { MobilePaneStack } from '../createMobilePaneStack';
import { createMobileSwipeBackGesture } from '../createMobileSwipeBackGesture';

/**
 * The channel message list and the composer, without the rest of the app.
 * A rightward swipe in the list slides this pane off and returns to Channels.
 */
function ChannelSwipe() {
  const [screen, setScreen] = createSignal<'channel' | 'list'>('channel');
  const [reply, setReply] = createSignal(false);
  const [container, setContainer] = createSignal<HTMLElement>();
  const stack: MobilePaneStack = {
    front: () => undefined,
    behind: () => undefined,
    canGoBack: () => screen() === 'channel',
    completeGoBack: () => setScreen('list'),
    goBack: () => {},
    setAnimatedTrigger: () => {},
    setForwardTrigger: () => {},
  };
  const gesture = createMobileSwipeBackGesture({
    animationMs: 88,
    bgPeekOffset: 110,
    edgeThreshold: 40,
    velocityThreshold: 0.3,
    distanceThreshold: 0.5,
    stack,
    canStart: () => true,
  });
  const showingBehind = () => gesture.isDragging() || gesture.isAnimatingOut();

  return (
    <div
      data-screen={screen()}
      data-reply={reply() ? 'yes' : 'no'}
      class="relative h-dvh overflow-hidden bg-neutral-950 text-white"
      on:touchstart={gesture.handleTouchStart}
      on:touchmove={gesture.handleTouchMove}
      on:touchend={gesture.handleTouchEnd}
      on:touchcancel={gesture.handleTouchCancel}
    >
      <Show
        when={screen() === 'channel'}
        fallback={
          <div class="p-6 text-2xl" data-testid="channel-list">
            Channels
          </div>
        }
      >
        <div
          class="absolute inset-0 bg-neutral-800 p-6 text-2xl"
          classList={{ invisible: !showingBehind() }}
          style={gesture.styleForSlot(false)}
        >
          Channels
        </div>
        <div
          data-testid="channel"
          class="absolute inset-0 z-10 flex flex-col bg-neutral-950"
          style={gesture.styleForSlot(true)}
        >
          <SwipableRowProvider
            container={container}
            triggerBehavior="spring-back"
          >
            <div
              ref={setContainer}
              data-swipe-back-region
              data-testid="messages"
              class="min-h-0 flex-1 overflow-y-auto"
            >
              <SwipableRow id="question" onSwipeLeft={() => setReply(true)}>
                <div data-testid="message" class="px-4 py-6 text-lg">
                  Is this intentional, or is it a bug?
                </div>
              </SwipableRow>
              <For each={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}>
                {(n) => (
                  <SwipableRow id={`note-${n}`}>
                    <div class="px-4 py-6 text-lg">Note {n}</div>
                  </SwipableRow>
                )}
              </For>
              <div
                data-testid="code"
                class="mx-4 overflow-x-auto whitespace-nowrap border border-white/20 py-4"
              >
                <span class="inline-block w-[800px] px-4">
                  wide code block that scrolls sideways
                </span>
              </div>
            </div>
          </SwipableRowProvider>
          <div
            data-testid="composer"
            class="border-t border-white/10 px-4 py-5 text-lg"
          >
            Type a message
          </div>
        </div>
      </Show>
    </div>
  );
}

document.documentElement.style.overscrollBehaviorX = 'none';
document.body.style.overscrollBehaviorX = 'none';

const root = document.getElementById('root');
if (!root) throw new Error('missing root');
render(() => <ChannelSwipe />, root);
