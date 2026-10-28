/**
 * Plays the Morph transition: both slides' backgrounds cross-fade while
 * each object shared by the two slides glides, grows, and turns from its
 * old place to its new one, objects only on the first slide fade out, and
 * objects only on the second fade in. Every object is a separately
 * rendered sprite (`renderLayer(…, 'only', id)`) cropped to its box; with
 * the Words or Characters option, text-only boxes are cut into one sprite
 * per word or letter, cropped along their caret stops.
 */

import type {
  DeckOutline,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import type { PresentationEngine } from '../context/pptx-editor-context';
import type { Point } from '../core/geometry';
import {
  matchUnits,
  morphFrames,
  morphPlan,
  spriteRect,
  type TextUnit,
  textOnly,
  textUnits,
} from '../core/morph';
import type { Rect } from '../core/selection';

/** Part of a slide drawn on its own, cropped to `rect` (slide points). */
interface Sprite {
  bitmap: ImageBitmap;
  rect: Rect;
  /** What it turns and scales about, in slide points. */
  origin: Point;
  /** The shape it shows, and the word or letter of its text (for tests). */
  label: { shape: number; unit?: string };
}

/** A place, size, and turn a sprite travels from or to. */
type Place = Pick<
  ShapeOutline,
  'x' | 'y' | 'w' | 'h' | 'rotation' | 'flipH' | 'flipV'
>;

/** What one layer of the scene does, back to front. */
type Item =
  | { kind: 'leave'; sprite: Sprite }
  | { kind: 'enter'; sprite: Sprite }
  | {
      kind: 'pair';
      from: Place;
      to: Place;
      /** Moves and turns without stretching (text keeps its size). */
      keepSize: boolean;
      a?: Sprite;
      b?: Sprite;
    };

export interface MorphScene {
  /** The two slides' backgrounds and inherited (master and layout) shapes. */
  backdrops: [ImageBitmap, ImageBitmap];
  items: Item[];
  /** Objects matched across the slides. */
  pairs: number;
  /** Words or letters matched across the slides. */
  units: number;
}

/** Above this many objects Morph falls back to a fade. */
const MAX_SPRITES = 80;
/** Above this many words or letters a text box morphs as one object. */
const MAX_UNITS = 400;

/** Shapes an animation hides when a slide is left (exits) or entered (entrances). */
function heldBack(
  animations: { shapeId: number; class: string }[] | undefined,
  at: 'start' | 'end'
): Set<number> {
  const out = new Set<number>();
  const list = animations ?? [];
  for (const id of new Set(list.map((a) => a.shapeId))) {
    const own = list.filter((a) => a.shapeId === id);
    const edge = at === 'start' ? own[0] : own[own.length - 1];
    if (edge?.class === (at === 'start' ? 'entrance' : 'exit')) out.add(id);
  }
  return out;
}

/** How the Morph into `slide` treats text (`byObject` = as whole objects). */
function unitsOf(slide: SlideOutline): 'word' | 'char' | undefined {
  const option = slide.transition?.direction;
  return option === 'byWord'
    ? 'word'
    : option === 'byChar'
      ? 'char'
      : undefined;
}

const upright = (s: Place) => s.rotation === 0 && !s.flipH && !s.flipV;
const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const placeOf = (r: Rect): Place => ({
  ...r,
  rotation: 0,
  flipH: false,
  flipV: false,
});

/**
 * Renders what Morph needs to go from slide `from` to slide `to` at `width`
 * pixels, or `null` when the engine cannot draw layers (or there is too
 * much to animate) and a fade should play instead.
 */
export async function prepareMorph(
  engine: PresentationEngine,
  deck: DeckOutline,
  from: number,
  to: number,
  width: number
): Promise<MorphScene | null> {
  const a = deck.slides[from];
  const b = deck.slides[to];
  const renderSpan = engine.renderSpan;
  if (!a || !b || !renderSpan) return null;
  const plan = morphPlan(
    a,
    b,
    heldBack(a.animations, 'end'),
    heldBack(b.animations, 'start')
  );
  const count =
    plan.pairs.length * 2 + plan.leaving.length + plan.entering.length;
  if (count > MAX_SPRITES) return null;
  const slide = { w: deck.width, h: deck.height };
  const scale = width / deck.width;
  const by = unitsOf(b);

  /** Crops `rect` (slide points) out of a slide-sized render. */
  const crop = async (
    full: ImageBitmap,
    rect: Rect,
    origin: Point,
    label: Sprite['label']
  ): Promise<Sprite | undefined> => {
    const sx = Math.max(0, Math.floor(rect.x * scale));
    const sy = Math.max(0, Math.floor(rect.y * scale));
    const sw = Math.min(full.width, Math.ceil((rect.x + rect.w) * scale)) - sx;
    const sh = Math.min(full.height, Math.ceil((rect.y + rect.h) * scale)) - sy;
    if (sw <= 0 || sh <= 0) return undefined;
    return {
      bitmap: await createImageBitmap(full, sx, sy, sw, sh),
      rect: { x: sx / scale, y: sy / scale, w: sw / scale, h: sh / scale },
      origin,
      label,
    };
  };
  /** Draws `shape` alone and lets `use` crop it. */
  const withRender = async <T>(
    index: number,
    shape: ShapeOutline,
    use: (full: ImageBitmap) => Promise<T>
  ): Promise<T> => {
    const full = await engine.renderLayer(index, width, 'only', shape.id);
    try {
      return await use(full);
    } finally {
      full.close();
    }
  };
  const sprite = (index: number, shape: ShapeOutline) => {
    const rect = spriteRect(shape, slide);
    if (!rect) return Promise.resolve(undefined);
    return withRender(index, shape, (full) =>
      crop(full, rect, center(shape), { shape: shape.id })
    );
  };
  /** A word's or letter's sprite, with room for ascenders and descenders. */
  const unitSprite = (full: ImageBitmap, shape: number, unit: TextUnit) => {
    const padX = by === 'word' ? unit.rect.h * 0.1 : 0;
    const padY = unit.rect.h * 0.12;
    const rect = {
      x: unit.rect.x - padX,
      y: unit.rect.y - padY,
      w: unit.rect.w + 2 * padX,
      h: unit.rect.h + 2 * padY,
    };
    return crop(full, rect, center(unit.rect), { shape, unit: unit.text });
  };

  let units = 0;
  /** A text-only pair morphed word by word (or letter by letter), if it can be. */
  const textItems = async (
    pair: (typeof plan.pairs)[number]
  ): Promise<Item[] | undefined> => {
    if (
      !by ||
      !textOnly(pair.from) ||
      !textOnly(pair.to) ||
      !upright(pair.from) ||
      !upright(pair.to)
    )
      return undefined;
    const [la, lb] = await Promise.all([
      engine.textLayout(from, pair.from.id).catch(() => null),
      engine.textLayout(to, pair.to.id).catch(() => null),
    ]);
    if (!la || !lb) return undefined;
    const ua = textUnits(la, by);
    const ub = textUnits(lb, by);
    if (ua.length + ub.length > MAX_UNITS) return undefined;
    const match = matchUnits(ua, ub);
    units += match.pairs.length;
    const sa = await withRender(from, pair.from, (full) =>
      Promise.all(ua.map((u) => unitSprite(full, pair.from.id, u)))
    );
    const sb = await withRender(to, pair.to, (full) =>
      Promise.all(ub.map((u) => unitSprite(full, pair.to.id, u)))
    );
    const items: Item[] = [];
    for (const i of match.leaving) {
      const s = sa[i];
      if (s) items.push({ kind: 'leave', sprite: s });
    }
    for (const [i, j] of match.pairs)
      items.push({
        kind: 'pair',
        from: placeOf(ua[i].rect),
        to: placeOf(ub[j].rect),
        keepSize: false,
        a: sa[i],
        b: sb[j],
      });
    for (const j of match.entering) {
      const s = sb[j];
      if (s) items.push({ kind: 'enter', sprite: s });
    }
    return items;
  };

  const [backA, backB] = await Promise.all([
    renderSpan(from, width, 0, 0, true),
    renderSpan(to, width, 0, 0, true),
  ]);
  const leaving = await Promise.all(plan.leaving.map((s) => sprite(from, s)));
  const pairs = await Promise.all(
    plan.pairs.map(async (p): Promise<Item[]> => {
      const words = await textItems(p);
      if (words) return words;
      return [
        {
          kind: 'pair',
          from: p.from,
          to: p.to,
          keepSize: textOnly(p.from) && textOnly(p.to),
          a: await sprite(from, p.from),
          b: await sprite(to, p.to),
        },
      ];
    })
  );
  const entering = await Promise.all(plan.entering.map((s) => sprite(to, s)));

  const items: Item[] = [];
  for (const s of leaving) if (s) items.push({ kind: 'leave', sprite: s });
  // The second slide's stacking order decides what passes over what.
  for (const shape of b.shapes) {
    const p = plan.pairs.findIndex((pair) => pair.to === shape);
    if (p >= 0) items.push(...pairs[p]);
    const i = plan.entering.indexOf(shape);
    const s = i >= 0 ? entering[i] : undefined;
    if (s) items.push({ kind: 'enter', sprite: s });
  }
  return {
    backdrops: [backA, backB],
    items,
    pairs: plan.pairs.length,
    units,
  };
}

/** Frees a scene's images. */
export function closeMorph(scene: MorphScene) {
  for (const b of scene.backdrops) b.close();
  for (const item of scene.items) {
    if (item.kind === 'pair') {
      item.a?.bitmap.close();
      item.b?.bitmap.close();
    } else item.sprite.bitmap.close();
  }
}

export interface MorphRun {
  /** Jumps to the end (a click during the transition). */
  finish: () => void;
  /** Removes the scene at once. */
  cancel: () => void;
}

/**
 * Plays `scene` over `container` (whose slide is `k` CSS pixels per point)
 * for `duration` ms, then removes it and calls `onDone`.
 */
export function playMorph(
  container: HTMLElement,
  scene: MorphScene,
  k: number,
  duration: number,
  onDone?: () => void
): MorphRun {
  const doc = container.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.dataset.testid = 'pptx-morph';
  overlay.dataset.pairs = String(scene.pairs);
  overlay.dataset.units = String(scene.units);
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',
    overflow: 'hidden',
    pointerEvents: 'none',
  });

  const canvasOf = (bitmap: ImageBitmap, rect?: Rect) => {
    const canvas = doc.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    Object.assign(
      canvas.style,
      rect
        ? {
            position: 'absolute',
            left: `${rect.x * k}px`,
            top: `${rect.y * k}px`,
            width: `${rect.w * k}px`,
            height: `${rect.h * k}px`,
          }
        : { position: 'absolute', inset: '0', width: '100%', height: '100%' }
    );
    overlay.append(canvas);
    return canvas;
  };
  /** A sprite placed where it was drawn, turning about its origin. */
  const spriteOf = (s: Sprite) => {
    const el = canvasOf(s.bitmap, s.rect);
    const cx = s.origin.x - s.rect.x;
    const cy = s.origin.y - s.rect.y;
    el.style.transformOrigin = `${cx * k}px ${cy * k}px`;
    el.dataset.shape = String(s.label.shape);
    if (s.label.unit !== undefined) el.dataset.unit = s.label.unit;
    return el;
  };

  const running: Animation[] = [];
  const timing: KeyframeAnimationOptions = {
    duration,
    easing: 'ease-in-out',
    fill: 'both',
  };
  const animate = (el: HTMLElement, frames: Keyframe[]) =>
    running.push(el.animate(frames, timing));
  const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

  canvasOf(scene.backdrops[0]);
  animate(canvasOf(scene.backdrops[1]), fadeIn);
  for (const item of scene.items) {
    if (item.kind === 'leave') {
      animate(spriteOf(item.sprite), [
        { opacity: 1 },
        { opacity: 0, offset: 0.5 },
        { opacity: 0 },
      ]);
    } else if (item.kind === 'enter') {
      animate(spriteOf(item.sprite), [
        { opacity: 0 },
        { opacity: 0, offset: 0.5 },
        { opacity: 1 },
      ]);
    } else {
      // The old look stays opaque under the new one fading in, so the
      // object never thins out, then gives way at the end.
      const both = !!item.a && !!item.b;
      const keepSize = item.keepSize;
      if (item.a) {
        const el = spriteOf(item.a);
        el.dataset.morph = 'from';
        const [start, end] = morphFrames(item.from, item.to, k, keepSize);
        animate(el, [{ transform: start }, { transform: end }]);
        if (both)
          animate(el, [
            { opacity: 1 },
            { opacity: 1, offset: 0.8 },
            { opacity: 0 },
          ]);
      }
      if (item.b) {
        const el = spriteOf(item.b);
        el.dataset.morph = 'to';
        const [end, start] = morphFrames(item.to, item.from, k, keepSize);
        animate(el, [{ transform: start }, { transform: end }]);
        if (both)
          animate(el, [
            { opacity: 0 },
            { opacity: 1, offset: 0.8 },
            { opacity: 1 },
          ]);
      }
    }
  }
  container.append(overlay);

  let over = false;
  const end = (done: boolean) => {
    if (over) return;
    over = true;
    for (const a of running) a.cancel();
    if (done) onDone?.();
    overlay.remove();
  };
  void Promise.all(running.map((a) => a.finished))
    .then(() => end(true))
    .catch(() => {});
  return { finish: () => end(true), cancel: () => end(false) };
}
