import { MediaBackgroundPicker } from '@core/component/media/media-background-picker';
import { MediaDevicePicker } from '@core/component/media/media-device-picker';
import type { BackgroundEffect } from '@core/media/background-effect';
import { readBackgroundImage } from '@core/media/read-background-image';
import Microphone from '@phosphor/microphone.svg';
import SpeakerHigh from '@phosphor/speaker-high.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import { InlineCheckbox } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import type { CallState } from '../CallContext';
import { CallControlBar } from './CallControlBar';

export type CallMediaControlsState = Pick<
  CallState,
  | 'isConnecting'
  | 'isAudioMuted'
  | 'isVideoMuted'
  | 'isScreenSharing'
  | 'toggleAudio'
  | 'toggleVideo'
  | 'toggleScreenShare'
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
>;

export function CallMediaControls(props: {
  media: CallMediaControlsState;
  onLeave: () => void | Promise<void>;
}) {
  const call = props.media;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [applyingBackground, setApplyingBackground] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let lastBackground: BackgroundEffect = { type: 'blur', intensity: 'heavy' };
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function run(action: () => void | Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (error) {
      if (!disposed)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not update call settings.'
        );
    }
  }
  async function applyBackground(effect: BackgroundEffect | File) {
    if (applyingBackground()) return;
    setApplyingBackground(true);
    await run(async () => {
      const next =
        effect instanceof File
          ? {
              type: 'image' as const,
              id: 'custom',
              path: await readBackgroundImage(effect),
            }
          : effect;
      if (!disposed) {
        const current = call.backgroundEffect();
        if (current.type !== 'none') lastBackground = current;
        await call.setBackgroundEffect(next);
        if (next.type !== 'none') lastBackground = next;
      }
    });
    if (!disposed) setApplyingBackground(false);
  }

  return (
    <CallControlBar
      disabled={call.isConnecting()}
      audioMuted={call.isAudioMuted()}
      videoMuted={call.isVideoMuted()}
      screenSharing={call.isScreenSharing()}
      onToggleAudio={() => void run(call.toggleAudio)}
      onToggleVideo={() => void run(call.toggleVideo)}
      onToggleScreen={() => void run(call.toggleScreenShare)}
      onLeave={() => void run(props.onLeave)}
      menuOpen={menuOpen()}
      error={error()}
      audioSettings={
        <div class="flex flex-col gap-3">
          <div class="grid grid-cols-1 gap-2 @sm:grid-cols-2">
            <MediaDevicePicker
              label="Microphone"
              icon={<Microphone class="size-4 shrink-0" />}
              devices={call.audioInputDevices()}
              selected={call.activeAudioInputDeviceId() ?? ''}
              placement="top-start"
              onOpenChange={setMenuOpen}
              disabled={call.isConnecting()}
              onSelect={(id) =>
                void run(() => call.switchAudioInput(id || 'default'))
              }
            />
            <MediaDevicePicker
              label="Speaker"
              icon={<SpeakerHigh class="size-4 shrink-0" />}
              devices={call.audioOutputDevices()}
              selected={call.activeAudioOutputDeviceId() ?? ''}
              placement="top-end"
              onOpenChange={setMenuOpen}
              unsupported={!('setSinkId' in HTMLMediaElement.prototype)}
              disabled={call.isConnecting()}
              onSelect={(id) =>
                void run(() => call.switchAudioOutput(id || 'default'))
              }
            />
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={call.isNoiseSuppressed()}
            disabled={call.isConnecting()}
            onClick={() => void run(call.toggleNoiseSuppression)}
            class="flex min-h-8 items-center gap-2 self-start rounded-lg px-2 text-sm text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          >
            <InlineCheckbox checked={call.isNoiseSuppressed()} />
            Noise suppression
          </button>
        </div>
      }
      videoSettings={
        <MediaDevicePicker
          label="Camera"
          icon={<VideoCamera class="size-4 shrink-0" />}
          devices={call.videoInputDevices()}
          selected={call.activeVideoInputDeviceId() ?? ''}
          placement="top-start"
          onOpenChange={setMenuOpen}
          disabled={call.isConnecting()}
          onSelect={(id) =>
            void run(() =>
              call.switchVideoInput(
                id || call.videoInputDevices()[0]?.deviceId || ''
              )
            )
          }
        />
      }
      backgroundActive={call.backgroundEffect().type !== 'none'}
      backgroundDisabled={applyingBackground()}
      onToggleBackground={() =>
        void applyBackground(
          call.backgroundEffect().type === 'none'
            ? lastBackground
            : { type: 'none' }
        )
      }
      backgroundSettings={
        <MediaBackgroundPicker
          effect={call.backgroundEffect()}
          placement="top-end"
          onOpenChange={setMenuOpen}
          disabled={call.isConnecting()}
          uploading={applyingBackground()}
          onSelect={(effect) => void applyBackground(effect)}
          onUpload={(file) => void applyBackground(file)}
        />
      }
    />
  );
}
