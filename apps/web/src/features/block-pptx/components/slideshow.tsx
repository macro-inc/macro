/**
 * Slide show: the deck full screen, one slide at a time, with the slides'
 * transitions and PowerPoint's keyboard controls (see `createShow`); S shows
 * speaker notes. Links show a hand and their ScreenTip, and a click follows
 * them.
 */

import type { DeckOutline, LinkRegion } from '@core/pptx-engine/types';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import X from '@phosphor/x.svg';
import {
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { linkLabel, regionAt } from '../core/links';
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

  // Links: a hand and the ScreenTip over them; a click follows one.
  const [regions] = createResource(
    () => (props.engine.linkRegions ? show.index() : undefined),
    async (index) => (await props.engine.linkRegions?.(index)) ?? []
  );
  const [hover, setHover] = createSignal<{
    region: LinkRegion;
    x: number;
    y: number;
  }>();
  /** The link under a pointer event, in slide points. */
  const regionAtEvent = (e: MouseEvent) => {
    const list = regions.latest;
    if (!list?.length || show.ended() || show.screen() !== 'slide') return;
    const { w, h } = size();
    const scale = Math.min(w / props.deck.width, h / props.deck.height);
    const x = (e.clientX - (w - props.deck.width * scale) / 2) / scale;
    const y = (e.clientY - (h - props.deck.height * scale) / 2) / scale;
    return regionAt(list, x, y);
  };

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
      classList={{ 'cursor-none': !chrome() && !hover() }}
      style={{ cursor: hover() ? 'pointer' : undefined }}
      onKeyDown={onKeyDown}
      onPointerMove={(e) => {
        showChrome();
        const region = regionAtEvent(e);
        setHover(region ? { region, x: e.clientX, y: e.clientY } : undefined);
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const region = regionAtEvent(e);
        if (region) {
          setHover(undefined);
          const url = show.follow(region.link);
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
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
        preload={show.nextSlide(1)}
        step={show.step()}
        onShown={show.shown}
        testId="pptx-slideshow-canvas"
      />
      <Show when={hover()}>
        {(h) => (
          <div
            class="pointer-events-none absolute max-w-80 rounded-sm border border-[#999] bg-[#ffffe1] px-1.5 py-0.5 text-[#000] text-xs shadow"
            style={{ left: `${h().x + 12}px`, top: `${h().y + 18}px` }}
            data-testid="pptx-slideshow-link-tip"
          >
            {h().region.tip ?? linkLabel(h().region.link, props.deck)}
          </div>
        )}
      </Show>
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
