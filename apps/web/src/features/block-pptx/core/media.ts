/**
 * Video and audio shapes: which files Insert ▸ Video/Audio takes, the MIME
 * type of an embedded clip, where a new clip goes, and which shapes on a
 * slide play.
 */

import type {
  MediaOutline,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';

/** The largest clip the engine embeds (its `MAX_MEDIA_BYTES`). */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
/**
 * The largest clip in a shared presentation: the sync service keeps whole
 * presentations under 4 MB, so clips must stay small there.
 */
export const SHARED_MEDIA_BYTES = 2 * 1024 * 1024;

const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

/** File inputs' `accept` for each kind. */
export const ACCEPT = {
  video: '.mp4,.m4v,.mov,.webm,.wmv,.avi,video/mp4,video/quicktime,video/webm',
  audio: '.mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/wav,audio/ogg',
} as const;

const extOf = (name: string) =>
  name.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';

/** The MIME type of an embedded clip, from its part name. */
export function mimeOf(part: string): string {
  return TYPES[extOf(part)] ?? 'application/octet-stream';
}

/**
 * The MIME type the engine stores a picked file as, or an error message.
 * Browsers leave `type` empty for some files (`.m4a`, `.wmv`), so the
 * extension decides then.
 */
export function mediaType(
  file: { name: string; type: string; size: number },
  kind: 'video' | 'audio',
  shared = false
): { type: string } | { error: string } {
  const type = TYPES[extOf(file.name)] ?? file.type;
  if (!type.startsWith(`${kind}/`) || !Object.values(TYPES).includes(type))
    return {
      error:
        kind === 'video'
          ? 'Choose an MP4, MOV, M4V, WebM, WMV, or AVI video.'
          : 'Choose an MP3, M4A, WAV, or OGG audio file.',
    };
  const limit = shared ? SHARED_MEDIA_BYTES : MAX_MEDIA_BYTES;
  if (file.size === 0 || file.size > limit)
    return {
      error: shared
        ? `In a shared presentation, clips can be up to ${limit / (1024 * 1024)} MB.`
        : `Media files can be up to ${limit / (1024 * 1024)} MB.`,
    };
  return { type };
}

/** Where a new clip goes: its natural size, shrunk to fit, centered. */
export function mediaBox(
  natural: { w: number; h: number },
  slide: { w: number; h: number },
  fill = 0.6
) {
  const scale = Math.min(
    1,
    (slide.w * fill) / natural.w,
    (slide.h * fill) / natural.h
  );
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: (slide.w - w) / 2, y: (slide.h - h) / 2, w, h };
}

/** Linked clips play only from web addresses. */
export function playableUrl(url: string | undefined): string | undefined {
  return url && /^https:\/\//i.test(url.trim()) ? url.trim() : undefined;
}

export interface MediaShape {
  shape: ShapeOutline;
  media: MediaOutline;
}

/** The video and audio shapes of a slide (groups searched), bottom first. */
export function mediaShapes(slide: SlideOutline | undefined): MediaShape[] {
  const out: MediaShape[] = [];
  const walk = (shapes: ShapeOutline[]) => {
    for (const shape of shapes) {
      if (shape.hidden) continue;
      if (shape.media) out.push({ shape, media: shape.media });
      if (shape.children) walk(shape.children);
    }
  };
  walk(slide?.shapes ?? []);
  return out;
}

/** `m:ss` (or `h:mm:ss`) for a playback position in seconds. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
