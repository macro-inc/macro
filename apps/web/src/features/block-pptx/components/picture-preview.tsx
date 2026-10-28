/**
 * A picture drawn the way the engine would show it with some adjustments:
 * its original image, cropped, with brightness and contrast, recolor, and
 * transparency applied. Used for the Picture Format galleries' previews
 * and crop mode.
 */

import type { CropOutline } from '@core/pptx-engine/types';
import { createEffect, type JSX } from 'solid-js';
import { adjustPixels, type PictureLook } from '../core/picture';

const identity = (look: PictureLook) =>
  look.brightness === 0 &&
  look.contrast === 0 &&
  !look.recolor &&
  look.transparency === 0;

/** A checkerboard showing transparency through what is drawn on it. */
export const CHECKERBOARD: JSX.CSSProperties = {
  'background-color': '#fff',
  'background-image':
    'linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)',
  'background-size': '8px 8px',
  'background-position': '0 0, 0 4px, 4px -4px, -4px 0',
};

/**
 * Draws the picture into a canvas `width`×`height` CSS pixels, the frame
 * (aspect `aspect`) fitted inside and centered.
 */
export function PicturePreview(props: {
  image: HTMLImageElement | null | undefined;
  crop: CropOutline;
  look: PictureLook;
  /** The frame's width / height. */
  aspect: number;
  width: number;
  height: number;
  class?: string;
  style?: JSX.CSSProperties;
}) {
  let canvas!: HTMLCanvasElement;
  // Drawing into the canvas is a DOM side effect of the inputs changing.
  createEffect(() => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(props.width * dpr));
    const H = Math.max(1, Math.round(props.height * dpr));
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const fit = Math.min(W / props.aspect, H);
    const dw = Math.max(1, Math.round(fit * props.aspect));
    const dh = Math.max(1, Math.round(fit));
    const dx = Math.round((W - dw) / 2);
    const dy = Math.round((H - dh) / 2);
    const image = props.image;
    if (!image) {
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(dx, dy, dw, dh);
      return;
    }
    const { left, top, right, bottom } = props.crop;
    const fullW = dw / Math.max(1e-6, 1 - left - right);
    const fullH = dh / Math.max(1e-6, 1 - top - bottom);
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, dx - left * fullW, dy - top * fullH, fullW, fullH);
    ctx.restore();
    if (identity(props.look)) return;
    try {
      const pixels = ctx.getImageData(dx, dy, dw, dh);
      adjustPixels(pixels.data, props.look);
      ctx.putImageData(pixels, dx, dy);
    } catch {
      // An image the canvas may not read back shows unadjusted.
    }
  });
  return (
    <canvas
      ref={canvas}
      class={props.class}
      style={{
        width: `${props.width}px`,
        height: `${props.height}px`,
        ...props.style,
      }}
    />
  );
}

/**
 * The whole image with `look` applied, as a URL, at most `maxSide` pixels
 * on a side. `owned` URLs are the caller's to revoke.
 */
export async function adjustedImageUrl(
  image: HTMLImageElement,
  url: string,
  look: PictureLook,
  maxSide = 2048
): Promise<{ url: string; owned: boolean }> {
  if (identity(look)) return { url, owned: false };
  const scale = Math.min(
    1,
    maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1)
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { url, owned: false };
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    adjustPixels(pixels.data, look);
    ctx.putImageData(pixels, 0, 0);
  } catch {
    return { url, owned: false };
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  return blob
    ? { url: URL.createObjectURL(blob), owned: true }
    : { url, owned: false };
}
