/**
 * Screen capture in the macOS desktop app.
 *
 * Chromium runs there without a screen picker and refuses
 * `getDisplayMedia()`. The app lists sources natively, shows its own picker,
 * arms a one-shot native grant, and opens the chosen source with Chromium's
 * desktop `getUserMedia()` constraints.
 */
import { isTauri } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';
import { errAsync, ResultAsync } from 'neverthrow';

export type ScreenCaptureSource = {
  /** Chromium's desktop media id, e.g. `screen:1:0` or `window:42:0`. */
  id: string;
  kind: 'screen' | 'window';
  /** The window title, when macOS exposes it. */
  name: string | null;
  appName: string | null;
  builtin: boolean;
};

export type ScreenCaptureSources = {
  /** Whether macOS Screen Recording access is granted. */
  hasAccess: boolean;
  sources: ScreenCaptureSource[];
};

export type ListScreenCaptureSourcesError =
  | { kind: 'unsupported' }
  | { kind: 'native'; error: unknown };

const LIST_COMMAND = 'list_screen_capture_sources';

/**
 * Lists the screens and windows the user can share. `unsupported` outside the
 * macOS app, and on native builds from before the picker shipped.
 */
export function listScreenCaptureSources(): ResultAsync<
  ScreenCaptureSources,
  ListScreenCaptureSourcesError
> {
  if (!isTauri()) return errAsync({ kind: 'unsupported' });
  return ResultAsync.fromPromise(
    invoke<ScreenCaptureSources>(LIST_COMMAND),
    (error): ListScreenCaptureSourcesError =>
      error === `Command ${LIST_COMMAND} not found`
        ? { kind: 'unsupported' }
        : { kind: 'native', error }
  );
}

/** Shows the macOS Screen Recording prompt the first time it is asked. */
export function requestScreenCaptureAccess(): Promise<boolean> {
  return invoke<boolean>('request_screen_capture_access');
}

/**
 * Chromium's desktop capture constraints, which the DOM types don't describe:
 * `mandatory` predates the standard constraint syntax.
 */
function desktopCaptureConstraints(sourceId: string): MediaStreamConstraints {
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: 30,
      },
    },
  };
  return constraints as unknown as MediaStreamConstraints;
}

/** Opens a video track of the source the user picked. */
export async function captureScreenSource(
  sourceId: string
): Promise<MediaStreamTrack> {
  await invoke('allow_screen_capture');
  const stream = await navigator.mediaDevices.getUserMedia(
    desktopCaptureConstraints(sourceId)
  );
  const [track] = stream.getVideoTracks();
  if (!track) throw new Error('Screen capture returned no video track');
  return track;
}
