/**
 * Slide show: the deck full screen, one slide at a time, with the slides'
 * transitions and PowerPoint's keyboard controls (see `createShow`); S shows
 * speaker notes.
 */

import type { DeckOutline } from '@core/pptx-engine/types';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import X from '@phosphor/x.svg';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { createShow } from '../primitives/create-show';
import { ShowCanvas } from './show-canvas';

export function SlideShow(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  /** Index to start at (hidden slides are skipped while advancing). */
  start: number;
  onExit: (index: number) => void;
}) {
  let root!: HTMLDivElement;
  const show = createShow({
    deck: () => props.deck,
    start: props.start,
    onExit: (index) => {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      props.onExit(index);
    },
  });
  const [notes, setNotes] = createSignal(false);
  const [chrome, setChrome] = createSignal(true);
  let chromeTimer: ReturnType<typeof setTimeout> | undefined;
  const [size, setSize] = createSignal({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (show.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 's' || e.key === 'S') setNotes((v) => !v);
  };

  const showChrome = () => {
    setChrome(true);
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => setChrome(false), 2500);
  };

  onMount(() => {
    root.focus();
    void root.requestFullscreen?.().catch(() => {});
    const onResize = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    const onFullscreen = () => {
      // Leaving full screen with the browser's own Esc ends the show.
      if (!document.fullscreenElement) show.exit();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    showChrome();
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(chromeTimer);
    });
  });

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label="Slide show"
      data-testid="pptx-slideshow"
      class="fixed inset-0 z-modal flex items-center justify-center bg-[black] outline-none"
      classList={{ 'cursor-none': !chrome() }}
      onKeyDown={onKeyDown}
      onPointerMove={showChrome}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        show.go(1);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        show.go(-1);
      }}
    >
      <ShowCanvas
        engine={props.engine}
        deck={props.deck}
        index={show.index()}
        width={size().w}
        height={size().h}
        pixelRatio={window.devicePixelRatio || 1}
        screen={show.screen()}
        preload={show.step(1)}
        onShown={show.shown}
        testId="pptx-slideshow-canvas"
      />
      <Show when={show.ended()}>
        <div class="absolute inset-0 flex items-start justify-center bg-[black] pt-8 text-[#ccc] text-sm">
          End of slide show, click to exit.
        </div>
      </Show>
      <Show when={notes() && show.slide()?.notes}>
        <div class="absolute inset-x-0 bottom-0 max-h-[30vh] overflow-y-auto bg-[black]/80 p-4 text-[white] text-base whitespace-pre-wrap">
          {show.slide()?.notes}
        </div>
      </Show>
      <div
        class="absolute bottom-4 left-4 flex items-center gap-1 rounded-full bg-[black]/60 px-2 py-1 text-[white] text-xs transition-opacity"
        classList={{ 'opacity-0': !chrome(), 'opacity-100': chrome() }}
      >
        <button
          type="button"
          aria-label="Previous slide"
          class="rounded-full p-1 hover:bg-[white]/20"
          onClick={() => show.go(-1)}
        >
          <CaretLeft class="size-4" />
        </button>
        <span class="tabular-nums" data-testid="pptx-slideshow-counter">
          {show.index() + 1} / {show.slides().length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          class="rounded-full p-1 hover:bg-[white]/20"
          onClick={() => show.go(1)}
        >
          <CaretRight class="size-4" />
        </button>
        <button
          type="button"
          aria-label="End show"
          class="ml-1 rounded-full p-1 hover:bg-[white]/20"
          onClick={show.exit}
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  );
}
