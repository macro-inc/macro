/**
 * Presenting a design, as Figma's ▶ Present does: one screen at a time,
 * scaled to fit, its prototype playing (hotspots navigate, open and close
 * overlays, go back, open links, with their transitions), the arrow keys
 * and Space stepping through the flow, Escape leaving. A click that runs
 * nothing flashes the screen's hotspots. Screens are rendered by the
 * engine's export path at the scale they are shown at.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type {
  PrototypeFrame,
  PrototypeHotspot,
  PrototypeInfo,
} from '@core/fig-engine/prototype-types';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import LinkIcon from '@phosphor/link.svg';
import XIcon from '@phosphor/x.svg';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  clickableHotspots,
  flowOrder,
  flowsOf,
  type Gesture,
  goTo,
  hexColor,
  hotspotAt,
  type OpenOverlay,
  overlayPosition,
  type PlayerState,
  runAction,
  type Side,
  startState,
  stepFlow,
  type Transition,
} from '../core/prototype';

/** Height of the bottom bar, CSS px. */
const BAR = 48;
/** Space around the screen, CSS px. */
const MARGIN = 24;

/** Renders frames as PNG object URLs, at a few fixed scales, once each. */
function createFrameImages(engine: FigEngine, page: number) {
  const cache = new Map<string, Promise<string>>();
  const urls: string[] = [];
  onCleanup(() => {
    for (const u of urls) URL.revokeObjectURL(u);
  });
  return (frame: string, scale: number) => {
    // Quarter steps keep re-renders few while resizing.
    const s = Math.min(4, Math.max(0.25, Math.ceil(scale * 4) / 4));
    const key = `${frame}@${s}`;
    let url = cache.get(key);
    if (!url) {
      url = engine.exportPng(page, frame, s).then((blob) => {
        const u = URL.createObjectURL(blob);
        urls.push(u);
        return u;
      });
      cache.set(key, url);
    }
    return url;
  };
}

const offsets: Record<Side, [string, string]> = {
  left: ['-100%', '0'],
  right: ['100%', '0'],
  top: ['0', '-100%'],
  bottom: ['0', '100%'],
};

const opposite: Record<Side, Side> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

const move = (side: Side, share = 1) => {
  const [x, y] = offsets[side];
  const scale = (v: string) =>
    v === '0' ? '0' : `${Number.parseFloat(v) * share}%`;
  return `translate(${scale(x)}, ${scale(y)})`;
};

/** Keyframes for the screen coming in and the one going out. */
function screenAnimations(t: Transition): {
  incoming?: Keyframe[];
  outgoing?: Keyframe[];
} {
  const reverse = !!t.reverse;
  const side = t.side ?? 'right';
  const kind = reverse
    ? t.kind === 'move-in'
      ? 'move-out'
      : t.kind === 'move-out'
        ? 'move-in'
        : t.kind
    : t.kind;
  const s = reverse && t.kind !== 'move-in' ? opposite[side] : side;
  switch (kind) {
    case 'dissolve':
      return { incoming: [{ opacity: 0 }, { opacity: 1 }] };
    case 'move-in':
      return {
        incoming: [
          { transform: move(reverse ? side : s) },
          { transform: 'none' },
        ],
      };
    case 'move-out':
      return {
        outgoing: [
          { transform: 'none' },
          { transform: move(reverse ? opposite[side] : s) },
        ],
      };
    case 'push':
      return {
        incoming: [{ transform: move(s) }, { transform: 'none' }],
        outgoing: [{ transform: 'none' }, { transform: move(opposite[s]) }],
      };
    case 'slide':
      return {
        incoming: [{ transform: move(s) }, { transform: 'none' }],
        outgoing: [
          { transform: 'none' },
          { transform: move(opposite[s], 0.3) },
        ],
      };
    default:
      return {};
  }
}

interface Shown {
  frame: string;
  key: number;
  leaving: boolean;
  transition: Transition;
}

export function PresentMode(props: {
  engine: FigEngine;
  page: number;
  info: PrototypeInfo;
  start: string;
  onExit: () => void;
  /** Copies a link that opens the design presenting a frame. */
  onCopyLink?: (frame: string) => void;
}) {
  const frames = createMemo(
    () => new Map(props.info.frames.map((f) => [f.id, f]))
  );
  const frame = (id: string): PrototypeFrame | undefined => frames().get(id);
  const order = createMemo(() => flowOrder(props.info, props.start));
  const flowName = () => {
    const flows = flowsOf(props.info);
    const at = order()[0];
    return flows.find((f) => f.frame === at)?.name;
  };

  const [state, setState] = createSignal<PlayerState>(startState(props.start));
  const [shown, setShown] = createSignal<Shown[]>([
    {
      frame: props.start,
      key: 0,
      leaving: false,
      transition: { kind: 'instant', duration: 0 },
    },
  ]);
  const [hints, setHints] = createSignal<PrototypeHotspot[]>([]);
  const [hovering, setHovering] = createSignal(false);
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let stage!: HTMLDivElement;
  let keySeq = 0;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let afterTimer: ReturnType<typeof setTimeout> | undefined;
  /** A hover interaction's state to return to when the pointer leaves. */
  let hoverReturn:
    | { hotspot: PrototypeHotspot; state: PlayerState }
    | undefined;
  const images = createFrameImages(props.engine, props.page);

  const current = () => frame(state().screen);
  const fit = () => {
    const f = current();
    const s = size();
    if (!f || s.w <= 0 || s.h <= 0) return 1;
    return Math.min(
      (s.w - 2 * MARGIN) / f.bounds.w,
      (s.h - 2 * MARGIN) / f.bounds.h
    );
  };
  const dpr = () =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  /** Shows `next`, animating the screen change with `transition`. */
  const show = (next: PlayerState, transition: Transition) => {
    const before = state();
    setState(next);
    hoverReturn = hoverReturn?.state === before ? hoverReturn : undefined;
    if (next.screen !== before.screen) {
      const key = ++keySeq;
      const instant = transition.kind === 'instant';
      setShown((list) => [
        ...(instant
          ? []
          : list
              .filter((s) => !s.leaving)
              .map((s) => ({ ...s, leaving: true, transition }))),
        { frame: next.screen, key, leaving: false, transition },
      ]);
      if (!instant)
        setTimeout(
          () => setShown((list) => list.filter((s) => !s.leaving)),
          transition.duration * 1000 + 50
        );
      armTimeout(next.screen);
    }
  };

  /** Frame-level "After delay" interactions. */
  const armTimeout = (screen: string) => {
    clearTimeout(afterTimer);
    const h = props.info.hotspots.find((x) => x.id === screen);
    const i = h?.interactions.find((x) => x.trigger === 'AFTER_TIMEOUT');
    if (!h || !i) return;
    afterTimer = setTimeout(
      () => {
        if (state().screen === screen) runInteraction(h, i.actions);
      },
      (i.timeout ?? 0.8) * 1000
    );
  };

  const runInteraction = (
    hotspot: PrototypeHotspot,
    actions: PrototypeHotspot['interactions'][number]['actions']
  ) => {
    let s = state();
    let transition: Transition = { kind: 'instant', duration: 0 };
    for (const a of actions) {
      const step = runAction(s, a, hotspot);
      s = step.state;
      if (step.transition.kind !== 'instant') transition = step.transition;
      if (step.effect.kind === 'open-url')
        window.open(step.effect.url, '_blank', 'noopener');
    }
    if (s !== state()) show(s, transition);
  };

  const step = (direction: 1 | -1) => {
    const next = stepFlow(order(), state().screen, direction);
    if (next) show(goTo(state(), next), { kind: 'instant', duration: 0 });
  };

  const restart = () =>
    show(startState(order()[0] ?? props.start), {
      kind: 'instant',
      duration: 0,
    });

  /** Page point under a stage point, in the screen or the top overlay. */
  const locate = (e: PointerEvent | MouseEvent) => {
    const f = current();
    if (!f) return undefined;
    const r = stage.getBoundingClientRect();
    const z = fit();
    const ox = (size().w - f.bounds.w * z) / 2;
    const oy = (size().h - f.bounds.h * z) / 2;
    const lx = (e.clientX - r.left - ox) / z;
    const ly = (e.clientY - r.top - oy) / z;
    const top = state().overlays.at(-1);
    if (top) {
      const of = frame(top.frame);
      if (of) {
        const at = overlayPosition(of, f, top);
        const inside =
          lx >= at.x &&
          ly >= at.y &&
          lx <= at.x + of.bounds.w &&
          ly <= at.y + of.bounds.h;
        return {
          frame: inside ? of.id : undefined,
          outside: !inside,
          x: of.bounds.x + lx - at.x,
          y: of.bounds.y + ly - at.y,
        };
      }
    }
    const inside = lx >= 0 && ly >= 0 && lx <= f.bounds.w && ly <= f.bounds.h;
    return {
      frame: inside ? f.id : undefined,
      outside: false,
      x: f.bounds.x + lx,
      y: f.bounds.y + ly,
    };
  };

  const hit = (e: PointerEvent | MouseEvent, gesture: Gesture) => {
    const at = locate(e);
    if (!at?.frame) return { at, found: undefined };
    return { at, found: hotspotAt(props.info, at.frame, at.x, at.y, gesture) };
  };

  const onClick = (e: MouseEvent) => {
    const { at, found } = hit(e, 'click');
    if (found) {
      runInteraction(found.hotspot, found.interaction.actions);
      return;
    }
    const top = state().overlays.at(-1);
    const topFrame = top ? frame(top.frame) : undefined;
    if (at?.outside && topFrame?.overlay?.closeOnClickOutside) {
      show(
        { ...state(), overlays: state().overlays.slice(0, -1) },
        {
          kind: 'instant',
          duration: 0,
        }
      );
      return;
    }
    // Nothing to run: flash where the hotspots are, as Figma does.
    const shownFrame = at?.frame ?? state().screen;
    setHints(clickableHotspots(props.info, shownFrame));
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setHints([]), 700);
  };

  const onPointerMove = (e: PointerEvent) => {
    const { at, found } = hit(e, 'hover');
    setHovering(!!hit(e, 'click').found || !!found);
    if (hoverReturn) {
      const b = hoverReturn.hotspot.bounds;
      const still =
        at &&
        at.x >= b.x &&
        at.y >= b.y &&
        at.x <= b.x + b.w &&
        at.y <= b.y + b.h;
      if (!still && found?.hotspot.id !== hoverReturn.hotspot.id) {
        const back = hoverReturn.state;
        hoverReturn = undefined;
        show(back, { kind: 'instant', duration: 0 });
      }
      return;
    }
    if (!found) return;
    const before = state();
    runInteraction(found.hotspot, found.interaction.actions);
    if (found.interaction.trigger === 'ON_HOVER' && state() !== before)
      hoverReturn = { hotspot: found.hotspot, state: before };
  };

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea')) return;
    let handled = true;
    if (e.key === 'Escape') props.onExit();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
    else if (e.key === ' ') step(e.shiftKey ? -1 : 1);
    else if (e.key === 'r' || e.key === 'R') restart();
    else handled = false;
    // The viewer's shortcuts stay off while presenting.
    e.stopPropagation();
    if (handled) e.preventDefault();
  };

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(stage);
    armTimeout(props.start);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, true);
      observer.disconnect();
      clearTimeout(hintTimer);
      clearTimeout(afterTimer);
    });
  });

  const index = () => order().indexOf(state().screen);

  /** A frame's image, sized to the screen's scale. */
  const FrameImage = (p: { frame: PrototypeFrame; testId: string }) => {
    const [src, setSrc] = createSignal<string>();
    const scale = () => fit() * dpr();
    const load = (s: number) => {
      void images(p.frame.id, s)
        .then(setSrc)
        .catch(() => setSrc(undefined));
    };
    // The image comes from the engine (an external system).
    createEffect(on(scale, load));
    return (
      <div
        class="absolute top-0 left-0"
        style={{
          width: `${p.frame.bounds.w * fit()}px`,
          height: `${p.frame.bounds.h * fit()}px`,
        }}
        data-testid={p.testId}
        data-frame={p.frame.id}
        data-loaded={src() ? 'true' : 'false'}
      >
        <Show when={src()}>
          {(url) => (
            <img
              src={url()}
              alt={p.frame.name}
              draggable={false}
              class="pointer-events-none size-full select-none"
            />
          )}
        </Show>
      </div>
    );
  };

  const Overlay = (p: { open: OpenOverlay; base: PrototypeFrame }) => {
    const f = () => frame(p.open.frame);
    return (
      <Show when={f()}>
        {(of) => {
          const at = () => overlayPosition(of(), p.base, p.open);
          return (
            <>
              <Show when={of().overlay?.background}>
                {(bg) => (
                  <div
                    class="pointer-events-none absolute inset-0"
                    style={{ background: hexColor(bg()) }}
                  />
                )}
              </Show>
              <div
                class="absolute"
                style={{
                  left: `${at().x * fit()}px`,
                  top: `${at().y * fit()}px`,
                }}
              >
                <FrameImage frame={of()} testId="fig-present-overlay" />
              </div>
            </>
          );
        }}
      </Show>
    );
  };

  const Screen = (p: { item: Shown }) => {
    const f = () => frame(p.item.frame);
    const ref = (el: HTMLDivElement) => {
      const anim = screenAnimations(p.item.transition);
      const frames = p.item.leaving ? anim.outgoing : anim.incoming;
      if (frames && p.item.transition.kind !== 'instant')
        el.animate(frames, {
          duration: p.item.transition.duration * 1000,
          easing: 'ease-out',
          fill: 'forwards',
        });
    };
    return (
      <Show when={f()}>
        {(sf) => (
          <div
            ref={ref}
            class="absolute"
            classList={{ 'pointer-events-none': p.item.leaving }}
            style={{
              left: `${(size().w - sf().bounds.w * fit()) / 2}px`,
              top: `${(size().h - sf().bounds.h * fit()) / 2}px`,
              width: `${sf().bounds.w * fit()}px`,
              height: `${sf().bounds.h * fit()}px`,
              'z-index': p.item.leaving ? 0 : 1,
            }}
          >
            <FrameImage
              frame={sf()}
              testId={
                p.item.leaving ? 'fig-present-leaving' : 'fig-present-screen'
              }
            />
            <Show when={!p.item.leaving}>
              <For each={state().overlays}>
                {(open) => <Overlay open={open} base={sf()} />}
              </For>
              <For each={hints()}>
                {(h) => {
                  const r = () => {
                    const top = state().overlays.at(-1);
                    const origin =
                      top && h.frame === top.frame ? frame(top.frame) : sf();
                    const offset =
                      top && h.frame === top.frame && origin
                        ? overlayPosition(origin, sf(), top)
                        : { x: 0, y: 0 };
                    return {
                      x:
                        (h.bounds.x - (origin?.bounds.x ?? 0) + offset.x) *
                        fit(),
                      y:
                        (h.bounds.y - (origin?.bounds.y ?? 0) + offset.y) *
                        fit(),
                      w: h.bounds.w * fit(),
                      h: h.bounds.h * fit(),
                    };
                  };
                  return (
                    <div
                      class="pointer-events-none absolute animate-pulse rounded-sm border-2 border-accent bg-accent/25"
                      style={{
                        left: `${r().x}px`,
                        top: `${r().y}px`,
                        width: `${r().w}px`,
                        height: `${r().h}px`,
                      }}
                      data-testid="fig-present-hint"
                      data-hotspot={h.id}
                    />
                  );
                }}
              </For>
            </Show>
          </div>
        )}
      </Show>
    );
  };

  return (
    <Portal>
      <div
        class="fixed inset-0 z-[1000] flex flex-col bg-panel text-ink"
        data-testid="fig-present"
        role="dialog"
        aria-label="Presentation"
      >
        <div
          ref={stage}
          class="relative min-h-0 flex-1 overflow-hidden bg-inset"
          style={{ cursor: hovering() ? 'pointer' : 'default' }}
          data-testid="fig-present-stage"
          onClick={onClick}
          onPointerMove={onPointerMove}
        >
          <For each={shown()}>{(item) => <Screen item={item} />}</For>
        </div>
        <div
          class="flex shrink-0 items-center gap-3 border-edge-muted border-t px-4 text-sm"
          style={{ height: `${BAR}px` }}
        >
          <Show when={flowName()}>
            {(name) => (
              <span class="text-ink-muted" data-testid="fig-present-flow">
                {name()}
              </span>
            )}
          </Show>
          <span class="truncate font-medium" data-testid="fig-present-name">
            {current()?.name ?? ''}
          </span>
          <span
            class="text-ink-muted tabular-nums"
            data-testid="fig-present-index"
          >
            {index() >= 0 ? `${index() + 1} / ${order().length}` : ''}
          </span>
          <div class="ml-auto flex items-center gap-1">
            <button
              type="button"
              class="rounded-md p-1.5 hover:bg-hover"
              aria-label="Previous frame"
              data-testid="fig-present-previous"
              onClick={() => step(-1)}
            >
              <ArrowLeft class="size-4" />
            </button>
            <button
              type="button"
              class="rounded-md p-1.5 hover:bg-hover"
              aria-label="Next frame"
              data-testid="fig-present-next"
              onClick={() => step(1)}
            >
              <ArrowRight class="size-4" />
            </button>
            <Show when={props.onCopyLink}>
              {(copy) => (
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-hover"
                  data-testid="fig-present-copy-link"
                  onClick={() => copy()(state().screen)}
                >
                  <LinkIcon class="size-4" />
                  Copy link to frame
                </button>
              )}
            </Show>
            <button
              type="button"
              class="rounded-md p-1.5 hover:bg-hover"
              aria-label="Exit presentation"
              data-testid="fig-present-exit"
              onClick={() => props.onExit()}
            >
              <XIcon class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
