/** An application key admission; native command priorities remain authoritative. */
export interface KeyRoute {
  readonly name: string;
  readonly json: string;
}

export interface ViewCommand<P> {
  readonly name: string;
  readonly accepts: (payload: unknown) => payload is P;
}
export type ViewCommandPriority = 0 | 1 | 2 | 3 | 4;
export interface ViewListener {
  readonly priority: ViewCommandPriority;
  readonly invoke: (payload: unknown) => boolean;
}
export function createViewCommand<P>(
  name: string,
  accepts: (payload: unknown) => payload is P
): ViewCommand<P> {
  return Object.freeze({ name, accepts });
}
export const KEY_DOWN_COMMAND = createViewCommand(
  'KeyDown',
  (payload): payload is KeyboardEvent => payload instanceof KeyboardEvent
);
export const CLICK_COMMAND = createViewCommand(
  'Click',
  (payload): payload is MouseEvent => payload instanceof MouseEvent
);
export const POINTER_DOWN_COMMAND = createViewCommand(
  'PointerDown',
  (payload): payload is PointerEvent => payload instanceof PointerEvent
);
export const PASTE_COMMAND = createViewCommand(
  'Paste',
  (payload): payload is ClipboardEvent => payload instanceof ClipboardEvent
);
export const DROP_COMMAND = createViewCommand(
  'Drop',
  (payload): payload is DragEvent => payload instanceof DragEvent
);
