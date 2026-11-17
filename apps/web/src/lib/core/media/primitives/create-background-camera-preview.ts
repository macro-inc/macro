import type { BackgroundProcessorWrapper } from '@livekit/track-processors';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from 'solid-js';
import { fireAndForget } from '../../util/fireAndForget';
import {
  type BlurIntensity,
  backgroundProcessorOptions,
} from '../background-effect';

export function createBackgroundCameraPreview(
  video: Accessor<HTMLVideoElement>,
  trackSource: Accessor<MediaStreamTrack | undefined>,
  blurSource: Accessor<BlurIntensity | undefined>
) {
  const [ready, setReady] = createSignal(false);
  createEffect(
    on(
      () => [trackSource(), blurSource()] as const,
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
          video().pause();
          video().srcObject = null;
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
            video().srcObject = new MediaStream([output]);
            await video().play();
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

  return ready;
}
