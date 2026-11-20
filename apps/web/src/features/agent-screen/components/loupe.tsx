import { fireAndForget } from '@core/util/fireAndForget';
import { onCleanup } from 'solid-js';
import type { Point } from '../core/geometry';
import type { ScreenRect } from '../transports/types';

const WIDTH = 168;
const HEIGHT = 96;
/** Clearance between the finger and the loupe. */
const GAP = 34;

/**
 * A magnified copy of the guest pixels under a finger in touch mode, shown
 * above the finger (below it near the top edge) so the finger never hides
 * what it is about to click.
 */
export function Loupe(props: {
  /** The finger, in viewer CSS px. */
  at: Point;
  /** The guest pixel under it. */
  guest: Point;
  /** The canvas or video the transport renders into, when the app can read it. */
  media: () => Element | undefined;
  /** A copy of a guest region, for a transport that renders out of reach (vnc). */
  snapshot: (rect: ScreenRect) => Promise<ImageBitmap | undefined> | undefined;
}) {
  let canvas: HTMLCanvasElement | undefined;
  let frame = 0;
  let disposed = false;

  const paint = (source: CanvasImageSource, x: number, y: number) => {
    const context = canvas?.getContext('2d');
    if (!context) return;
    const scale = window.devicePixelRatio;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.drawImage(source, x, y, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT);
  };

  const draw = async () => {
    const rect = {
      x: Math.round(props.guest.x - WIDTH / 2),
      y: Math.round(props.guest.y - HEIGHT / 2),
      width: WIDTH,
      height: HEIGHT,
    };
    const pending = props.snapshot(rect);
    if (pending) {
      // One snapshot in flight at a time; the next frame asks again.
      const bitmap = await pending;
      if (bitmap && !disposed) paint(bitmap, 0, 0);
      bitmap?.close();
    } else {
      const source = props.media();
      if (
        source instanceof HTMLCanvasElement ||
        source instanceof HTMLVideoElement
      ) {
        paint(source, rect.x, rect.y);
      }
    }
    if (!disposed) frame = requestAnimationFrame(tick);
  };
  const tick = () => fireAndForget(draw(), 'agent-screen.loupe');
  frame = requestAnimationFrame(tick);
  onCleanup(() => {
    disposed = true;
    cancelAnimationFrame(frame);
  });

  const left = () => Math.max(4, props.at.x - WIDTH / 2);
  const top = () => {
    const above = props.at.y - HEIGHT - GAP;
    return above < 4 ? props.at.y + GAP : above;
  };

  return (
    <div
      class="pointer-events-none absolute z-10 overflow-hidden rounded-lg border-2 border-amber shadow-lg"
      style={{
        left: `${left()}px`,
        top: `${top()}px`,
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
      }}
    >
      <canvas
        ref={canvas}
        width={WIDTH * window.devicePixelRatio}
        height={HEIGHT * window.devicePixelRatio}
        class="size-full"
      />
      <div class="absolute top-1/2 left-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-amber" />
    </div>
  );
}
