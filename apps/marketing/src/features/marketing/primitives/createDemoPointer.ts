import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  DEMO_SEQUENCE_FINISHED,
  DEMO_SEQUENCE_RESET,
} from './createEmailWalkthrough';
import { observeDemoTakeover } from './observeDemoTakeover';

export type DemoPoint = { x: number; y: number };

/** One pointer per sequence. A missing target means rest, not disappear. */
export function createDemoPointer(options: {
  frame: () => HTMLElement | undefined;
  target: () => string | undefined;
  active?: () => boolean;
  track?: () => unknown;
  place?: (rect: DOMRect) => DemoPoint;
  /** Track a dragged element while its own transform animation is running. */
  followAnimation?: () => boolean;
}) {
  const [point, setPoint] = createSignal<DemoPoint>();
  let stopped = false;
  let finished = false;
  onMount(() => {
    const frame = options.frame();
    if (!frame) return;
    const measure = () => {
      if (stopped || finished || options.active?.() === false) {
        setPoint(undefined);
        return;
      }
      const selector = options.target();
      const target = selector
        ? [...frame.querySelectorAll<HTMLElement>(selector)].find((element) => {
            const rect = element.getBoundingClientRect();
            return (
              !element.closest('[hidden]') && rect.width > 0 && rect.height > 0
            );
          })
        : undefined;
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      const parent = frame.getBoundingClientRect();
      if (!parent.width || !parent.height) return;
      const scaleX = frame.offsetWidth ? parent.width / frame.offsetWidth : 1;
      const scaleY = frame.offsetHeight
        ? parent.height / frame.offsetHeight
        : 1;
      const position = options.place?.(bounds) ?? {
        x: bounds.left + Math.min(bounds.width / 2, 36 * scaleX),
        y: bounds.top + bounds.height / 2,
      };
      const x = (position.x - parent.left) / scaleX;
      const y = (position.y - parent.top) / scaleY;
      if (
        x < 0 ||
        y < 0 ||
        x > (frame.clientWidth || parent.width) ||
        y > (frame.clientHeight || parent.height)
      )
        return;
      setPoint((previous) =>
        previous &&
        Math.abs(previous.x - x) < 0.5 &&
        Math.abs(previous.y - y) < 0.5
          ? previous
          : { x, y }
      );
    };
    let raf = 0;
    const requestMeasure = () => {
      cancelAnimationFrame(raf);
      const tick = () => {
        measure();
        if (
          !stopped &&
          !finished &&
          options.active?.() !== false &&
          options.followAnimation?.()
        )
          raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    createEffect(() => {
      options.target();
      options.active?.();
      options.track?.();
      options.followAnimation?.();
      requestMeasure();
    });
    const resize = new ResizeObserver(requestMeasure);
    resize.observe(frame);
    const mutation = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !(record.target instanceof Element) ||
            !record.target.closest('.demo-cursor')
        )
      )
        requestMeasure();
    });
    mutation.observe(frame, { childList: true, subtree: true });
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      setPoint(undefined);
    };
    const releaseTakeover = observeDemoTakeover(frame, stop);
    const endSequence = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        (!frame.contains(target) && !target.contains(frame))
      )
        return;
      finished = event.type === DEMO_SEQUENCE_FINISHED;
      cancelAnimationFrame(raf);
      setPoint(undefined);
      if (!finished && !stopped) requestMeasure();
    };
    frame.ownerDocument.addEventListener(DEMO_SEQUENCE_FINISHED, endSequence);
    frame.ownerDocument.addEventListener(DEMO_SEQUENCE_RESET, endSequence);
    frame.addEventListener('scroll', requestMeasure, true);
    onCleanup(() => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      mutation.disconnect();
      releaseTakeover();
      frame.ownerDocument.removeEventListener(
        DEMO_SEQUENCE_FINISHED,
        endSequence
      );
      frame.ownerDocument.removeEventListener(DEMO_SEQUENCE_RESET, endSequence);
      frame.removeEventListener('scroll', requestMeasure, true);
    });
  });
  return point;
}
