/**
 * Slide show: the deck full screen, one slide at a time, with the slides'
 * transitions and PowerPoint's keyboard controls.
 *
 * Next: click, Space, →, ↓, Enter, PageDown, N. Previous: ←, ↑, Backspace,
 * PageUp, P. Home/End jump; a number then Enter goes to that slide; B or .
 * blacks the screen, W or , whites it; S shows speaker notes; Esc ends.
 */

import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import X from '@phosphor/x.svg';
import {
  createEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';

/** Keyframes for the incoming and outgoing slide of a transition. */
interface TransitionFrames {
  incoming?: Keyframe[];
  outgoing?: Keyframe[];
}

/**
 * A transition as keyframes. OOXML directions name where the motion goes:
 * `l` moves leftwards, so a pushed slide enters from the right.
 */
export function transitionFrames(
  kind: string,
  direction: string | undefined
): TransitionFrames | null {
  const offset = (d: string | undefined) => {
    switch (d) {
      case 'r':
        return { from: 'translateX(-100%)', to: 'translateX(100%)' };
      case 'u':
        return { from: 'translateY(100%)', to: 'translateY(-100%)' };
      case 'd':
        return { from: 'translateY(-100%)', to: 'translateY(100%)' };
      case 'lu':
        return { from: 'translate(100%, 100%)', to: 'translate(-100%, -100%)' };
      case 'ru':
        return { from: 'translate(-100%, 100%)', to: 'translate(100%, -100%)' };
      case 'ld':
        return { from: 'translate(100%, -100%)', to: 'translate(-100%, 100%)' };
      case 'rd':
        return { from: 'translate(-100%, -100%)', to: 'translate(100%, 100%)' };
      default:
        return { from: 'translateX(100%)', to: 'translateX(-100%)' };
    }
  };
  const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  switch (kind) {
    case 'none':
    case 'cut':
      return null;
    case 'push': {
      const o = offset(direction);
      return {
        incoming: [{ transform: o.from }, { transform: 'none' }],
        outgoing: [{ transform: 'none' }, { transform: o.to }],
      };
    }
    case 'cover':
      return {
        incoming: [
          { transform: offset(direction).from },
          { transform: 'none' },
        ],
      };
    case 'uncover':
    case 'pull':
      // The old slide slides away and reveals the new one underneath.
      return {
        incoming: [{ opacity: 1 }, { opacity: 1 }],
        outgoing: [{ transform: 'none' }, { transform: offset(direction).to }],
      };
    case 'wipe':
      return {
        incoming: [
          {
            clipPath:
              direction === 'r'
                ? 'inset(0 100% 0 0)'
                : direction === 'u'
                  ? 'inset(100% 0 0 0)'
                  : direction === 'd'
                    ? 'inset(0 0 100% 0)'
                    : 'inset(0 0 0 100%)',
          },
          { clipPath: 'inset(0 0 0 0)' },
        ],
      };
    case 'split':
      return {
        incoming: [
          {
            clipPath: direction?.startsWith('horz')
              ? direction.endsWith('In')
                ? 'inset(0 0 0 0)'
                : 'inset(50% 0 50% 0)'
              : direction?.endsWith('In')
                ? 'inset(0 0 0 0)'
                : 'inset(0 50% 0 50%)',
          },
          { clipPath: 'inset(0 0 0 0)' },
        ],
      };
    case 'reveal':
      return {
        incoming: fadeIn,
        outgoing: [
          { transform: 'none', opacity: 1 },
          { transform: offset(direction).to, opacity: 0 },
        ],
      };
    case 'shape':
    case 'circle':
      return {
        incoming: [
          {
            clipPath:
              direction === 'diamond'
                ? 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)'
                : 'circle(0% at 50% 50%)',
          },
          {
            clipPath:
              direction === 'diamond'
                ? 'polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%)'
                : 'circle(75% at 50% 50%)',
          },
        ],
      };
    case 'zoom':
      return direction === 'out'
        ? {
            incoming: fadeIn,
            outgoing: [
              { transform: 'none', opacity: 1 },
              { transform: 'scale(1.6)', opacity: 0 },
            ],
          }
        : {
            incoming: [
              { transform: 'scale(0.3)', opacity: 0 },
              { transform: 'none', opacity: 1 },
            ],
          };
    case 'flash':
      return {
        incoming: [
          { filter: 'brightness(4)', opacity: 0 },
          { filter: 'brightness(1)', opacity: 1 },
        ],
      };
    case 'fade':
      return direction === 'black'
        ? {
            incoming: [
              { opacity: 0 },
              { opacity: 0, offset: 0.5 },
              { opacity: 1 },
            ],
            outgoing: [
              { opacity: 1 },
              { opacity: 0, offset: 0.5 },
              { opacity: 0 },
            ],
          }
        : { incoming: fadeIn };
    default:
      // dissolve, randomBar, morph (approximated with a fade)...
      return { incoming: fadeIn };
  }
}

export function SlideShow(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  /** Index to start at (hidden slides are skipped while advancing). */
  start: number;
  onExit: (index: number) => void;
}) {
  let root!: HTMLDivElement;
  let incoming!: HTMLCanvasElement;
  let outgoing!: HTMLCanvasElement;
  const [index, setIndex] = createSignal(
    Math.min(Math.max(0, props.start), props.deck.slides.length - 1)
  );
  const [screen, setScreen] = createSignal<'slide' | 'black' | 'white'>(
    'slide'
  );
  const [ended, setEnded] = createSignal(false);
  const [notes, setNotes] = createSignal(false);
  const [chrome, setChrome] = createSignal(true);
  let typed = '';
  let chromeTimer: ReturnType<typeof setTimeout> | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;

  const slides = () => props.deck.slides;
  const slide = (): SlideOutline | undefined => slides()[index()];
  const [size, setSize] = createSignal({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const fit = () => {
    const { w, h } = size();
    const s = Math.min(w / props.deck.width, h / props.deck.height);
    return { w: props.deck.width * s, h: props.deck.height * s };
  };
  const pixelWidth = () =>
    Math.min(4096, Math.round(fit().w * (window.devicePixelRatio || 1)));

  /** Renders are cached per slide for the session; neighbours preload. */
  const cache = new Map<number, Promise<ImageBitmap>>();
  const render = (i: number) => {
    const width = pixelWidth();
    const key = i * 10000 + width;
    let hit = cache.get(key);
    if (!hit) {
      hit = props.engine.render(i, width);
      cache.set(key, hit);
      hit.catch(() => cache.delete(key));
    }
    return hit;
  };
  onCleanup(() => {
    for (const p of cache.values())
      void p.then((b) => b.close()).catch(() => {});
  });

  const draw = (canvas: HTMLCanvasElement, bitmap: ImageBitmap) => {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  };

  const [shown] = createResource(
    () => [index(), pixelWidth()] as const,
    async ([i]) => {
      const bitmap = await render(i);
      return { i, bitmap };
    }
  );

  let first = true;
  /** Uncover-style transitions move the old slide over the new one. */
  const [outgoingOnTop, setOutgoingOnTop] = createSignal(false);
  createEffect(
    on(shown, (value) => {
      if (!value) return;
      // The previous image stays underneath while the next one enters.
      if (incoming.width > 0) {
        outgoing.width = incoming.width;
        outgoing.height = incoming.height;
        outgoing.getContext('2d')?.drawImage(incoming, 0, 0);
      }
      draw(incoming, value.bitmap);
      const t = slides()[value.i]?.transition;
      // Slides without a transition just appear, as in PowerPoint.
      const frames = first
        ? null
        : transitionFrames(t?.kind ?? 'none', t?.direction);
      first = false;
      setOutgoingOnTop(
        ['uncover', 'pull', 'reveal'].includes(t?.kind ?? '') ||
          (t?.kind === 'zoom' && t.direction === 'out')
      );
      const timing = { duration: t?.durationMs ?? 500, easing: 'ease-in-out' };
      if (frames?.incoming) incoming.animate(frames.incoming, timing);
      // The old slide stays visible underneath until the new one covers it.
      if (frames) {
        const leaving = outgoing.animate(
          frames.outgoing ?? [{ opacity: 1 }, { opacity: 1 }],
          timing
        );
        // Once gone, the old slide drops below the new one for good.
        leaving.onfinish = () => setOutgoingOnTop(false);
      }
      // Preload the neighbours.
      const next = step(1);
      if (next !== undefined) void render(next).catch(() => {});
      clearTimeout(advanceTimer);
      const after = slides()[value.i]?.transition?.advanceAfterMs;
      if (after !== undefined && after !== null)
        advanceTimer = setTimeout(() => go(1), after);
    })
  );

  /** The next visible slide in a direction, if any. */
  function step(direction: 1 | -1): number | undefined {
    for (
      let i = index() + direction;
      i >= 0 && i < slides().length;
      i += direction
    ) {
      if (!slides()[i].hidden) return i;
    }
    return undefined;
  }

  function go(direction: 1 | -1) {
    setScreen('slide');
    if (ended()) {
      if (direction < 0) setEnded(false);
      else exit();
      return;
    }
    const next = step(direction);
    if (next === undefined) {
      if (direction > 0) setEnded(true);
      return;
    }
    setIndex(next);
  }

  function jump(i: number) {
    setEnded(false);
    setScreen('slide');
    setIndex(Math.min(Math.max(0, i), slides().length - 1));
  }

  function exit() {
    clearTimeout(advanceTimer);
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    props.onExit(index());
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const key = e.key;
    if (/^\d$/.test(key)) {
      typed += key;
      return;
    }
    if (key === 'Enter' && typed) {
      e.preventDefault();
      jump(Number(typed) - 1);
      typed = '';
      return;
    }
    typed = '';
    switch (key) {
      case 'Escape':
      case '-':
        e.preventDefault();
        exit();
        break;
      case ' ':
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case 'Enter':
      case 'n':
      case 'N':
        e.preventDefault();
        go(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
      case 'p':
      case 'P':
        e.preventDefault();
        go(-1);
        break;
      case 'Home':
        e.preventDefault();
        jump(0);
        break;
      case 'End':
        e.preventDefault();
        jump(slides().length - 1);
        break;
      case 'b':
      case 'B':
      case '.':
        setScreen((s) => (s === 'black' ? 'slide' : 'black'));
        break;
      case 'w':
      case 'W':
      case ',':
        setScreen((s) => (s === 'white' ? 'slide' : 'white'));
        break;
      case 's':
      case 'S':
        setNotes((v) => !v);
        break;
    }
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
      if (!document.fullscreenElement) exit();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    showChrome();
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(chromeTimer);
      clearTimeout(advanceTimer);
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
        go(1);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        go(-1);
      }}
    >
      <div
        class="relative overflow-hidden"
        style={{ width: `${fit().w}px`, height: `${fit().h}px` }}
      >
        <canvas
          ref={outgoing}
          class="absolute inset-0 size-full"
          style={{ 'z-index': outgoingOnTop() ? 1 : 0 }}
        />
        <canvas
          ref={incoming}
          style={{ 'z-index': outgoingOnTop() ? 0 : 1 }}
          data-testid="pptx-slideshow-canvas"
          data-slide-index={shown()?.i}
          class="absolute inset-0 size-full"
        />
      </div>
      <Show when={screen() !== 'slide'}>
        <div
          class="absolute inset-0"
          classList={{
            'bg-[black]': screen() === 'black',
            'bg-[white]': screen() === 'white',
          }}
        />
      </Show>
      <Show when={ended()}>
        <div class="absolute inset-0 flex items-start justify-center bg-[black] pt-8 text-[#ccc] text-sm">
          End of slide show, click to exit.
        </div>
      </Show>
      <Show when={notes() && slide()?.notes}>
        <div class="absolute inset-x-0 bottom-0 max-h-[30vh] overflow-y-auto bg-[black]/80 p-4 text-[white] text-base whitespace-pre-wrap">
          {slide()?.notes}
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
          onClick={() => go(-1)}
        >
          <CaretLeft class="size-4" />
        </button>
        <span class="tabular-nums" data-testid="pptx-slideshow-counter">
          {index() + 1} / {slides().length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          class="rounded-full p-1 hover:bg-[white]/20"
          onClick={() => go(1)}
        >
          <CaretRight class="size-4" />
        </button>
        <button
          type="button"
          aria-label="End show"
          class="ml-1 rounded-full p-1 hover:bg-[white]/20"
          onClick={exit}
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  );
}
