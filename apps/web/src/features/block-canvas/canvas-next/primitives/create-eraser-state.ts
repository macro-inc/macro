import {
  type GraphicsEditor,
  isShape,
  type PencilPoint,
  type Point,
  screenToWorld,
  selectedShapeIds,
} from '@macro-inc/graphics';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import { eraseCommand, eraserHits } from '../core/eraser';

export function createEraserState(
  editor: GraphicsEditor,
  active: Accessor<boolean>
) {
  const [hits, setHits] = createSignal<readonly string[]>([]);
  const lifetime = 300;
  let samples: (Point & { time: number })[] = [];
  const [trail, setTrail] = createSignal<readonly PencilPoint[]>([]);
  let pointer: number | undefined;
  let previous: Point | undefined;
  let surface: HTMLElement | undefined;
  let frame: number | undefined;
  const erased = new Set<string>();
  const preview = createMemo(() => {
    if (!hits().length) return;
    const document = editor.document;
    const items = { ...document.items };
    for (const id of selectedShapeIds(document, hits())) {
      const item = items[id];
      if (isShape(item))
        items[id] = {
          ...item,
          appearance: {
            ...item.appearance,
            opacity: (item.appearance.opacity ?? 1) * 0.2,
          },
        };
    }
    return { ...document, items };
  });
  const cancel = () => {
    const id = pointer;
    pointer = undefined;
    previous = undefined;
    setHits([]);
    erased.clear();
    if (id !== undefined && surface?.hasPointerCapture(id))
      surface.releasePointerCapture(id);
  };
  const animate = () => {
    const now = performance.now();
    samples = samples.filter((point) => now - point.time < lifetime);
    setTrail(
      samples.map(
        (point): PencilPoint => [
          point.x,
          point.y,
          Math.max(0, 1 - (now - point.time) / lifetime),
        ]
      )
    );
    frame = samples.length ? requestAnimationFrame(animate) : undefined;
  };
  const append = (point: Point) => {
    samples.push({ ...point, time: performance.now() });
    if (frame === undefined) frame = requestAnimationFrame(animate);
  };
  const sample = (event: PointerEvent, force = false) => {
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const distance = previous
      ? Math.hypot(point.x - previous.x, point.y - previous.y)
      : Infinity;
    if (!force && distance < 2) return;
    const camera = editor.getCamera();
    const found = eraserHits(
      editor.document,
      screenToWorld(camera, previous ?? point),
      screenToWorld(camera, point),
      6 / camera.scale,
      erased
    );
    if (found.length) {
      for (const id of found) erased.add(id);
      setHits([...erased]);
    }
    previous = point;
    if (distance >= 2) append(point);
  };
  onCleanup(() => {
    cancel();
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  return {
    preview,
    trail,
    cancel,
    attach(element: HTMLElement) {
      surface = element;
      const down = (event: PointerEvent) => {
        if (!active() || event.button !== 0 || pointer !== undefined) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        element.focus({ preventScroll: true });
        editor.select();
        pointer = event.pointerId;
        previous = undefined;
        samples = [];
        setTrail([]);
        element.setPointerCapture(pointer);
        sample(event);
      };
      const move = (event: PointerEvent) => {
        if (pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        sample(event);
      };
      const up = (event: PointerEvent) => {
        if (pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        sample(event, true);
        editor.execute(eraseCommand, hits());
        cancel();
      };
      const lost = (event: PointerEvent) => {
        if (pointer === event.pointerId) cancel();
      };
      element.addEventListener('pointerdown', down, true);
      element.addEventListener('pointermove', move, true);
      element.addEventListener('pointerup', up, true);
      element.addEventListener('pointercancel', lost, true);
      element.addEventListener('lostpointercapture', lost, true);
      return () => {
        cancel();
        element.removeEventListener('pointerdown', down, true);
        element.removeEventListener('pointermove', move, true);
        element.removeEventListener('pointerup', up, true);
        element.removeEventListener('pointercancel', lost, true);
        element.removeEventListener('lostpointercapture', lost, true);
        surface = undefined;
      };
    },
  };
}
