/**
 * One slide of a running show, drawn to fit a box, playing the slide's
 * transition when the slide changes. Renders are cached per slide.
 */

import type { DeckOutline } from '@core/pptx-engine/types';
import {
  createEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { transitionFrames } from '../core/transitions';
import type { ShowScreen } from '../primitives/create-show';

export function ShowCanvas(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  index: number;
  /** CSS pixels to fit the slide in. */
  width: number;
  height: number;
  pixelRatio?: number;
  screen?: ShowScreen;
  /** Whether slide changes play transitions. */
  transitions?: boolean;
  /** A slide to render ahead of time. */
  preload?: number;
  /** Called when a slide has appeared. */
  onShown?: (index: number) => void;
  testId?: string;
}) {
  let incoming!: HTMLCanvasElement;
  let outgoing!: HTMLCanvasElement;
  const fit = () => {
    const s = Math.min(
      props.width / props.deck.width,
      props.height / props.deck.height
    );
    return { w: props.deck.width * s, h: props.deck.height * s };
  };
  const pixelWidth = () =>
    Math.max(16, Math.min(4096, Math.round(fit().w * (props.pixelRatio ?? 1))));

  const cache = new Map<string, Promise<ImageBitmap>>();
  const render = (i: number, width: number) => {
    const key = `${i}:${width}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = props.engine.render(i, width);
      cache.set(key, hit);
      hit.catch(() => cache.delete(key));
    }
    return hit;
  };
  onCleanup(() => {
    for (const p of cache.values())
      void p.then((b) => b.close()).catch(() => {});
  });

  const [shown] = createResource(
    () => [props.index, pixelWidth()] as const,
    async ([i, width]) => ({ i, bitmap: await render(i, width) })
  );

  let previous: number | undefined;
  /** Uncover-style transitions move the old slide over the new one. */
  const [outgoingOnTop, setOutgoingOnTop] = createSignal(false);
  // Drawing to canvases and starting animations syncs external systems.
  createEffect(
    on(shown, (value) => {
      if (!value) return;
      const changed = previous !== undefined && previous !== value.i;
      previous = value.i;
      // The previous image stays underneath while the next one enters.
      if (incoming.width > 0 && changed) {
        outgoing.width = incoming.width;
        outgoing.height = incoming.height;
        outgoing.getContext('2d')?.drawImage(incoming, 0, 0);
      }
      incoming.width = value.bitmap.width;
      incoming.height = value.bitmap.height;
      incoming.getContext('2d')?.drawImage(value.bitmap, 0, 0);
      const t = props.deck.slides[value.i]?.transition;
      // Slides without a transition just appear, as in PowerPoint.
      const frames =
        changed && props.transitions !== false
          ? transitionFrames(t?.kind ?? 'none', t?.direction)
          : null;
      setOutgoingOnTop(
        !!frames &&
          (['uncover', 'pull', 'reveal'].includes(t?.kind ?? '') ||
            (t?.kind === 'zoom' && t.direction === 'out'))
      );
      const timing = { duration: t?.durationMs ?? 500, easing: 'ease-in-out' };
      if (frames?.incoming) incoming.animate(frames.incoming, timing);
      if (frames) {
        const leaving = outgoing.animate(
          frames.outgoing ?? [{ opacity: 1 }, { opacity: 1 }],
          timing
        );
        // Once gone, the old slide drops below the new one for good.
        leaving.onfinish = () => setOutgoingOnTop(false);
      } else {
        outgoing.width = 0;
      }
      if (props.preload !== undefined)
        void render(props.preload, pixelWidth()).catch(() => {});
      props.onShown?.(value.i);
    })
  );

  return (
    <div
      class="relative overflow-hidden"
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: `${fit().w}px`,
        height: `${fit().h}px`,
      }}
    >
      <canvas
        ref={outgoing}
        class="absolute inset-0 size-full"
        style={{
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          'z-index': outgoingOnTop() ? 1 : 0,
        }}
      />
      <canvas
        ref={incoming}
        data-testid={props.testId}
        data-slide-index={shown()?.i}
        class="absolute inset-0 size-full"
        style={{
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          'z-index': outgoingOnTop() ? 0 : 1,
        }}
      />
      <Show when={props.screen && props.screen !== 'slide'}>
        <div
          style={{
            position: 'absolute',
            inset: '0',
            'z-index': 2,
            background: props.screen === 'black' ? 'black' : 'white',
          }}
        />
      </Show>
    </div>
  );
}
