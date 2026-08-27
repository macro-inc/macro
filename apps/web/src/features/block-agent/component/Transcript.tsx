/**
 * The message chain: a virtualized transcript that loads pinned to the
 * bottom and follows appends while the reader is near it.
 *
 * The scroll recipe is the channel's `ThreadList` distilled (see
 * CHANNEL_BLOCK_NOTES.md §5): virtua for virtualization, an immediate
 * bottom preposition on mount (virtua overshoots with an unmeasured
 * viewport and the browser clamps — first paint lands at the bottom), then
 * a settle loop that keeps re-pinning while late content (Pierre diffs,
 * markdown) grows the list, aborting on a real scroll-up gesture. opencode
 * solves the same problem by patching @tanstack/virtual-core with
 * `anchorTo: "end"`/`followOnAppend` — virtua plus this loop is the
 * unpatched equivalent.
 *
 * Chrome shared with the channel: the `@ui` `Scroll` thumb (hidden native
 * scrollbar, drag-seekable gutter) and the channel's `ScrollToBottomOverlay`,
 * fed by the same scroll-state shape `ThreadList` emits.
 */

import { ScrollToBottomOverlay } from '@channel/Channel/ScrollToBottomOverlay';
import type { ThreadListScrollState } from '@channel/Channel/ThreadList';
import { Scroll } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { useAgentSession } from '../context/AgentSessionContext';
import { Message } from './AgentMessage';
import { ReplyToSelection } from './ReplyToSelection';

/** The channel's `NEAR_BOTTOM_THRESHOLD`: within this, the view follows. */
const NEAR_BOTTOM_PX = 50;
/** How long the bottom pin keeps correcting after a scroll-to-bottom. */
const SETTLE_MS = 1000;
/** The channel's `BASE_ITEM_SIZE` estimate. */
const ITEM_SIZE = 96;

export function Transcript() {
  const { messages, quoteSelection } = useAgentSession();

  let scrollRef: HTMLDivElement | undefined;
  let handle: VirtualizerHandle | undefined;
  let cancelPin: (() => void) | undefined;
  let growthObserver: ResizeObserver | undefined;
  let viewportObserver: ResizeObserver | undefined;
  const [transcriptEl, setTranscriptEl] = createSignal<HTMLDivElement>();

  onCleanup(() => {
    cancelPin?.();
    growthObserver?.disconnect();
    viewportObserver?.disconnect();
  });
  // Whether the view should chase the bottom as content grows. True until
  // the reader scrolls away; recomputed on every scroll.
  let follow = true;
  let didInitialScroll = false;
  let lastScrollTop = 0;

  // The scroller's inner height, so short transcripts can bottom-align:
  // the flex spacer needs the content wrapper to be at least viewport-tall.
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [scrollState, setScrollState] = createSignal<ThreadListScrollState>();

  const distanceFromBottom = () => {
    const el = scrollRef;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  };

  const emitScrollState = () => {
    const el = scrollRef;
    if (!el) return;
    const distance = distanceFromBottom();
    setScrollState({
      didInitialScroll,
      isNearBottom: distance <= NEAR_BOTTOM_PX,
      isScrollingDown: el.scrollTop >= lastScrollTop,
      distanceFromTop: el.scrollTop,
      distanceFromBottom: distance,
      viewportSize: el.clientHeight,
    });
    lastScrollTop = el.scrollTop;
  };

  /**
   * Scroll to the newest message, then keep re-pinning to the true bottom for
   * a short window so late-settling content can't leave the last message cut
   * off. Aborts on a wheel-up or touch drag (a tap is not a scroll) — the
   * channel's `pinToBottom`, without its target machinery.
   */
  const pinToBottom = () => {
    cancelPin?.();
    const el = scrollRef;
    if (!el || !handle) return;
    follow = true;
    handle.scrollToIndex(messages().length - 1, { align: 'end' });

    let rafId = 0;
    const start = performance.now();

    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      if (cancelPin === stop) cancelPin = undefined;
      didInitialScroll = true;
      emitScrollState();
    };
    function onWheel(event: WheelEvent) {
      if (event.deltaY < 0) stop();
    }
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch') stop();
    }
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    cancelPin = stop;

    const tick = () => {
      if (distanceFromBottom() > 1) el.scrollTop = el.scrollHeight;
      if (performance.now() - start >= SETTLE_MS) {
        stop();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  // Follow growth beyond the pin window: whenever the virtualized content
  // resizes (a new turn, a streaming message getting longer) and the reader
  // hasn't scrolled away, snap back to the bottom. This is the sticky-scroll
  // rule — follow only near the bottom — applied to content growth, which is
  // how agent output arrives.
  const observeGrowth = (el: HTMLDivElement) => {
    growthObserver = new ResizeObserver(() => {
      if (follow && distanceFromBottom() > 1) {
        const scroller = scrollRef;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      }
    });
    growthObserver.observe(el);
  };

  const attachScroller = (el: HTMLDivElement) => {
    scrollRef = el;
    // `Scroll` owns the element's onScroll; listen alongside it.
    el.addEventListener(
      'scroll',
      () => {
        follow = distanceFromBottom() <= NEAR_BOTTOM_PX;
        emitScrollState();
      },
      { passive: true }
    );
    viewportObserver = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
      emitScrollState();
    });
    viewportObserver.observe(el);
  };

  return (
    <div class="relative flex-1 min-h-0" ref={setTranscriptEl}>
      <Scroll scrollRef={attachScroller}>
        <div
          class="flex flex-col [overflow-anchor:none]"
          style={{ 'min-height': `${viewportHeight()}px` }}
        >
          {/* Bottom-align short transcripts, chat-style. */}
          <div aria-hidden style={{ 'flex-grow': 1 }} />
          <div ref={observeGrowth}>
            <Virtualizer
              ref={(virtualizer) => {
                if (!virtualizer) return;
                handle = virtualizer;
                // Issue the bottom target immediately, before virtua has a
                // measured viewport — overshoot clamps to the current
                // maximum, so the first painted frame is already at the
                // bottom.
                if (messages().length > 0) pinToBottom();
              }}
              scrollRef={scrollRef}
              data={messages()}
              itemSize={ITEM_SIZE}
              onScrollEnd={() => {
                // The feed fills asynchronously; if rows arrived after mount
                // and we're meant to be following, correct the landing.
                if (follow && distanceFromBottom() > NEAR_BOTTOM_PX) {
                  pinToBottom();
                }
              }}
            >
              {(message) => (
                <div class="w-full max-w-3xl mx-auto px-4 pb-4 min-w-0">
                  <Message message={message} />
                </div>
              )}
            </Virtualizer>
          </div>
        </div>
      </Scroll>
      <ScrollToBottomOverlay
        scrollState={scrollState}
        onScrollToBottom={pinToBottom}
      />
      <ReplyToSelection container={transcriptEl()} onReply={quoteSelection} />
    </div>
  );
}
