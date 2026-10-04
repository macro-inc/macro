/**
 * Presenter View: PowerPoint's speaker console. The audience sees the show
 * in a separate window (drag it to the projector and double-click it for
 * full screen); this window shows the current slide, the next one, the
 * speaker notes, a timer, and every slide to jump to.
 */

import type { DeckOutline } from '@core/pptx-engine/types';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Pause from '@phosphor/pause.svg';
import Play from '@phosphor/play.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import { Button } from '@ui/components/Button';
import {
  createSignal,
  For,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { createShow } from '../primitives/create-show';
import { ShowCanvas } from './show-canvas';

/** `h:mm:ss`, or `mm:ss` under an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** A box's size, tracked from the element given to `ref`. */
function createSize() {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  const ref = (el: HTMLElement) => {
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    // Resize observations wait for a rendering step, which a console behind
    // its audience window may not get; measure directly as well.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    queueMicrotask(measure);
    window.addEventListener('resize', measure);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    });
  };
  return [size, ref] as const;
}

/** The audience's window: a black page that shows the slide. */
function openAudience(): Window | null {
  const popup = window.open('', 'pptx-audience', 'popup,width=960,height=540');
  if (!popup) return null;
  const doc = popup.document;
  doc.title = 'Slide show';
  doc.body.replaceChildren();
  Object.assign(doc.body.style, {
    margin: '0',
    background: 'black',
    overflow: 'hidden',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'none',
  });
  return popup;
}

function Panel(props: ParentProps<{ label: string; class?: string }>) {
  return (
    <section
      aria-label={props.label}
      class={`flex min-h-0 flex-col gap-1 ${props.class ?? ''}`}
    >
      <h2 class="font-medium text-ink-muted text-xs">{props.label}</h2>
      {props.children}
    </section>
  );
}

export function PresenterView(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  start: number;
  onExit: (index: number) => void;
}) {
  let root!: HTMLDivElement;
  const [popup, setPopup] = createSignal<Window | null>(null);
  const show = createShow({
    deck: () => props.deck,
    start: props.start,
    onExit: (index) => {
      popup()?.close();
      props.onExit(index);
    },
  });
  const [current, currentRef] = createSize();
  const [next, nextRef] = createSize();
  const [grid, setGrid] = createSignal(false);
  const [notesSize, setNotesSize] = createSignal(18);

  // ---- timer ---------------------------------------------------------------
  const [now, setNow] = createSignal(Date.now());
  const [started, setStarted] = createSignal(Date.now());
  const [pausedAt, setPausedAt] = createSignal<number | null>(null);
  const elapsed = () => (pausedAt() ?? now()) - started();
  const togglePause = () => {
    const at = pausedAt();
    if (at === null) setPausedAt(Date.now());
    else {
      setStarted((s) => s + (Date.now() - at));
      setPausedAt(null);
    }
  };
  const resetTimer = () => {
    setStarted(Date.now());
    if (pausedAt() !== null) setPausedAt(Date.now());
  };

  // ---- the audience window -------------------------------------------------
  const [audienceSize, setAudienceSize] = createSignal({ w: 960, h: 540 });
  const attach = () => {
    const win = openAudience();
    setPopup(win);
    if (!win) return;
    const onKey = (e: KeyboardEvent) => {
      if (show.onKey(e)) e.preventDefault();
    };
    const onClick = () => show.go(1);
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      show.go(-1);
    };
    const onFull = () =>
      void win.document.documentElement.requestFullscreen?.().catch(() => {});
    const onResize = () =>
      setAudienceSize({ w: win.innerWidth, h: win.innerHeight });
    const onGone = () => setPopup(null);
    onResize();
    win.addEventListener('keydown', onKey);
    win.addEventListener('click', onClick);
    win.addEventListener('contextmenu', onContext);
    win.addEventListener('dblclick', onFull);
    win.addEventListener('resize', onResize);
    win.addEventListener('pagehide', onGone);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Buttons keep Enter and Space.
    if (e.target instanceof HTMLButtonElement && [' ', 'Enter'].includes(e.key))
      return;
    if (show.onKey(e)) e.preventDefault();
    else if (e.key === 'g' || e.key === 'G') setGrid((v) => !v);
  };

  onMount(() => {
    root.focus();
    attach();
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
    const timer = setInterval(() => setNow(Date.now()), 500);
    onCleanup(() => {
      clearInterval(timer);
      popup()?.close();
    });
  });

  const nextIndex = () => show.nextSlide(1);

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label="Presenter view"
      data-testid="pptx-presenter"
      class="fixed inset-0 z-modal flex flex-col gap-3 bg-page p-4 text-ink outline-none"
    >
      <header class="flex items-center gap-3 text-sm">
        <span
          class="font-medium text-2xl tabular-nums"
          data-testid="pptx-presenter-timer"
        >
          {formatElapsed(elapsed())}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          label={pausedAt() === null ? 'Pause timer' : 'Resume timer'}
          tooltip={pausedAt() === null ? 'Pause timer' : 'Resume timer'}
          onClick={togglePause}
        >
          <Show when={pausedAt() === null} fallback={<Play />}>
            <Pause />
          </Show>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Restart timer"
          tooltip="Restart timer"
          onClick={resetTimer}
        >
          <ArrowCounterClockwise />
        </Button>
        <span class="text-ink-muted tabular-nums">
          {new Date(now()).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <div class="flex-1" />
        <Show
          when={popup()}
          fallback={
            <span
              class="flex items-center gap-2 text-ink-muted"
              data-testid="pptx-presenter-audience-closed"
            >
              The audience window is closed.
              <Button variant="outline" size="sm" onClick={attach}>
                Open audience window
              </Button>
            </span>
          }
        >
          <span class="text-ink-muted">
            Audience window open: drag it to the projector, double-click for
            full screen.
          </span>
        </Show>
        <Button
          variant="outline"
          size="sm"
          data-testid="pptx-presenter-end"
          onClick={show.exit}
        >
          End slide show
        </Button>
      </header>
      <div class="flex min-h-0 flex-1 gap-4">
        <div class="flex min-h-0 min-w-0 flex-[2] flex-col gap-2">
          <Panel label="Current slide" class="flex-1">
            <div
              ref={currentRef}
              class="flex min-h-0 flex-1 items-center justify-center"
            >
              <Show when={current().w > 0}>
                <ShowCanvas
                  engine={props.engine}
                  deck={props.deck}
                  index={show.index()}
                  width={current().w}
                  height={current().h}
                  pixelRatio={window.devicePixelRatio || 1}
                  screen={show.screen()}
                  preload={nextIndex()}
                  onShown={show.shown}
                  step={show.step()}
                  testId="pptx-presenter-current"
                />
              </Show>
            </div>
          </Panel>
          <div class="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              label="Previous slide"
              tooltip="Previous slide (←)"
              onClick={() => show.go(-1)}
            >
              <CaretLeft />
            </Button>
            <span
              class="min-w-24 text-center text-sm tabular-nums"
              data-testid="pptx-presenter-counter"
            >
              Slide {show.index() + 1} of {show.slides().length}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              label="Next slide"
              tooltip="Next slide (→)"
              data-testid="pptx-presenter-next-button"
              onClick={() => show.go(1)}
            >
              <CaretRight />
            </Button>
            <Button
              variant={grid() ? 'accent' : 'ghost'}
              size="sm"
              tooltip="See all slides (G)"
              data-testid="pptx-presenter-grid-toggle"
              onClick={() => setGrid((v) => !v)}
            >
              <SquaresFour />
              All slides
            </Button>
            <Button
              variant={show.screen() === 'black' ? 'accent' : 'ghost'}
              size="sm"
              tooltip="Black or unblack the screen (B)"
              onClick={() => show.toggleScreen('black')}
            >
              Black screen
            </Button>
          </div>
        </div>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <Panel label="Next" class="h-[40%]">
            <div
              ref={nextRef}
              class="flex min-h-0 flex-1 items-center justify-center"
            >
              <Show
                when={nextIndex() !== undefined && next().w > 0}
                fallback={
                  <span class="text-ink-muted text-sm">End of slide show</span>
                }
              >
                <ShowCanvas
                  engine={props.engine}
                  deck={props.deck}
                  index={nextIndex() ?? 0}
                  width={next().w}
                  height={next().h}
                  pixelRatio={window.devicePixelRatio || 1}
                  transitions={false}
                  testId="pptx-presenter-next"
                />
              </Show>
            </div>
          </Panel>
          <Panel label="Notes" class="flex-1">
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                tooltip="Larger notes"
                data-testid="pptx-presenter-notes-larger"
                onClick={() => setNotesSize((s) => Math.min(48, s + 2))}
              >
                A+
              </Button>
              <Button
                variant="ghost"
                size="xs"
                tooltip="Smaller notes"
                onClick={() => setNotesSize((s) => Math.max(10, s - 2))}
              >
                A−
              </Button>
            </div>
            <div
              data-testid="pptx-presenter-notes"
              class="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-edge-muted p-3"
              style={{ 'font-size': `${notesSize()}px` }}
            >
              {show.slide()?.notes || (
                <span class="text-ink-muted">No notes.</span>
              )}
            </div>
          </Panel>
        </div>
      </div>
      <Show when={grid()}>
        <div
          class="absolute inset-0 z-10 overflow-y-auto bg-page p-6"
          data-testid="pptx-presenter-grid"
        >
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-medium">All slides</h2>
            <Button variant="outline" size="sm" onClick={() => setGrid(false)}>
              Back
            </Button>
          </div>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            <For each={props.deck.slides}>
              {(s, i) => (
                <button
                  type="button"
                  class="flex flex-col items-center gap-1 rounded-md p-1 text-xs hover:bg-ink/5"
                  classList={{
                    'outline outline-2 outline-accent': i() === show.index(),
                    'opacity-50': s.hidden,
                  }}
                  aria-label={`Go to slide ${i() + 1}`}
                  onClick={() => {
                    show.jump(i());
                    setGrid(false);
                  }}
                >
                  <ShowCanvas
                    engine={props.engine}
                    deck={props.deck}
                    index={i()}
                    width={210}
                    height={150}
                    pixelRatio={window.devicePixelRatio || 1}
                    transitions={false}
                  />
                  {i() + 1}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={popup()}>
        {(win) => (
          <Portal mount={win().document.body}>
            <ShowCanvas
              engine={props.engine}
              deck={props.deck}
              index={show.index()}
              width={audienceSize().w}
              height={audienceSize().h}
              pixelRatio={win().devicePixelRatio || 1}
              screen={show.ended() ? 'black' : show.screen()}
              step={show.step()}
              testId="pptx-audience-canvas"
            />
          </Portal>
        )}
      </Show>
    </div>
  );
}
