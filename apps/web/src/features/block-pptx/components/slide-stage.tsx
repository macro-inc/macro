/**
 * The slide as pixels: the rendered bitmap, or a backdrop plus the shape
 * being dragged or edited as its own layer.
 */

import { createEffect, type JSX } from 'solid-js';
import type { StageImages } from '../primitives/create-slide-editor';

export function SlideStage(props: {
  images: StageImages;
  /** CSS size of the slide. */
  cssWidth: number;
  cssHeight: number;
  /** Backing-store width in pixels. */
  pixelWidth: number;
  /** Device pixels per point. */
  pixelsPerPoint: number;
  children?: JSX.Element;
}) {
  let canvas!: HTMLCanvasElement;
  // Painting is a DOM side effect of the images changing.
  createEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = Math.max(1, Math.round(props.pixelWidth));
    const height = Math.max(
      1,
      Math.round(
        (props.pixelWidth * props.cssHeight) / Math.max(1, props.cssWidth)
      )
    );
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const { base, backdrop, layer, layerOffset } = props.images;
    ctx.imageSmoothingQuality = 'high';
    if (backdrop && layer) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(backdrop, 0, 0, width, height);
      const dx = layerOffset.x * props.pixelsPerPoint;
      const dy = layerOffset.y * props.pixelsPerPoint;
      ctx.drawImage(layer, dx, dy, width, height);
    } else if (base) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(base, 0, 0, width, height);
    }
  });
  return (
    <div
      class="relative shrink-0 bg-panel shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
      style={{ width: `${props.cssWidth}px`, height: `${props.cssHeight}px` }}
    >
      <canvas
        ref={canvas}
        data-testid="pptx-slide-canvas"
        class="absolute inset-0 size-full"
      />
      {props.children}
    </div>
  );
}
