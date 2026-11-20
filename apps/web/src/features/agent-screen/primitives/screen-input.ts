import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  FIT_VIEWPORT,
  frameTransform,
  keepInView,
  type Rotation,
  type Size,
  type ViewGeometry,
  type Viewport,
  zoomAt,
} from '../core/geometry';
import {
  type GestureEffect,
  type GestureEvent,
  INITIAL_GESTURE_STATE,
  LONG_PRESS_MS,
  type PointerKind,
  stepGesture,
  type TouchMode,
  touchPoint,
} from '../core/gestures';
import {
  KEYSYM_CONTROL,
  KEYSYM_ESCAPE,
  KEYSYM_SUPER_LEFT,
  KEYSYM_SUPER_RIGHT,
  keysymForKey,
} from '../core/keysym';
import type { ScreenFrameSize, ScreenInputEvent } from '../transports/types';

/** Keyboards report keys as this while an IME composes. */
const KEY_CODE_COMPOSING = 229;

/** Holding Esc this long hands control back. */
export const HAND_BACK_HOLD_MS = 1000;

export type ScreenInputOptions = {
  frame: Accessor<ScreenFrameSize | undefined>;
  container: Accessor<Size>;
  rotation: Accessor<Rotation>;
  /** This viewer holds the driver lease. */
  sendsInput: Accessor<boolean>;
  send: (event: ScreenInputEvent) => void;
  /** Esc held for `HAND_BACK_HOLD_MS` while driving. */
  onHandBackHold: () => void;
};

function pointerKind(type: string): PointerKind {
  if (type === 'mouse') return 'mouse';
  if (type === 'pen') return 'pen';
  return 'touch';
}

/** Wheel deltas in CSS px whatever `deltaMode` the device reports. */
function wheelPixels(event: WheelEvent): { dx: number; dy: number } {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 400
        : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
}

/**
 * The viewer's local viewport (zoom, pan) and everything that turns the
 * person's pointer, wheel and keyboard into guest input. The view binds the
 * returned handlers to the element over the picture.
 */
export function createScreenInput(options: ScreenInputOptions) {
  const [viewport, setViewport] = createSignal<Viewport>(FIT_VIEWPORT);
  const [touchMode, setTouchMode] = createSignal<TouchMode>('touch');
  const [gestures, setGestures] = createSignal(INITIAL_GESTURE_STATE);
  const [escapeHeld, setEscapeHeld] = createSignal(false);

  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  // Keysyms sent down per physical key, so the release matches the press
  // even when a modifier changed `key` in between.
  let pressedKeys: Record<string, number> = {};

  const geometry = (): ViewGeometry | undefined => {
    const frame = options.frame();
    if (!frame) return undefined;
    return {
      container: options.container(),
      frame,
      rotation: options.rotation(),
    };
  };

  /**
   * While zoomed in, a drag that carries the guest pointer towards the edge
   * pans the view after it, so the pointer (drawn into the picture) never
   * leaves sight.
   */
  const followPointer = (event: ScreenInputEvent) => {
    if (event.kind !== 'pointer' || event.buttons === 0) return;
    const current = geometry();
    if (!current) return;
    setViewport(keepInView(current, viewport(), event));
  };

  const apply = (effects: GestureEffect[]) => {
    for (const effect of effects) {
      if (effect.type === 'input') {
        options.send(effect.event);
        followPointer(effect.event);
      }
      if (effect.type === 'viewport') setViewport(effect.viewport);
      if (effect.type === 'cancelLongPress') clearTimeout(longPressTimer);
      if (effect.type === 'armLongPress') {
        clearTimeout(longPressTimer);
        const id = effect.id;
        longPressTimer = setTimeout(
          () => feed({ type: 'longPress', id }),
          LONG_PRESS_MS
        );
      }
    }
  };

  function feed(event: GestureEvent) {
    const current = geometry();
    if (!current) return;
    const result = stepGesture(gestures(), event, {
      geometry: current,
      viewport: viewport(),
      sendsInput: options.sendsInput(),
      touchMode: touchMode(),
    });
    setGestures(result.state);
    apply(result.effects);
  }

  const pointerEvent = (
    type: 'down' | 'move' | 'up' | 'cancel',
    event: PointerEvent
  ) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    feed({
      type,
      pointer: {
        id: event.pointerId,
        kind: pointerKind(event.pointerType),
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        buttons: event.buttons,
        time: event.timeStamp,
      },
    });
  };

  const releaseKeys = () => {
    for (const keysym of Object.values(pressedKeys)) {
      options.send({ kind: 'key', keysym, down: false });
    }
    pressedKeys = {};
  };

  const cancelEscapeHold = () => {
    clearTimeout(escapeTimer);
    escapeTimer = undefined;
    setEscapeHeld(false);
  };

  onCleanup(() => {
    clearTimeout(longPressTimer);
    cancelEscapeHold();
  });

  const zoomBy = (factor: number) => {
    const current = geometry();
    if (!current) return;
    const center = {
      x: current.container.width / 2,
      y: current.container.height / 2,
    };
    setViewport(zoomAt(current, viewport(), factor, center));
  };

  return {
    viewport,
    touchMode,
    setTouchMode,
    escapeHeld,
    /** The CSS transform for the frame element, or `undefined` before the first frame size. */
    transform: () => {
      const current = geometry();
      return current ? frameTransform(current, viewport()) : undefined;
    },
    /** The viewer point under a touch-mode finger, for the loupe. */
    loupePoint: () => touchPoint(gestures()),
    zoomBy,
    fit: () => setViewport(FIT_VIEWPORT),

    onPointerDown(event: PointerEvent) {
      const target = event.currentTarget;
      if (target instanceof HTMLElement)
        target.setPointerCapture(event.pointerId);
      event.preventDefault();
      pointerEvent('down', event);
    },
    onPointerMove: (event: PointerEvent) => pointerEvent('move', event),
    onPointerUp: (event: PointerEvent) => pointerEvent('up', event),
    onPointerCancel: (event: PointerEvent) => pointerEvent('cancel', event),
    onWheel(event: WheelEvent) {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      feed({
        type: 'wheel',
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        ...wheelPixels(event),
        ctrlKey: event.ctrlKey,
      });
    },
    onContextMenu: (event: MouseEvent) => event.preventDefault(),

    onKeyDown(event: KeyboardEvent) {
      if (!options.sendsInput()) return;
      // An IME (or a dead key) is composing in the keyboard field: let it,
      // and send what it commits (onCompositionEnd).
      if (
        event.isComposing ||
        event.keyCode === KEY_CODE_COMPOSING ||
        event.key === 'Dead'
      ) {
        return;
      }

      // Esc is held to hand back; a short press still reaches the guest on release.
      if (event.key === 'Escape') {
        event.preventDefault();
        if (event.repeat || escapeTimer) return;
        setEscapeHeld(true);
        escapeTimer = setTimeout(() => {
          escapeTimer = undefined;
          setEscapeHeld(false);
          releaseKeys();
          options.onHandBackHold();
        }, HAND_BACK_HOLD_MS);
        return;
      }

      // Ctrl+V / Cmd+V: let the browser paste, so the guest gets this
      // computer's clipboard first (see onPaste).
      const pasteShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
      if (pasteShortcut) return;
      event.preventDefault();

      const keysym = keysymForKey(event.key, event.location);
      if (keysym === undefined) return;
      pressedKeys[event.code] = keysym;
      options.send({ kind: 'key', keysym, down: true });
    },
    onKeyUp(event: KeyboardEvent) {
      if (!options.sendsInput()) return;
      if (event.isComposing || event.keyCode === KEY_CODE_COMPOSING) return;
      event.preventDefault();

      if (event.key === 'Escape') {
        if (!escapeTimer) return;
        cancelEscapeHold();
        options.send({ kind: 'key', keysym: KEYSYM_ESCAPE, down: true });
        options.send({ kind: 'key', keysym: KEYSYM_ESCAPE, down: false });
        return;
      }

      const keysym = pressedKeys[event.code];
      if (keysym === undefined) return;
      delete pressedKeys[event.code];
      options.send({ kind: 'key', keysym, down: false });
    },
    /** An IME composition committed in the keyboard field: type it, once. */
    onCompositionEnd(event: CompositionEvent) {
      const field = event.currentTarget;
      if (field instanceof HTMLTextAreaElement) field.value = '';
      if (!options.sendsInput() || !event.data) return;
      options.send({ kind: 'text', text: event.data });
    },
    onBlur() {
      cancelEscapeHold();
      releaseKeys();
    },
    onPaste(event: ClipboardEvent) {
      if (!options.sendsInput()) return;
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      options.send({ kind: 'clipboard', text });

      // Then paste in the guest. A Linux guest pastes with Ctrl+V, so a Mac's
      // Cmd (sent as Super) is let go first.
      const releaseSuper = Object.entries(pressedKeys).filter(
        ([, keysym]) =>
          keysym === KEYSYM_SUPER_LEFT || keysym === KEYSYM_SUPER_RIGHT
      );
      for (const [code, keysym] of releaseSuper) {
        options.send({ kind: 'key', keysym, down: false });
        delete pressedKeys[code];
      }
      const controlHeld = Object.values(pressedKeys).includes(KEYSYM_CONTROL);
      const keysymV = 0x76;
      if (!controlHeld)
        options.send({ kind: 'key', keysym: KEYSYM_CONTROL, down: true });
      options.send({ kind: 'key', keysym: keysymV, down: true });
      options.send({ kind: 'key', keysym: keysymV, down: false });
      if (!controlHeld)
        options.send({ kind: 'key', keysym: KEYSYM_CONTROL, down: false });
    },
  };
}

export type ScreenInputController = ReturnType<typeof createScreenInput>;
