import { type Camera, type Point, screenToWorld } from '@macro-inc/graphics';
import { createSignal } from 'solid-js';

export type CanvasInsertLocation = {
  screen: Point;
  world: Point;
  presentation?: 'dropdown';
};

export function createCanvasInsertState(camera: () => Camera) {
  const [location, setLocation] = createSignal<CanvasInsertLocation>();
  let viewport: HTMLElement | undefined;
  let pointer: Point | undefined;
  return {
    location,
    close: () => setLocation(undefined),
    open() {
      if (!viewport || location()) return;
      const rect = viewport.getBoundingClientRect();
      const screen = pointer ?? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      setLocation({
        screen,
        world: screenToWorld(camera(), {
          x: screen.x - rect.left,
          y: screen.y - rect.top,
        }),
      });
    },
    openFromToolbar(screen: Point) {
      if (!viewport || location()) return;
      const rect = viewport.getBoundingClientRect();
      setLocation({
        screen,
        world: screenToWorld(camera(), {
          x: rect.width / 2,
          y: rect.height / 2,
        }),
        presentation: 'dropdown',
      });
    },
    attach(element: HTMLElement) {
      viewport = element;
      const track = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
      };
      const leave = () => {
        pointer = undefined;
      };
      element.addEventListener('pointermove', track);
      element.addEventListener('pointerdown', track);
      element.addEventListener('pointerleave', leave);
      return () => {
        element.removeEventListener('pointermove', track);
        element.removeEventListener('pointerdown', track);
        element.removeEventListener('pointerleave', leave);
        viewport = undefined;
        pointer = undefined;
      };
    },
  };
}

export type CanvasInsertState = ReturnType<typeof createCanvasInsertState>;
