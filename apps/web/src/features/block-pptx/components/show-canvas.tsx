/**
 * One slide of a running show, drawn to fit a box. Slide changes play the
 * slide's transition (Morph animates each object from one slide to the
 * next); with `step`, slides with animations are drawn as layers
 * (`renderSpan`) whose pieces play each click's animations. Renders are
 * cached per slide.
 */

import type { DeckOutline, TextLayoutInfo } from '@core/pptx-engine/types';
import {
  createEffect,
  createMemo,
  createResource,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  effectFrames,
  restingClip,
  restingStyle,
} from '../core/animation-effects';
import {
  buildTimeline,
  type PieceState,
  settle,
  statesAfter,
  type Timeline,
} from '../core/animation-timeline';
import type { Rect } from '../core/selection';
import { transitionFrames } from '../core/transitions';
import type { ShowScreen } from '../primitives/create-show';
import {
  closeMorph,
  type MorphRun,
  type MorphScene,
  playMorph,
  prepareMorph,
} from '../primitives/morph-scene';

/** A slide ready to show: one image, or layers and a timeline. */
type Prepared =
  | { kind: 'flat'; bitmap: ImageBitmap }
  | { kind: 'layered'; timeline: Timeline; bitmaps: ImageBitmap[] };

/** A slide put on screen in one of the two slots. */
interface Mounted {
  index: number;
  prepared: Prepared;
  /** Piece elements by key (layered slides). */
  pieces: Map<string, HTMLElement>;
  step: number;
  running: Animation[];
  /** Bumped to abandon a step that is still playing. */
  token: number;
}

/** Slide-space boxes of a shape's paragraphs, from its text layout. */
function paragraphBoxes(layout: TextLayoutInfo): Rect[] {
  const [a, b, c, d, e, f] = layout.transform;
  const map = (x: number, y: number) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  });
  const boxes: Rect[] = [];
  for (const line of layout.lines) {
    const corners = [
      map(0, line.top),
      map(layout.size[0], line.top),
      map(0, line.bottom),
      map(layout.size[0], line.bottom),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    const old = boxes[line.paragraph];
    boxes[line.paragraph] = old
      ? {
          x: Math.min(old.x, box.x),
          y: Math.min(old.y, box.y),
          w: Math.max(old.x + old.w, box.x + box.w) - Math.min(old.x, box.x),
          h: Math.max(old.y + old.h, box.y + box.h) - Math.min(old.y, box.y),
        }
      : box;
  }
  return boxes;
}

export function ShowCanvas(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  index: number;
  /**
   * Click steps played on the slide (0 = only what plays as it appears).
   * Without it the slide is drawn whole, as it looks after its animations.
   */
  step?: number;
  /** CSS pixels to fit the slide in. */
  width: number;
  height: number;
  pixelRatio?: number;
  screen?: ShowScreen;
  /** Whether slide changes play transitions. */
  transitions?: boolean;
  /** A slide to render ahead of time. */
  preload?: number;
  /** Called when a slide has appeared. */
  onShown?: (index: number) => void;
  testId?: string;
}) {
  let wrapper!: HTMLDivElement;
  const slots: HTMLDivElement[] = [];
  const mounted: (Mounted | null)[] = [null, null];
  let active = 0;

  const fit = () => {
    const s = Math.min(
      props.width / props.deck.width,
      props.height / props.deck.height
    );
    return { w: props.deck.width * s, h: props.deck.height * s };
  };
  /** CSS pixels per point. */
  const k = () => fit().w / props.deck.width;
  const slideSize = () => ({ w: props.deck.width, h: props.deck.height });
  const pixelWidth = () =>
    Math.max(16, Math.min(4096, Math.round(fit().w * (props.pixelRatio ?? 1))));
  const layered = createMemo(
    () => props.step !== undefined && !!props.engine.renderSpan
  );

  const cache = new Map<string, Promise<Prepared>>();
  const prepare = (i: number, width: number, layers: boolean) => {
    const key = `${i}:${width}:${layers}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = (async (): Promise<Prepared> => {
        const slide = props.deck.slides[i];
        const renderSpan = props.engine.renderSpan;
        if (!layers || !renderSpan || !slide?.animations?.length)
          return { kind: 'flat', bitmap: await props.engine.render(i, width) };
        const boxes = new Map<number, Rect[]>();
        const built = new Set(
          slide.animations
            .filter((a) => a.paragraph !== undefined)
            .map((a) => a.shapeId)
        );
        for (const id of built) {
          const layout = await props.engine.textLayout(i, id).catch(() => null);
          if (layout) boxes.set(id, paragraphBoxes(layout));
        }
        const timeline = buildTimeline(slide, boxes);
        const bitmaps = await Promise.all(
          timeline.layers.map((l) =>
            renderSpan(i, width, l.start, l.end, l.backdrop)
          )
        );
        return { kind: 'layered', timeline, bitmaps };
      })();
      cache.set(key, hit);
      hit.catch(() => cache.delete(key));
    }
    return hit;
  };

  // Morph scenes, newest last; only a few are kept (each holds two slides).
  const morphs = new Map<string, Promise<MorphScene | null>>();
  const morphInto = (i: number) =>
    props.transitions !== false &&
    props.deck.slides[i]?.transition?.kind === 'morph';
  const prepareMorphFor = (from: number, to: number, width: number) => {
    const key = `${from}:${to}:${width}`;
    let hit = morphs.get(key);
    if (hit) morphs.delete(key);
    else {
      hit = prepareMorph(props.engine, props.deck, from, to, width).catch(
        () => null
      );
      while (morphs.size >= 3) {
        const [oldest, scene] = morphs.entries().next().value!;
        morphs.delete(oldest);
        void scene.then((s) => s && closeMorph(s));
      }
    }
    morphs.set(key, hit);
    return hit;
  };
  let morphRun: MorphRun | undefined;

  const stop = (m: Mounted | null) => {
    if (!m) return;
    m.token++;
    for (const a of m.running) a.cancel();
    m.running = [];
  };

  onCleanup(() => {
    morphRun?.cancel();
    for (const scene of morphs.values())
      void scene.then((s) => s && closeMorph(s));
    for (const m of mounted) stop(m);
    for (const p of cache.values())
      void p
        .then((r) =>
          r.kind === 'flat'
            ? r.bitmap.close()
            : r.bitmaps.forEach((b) => b.close())
        )
        .catch(() => {});
  });

  const canvasFor = (bitmap: ImageBitmap) => {
    const canvas = wrapper.ownerDocument.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    });
    return canvas;
  };

  /** Rests every piece of `m` as it looks after `step` click steps. */
  const rest = (m: Mounted, step: number) => {
    if (m.prepared.kind !== 'layered') return;
    const states = statesAfter(m.prepared.timeline, step, slideSize());
    for (const [key, el] of m.pieces) {
      const state = states.get(key);
      if (state) Object.assign(el.style, restingStyle(state, k()));
    }
  };

  /** Shows `m` as it looks after `step` click steps, without animating. */
  const settleAt = (m: Mounted, step: number) => {
    stop(m);
    m.step = step;
    rest(m, step);
  };

  /** Plays animation group `group` of `m` from the state before it. */
  const play = (m: Mounted, group: number) => {
    if (m.prepared.kind !== 'layered') return;
    const timeline = m.prepared.timeline;
    const animations = timeline.groups[group] ?? [];
    settleAt(m, group - 1);
    m.step = group;
    const token = m.token;
    const states: Map<string, PieceState> = statesAfter(
      timeline,
      group - 1,
      slideSize()
    );
    const started = new Set<string>();
    const finite: Promise<unknown>[] = [];
    let endless = false;
    for (const timed of animations) {
      const el = m.pieces.get(timed.piece);
      const piece = timeline.pieces.find((p) => p.key === timed.piece);
      const state = states.get(timed.piece);
      if (!el || !piece || !state) continue;
      const frames = effectFrames(
        timed.animation,
        piece,
        state,
        slideSize(),
        k()
      );
      const after = settle(state, timed.animation, slideSize());
      states.set(timed.piece, after);
      if (!frames) {
        // Instant effects (appear, disappear) switch at their start time.
        const anim = el.animate(
          [{ visibility: after.visible ? 'visible' : 'hidden' }],
          { duration: 1, delay: timed.start, fill: 'forwards' }
        );
        m.running.push(anim);
        finite.push(anim.finished);
        continue;
      }
      // The first animation of a piece holds its start until it begins;
      // later ones only hold their end.
      const fill: FillMode = started.has(timed.piece) ? 'forwards' : 'both';
      started.add(timed.piece);
      const anim = el.animate(frames.keyframes, {
        duration: Math.max(1, timed.duration),
        delay: timed.start,
        iterations: timed.iterations,
        easing: frames.easing,
        fill,
      });
      m.running.push(anim);
      if (Number.isFinite(timed.iterations)) finite.push(anim.finished);
      else endless = true;
    }
    void Promise.all(finite)
      .then(() => {
        if (m.token !== token) return;
        // Endless repeats keep going until the next click.
        if (endless) rest(m, group);
        else settleAt(m, group);
      })
      .catch(() => {});
  };

  /** Puts a prepared slide into a slot. */
  const mount = (
    slot: HTMLDivElement,
    index: number,
    prepared: Prepared
  ): Mounted => {
    slot.replaceChildren();
    const pieces = new Map<string, HTMLElement>();
    if (prepared.kind === 'flat') {
      slot.append(canvasFor(prepared.bitmap));
    } else {
      const { timeline, bitmaps } = prepared;
      timeline.layers.forEach((_, i) => {
        const own = timeline.pieces.filter((p) => p.layer === i);
        if (own.length === 0) {
          slot.append(canvasFor(bitmaps[i]));
          return;
        }
        for (const piece of own) {
          const el = canvasFor(bitmaps[i]);
          el.dataset.piece = piece.key;
          const cx = (piece.box.x + piece.box.w / 2) * k();
          const cy = (piece.box.y + piece.box.h / 2) * k();
          el.style.transformOrigin = `${cx}px ${cy}px`;
          const clip = restingClip(piece, slideSize(), k());
          if (clip) el.style.clipPath = clip;
          pieces.set(piece.key, el);
          slot.append(el);
        }
      });
    }
    return { index, prepared, pieces, step: 0, running: [], token: 0 };
  };

  // A string key: steps must not re-render (and re-mount) the slide.
  const [shown] = createResource(
    () => `${props.index}:${pixelWidth()}:${layered()}`,
    async (key) => {
      const [i, width, layers] = key
        .split(':')
        .map((v, n) => (n === 2 ? Number(v === 'true') : Number(v)));
      // Morph needs both slides' objects drawn before it can start.
      const from = mounted[active]?.index;
      const morph =
        from !== undefined && from !== i && morphInto(i)
          ? prepareMorphFor(from, i, width)
          : Promise.resolve(null);
      const [prepared, scene] = await Promise.all([
        prepare(i, width, layers === 1),
        morph,
      ]);
      return { i, prepared, morph: scene && { from, scene } };
    }
  );

  // Drawing to canvases and starting animations syncs external systems.
  createEffect(
    on(shown, (value) => {
      if (!value) return;
      morphRun?.cancel();
      morphRun = undefined;
      const previous = mounted[active];
      const changed = previous !== null && previous.index !== value.i;
      const target = changed ? 1 - active : active;
      stop(mounted[target]);
      const m = mount(slots[target], value.i, value.prepared);
      mounted[target] = m;
      const step = props.step ?? Number.POSITIVE_INFINITY;
      const appearing = previous === null || changed;
      const t = props.deck.slides[value.i]?.transition;
      const morph =
        changed && value.morph?.from === previous?.index
          ? value.morph?.scene
          : undefined;
      const frames =
        changed && props.transitions !== false && !morph
          ? transitionFrames(t?.kind ?? 'none', t?.direction)
          : null;
      const duration = frames || morph ? (t?.durationMs ?? 500) : 0;
      if (appearing && step === 0 && value.prepared.kind === 'layered') {
        // What plays as the slide appears starts after its transition.
        settleAt(m, -1);
        const token = m.token;
        setTimeout(() => {
          if (m.token === token) play(m, 0);
        }, duration);
      } else {
        settleAt(m, step);
      }
      if (changed && previous) {
        const incoming = slots[target];
        const outgoing = slots[active];
        const onTop =
          !!frames &&
          (['uncover', 'pull', 'reveal'].includes(t?.kind ?? '') ||
            (t?.kind === 'zoom' && t.direction === 'out'));
        incoming.style.zIndex = onTop ? '0' : '1';
        outgoing.style.zIndex = onTop ? '1' : '0';
        incoming.style.visibility = 'visible';
        // The Morph scene covers both slots while it plays.
        if (morph) morphRun = playMorph(wrapper, morph, k(), duration);
        const timing = { duration, easing: 'ease-in-out' };
        if (frames?.incoming) incoming.animate(frames.incoming, timing);
        if (frames) {
          const leaving = outgoing.animate(
            frames.outgoing ?? [{ opacity: 1 }, { opacity: 1 }],
            timing
          );
          leaving.onfinish = () => {
            if (mounted[1 - target] === previous) {
              outgoing.style.visibility = 'hidden';
              stop(previous);
            }
          };
        } else {
          outgoing.style.visibility = 'hidden';
          stop(previous);
        }
        active = target;
      } else {
        slots[target].style.visibility = 'visible';
      }
      if (props.preload !== undefined) {
        void prepare(props.preload, pixelWidth(), layered()).catch(() => {});
        if (props.preload !== value.i && morphInto(props.preload))
          void prepareMorphFor(value.i, props.preload, pixelWidth());
      }
      props.onShown?.(value.i);
    })
  );

  // A new step on the same slide plays its animations (or jumps there).
  let lastStep = props.step;
  createEffect(
    on(
      () => props.step,
      (step) => {
        const previousStep = lastStep;
        lastStep = step;
        const m = mounted[active];
        if (step === undefined || !m || m.index !== props.index) return;
        // A click during Morph finishes it first.
        morphRun?.finish();
        if (previousStep !== undefined && step === previousStep + 1)
          play(m, step);
        else settleAt(m, step);
      },
      { defer: true }
    )
  );

  return (
    <div
      ref={wrapper}
      class="relative overflow-hidden"
      data-testid={props.testId}
      data-slide-index={shown()?.i}
      data-step={props.step}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: `${fit().w}px`,
        height: `${fit().h}px`,
      }}
    >
      <div
        ref={(el) => {
          slots[0] = el;
        }}
        style={{ position: 'absolute', inset: '0' }}
      />
      <div
        ref={(el) => {
          slots[1] = el;
        }}
        style={{ position: 'absolute', inset: '0', visibility: 'hidden' }}
      />
      <Show when={props.screen && props.screen !== 'slide'}>
        <div
          style={{
            position: 'absolute',
            inset: '0',
            'z-index': 2,
            background: props.screen === 'black' ? 'black' : 'white',
          }}
        />
      </Show>
    </div>
  );
}
