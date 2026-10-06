import { MediaBackgroundPicker } from '@core/component/media/media-background-picker';
import { MediaDevicePicker } from '@core/component/media/media-device-picker';
import type { BackgroundEffect } from '@core/media/background-effect';
import Image from '@phosphor/image.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import Speaker from '@phosphor/speaker-high.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import Warning from '@phosphor/warning-circle.svg';
import { Button } from '@ui';
import {
  children,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import type { createMeetingMedia } from '../primitives/meeting-media';

export function MeetingMediaSetup(props: {
  media: ReturnType<typeof createMeetingMedia>;
  name: string;
  avatar?: JSX.Element;
  disabled?: boolean;
  readBackgroundImage?: (file: File) => Promise<string>;
  onUploading: (uploading: boolean) => void;
}) {
  const media = props.media;
  const avatar = children(() => props.avatar);
  const [uploading, setUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal<string>();
  let lastBackground: BackgroundEffect = { type: 'blur', intensity: 'heavy' };
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  let video: HTMLVideoElement | undefined;
  createEffect(() => {
    if (video) video.srcObject = media.video() ?? null;
  });
  const selectBackground = (effect: BackgroundEffect) => {
    setUploadError(undefined);
    const current = media.backgroundEffect();
    if (current.type !== 'none') lastBackground = current;
    if (effect.type !== 'none') lastBackground = effect;
    media.setBackgroundEffect(effect);
  };
  async function upload(file: File) {
    if (!props.readBackgroundImage) return;
    setUploading(true);
    props.onUploading(true);
    setUploadError(undefined);
    try {
      const path = await props.readBackgroundImage(file);
      if (!disposed) selectBackground({ type: 'image', id: 'custom', path });
    } catch (error) {
      if (!disposed)
        setUploadError(
          error instanceof Error ? error.message : 'Could not read this image.'
        );
    } finally {
      if (!disposed) {
        setUploading(false);
        props.onUploading(false);
      }
    }
  }
  const previewError = () => media.backgroundError() || media.cameraError();
  return (
    <section aria-label="Audio and video setup" class="min-w-0">
      <div class="relative aspect-video overflow-hidden rounded-2xl bg-panel text-ink light-mode:bg-ink light-mode:text-page">
        <video
          ref={video}
          autoplay
          muted
          playsinline
          aria-label="Camera preview"
          class="absolute inset-0 h-full w-full object-cover -scale-x-100"
          classList={{ hidden: !media.video() }}
        />
        <span
          class="absolute top-4 left-5 z-10 max-w-[calc(100%-2.5rem)] truncate text-sm font-medium"
          title={props.name}
        >
          {props.name || 'You'}
        </span>
        <Show when={!media.video()}>
          <div class="absolute inset-x-5 top-10 bottom-20 flex flex-col items-center justify-center gap-3 text-center">
            <Show
              when={!previewError()}
              fallback={
                <>
                  <Warning class="size-7 shrink-0 text-warning" />
                  <p role="alert" class="max-w-sm text-sm">
                    {media.backgroundError()
                      ? 'Background unavailable'
                      : 'Camera unavailable'}
                  </p>
                </>
              }
            >
              <Show
                when={!media.backgroundPending()}
                fallback={
                  <p role="status" class="text-sm">
                    Applying background…
                  </p>
                }
              >
                <div class="flex size-16 items-center justify-center overflow-hidden rounded-full bg-accent/20 text-2xl font-medium text-accent sm:size-20">
                  <Show
                    when={avatar()}
                    fallback={props.name.charAt(0).toUpperCase() || 'Y'}
                  >
                    {avatar()}
                  </Show>
                </div>
                <p class="text-sm">Camera is off</p>
              </Show>
            </Show>
          </div>
        </Show>
        <div class="absolute inset-x-0 bottom-4 flex justify-center">
          <div class="flex items-center gap-1 rounded-xl border border-edge-muted bg-panel p-1 shadow-sm">
            <Button
              size="icon-lg"
              class="size-12"
              label={
                media.microphoneEnabled()
                  ? 'Turn off microphone'
                  : 'Turn on microphone'
              }
              tooltipPlacement="top"
              disabled={props.disabled}
              aria-pressed={media.microphoneEnabled()}
              onClick={() =>
                media.setMicrophoneEnabled(!media.microphoneEnabled())
              }
            >
              <Show
                when={media.microphoneEnabled()}
                fallback={<MicrophoneSlash />}
              >
                <Microphone />
              </Show>
            </Button>
            <Button
              size="icon-lg"
              class="size-12"
              label={
                media.cameraEnabled() ? 'Turn off camera' : 'Turn on camera'
              }
              tooltipPlacement="top"
              disabled={props.disabled}
              aria-pressed={media.cameraEnabled()}
              onClick={() => media.setCameraEnabled(!media.cameraEnabled())}
            >
              <Show
                when={media.cameraEnabled()}
                fallback={<VideoCameraSlash />}
              >
                <VideoCamera />
              </Show>
            </Button>
            <Button
              size="icon-lg"
              class="size-12"
              disabled={props.disabled || uploading()}
              label={
                media.backgroundEffect().type === 'none'
                  ? 'Turn on background'
                  : 'Turn off background'
              }
              tooltipPlacement="top"
              aria-pressed={media.backgroundEffect().type !== 'none'}
              onClick={() =>
                selectBackground(
                  media.backgroundEffect().type === 'none'
                    ? lastBackground
                    : { type: 'none' }
                )
              }
            >
              <Image />
            </Button>
          </div>
        </div>
      </div>
      <div class="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MediaDevicePicker
          label="Microphone"
          icon={<Microphone class="size-4 shrink-0" />}
          devices={media
            .availableDevices()
            .filter((device) => device.kind === 'audioinput')}
          selected={media.selectedDevices().microphone}
          disabled={props.disabled}
          onSelect={(id) => media.selectDevice('microphone', id)}
        />
        <MediaDevicePicker
          label="Speaker"
          icon={<Speaker class="size-4 shrink-0" />}
          devices={media
            .availableDevices()
            .filter((device) => device.kind === 'audiooutput')}
          selected={media.selectedDevices().speaker}
          disabled={props.disabled}
          unsupported={!media.canSelectSpeaker()}
          onSelect={(id) => media.selectDevice('speaker', id)}
        />
        <MediaDevicePicker
          label="Camera"
          icon={<VideoCamera class="size-4 shrink-0" />}
          devices={media
            .availableDevices()
            .filter((device) => device.kind === 'videoinput')}
          selected={media.selectedDevices().camera}
          disabled={props.disabled}
          onSelect={(id) => media.selectDevice('camera', id)}
        />
        <MediaBackgroundPicker
          effect={media.backgroundEffect()}
          disabled={props.disabled}
          uploading={uploading()}
          onSelect={selectBackground}
          onUpload={
            props.readBackgroundImage ? (file) => void upload(file) : undefined
          }
        />
      </div>
      <For
        each={[
          ...media.errors(),
          media.backgroundError(),
          media.deviceError(),
          uploadError(),
        ].filter(Boolean)}
      >
        {(error) => (
          <p role="alert" class="mt-3 text-sm text-failure">
            {error}
          </p>
        )}
      </For>
    </section>
  );
}
