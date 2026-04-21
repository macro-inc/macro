import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import type {
  SplitHandle,
  SplitId,
  SplitManager,
  SplitState,
} from '../layoutManager';
import type { MobileSwipeLayout } from './createMobileSwipeLayout';
import { SplitPanel } from '../components/SplitPanel';

const SWIPE_EDGE_THRESHOLD = 28; // px from left edge to initiate gesture
const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms — fast flick completes swipe
const SWIPE_DISTANCE_THRESHOLD = 0.5; // fraction of screen width
const SWIPE_ANIMATION_MS = 88;
const BG_PEEK_OFFSET = 110; // px the BG panel is offset left at rest; closes to 0 as FG slides away

export type MobileSwipeBackContainerProps = {
  splitManager: SplitManager;
  mobileSwipeLayout: MobileSwipeLayout;
  splits: Accessor<ReadonlyArray<SplitState>>;
  panelRefs: Map<SplitId, HTMLDivElement>;
};

export function MobileSwipeBackContainer(props: MobileSwipeBackContainerProps) {
  const { splitManager, mobileSwipeLayout } = props;

  const [dragOffset, setDragOffset] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isAnimatingOut, setIsAnimatingOut] = createSignal(false);

  let startX = 0;
  let startTime = 0;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(animationTimer));

  function animateComplete(onDone: () => void) {
    setIsAnimatingOut(true);
    setDragOffset(window.innerWidth);
    animationTimer = setTimeout(() => {
      batch(() => {
        setIsAnimatingOut(false);
        setDragOffset(0);
        onDone();
      });
    }, SWIPE_ANIMATION_MS);
  }

  function animateSnapBack() {
    setIsAnimatingOut(true);
    setDragOffset(0);
    animationTimer = setTimeout(
      () => setIsAnimatingOut(false),
      SWIPE_ANIMATION_MS
    );
  }

  function triggerAnimatedSwipeBack() {
    if (!mobileSwipeLayout.canGoBack()) return;
    animateComplete(() => mobileSwipeLayout.completeSwipeBack());
  }

  // Register the animated trigger so the back button can invoke it.
  onMount(() => mobileSwipeLayout.setAnimatedTrigger(triggerAnimatedSwipeBack));
  onCleanup(() => mobileSwipeLayout.setAnimatedTrigger(undefined));

  function handleTouchStart(e: TouchEvent) {
    if (!mobileSwipeLayout.canGoBack()) return;
    const touch = e.touches[0];
    if (!touch || touch.clientX > SWIPE_EDGE_THRESHOLD) return;
    startX = touch.clientX;
    startTime = Date.now();
    setIsDragging(true);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging()) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.max(0, touch.clientX - startX);
    setDragOffset(dx);
  }

  function handleTouchEnd() {
    if (!isDragging()) return;
    setIsDragging(false);
    const dx = dragOffset();
    const elapsed = Date.now() - startTime;
    const velocity = elapsed > 0 ? dx / elapsed : 0;
    const threshold = window.innerWidth * SWIPE_DISTANCE_THRESHOLD;
    if (dx > threshold || velocity > SWIPE_VELOCITY_THRESHOLD) {
      animateComplete(() => mobileSwipeLayout.completeSwipeBack());
    } else {
      animateSnapBack();
    }
  }

  const slotAData = createMemo(() => {
    const id = mobileSwipeLayout.slotASplitId();
    if (!id) return undefined;
    const split = props.splits().find((s) => s.id === id);
    const rawHandle = splitManager.getSplit(id);
    if (!split || !rawHandle) return undefined;
    const handle: SplitHandle = {
      ...rawHandle,
      goBack: () => mobileSwipeLayout.swipeBack(),
      canGoBack: () => mobileSwipeLayout.canGoBack(),
    };
    return { split, handle };
  });

  const slotBData = createMemo(() => {
    const id = mobileSwipeLayout.slotBSplitId();
    if (!id) return undefined;
    const split = props.splits().find((s) => s.id === id);
    const rawHandle = splitManager.getSplit(id);
    if (!split || !rawHandle) return undefined;
    const handle: SplitHandle = {
      ...rawHandle,
      goBack: () => mobileSwipeLayout.swipeBack(),
      canGoBack: () => mobileSwipeLayout.canGoBack(),
    };
    return { split, handle };
  });

  function getFgTransition(): string {
    if (isDragging()) return 'none';
    if (isAnimatingOut()) return `transform ${SWIPE_ANIMATION_MS}ms ease-out`;
    return 'none';
  }

  // FG translation style — applied only to the currently-active FG slot div.
  const fgStyle = () => ({
    transform: `translateX(${dragOffset()}px)`,
    transition: getFgTransition(),
    'will-change': 'transform',
  });

  // BG parallax style — BG starts BG_PEEK_OFFSET px to the left and closes to 0 as FG slides away.
  const bgStyle = () => ({
    transform: `translateX(${-BG_PEEK_OFFSET + (dragOffset() / window.innerWidth) * BG_PEEK_OFFSET}px)`,
    transition: getFgTransition(),
    'will-change': 'transform',
  });

  return (
    <div
      class="relative size-full overflow-hidden"
      on:touchstart={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      on:touchcancel={() => {
        if (!isDragging()) return;
        setIsDragging(false);
        animateSnapBack();
      }}
    >
      <Show when={slotAData()}>
        {(a) => (
          <div
            class={cn(
              'absolute inset-0',
              {
                'z-10 shadow-xl': mobileSwipeLayout.fgIsSlotA(),
                'z-0 pointer-events-none': !mobileSwipeLayout.fgIsSlotA(),
              },
              !mobileSwipeLayout.fgIsSlotA() &&
                !isDragging() &&
                !isAnimatingOut &&
                'hidden'
            )}
            style={mobileSwipeLayout.fgIsSlotA() ? fgStyle() : bgStyle()}
          >
            {/*
             * Key by content id so that SplitPanel (and its soup state) remounts when the slot's content changes, needed for dock / soup-view navigation.
             */}
            <Show when={a().split.content.id} keyed>
              {(_contentId) => (
                <Suspense>
                  <SplitPanel
                    split={a().split}
                    handle={a().handle}
                    active={mobileSwipeLayout.fgIsSlotA()}
                    setPanelRef={(ref) =>
                      props.panelRefs.set(a().split.id, ref)
                    }
                    index={0}
                  />
                </Suspense>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show when={slotBData()}>
        {(b) => (
          <div
            class={cn(
              'absolute inset-0',
              {
                'z-1 shadow-xl': !mobileSwipeLayout.fgIsSlotA(),
                '-z-1 pointer-events-none': mobileSwipeLayout.fgIsSlotA(),
              },
              mobileSwipeLayout.fgIsSlotA() &&
                !isDragging() &&
                !isAnimatingOut() &&
                'hidden'
            )}
            style={!mobileSwipeLayout.fgIsSlotA() ? fgStyle() : bgStyle()}
          >
            <Show when={b().split.content.id} keyed>
              {(_contentId) => (
                <Suspense>
                  <SplitPanel
                    split={b().split}
                    handle={b().handle}
                    active={!mobileSwipeLayout.fgIsSlotA()}
                    setPanelRef={(ref) =>
                      props.panelRefs.set(b().split.id, ref)
                    }
                    index={1}
                  />
                </Suspense>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
