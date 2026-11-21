import { IS_MAC } from '@core/constant/isMac';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
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
  KEYSYM_CONTROL_RIGHT,
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
  /** A Mac's Cmd drives the guest's Ctrl (a Linux guest copies with Ctrl+C). */
  isMac?: boolean;
};

/** Ctrl+V with nothing local to paste still pastes the guest's own clipboard after this. */
const PASTE_FALLBACK_MS = 60;

/** The three modifiers held together leave the keyboard without handing back. */
const RELEASE_CHORD_KEYS = ['Control', 'Alt', 'Shift'];

/** Keys that are modifiers themselves, by `KeyboardEvent.key`. */
const MODIFIER_KEYS = [
  'Control',
  'Alt',
  'AltGraph',
  'Shift',
  'Meta',
  'OS',
  'CapsLock',
];

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

/** An IME, or a dead key, is composing: what it commits comes as text. */
function composingKey(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    event.keyCode === KEY_CODE_COMPOSING ||
    event.key === 'Dead'
  );
}

/** Ctrl+Alt+Shift held together: the way out of the guest by keyboard alone. */
function isReleaseChord(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    event.altKey &&
    event.shiftKey &&
    RELEASE_CHORD_KEYS.includes(event.key)
  );
}

function isPasteShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
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
  /** The guest pointer as last sent, to let go of a held button. */
  let lastPointer: { x: number; y: number; buttons: number } | undefined;
  let pasteFallback: ReturnType<typeof setTimeout> | undefined;
  const isMac = options.isMac ?? IS_MAC;

  /** The keysym a key press sends; a Mac's Cmd becomes Ctrl. */
  const keysymFor = (event: KeyboardEvent) => {
    const keysym = keysymForKey(event.key, event.location);
    if (!isMac) return keysym;
    if (keysym === KEYSYM_SUPER_LEFT) return KEYSYM_CONTROL;
    if (keysym === KEYSYM_SUPER_RIGHT) return KEYSYM_CONTROL_RIGHT;
    return keysym;
  };

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
        if (effect.event.kind === 'pointer') {
          const { x, y, buttons } = effect.event;
          lastPointer = { x, y, buttons };
        }
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

  /** Lets go, in the guest, of every key and button this viewer holds down. */
  const releaseKeys = () => {
    for (const keysym of Object.values(pressedKeys)) {
      options.send({ kind: 'key', keysym, down: false });
    }
    pressedKeys = {};
    if (lastPointer && lastPointer.buttons !== 0) {
      options.send({ kind: 'pointer', ...lastPointer, buttons: 0 });
      lastPointer = { ...lastPointer, buttons: 0 };
    }
  };

  // The lease went elsewhere: the guest no longer takes our input, so only
  // forget what we held (a later key-up must not be sent for it).
  createEffect(
    on(
      options.sendsInput,
      (sends) => {
        if (sends) return;
        pressedKeys = {};
        lastPointer = undefined;
        clearTimeout(pasteFallback);
        cancelEscapeHold();
      },
      { defer: true }
    )
  );

  const cancelEscapeHold = () => {
    clearTimeout(escapeTimer);
    escapeTimer = undefined;
    setEscapeHeld(false);
  };

  onCleanup(() => {
    clearTimeout(longPressTimer);
    clearTimeout(pasteFallback);
    cancelEscapeHold();
  });

  /** Ctrl+V in the guest, with a Mac's Cmd (sent as Ctrl) already down or not. */
  const pasteInGuest = () => {
    const controlHeld = Object.values(pressedKeys).some(
      (keysym) => keysym === KEYSYM_CONTROL || keysym === KEYSYM_CONTROL_RIGHT
    );
    const keysymV = 0x76;
    if (!controlHeld)
      options.send({ kind: 'key', keysym: KEYSYM_CONTROL, down: true });
    options.send({ kind: 'key', keysym: keysymV, down: true });
    options.send({ kind: 'key', keysym: keysymV, down: false });
    if (!controlHeld)
      options.send({ kind: 'key', keysym: KEYSYM_CONTROL, down: false });
  };

  const zoomBy = (factor: number) => {
    const current = geometry();
    if (!current) return;
    const center = {
      x: current.container.width / 2,
      y: current.container.height / 2,
    };
    setViewport(zoomAt(current, viewport(), factor, center));
  };

  /** Ctrl+Alt+Shift leaves the keyboard (focus moves out) without handing back. */
  function leaveKeyboard(event: KeyboardEvent) {
    event.preventDefault();
    cancelEscapeHold();
    releaseKeys();
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
  }

  /** Esc is held to hand back; a short press still reaches the guest on release. */
  function holdEscape(event: KeyboardEvent) {
    event.preventDefault();
    if (event.repeat || escapeTimer) return;
    setEscapeHeld(true);
    escapeTimer = setTimeout(() => {
      escapeTimer = undefined;
      setEscapeHeld(false);
      releaseKeys();
      options.onHandBackHold();
    }, HAND_BACK_HOLD_MS);
  }

  /**
   * Ctrl+V / Cmd+V: the browser pastes, so the guest gets this computer's
   * clipboard first (see onPaste). When nothing local arrives (an empty
   * clipboard, an image, a refused permission), the guest still pastes its
   * own clipboard.
   */
  function armPasteFallback() {
    clearTimeout(pasteFallback);
    pasteFallback = setTimeout(() => {
      pasteFallback = undefined;
      if (options.sendsInput()) pasteInGuest();
    }, PASTE_FALLBACK_MS);
  }

  function tap(keysym: number) {
    options.send({ kind: 'key', keysym, down: true });
    options.send({ kind: 'key', keysym, down: false });
  }

  function pressKey(event: KeyboardEvent, keysym: number, altGraph: boolean) {
    const modifier = MODIFIER_KEYS.includes(event.key);
    // macOS sends CapsLock's keydown when it turns on and its keyup when it
    // turns off: each is one tap, or the guest's caps state drifts.
    if (isMac && event.key === 'CapsLock') return tap(keysym);
    // macOS sends no keyup for a key let go while Cmd is down (Cmd+C):
    // press and release it at once, as noVNC's keyboard does.
    if (isMac && event.metaKey && !modifier) return tap(keysym);
    // An AltGr character on Windows arrives with a fake Ctrl held: let the
    // guest's Ctrl go first, so the character isn't a Ctrl+Alt shortcut.
    if (altGraph && !modifier) releaseFakeControl();
    pressedKeys[event.code] = keysym;
    options.send({ kind: 'key', keysym, down: true });
  }

  function releaseFakeControl() {
    const control = pressedKeys.ControlLeft;
    if (control === undefined) return;
    delete pressedKeys.ControlLeft;
    options.send({ kind: 'key', keysym: control, down: false });
  }

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
      if (composingKey(event)) return;
      // Windows reports AltGr as Ctrl+Alt: an AltGr character is not a
      // shortcut, and AltGr+Shift is not the release chord.
      const altGraph = event.getModifierState?.('AltGraph') ?? false;
      if (!altGraph && isReleaseChord(event)) return leaveKeyboard(event);
      if (event.key === 'Escape') return holdEscape(event);
      if (isPasteShortcut(event)) return armPasteFallback();
      event.preventDefault();

      const keysym = keysymFor(event);
      if (keysym !== undefined) pressKey(event, keysym, altGraph);
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

      if (isMac && event.key === 'CapsLock') {
        const capsLock = keysymFor(event);
        if (capsLock === undefined) return;
        options.send({ kind: 'key', keysym: capsLock, down: true });
        options.send({ kind: 'key', keysym: capsLock, down: false });
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
      clearTimeout(pasteFallback);
      pasteFallback = undefined;
      event.preventDefault();
      // This computer's text goes to the guest's clipboard, then pastes.
      options.send({ kind: 'clipboard', text });
      pasteInGuest();
    },
    /** Lets go of everything held in the guest; the session calls it before a hand-back. */
    releaseAll() {
      cancelEscapeHold();
      clearTimeout(pasteFallback);
      pasteFallback = undefined;
      releaseKeys();
    },
  };
}

export type ScreenInputController = ReturnType<typeof createScreenInput>;
