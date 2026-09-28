import type { Direction } from '../core/games/snake';

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

/** Arrow keys or WASD, ignoring shortcuts with modifiers. */
export function directionFromKey(event: KeyboardEvent): Direction | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  return KEY_DIRECTIONS[event.key];
}

const SWIPE_THRESHOLD_PX = 24;

/** Pointer handlers that report a swipe's dominant direction, or a tap. */
export function createSwipe(
  onSwipe: (direction: Direction) => void,
  onTap?: () => void
) {
  let start: { x: number; y: number } | undefined;
  return {
    onPointerDown: (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = undefined;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) {
        onTap?.();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) onSwipe(dx > 0 ? 'right' : 'left');
      else onSwipe(dy > 0 ? 'down' : 'up');
    },
    onPointerCancel: () => {
      start = undefined;
    },
  };
}
