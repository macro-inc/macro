import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portrait } from './portrait';
import type { Look, PresetId } from './presets';

type PortraitScene = {
  update(preset: PresetId, look: Look, pose: number): void;
  resize(width: number, height: number): void;
  captureCanonical(): string | undefined;
  dispose(): void;
};

export function CreatorScene(props: {
  preset: PresetId;
  look: Look;
  pose: number;
  onCapture: (capture: (() => string | undefined) | undefined) => void;
}) {
  const [scene, setScene] = createSignal<PortraitScene>();
  let canvas: HTMLCanvasElement | undefined;

  function release() {
    const instance = scene();
    if (!instance) return;

    props.onCapture(undefined);
    setScene(undefined);
    instance.dispose();
  }

  onMount(() => {
    const target = canvas;
    if (!target) return;

    const life = new AbortController();
    function fallBack() {
      life.abort();
      release();
    }

    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;

      const { width, height } = entry.contentRect;
      try {
        if (width > 0 && height > 0) scene()?.resize(width, height);
      } catch {
        fallBack();
      }
    });

    resize.observe(target);
    target.addEventListener('webglcontextlost', fallBack, {
      signal: life.signal,
    });

    async function load(target: HTMLCanvasElement) {
      let pending: PortraitScene | undefined;

      try {
        const { loadPortraitScene } = await import('./creator-three/load');
        if (life.signal.aborted) return;

        pending = await loadPortraitScene(target, life.signal, fallBack);
        if (life.signal.aborted) return;

        const { width, height } = target.getBoundingClientRect();
        pending.update(props.preset, props.look, props.pose);
        pending.resize(width, height);
        if (life.signal.aborted) return;

        const instance = pending;
        setScene(instance);
        props.onCapture(() => {
          let source: string | undefined;
          try {
            source = instance.captureCanonical();
          } catch {
            // A capture cannot be accepted without the image the review shows.
          }

          if (!source) {
            queueMicrotask(() => {
              if (scene() === instance) fallBack();
            });
          }
          return source;
        });
        pending = undefined;
      } catch {
        fallBack();
      } finally {
        pending?.dispose();
      }
    }

    void load(target);
    onCleanup(() => {
      life.abort();
      resize.disconnect();
      release();
    });
  });

  createEffect(() => {
    try {
      scene()?.update(props.preset, props.look, props.pose);
    } catch {
      release();
    }
  });

  return (
    <div
      class="creator-scene"
      data-renderer={scene() ? 'three' : 'flat'}
      aria-hidden="true"
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
      />
      <Show when={!scene()}>
        <Portrait preset={props.preset} look={props.look} pose={props.pose} />
      </Show>
    </div>
  );
}
