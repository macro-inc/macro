/**
 * The original images of pictures, for crop mode and the adjustment
 * galleries' previews. The engine has no call for a picture's image, but a
 * clipboard copy of the picture carries its image part; each image is
 * decoded once.
 */

import type { PresentationEngine } from '../context/pptx-editor-context';
import { pictureImagePart } from '../core/picture';
import type { PresentationSession } from './create-presentation-session';

export interface PictureImage {
  /** The decoded original image (crop and adjustments not applied). */
  image: HTMLImageElement;
  /** An object URL of it. */
  url: string;
}

export interface PictureImages {
  /**
   * The original image of a picture on the current slide; `null` when it
   * can't be read or the browser can't draw its format (EMF, TIFF...).
   */
  load: (shape: number) => Promise<PictureImage | null>;
}

/** Decoded images kept, oldest dropped first. */
const KEEP = 8;

async function decode(part: {
  contentType: string;
  data: string;
}): Promise<PictureImage | null> {
  try {
    const binary = atob(part.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: part.contentType })
    );
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
    return { image, url };
  } catch {
    return null;
  }
}

async function release(entry: Promise<PictureImage | null>) {
  const old = await entry;
  if (old) URL.revokeObjectURL(old.url);
}

export function createPictureImages(options: {
  engine: PresentationEngine;
  session: PresentationSession;
}): PictureImages {
  const { engine, session } = options;
  const decoded = new Map<string, Promise<PictureImage | null>>();

  const load = async (shape: number) => {
    let payload: string;
    try {
      payload = await engine.copyShapes(session.slideIndex(), [shape]);
    } catch {
      return null;
    }
    const part = pictureImagePart(payload);
    if (!part) return null;
    // Same bytes, same image: a cheap fingerprint of the base64.
    const key = `${part.contentType}:${part.data.length}:${part.data.slice(0, 96)}:${part.data.slice(-96)}`;
    let entry = decoded.get(key);
    if (!entry) {
      entry = decode(part);
      decoded.set(key, entry);
      if (decoded.size > KEEP) {
        const [oldest, value] = decoded.entries().next().value as [
          string,
          Promise<PictureImage | null>,
        ];
        decoded.delete(oldest);
        void release(value);
      }
    }
    return entry;
  };

  return { load };
}
