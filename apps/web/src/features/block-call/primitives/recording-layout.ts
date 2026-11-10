import { beginInteraction } from '@app/observability/flow';
import { isMobile } from '@core/mobile/isMobile';
import { createScrollIntentTracker } from '@core/util/scroll-intent';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { RecordingPlayback } from './recording-playback';

type RecordingLayoutState = {
  scrollingDown: boolean;
  playerOffscreen: boolean;
};

// 520px player + 480px transcript + 28px gap + 80px page insets.
const TRANSCRIPT_LAYOUT_MIN_PX = 1108;

/** Own the responsive workspace, scroll surfaces and coordinated entry motion. */
export function createRecordingLayout(options: {
  playback: RecordingPlayback;
  hasRecording: Accessor<boolean>;
}) {
  const playback = options.playback;
  const [state, setState] = createStore<RecordingLayoutState>({
    scrollingDown: false,
    playerOffscreen: false,
  });
  const [columnRef, setColumnRef] = createSignal<HTMLDivElement>();
  const columnSize = createElementSize(columnRef);
  const wideTranscript = () =>
    !isMobile() && (columnSize.width ?? 0) >= TRANSCRIPT_LAYOUT_MIN_PX;
  const [fullscreenTranscript, setFullscreenTranscript] = createSignal(true);
  const transcriptPanel = () => playback.isFullscreen() || wideTranscript();
  createEffect(
    on(playback.isFullscreen, (active) => {
      if (!active) setFullscreenTranscript(true);
    })
  );
  const toggleFullscreenTranscript = () => {
    const interaction = beginInteraction('call.recording.transcript');
    try {
      setFullscreenTranscript((visible) => !visible);
    } finally {
      interaction.end();
    }
  };
  const [pageScrollRef, setPageScrollRef] = createSignal<HTMLDivElement>();
  const [leftScrollRef, setLeftScrollRef] = createSignal<HTMLDivElement>();
  const scrollRef = () =>
    transcriptPanel() ? leftScrollRef() : pageScrollRef();

  const [manualScrollGeneration, setManualScrollGeneration] = createSignal(0);
  const [syncTarget, setSyncTarget] = createSignal<HTMLDivElement>();
  const registerSyncTarget = (element: HTMLDivElement) => {
    setSyncTarget(element);
    onCleanup(() => {
      if (syncTarget() === element) setSyncTarget(undefined);
    });
  };
  const scrollIntent = createScrollIntentTracker(() => {
    const direction = scrollIntent.lastDirection();
    if (direction) setState('scrollingDown', direction === 'down');
  });
  const [playerRef, setPlayerRef] = createSignal<HTMLElement>();
  const [playerColumnRef, setPlayerColumnRef] = createSignal<HTMLDivElement>();
  const [transcriptCardRef, setTranscriptCardRef] = createSignal<HTMLElement>();
  let narrowPlayerRect: DOMRect | undefined;
  let layoutAnimations: Animation[] = [];
  let animationPaneWidth = 0;
  const cancelLayoutAnimations = () => {
    for (const animation of layoutAnimations) animation.cancel();
    layoutAnimations = [];
  };
  onCleanup(cancelLayoutAnimations);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionChanged = () => {
    if (reducedMotion.matches) cancelLayoutAnimations();
  };
  reducedMotion.addEventListener('change', motionChanged);
  onCleanup(() => reducedMotion.removeEventListener('change', motionChanged));
  createEffect(() => {
    const column = columnRef();
    const player = playerRef();
    if (!column) return;
    const observer = new ResizeObserver(() => {
      if (layoutAnimations.length && column.clientWidth !== animationPaneWidth)
        cancelLayoutAnimations();
      if (player && !wideTranscript() && !playback.isFullscreen())
        narrowPlayerRect = player.getBoundingClientRect();
    });
    observer.observe(column);
    if (player) observer.observe(player);
    onCleanup(() => observer.disconnect());
  });
  createEffect(
    on(wideTranscript, (wide, previous) => {
      cancelLayoutAnimations();
      if (
        !wide ||
        previous !== false ||
        playback.isFullscreen() ||
        reducedMotion.matches
      )
        return;
      const before = narrowPlayerRect;
      const player = playerRef();
      const column = playerColumnRef();
      const card = transcriptCardRef();
      if (!column || !card) return;
      const cardRect = card.getBoundingClientRect();
      animationPaneWidth = columnRef()?.clientWidth ?? 0;
      const timing = { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
      const cardOffset = before ? before.right + 28 - cardRect.left : 12;
      layoutAnimations = [
        card.animate(
          [
            { opacity: 0, transform: `translateX(${cardOffset}px)` },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          timing
        ),
      ];
      if (before && player) {
        const after = player.getBoundingClientRect();
        layoutAnimations.push(
          column.animate(
            [
              {
                width: `${before.width}px`,
                transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`,
              },
              { width: `${after.width}px`, transform: 'translate(0, 0)' },
            ],
            timing
          )
        );
      }
    })
  );
  createEffect(
    on(playback.isFullscreen, (active) => {
      if (active) cancelLayoutAnimations();
    })
  );

  const floatingPlayback = () =>
    state.playerOffscreen && options.hasRecording();
  createEffect(
    on([scrollRef, playerRef], ([root, player]) => {
      if (!root || !player) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          setState(
            'playerOffscreen',
            entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0)
          );
        },
        { root }
      );
      observer.observe(player);
      onCleanup(() => observer.disconnect());
    })
  );

  return {
    setColumnRef,
    setPageScrollRef,
    setLeftScrollRef,
    setPlayerRef,
    setPlayerColumnRef,
    setTranscriptCardRef,
    wideTranscript,
    transcriptPanel,
    fullscreenTranscript,
    toggleFullscreenTranscript,
    scrollRef,
    scrollIntent,
    scrollingDown: () => state.scrollingDown,
    floatingPlayback,
    manualScrollGeneration,
    setManualScrollGeneration,
    syncTarget,
    registerSyncTarget,
    columnRef,
    showVideo: () =>
      playerRef()?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  };
}
