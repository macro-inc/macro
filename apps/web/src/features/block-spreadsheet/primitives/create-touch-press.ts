import { type Accessor, onCleanup } from 'solid-js';

/** Press without blurring an editor, including WebKit's click-less touch taps. */
export function createTouchPress(
  onPress: () => void,
  disabled: Accessor<boolean> = () => false
) {
  let touch:
    | { id: number; x: number; y: number; element: HTMLElement }
    | undefined;
  let suppressCompatibilityClick = false;

  const cancel = () => {
    touch?.element.ownerDocument.removeEventListener(
      'pointerdown',
      anotherPointer,
      true
    );
    touch = undefined;
  };
  const anotherPointer = (event: PointerEvent) => {
    if (touch && event.pointerId !== touch.id) cancel();
  };
  onCleanup(cancel);

  return {
    onPointerDown(event: PointerEvent) {
      cancel();
      suppressCompatibilityClick = event.pointerType === 'touch';
      if (
        event.button !== 0 ||
        event.isPrimary === false ||
        disabled() ||
        !(event.currentTarget instanceof HTMLElement)
      )
        return;
      event.preventDefault();
      if (event.pointerType !== 'touch') return;
      touch = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element: event.currentTarget,
      };
      touch.element.ownerDocument.addEventListener(
        'pointerdown',
        anotherPointer,
        true
      );
    },
    onPointerMove(event: PointerEvent) {
      if (
        touch &&
        event.pointerId === touch.id &&
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8
      )
        cancel();
      // Do not cancel movement: the list retains its native touch scrolling.
    },
    onPointerUp(event: PointerEvent) {
      if (!touch || event.pointerId !== touch.id) return;
      const press = touch;
      const rect = press.element.getBoundingClientRect();
      cancel();
      if (
        disabled() ||
        !press.element.isConnected ||
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8 ||
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        return;
      event.preventDefault();
      onPress();
    },
    onPointerCancel: cancel,
    onMouseDown(event: MouseEvent) {
      if (event.button === 0) event.preventDefault();
    },
    onClick(event: MouseEvent) {
      // Native keyboard activation has no preceding pointer and detail === 0.
      // A real mouse down clears this flag; it can remain set when WebKit omits
      // the compatibility click entirely.
      if (suppressCompatibilityClick && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      suppressCompatibilityClick = false;
      if (!disabled() && event.button === 0) onPress();
    },
  };
}
