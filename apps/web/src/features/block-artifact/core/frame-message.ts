/** The only message an artifact page may send its host. */
export type ArtifactFrameMessage = { type: 'size'; height: number };

export type ArtifactTheme = 'light' | 'dark';

/** Taller pages scroll inside the frame. */
export const MAX_FRAME_HEIGHT = 20_000;

const SIZE_MESSAGE = 'macro-artifact:size';
const THEME_MESSAGE = 'macro-artifact:theme';

/**
 * Reads a `message` event from an artifact frame. Only events from that
 * frame's window and its exact origin count, and only the size message.
 */
export function readFrameMessage(
  event: { origin: string; source: unknown; data: unknown },
  frame: { origin: string; window: unknown }
): ArtifactFrameMessage | undefined {
  if (!frame.window || event.source !== frame.window) return undefined;
  if (event.origin !== frame.origin) return undefined;

  const data = event.data;
  if (!data || typeof data !== 'object') return undefined;
  if (!('type' in data) || data.type !== SIZE_MESSAGE) return undefined;
  if (!('height' in data) || typeof data.height !== 'number') return undefined;
  if (!Number.isFinite(data.height) || data.height < 0) return undefined;

  return {
    type: 'size',
    height: Math.min(Math.ceil(data.height), MAX_FRAME_HEIGHT),
  };
}

/** What the host posts to the frame when the app's theme changes. */
export function themeMessage(theme: ArtifactTheme) {
  return { type: THEME_MESSAGE, theme };
}
