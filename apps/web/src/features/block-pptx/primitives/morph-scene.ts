/**
 * Plays the Morph transition: both slides' backgrounds cross-fade while
 * each object shared by the two slides glides, grows, and turns from its
 * old place to its new one, objects only on the first slide fade out, and
 * objects only on the second fade in. Every object is a separately
 * rendered sprite (`renderLayer(…, 'only', id)`) cropped to its box.
 */

import type { DeckOutline, ShapeOutline } from '@core/pptx-engine/types';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { morphFrames, morphPlan, spriteRect, textOnly } from '../core/morph';
import type { Rect } from '../core/selection';

/** One object drawn on its own, cropped to `rect` (slide points). */
interface Sprite {
  shape: ShapeOutline;
  bitmap: ImageBitmap;
  rect: Rect;
}

/** What one layer of the scene does, back to front. */
type Item =
  | { kind: 'leave'; sprite: Sprite }
  | { kind: 'enter'; sprite: Sprite }
  | {
      kind: 'pair';
      from: ShapeOutline;
      to: ShapeOutline;
      a?: Sprite;
      b?: Sprite;
    };

export interface MorphScene {
  /** The two slides' backgrounds and inherited (master and layout) shapes. */
  backdrops: [ImageBitmap, ImageBitmap];
  items: Item[];
  pairs: number;
}

/** Above this many objects Morph falls back to a fade. */
const MAX_SPRITES = 80;

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

  const sprite = async (
    index: number,
    shape: ShapeOutline
  ): Promise<Sprite | undefined> => {
    const rect = spriteRect(shape, slide);
    if (!rect) return undefined;
    const full = await engine.renderLayer(index, width, 'only', shape.id);
    try {
      const sx = Math.floor(rect.x * scale);
      const sy = Math.floor(rect.y * scale);
      const sw =
        Math.min(full.width, Math.ceil((rect.x + rect.w) * scale)) - sx;
      const sh =
        Math.min(full.height, Math.ceil((rect.y + rect.h) * scale)) - sy;
      if (sw <= 0 || sh <= 0) return undefined;
      const bitmap = await createImageBitmap(full, sx, sy, sw, sh);
      return {
        shape,
        bitmap,
        rect: { x: sx / scale, y: sy / scale, w: sw / scale, h: sh / scale },
      };
    } finally {
      full.close();
    }
  };

  const [backA, backB] = await Promise.all([
    renderSpan(from, width, 0, 0, true),
    renderSpan(to, width, 0, 0, true),
  ]);
  const leaving = await Promise.all(plan.leaving.map((s) => sprite(from, s)));
  const pairs = await Promise.all(
    plan.pairs.map(async (p) => ({
      ...p,
      a: await sprite(from, p.from),
      b: await sprite(to, p.to),
    }))
  );
  const entering = await Promise.all(plan.entering.map((s) => sprite(to, s)));

  const items: Item[] = [];
  for (const s of leaving) if (s) items.push({ kind: 'leave', sprite: s });
  // The second slide's stacking order decides what passes over what.
  for (const shape of b.shapes) {
    const pair = pairs.find((p) => p.to === shape);
    if (pair) items.push({ kind: 'pair', ...pair });
    const i = plan.entering.indexOf(shape);
    const s = i >= 0 ? entering[i] : undefined;
    if (s) items.push({ kind: 'enter', sprite: s });
  }
  return { backdrops: [backA, backB], items, pairs: pairs.length };
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
  /** A sprite placed where its shape sits, turning about the shape's center. */
  const spriteOf = (s: Sprite) => {
    const el = canvasOf(s.bitmap, s.rect);
    const cx = s.shape.x + s.shape.w / 2 - s.rect.x;
    const cy = s.shape.y + s.shape.h / 2 - s.rect.y;
    el.style.transformOrigin = `${cx * k}px ${cy * k}px`;
    el.dataset.shape = String(s.shape.id);
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
      const keepSize = textOnly(item.from) && textOnly(item.to);
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
