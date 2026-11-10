import type { BlurIntensity } from '@core/media/background-effect';
import { createBackgroundCameraPreview } from '@core/media/primitives/create-background-camera-preview';
import Blur from '@icon/system/regular/drop-half.svg';
import Prohibit from '@icon/system/regular/prohibit.svg';
import { Show } from 'solid-js';

/** Menu-only previews never attach a processor to the published camera track. */
export function BackgroundCameraPreview(props: {
  track?: MediaStreamTrack;
  blur?: BlurIntensity;
}) {
  let video!: HTMLVideoElement;
  const ready = createBackgroundCameraPreview(
    () => video,
    () => props.track,
    () => props.blur
  );
  return (
    <span class="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-panel ring-1 ring-edge-muted group-data-checked:ring-2 group-data-checked:ring-accent">
      <video
        ref={video}
        autoplay
        muted
        playsinline
        aria-hidden="true"
        class="size-full object-cover -scale-x-100"
        classList={{ invisible: !ready() }}
      />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 grid place-items-center"
      >
        <span class="grid size-10 place-items-center rounded-full bg-surface-2/90 text-ink shadow-sm">
          <Show when={props.blur} fallback={<Prohibit class="size-5" />}>
            <Blur class={props.blur === 'heavy' ? 'size-7' : 'size-5'} />
          </Show>
        </span>
      </span>
    </span>
  );
}
