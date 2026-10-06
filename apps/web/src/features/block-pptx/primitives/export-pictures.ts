/**
 * Slides and shapes as picture files: renders from the engine drawn onto a
 * canvas and encoded as PNG or JPEG (JPEG over white, as it has no
 * transparency).
 */

import type { ShapeOutline } from '@core/pptx-engine/types';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { cropBox, type ImageFormat } from '../core/export-images';
import { boxOf } from '../core/geometry';
import { unionBounds } from '../core/selection';

async function encode(
  bitmap: ImageBitmap,
  format: ImageFormat,
  crop?: { x: number; y: number; w: number; h: number }
): Promise<Uint8Array> {
  const area = crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const canvas = document.createElement('canvas');
  canvas.width = area.w;
  canvas.height = area.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, area.w, area.h);
  }
  ctx.drawImage(bitmap, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', 0.92)
  );
  if (!blob) throw new Error('The picture could not be encoded.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Slide `index` as a picture `width` pixels wide. */
export async function slidePicture(
  engine: PresentationEngine,
  index: number,
  width: number,
  format: ImageFormat
): Promise<Uint8Array> {
  const bitmap = await engine.render(index, width);
  try {
    return await encode(bitmap, format);
  } finally {
    bitmap.close();
  }
}

/**
 * Shapes of slide `index` alone, cropped to their bounds, at `scale`
 * pixels per point (Save as Picture).
 */
export async function shapePicture(
  engine: PresentationEngine,
  index: number,
  slideWidth: number,
  shape: ShapeOutline,
  scale = 2
): Promise<Uint8Array> {
  const bounds = unionBounds([boxOf(shape)]);
  if (!bounds) throw new Error('The shape has no size.');
  const width = Math.round(slideWidth * scale);
  const bitmap = await engine.renderLayer(index, width, 'only', shape.id);
  try {
    const k = bitmap.width / slideWidth;
    return await encode(
      bitmap,
      'png',
      cropBox(bounds, k, { w: bitmap.width, h: bitmap.height })
    );
  } finally {
    bitmap.close();
  }
}
