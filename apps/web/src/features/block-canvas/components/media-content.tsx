import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';

export function CanvasMediaSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading media"
      class="skeleton-shimmer size-full bg-skeleton"
    />
  );
}

type MediaContentProps = {
  url?: string;
  type: 'image' | 'video';
  name?: string;
  unavailable?: boolean;
  playing: boolean;
  onStop: () => void;
};

export function CanvasMediaContent(props: MediaContentProps) {
  return (
    <Show when={!props.unavailable} fallback={<MediaUnavailable />}>
      <Show when={props.url} keyed fallback={<CanvasMediaSkeleton />}>
        {(url) => <LoadedMedia {...props} url={url} />}
      </Show>
    </Show>
  );
}

function MediaUnavailable() {
  return (
    <div class="grid size-full place-items-center border border-edge-muted bg-panel p-3 text-xs text-ink-muted">
      Media unavailable
    </div>
  );
}

function LoadedMedia(props: MediaContentProps & { url: string }) {
  const [loaded, setLoaded] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [video, setVideo] = createSignal<HTMLVideoElement>();
  createEffect(
    on([video, () => props.playing], ([element, playing]) => {
      if (!element) return;
      if (!playing) {
        element.pause();
        return;
      }
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        element.pause();
      });
      async function play() {
        try {
          await element!.play();
        } catch {
          if (!cancelled) props.onStop();
        }
      }
      void play();
    })
  );
  return (
    <div class="relative size-full" aria-busy={!loaded() && !failed()}>
      <Show when={!failed()} fallback={<MediaUnavailable />}>
        <Show when={!loaded()}>
          <div class="pointer-events-none absolute inset-0">
            <CanvasMediaSkeleton />
          </div>
        </Show>
        <Show
          when={props.type === 'image'}
          fallback={
            <video
              ref={setVideo}
              src={props.url}
              preload="metadata"
              playsinline
              class="size-full object-fill"
              classList={{ invisible: !loaded() }}
              onLoadedData={() => setLoaded(true)}
              onError={() => setFailed(true)}
              onEnded={props.onStop}
            />
          }
        >
          <img
            src={props.url}
            alt={props.name}
            draggable={false}
            class="size-full object-fill"
            classList={{ invisible: !loaded() }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </Show>
      </Show>
    </div>
  );
}
