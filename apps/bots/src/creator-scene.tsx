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
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) scene()?.resize(width, height);
    });

    resize.observe(target);
    target.addEventListener(
      'webglcontextlost',
      () => {
        life.abort();
        release();
      },
      { signal: life.signal }
    );

    async function load(target: HTMLCanvasElement) {
      let pending: PortraitScene | undefined;

      try {
        const { loadPortraitScene } = await import('./creator-three/load');
        if (life.signal.aborted) return;

        pending = await loadPortraitScene(target, life.signal);
        if (life.signal.aborted) return;

        const { width, height } = target.getBoundingClientRect();
        pending.resize(width, height);
        pending.update(props.preset, props.look, props.pose);

        const instance = pending;
        setScene(instance);
        props.onCapture(() => {
          try {
            return instance.captureCanonical();
          } catch {
            return undefined;
          }
        });
        pending = undefined;
      } catch {
        release();
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
