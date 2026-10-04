/**
 * Crop mode on the stage, as in PowerPoint: the slide without the picture,
 * the whole image ghosted where the crop hides it, and the frame with
 * black crop handles at its corners and edges. Dragging a crop handle
 * crops (Shift keeps the aspect ratio, Ctrl/Alt crops both sides), dragging
 * the picture pans the image under the frame, and the round handles scale
 * the image. Enter, Esc, a click outside, or Crop again commit the crop.
 */

import type { ShapeOutline } from '@core/pptx-engine/types';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { HANDLES, type Handle, type Point } from '../core/geometry';
import {
  type CropState,
  dragCropHandle,
  lookOf,
  panCrop,
  scaleCropImage,
  slideDeltaToLocal,
} from '../core/picture';
import type { CropMode } from '../primitives/create-crop-mode';
import type { PictureImages } from '../primitives/create-picture-images';
import { BitmapCanvas } from './bitmap-canvas';
import { adjustedImageUrl } from './picture-preview';

type ImageCorner = 'nw' | 'ne' | 'se' | 'sw';
const IMAGE_CORNERS: ImageCorner[] = ['nw', 'ne', 'se', 'sw'];

type Gesture =
  | { kind: 'crop'; handle: Handle; start: CropState; at: Point }
  | { kind: 'scale'; corner: ImageCorner; start: CropState; at: Point }
  | { kind: 'pan'; start: CropState; at: Point };

/** Crop handles in CSS pixels: bar thickness, corner arm, edge bar, hit box. */
const BAR = 4;
const ARM = 14;
const EDGE = 18;
const HIT = 24;

/** One black crop handle: an L inside a corner, a bar inside an edge. */
function CropHandle(props: {
  handle: Handle;
  frame: { w: number; h: number };
}) {
  const h = () => props.handle;
  const x = () =>
    h().includes('w')
      ? 0
      : h().includes('e')
        ? props.frame.w
        : props.frame.w / 2;
  const y = () =>
    h().includes('n')
      ? 0
      : h().includes('s')
        ? props.frame.h
        : props.frame.h / 2;
  // Bars lie inside the frame: from the handle's point toward its center.
  const c = HIT / 2;
  const inX = (length: number) => (h().includes('e') ? c - length : c);
  const inY = (length: number) => (h().includes('s') ? c - length : c);
  const piece = (left: number, top: number, width: number, height: number) => (
    <span
      class="absolute block"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: '#000',
        'box-shadow': '0 0 0 1px #fff',
      }}
    />
  );
  return (
    <span
      data-crop-handle={h()}
      data-testid={`pptx-crop-handle-${h()}`}
      class="absolute block"
      style={{
        left: `${x() - c}px`,
        top: `${y() - c}px`,
        width: `${HIT}px`,
        height: `${HIT}px`,
        cursor: `${h()}-resize`,
      }}
    >
      <Show when={h() === 'n' || h() === 's'}>
        {piece(c - EDGE / 2, inY(BAR), EDGE, BAR)}
      </Show>
      <Show when={h() === 'w' || h() === 'e'}>
        {piece(inX(BAR), c - EDGE / 2, BAR, EDGE)}
      </Show>
      <Show when={h().length === 2}>
        {piece(inX(ARM), inY(BAR), ARM, BAR)}
        {piece(inX(BAR), inY(ARM), BAR, ARM)}
      </Show>
    </span>
  );
}

export function CropOverlay(props: {
  crop: CropMode;
  images: PictureImages;
  themeColors: [string, string][];
  /** CSS pixels per point. */
  scale: number;
}) {
  const crop = props.crop;
  let root!: HTMLDivElement;
  const [image, setImage] = createSignal<string>();
  let owned: string | undefined;

  /** The picture as crop mode began (its outline does not change until commit). */
  const shape = (): ShapeOutline | undefined => crop.shape();
  const state = () => crop.state();
  const s = () => props.scale;

  const loadImage = async () => {
    const picture = shape();
    if (!picture) return;
    const original = await props.images.load(picture.id);
    if (!original) return;
    const adjusted = await adjustedImageUrl(
      original.image,
      original.url,
      lookOf(picture.picture, props.themeColors)
    );
    if (adjusted.owned) owned = adjusted.url;
    setImage(adjusted.url);
  };
  onMount(() => void loadImage());
  onCleanup(() => {
    if (owned) URL.revokeObjectURL(owned);
  });

  // ---- pointer -------------------------------------------------------------

  let gesture: Gesture | null = null;
  const toSlide = (e: { clientX: number; clientY: number }): Point => {
    const r = root.getBoundingClientRect();
    return { x: (e.clientX - r.left) / s(), y: (e.clientY - r.top) / s() };
  };
  /** A slide point in the picture's local coordinates. */
  const toLocal = (p: Point): Point | undefined => {
    const f = shape();
    if (!f) return undefined;
    const d = slideDeltaToLocal(f, {
      x: p.x - (f.x + f.w / 2),
      y: p.y - (f.y + f.h / 2),
    });
    return { x: d.x + f.w / 2, y: d.y + f.h / 2 };
  };
  const inside = (
    r: { x: number; y: number; w: number; h: number },
    p: Point
  ) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const current = state();
    const at = toSlide(e);
    if (!current) return;
    const target = e.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset
      .cropHandle as Handle | undefined;
    const corner = target.closest<HTMLElement>('[data-image-handle]')?.dataset
      .imageHandle as ImageCorner | undefined;
    const local = toLocal(at);
    if (handle) gesture = { kind: 'crop', handle, start: current, at };
    else if (corner) gesture = { kind: 'scale', corner, start: current, at };
    else if (
      local &&
      (inside(current.frame, local) || inside(current.image, local))
    )
      gesture = { kind: 'pan', start: current, at };
    else {
      void crop.commit();
      return;
    }
    root.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture;
    const f = shape();
    if (!g || !f) return;
    const at = toSlide(e);
    const d = slideDeltaToLocal(f, { x: at.x - g.at.x, y: at.y - g.at.y });
    const min = 6 / s();
    crop.setState(
      g.kind === 'crop'
        ? dragCropHandle(g.start, g.handle, d, {
            keepAspect: e.shiftKey,
            symmetric: e.ctrlKey || e.altKey,
            minSize: min,
          })
        : g.kind === 'scale'
          ? scaleCropImage(g.start, g.corner, d, min)
          : panCrop(g.start, d)
    );
  };

  const onPointerUp = (e: PointerEvent) => {
    gesture = null;
    if (root.hasPointerCapture(e.pointerId))
      root.releasePointerCapture(e.pointerId);
  };

  // ---- keyboard and clicks elsewhere --------------------------------------

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!crop.active()) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void crop.commit();
        return;
      }
      if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey) {
        // Arrows move the image under the frame.
        e.preventDefault();
        e.stopPropagation();
        const current = state();
        const f = shape();
        if (!current || !f) return;
        const step = e.shiftKey ? 10 : 1;
        const d = {
          x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        };
        crop.setState(panCrop(current, slideDeltaToLocal(f, d)));
        return;
      }
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))
        void crop.commit({ refocus: false });
    };
    const onDocumentPointerDown = (e: PointerEvent) => {
      if (!crop.active()) return;
      const target = e.target as HTMLElement | null;
      if (!target || root.contains(target)) return;
      // The Crop button toggles crop mode itself.
      if (target.closest('[data-pptx-crop-toggle]')) return;
      void crop.commit({ refocus: false });
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    });
  });

  // ---- drawing -------------------------------------------------------------

  /** CSS transform from local points (as pixels) to the stage. */
  const transform = () => {
    const f = shape();
    if (!f) return undefined;
    const k = s();
    return `translate(${(f.x + f.w / 2) * k}px, ${(f.y + f.h / 2) * k}px) rotate(${f.rotation}deg) scale(${f.flipH ? -1 : 1}, ${f.flipV ? -1 : 1}) translate(${(-f.w / 2) * k}px, ${(-f.h / 2) * k}px)`;
  };
  const px = (v: number) => `${v * s()}px`;
  const box = (r: { x: number; y: number; w: number; h: number }) => ({
    left: px(r.x),
    top: px(r.y),
    width: px(r.w),
    height: px(r.h),
  });

  return (
    <div
      ref={root}
      data-testid="pptx-crop-overlay"
      class="absolute inset-0 touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Show when={image() ? crop.backdrop() : undefined}>
        {(bitmap) => (
          <BitmapCanvas
            bitmap={bitmap()}
            width={bitmap().width}
            height={bitmap().height}
            class="pointer-events-none absolute inset-0 size-full"
          />
        )}
      </Show>
      <Show when={state()}>
        {(st) => (
          <div
            class="absolute top-0 left-0 origin-top-left"
            style={{ transform: transform() }}
          >
            <Show when={image()}>
              {(url) => (
                <>
                  {/* The whole image, ghosted where the crop hides it. */}
                  <img
                    src={url()}
                    alt=""
                    draggable={false}
                    class="pointer-events-none absolute max-w-none opacity-45"
                    style={box(st().image)}
                  />
                  <div
                    class="pointer-events-none absolute overflow-hidden"
                    style={box(st().frame)}
                  >
                    <img
                      src={url()}
                      alt=""
                      draggable={false}
                      class="absolute max-w-none"
                      style={box({
                        ...st().image,
                        x: st().image.x - st().frame.x,
                        y: st().image.y - st().frame.y,
                      })}
                    />
                  </div>
                </>
              )}
            </Show>
            {/* The image's bounds and its sizing handles. */}
            <div
              class="pointer-events-none absolute border border-[#7f7f7f] border-dashed"
              style={box(st().image)}
            />
            <For each={IMAGE_CORNERS}>
              {(corner) => (
                <span
                  data-image-handle={corner}
                  data-testid={`pptx-crop-image-handle-${corner}`}
                  class="absolute block size-2.5 rounded-full border border-[#5f5f5f] bg-[#fff]"
                  style={{
                    left: `${(st().image.x + (corner.includes('e') ? st().image.w : 0)) * s() - 5}px`,
                    top: `${(st().image.y + (corner.includes('s') ? st().image.h : 0)) * s() - 5}px`,
                    cursor: `${corner}-resize`,
                  }}
                />
              )}
            </For>
            {/* The frame and its crop handles. */}
            <div
              data-testid="pptx-crop-frame"
              class="absolute cursor-move outline outline-1 outline-[#000]"
              style={box(st().frame)}
            >
              <For each={HANDLES}>
                {(handle) => (
                  <CropHandle
                    handle={handle}
                    frame={{ w: st().frame.w * s(), h: st().frame.h * s() }}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
