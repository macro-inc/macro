import type { BackgroundEffect } from '@core/media/background-effect';
import { readBackgroundImage } from '@core/media/read-background-image';
import { rememberRecentBackgroundImage } from '@core/media/recent-background-state';
import { fireAndForget } from '@core/util/fireAndForget';
import { createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CallState } from '../CallContext';
import { LK_TRACK_SOURCE } from '../livekit-loader';

export type CallMediaControlsState = Pick<
  CallState,
  | 'isConnecting'
  | 'isAudioMuted'
  | 'isVideoMuted'
  | 'isScreenSharing'
  | 'toggleAudio'
  | 'toggleVideo'
  | 'toggleScreenShare'
  | 'shareScreenAudio'
  | 'setShareScreenAudio'
  | 'audioInputDevices'
  | 'audioOutputDevices'
  | 'videoInputDevices'
  | 'activeAudioInputDeviceId'
  | 'activeAudioOutputDeviceId'
  | 'activeVideoInputDeviceId'
  | 'switchAudioInput'
  | 'switchAudioOutput'
  | 'switchVideoInput'
  | 'isNoiseSuppressed'
  | 'toggleNoiseSuppression'
  | 'backgroundEffect'
  | 'setBackgroundEffect'
> &
  Partial<
    Pick<
      CallState,
      | 'microphonePermission'
      | 'cameraPermission'
      | 'cancelMediaPermissionRecovery'
      | 'room'
      | 'trackVersion'
    >
  >;

type MediaSettingsState = { applyingBackground: boolean; error?: string };

export function createCallMediaSettings(call: CallMediaControlsState) {
  const cameraTrack = createMemo(() => {
    call.trackVersion?.();
    if (call.isVideoMuted() || call.cameraPermission?.() === 'denied')
      return undefined;
    const track = call
      .room?.()
      ?.localParticipant.getTrackPublication(LK_TRACK_SOURCE.Camera)?.track;
    // mediaStreamTrack returns processed output when a processor is active.
    const processor = track?.getProcessor?.();
    // Prefer the processor's raw input so preview tiles apply each effect once.
    // Unprocessed tracks expose their camera stream directly.
    const rawSource = () => {
      if (
        processor &&
        'source' in processor &&
        processor.source instanceof MediaStreamTrack
      ) {
        return processor.source;
      }
      const streamTrack = track?.mediaStream?.getVideoTracks()[0];
      if (streamTrack) return streamTrack;
      if (!processor) return track?.mediaStreamTrack;
      return undefined;
    };
    const source = rawSource();
    return source?.readyState === 'live' ? source : undefined;
  });
  const [state, setState] = createStore<MediaSettingsState>({
    applyingBackground: false,
    error: undefined,
  });
  const applyingBackground = () => state.applyingBackground;
  const error = () => state.error;
  const setApplyingBackground = (value: boolean) =>
    setState('applyingBackground', value);
  const setError = (error: string | undefined) => setState('error', error);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function run(action: () => void | Promise<void>): Promise<boolean> {
    setError(undefined);
    try {
      await action();
      return true;
    } catch (error) {
      if (!disposed)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not update call settings.'
        );
      return false;
    }
  }
  const fire = (action: () => void | Promise<void>) =>
    fireAndForget(run(action), 'channel-call');

  async function applyBackground(effect: BackgroundEffect | File) {
    if (disposed || applyingBackground()) return false;
    setApplyingBackground(true);
    let next: BackgroundEffect | undefined;
    const applied = await run(async () => {
      if (effect instanceof File) {
        next = {
          type: 'image',
          id: 'custom',
          path: await readBackgroundImage(effect),
        };
      } else {
        next = effect;
      }
      if (!disposed) await call.setBackgroundEffect(next);
    });
    if (applied && !disposed) {
      if (effect instanceof File && next?.type === 'image') {
        fireAndForget(
          rememberRecentBackgroundImage({ id: next.id, path: next.path }),
          'recent-background-images'
        );
      }
    }
    if (!disposed) setApplyingBackground(false);
    return applied && !disposed;
  }
  async function selectBackground(value: string) {
    if (value === 'none') await applyBackground({ type: 'none' });
    else if (value === 'light' || value === 'heavy')
      await applyBackground({ type: 'blur', intensity: value });
  }

  return {
    cameraTrack,
    applyingBackground,
    error,
    fire,
    applyBackground,
    selectBackground,
  };
}
