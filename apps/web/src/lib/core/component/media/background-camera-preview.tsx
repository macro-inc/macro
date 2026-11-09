import {
  type BlurIntensity,
  backgroundProcessorOptions,
} from '@core/media/background-effect';
import { fireAndForget } from '@core/util/fireAndForget';
import Blur from '@icon/system/regular/drop-half.svg';
import Prohibit from '@icon/system/regular/prohibit.svg';
import type { BackgroundProcessorWrapper } from '@livekit/track-processors';
import { Telemetry } from '@macro-inc/observability';
import {
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  Show,
} from 'solid-js';

/** Menu-only previews never attach a processor to the published camera track. */
export function BackgroundCameraPreview(props: {
  track?: MediaStreamTrack;
  blur?: BlurIntensity;
}) {
  let video!: HTMLVideoElement;
  const [ready, setReady] = createSignal(false);
  createEffect(
    on(
      () => [props.track, props.blur] as const,
      ([track, blur]) => {
        setReady(false);
        if (!track || track.readyState === 'ended') return;
        const clone = track.clone();
        const input = document.createElement('video');
        input.muted = true;
        input.playsInline = true;
        input.srcObject = new MediaStream([clone]);
        let disposed = false;
        let processor: BackgroundProcessorWrapper | undefined;
        let setup: Promise<void> = Promise.resolve();
        const stop = () => {
          if (disposed) return;
          disposed = true;
          clone.stop();
          input.pause();
          input.srcObject = null;
          video.pause();
          video.srcObject = null;
          fireAndForget(
            (async () => {
              await setup;
              await processor?.destroy();
            })(),
            'background-preview'
          );
          setReady(false);
        };
        track.addEventListener('ended', stop);
        onCleanup(() => {
          track.removeEventListener('ended', stop);
          stop();
        });
        setup = Telemetry.span('call.background.preview', async (span) => {
          span.setAttr('background.blur', blur ?? 'none');
          try {
            await input.play();
            if (disposed) return;
            let output = clone;
            if (blur) {
              const [
                { BackgroundProcessor, supportsBackgroundProcessors },
                { Track },
              ] = await Promise.all([
                import('@livekit/track-processors'),
                import('livekit-client'),
              ]);
              if (disposed || !supportsBackgroundProcessors()) return;
              processor = BackgroundProcessor({
                ...backgroundProcessorOptions({
                  type: 'blur',
                  intensity: blur,
                }),
                maxFps: 8,
              });
              // The fallback backend looks up its canvas by processor name.
              processor.name = `call-background-preview-${createUniqueId()}`;
              await processor.init({
                kind: Track.Kind.Video,
                track: clone,
                element: input,
              });
              if (disposed) return;
              if (!processor.processedTrack) return;
              output = processor.processedTrack;
            }
            video.srcObject = new MediaStream([output]);
            await video.play();
            if (!disposed) setReady(true);
          } catch {
            span.error('Preview initialization failed');
            // Unsupported processing leaves a truthful neutral tile, not simulated blur.
            if (!disposed) stop();
          }
        });
        fireAndForget(setup, 'background-preview');
      }
    )
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
