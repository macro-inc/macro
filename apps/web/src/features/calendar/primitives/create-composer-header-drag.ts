import { type Accessor, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  type ComposerDragBounds,
  type ComposerDragPoint,
  clampComposerPosition,
  composerPinTarget,
} from '../core/composer-drag';

interface HeaderGesture {
  pointerId: number;
  origin: ComposerDragPoint;
  surface: ComposerDragBounds;
  previous: ComposerDragPoint | undefined;
  target: HTMLElement;
  pinned: boolean;
}

interface HeaderDragState {
  active: boolean;
  overTarget: boolean;
  position: ComposerDragPoint | undefined;
}

export type ComposerDragOutcome = 'pinned' | 'floating' | 'cancelled';

const DRAG_THRESHOLD = 8;
const MIN_FLOATING_HEIGHT = 144;

const headerBounds = (surface: ComposerDragBounds) => ({
  left: surface.left,
  top: surface.top,
  width: surface.width,
  height: Math.min(MIN_FLOATING_HEIGHT, surface.height),
});

/** Own pointer capture and cancellation without moving or replacing the editor. */
export function createComposerHeaderDrag(options: {
  boundary: Accessor<ComposerDragBounds | undefined>;
  surface: Accessor<ComposerDragBounds | undefined>;
  pinTarget?: Accessor<ComposerDragBounds | undefined>;
  canPin?: Accessor<boolean>;
  disabled: Accessor<boolean>;
  pinned?: Accessor<boolean>;
  onPin: () => void;
  onUnpin?: () => void;
  onStart?: () => void;
  onFinish?: (outcome: ComposerDragOutcome) => void;
}) {
  const [state, setState] = createStore<HeaderDragState>({
    active: false,
    overTarget: false,
    position: undefined,
  });
  let gesture: HeaderGesture | undefined;
  const target = () => {
    if (options.canPin && !options.canPin()) return undefined;
    const boundary = options.boundary();
    return (
      options.pinTarget?.() ??
      (boundary ? composerPinTarget(boundary) : undefined)
    );
  };

  const detach = () => {
    const current = gesture;
    gesture = undefined;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', drop);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', cancel);
    current?.target.removeEventListener('lostpointercapture', onPointerCancel);
    if (current?.target.hasPointerCapture(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId);
    }
  };
  const cancel = () => {
    const current = gesture;
    if (!current) return;
    const active = state.active;
    detach();
    setState({ active: false, overTarget: false, position: current.previous });
    if (active) options.onFinish?.('cancelled');
  };
  const move = (event: PointerEvent) => {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    const boundary = options.boundary();
    if (options.disabled() || !boundary) {
      cancel();
      return;
    }
    const dx = event.clientX - current.origin.x;
    const dy = event.clientY - current.origin.y;
    if (!state.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    event.preventDefault();
    if (!state.active) options.onStart?.();
    const pinTarget = target();
    const overTarget = Boolean(
      pinTarget &&
        event.clientX >= pinTarget.left &&
        event.clientX <= pinTarget.left + pinTarget.width &&
        event.clientY >= pinTarget.top &&
        event.clientY <= pinTarget.top + pinTarget.height
    );
    setState({
      active: true,
      overTarget,
      position: clampComposerPosition(
        { x: current.surface.left + dx, y: current.surface.top + dy },
        // Keep the header reachable, but let a tall lifted panel follow both axes.
        headerBounds(current.surface),
        boundary
      ),
    });
  };
  const drop = (event: PointerEvent) => {
    if (gesture?.pointerId !== event.pointerId) return;
    move(event);
    if (!gesture) return;
    const active = state.active;
    const pin = active && state.overTarget;
    const wasPinned = gesture.pinned;
    detach();
    setState({
      active: false,
      overTarget: false,
      position: pin ? undefined : state.position,
    });
    if (!active) return;
    if (pin && !wasPinned) options.onPin();
    if (!pin && wasPinned) options.onUnpin?.();
    options.onFinish?.(pin ? 'pinned' : 'floating');
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId) cancel();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !gesture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  };
  const start = (event: PointerEvent) => {
    if (options.disabled() || gesture || event.button !== 0 || !event.isPrimary)
      return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    if (!(event.target instanceof Element)) return;
    // Scoped menus can bubble through the header without belonging to its drag surface.
    if (!event.currentTarget.contains(event.target)) return;
    if (
      event.target.closest(
        'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role^="menuitem"], [role="option"], [role="combobox"]'
      )
    )
      return;
    const boundary = options.boundary();
    const surface = options.surface();
    if (!boundary || !surface) return;
    gesture = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      surface,
      previous: state.position ? { ...state.position } : undefined,
      target: event.currentTarget,
      pinned: options.pinned?.() ?? false,
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', cancel);
    event.currentTarget.addEventListener('lostpointercapture', onPointerCancel);
  };
  const position = () => {
    const current = state.position;
    const boundary = options.boundary();
    const surface = options.surface();
    if (!current || !boundary || !surface) return current;
    // Keep a lifted panel's header reachable during dragging. Its placement
    // owner fits the complete floating card into the viewport after release.
    return clampComposerPosition(current, headerBounds(surface), boundary);
  };
  onCleanup(cancel);
  return {
    state,
    target,
    position,
    start,
    reset: () => setState('position', undefined),
  };
}

export type ComposerHeaderDrag = ReturnType<typeof createComposerHeaderDrag>;
