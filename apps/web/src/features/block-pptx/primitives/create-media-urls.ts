/**
 * Playable addresses for a deck's clips: embedded clips are read from the
 * engine once each and served as object URLs (revoked with the owner);
 * linked clips play from their https address.
 */

import type { MediaOutline } from '@core/pptx-engine/types';
import { onCleanup } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { mimeOf, playableUrl } from '../core/media';

export function createMediaUrls(engine: PresentationEngine) {
  const urls = new Map<string, Promise<string | undefined>>();
  const made: string[] = [];
  onCleanup(() => {
    for (const url of made) URL.revokeObjectURL(url);
  });

  const read = async (part: string) => {
    const bytes = await engine.mediaBytes?.(part);
    if (!bytes) return undefined;
    const url = URL.createObjectURL(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeOf(part) })
    );
    made.push(url);
    return url;
  };

  /** Reads a clip; a failed read is forgotten, so the next request retries. */
  const readOrForget = async (part: string) => {
    try {
      return await read(part);
    } catch {
      urls.delete(part);
      return undefined;
    }
  };

  /** The address to play `media` from, if it can be played here. */
  const urlOf = (media: MediaOutline): Promise<string | undefined> => {
    if (!media.part) return Promise.resolve(playableUrl(media.url));
    const part = media.part;
    let url = urls.get(part);
    if (!url) {
      url = readOrForget(part);
      urls.set(part, url);
    }
    return url;
  };

  return { urlOf };
}

export type MediaUrls = ReturnType<typeof createMediaUrls>;
