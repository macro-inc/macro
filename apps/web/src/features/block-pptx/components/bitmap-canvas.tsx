import { createEffect, type JSX, splitProps } from 'solid-js';

/** Draws an `ImageBitmap` into a canvas that fills its box. */
export function BitmapCanvas(
  props: {
    bitmap?: ImageBitmap;
    /** Backing-store size in pixels. */
    width: number;
    height: number;
  } & Omit<JSX.CanvasHTMLAttributes<HTMLCanvasElement>, 'width' | 'height'>
) {
  const [local, rest] = splitProps(props, ['bitmap', 'width', 'height']);
  let canvas!: HTMLCanvasElement;
  // Drawing into the canvas is a DOM side effect of the bitmap changing.
  createEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = Math.max(1, Math.round(local.width));
    canvas.height = Math.max(1, Math.round(local.height));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (local.bitmap) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(local.bitmap, 0, 0, canvas.width, canvas.height);
    }
  });
  return <canvas ref={canvas} {...rest} />;
}
