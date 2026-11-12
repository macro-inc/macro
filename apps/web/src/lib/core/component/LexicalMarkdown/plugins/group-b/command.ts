import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import { readSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import type {
  JsonValue,
  ViewSelection,
} from '@macro-inc/lexical-wasm-view/view/types';

/** One session admission; all tree reads and policy execute in the native model. */
function applicationInput(
  view: EditorView,
  name: string,
  payload: JsonValue,
  event?: KeyboardEvent,
  at?: ViewSelection
): EditorInputMsg | undefined {
  const generation = view.mirror.keyGeneration;
  if (generation === null) return undefined;
  const cached = view.selection().selection;
  // Source application updates keep a null, node or table selection; only a
  // published range follows the browser's current DOM range. A caller that
  // restores a captured Source selection passes it as `at`.
  const resolved =
    at ??
    (cached.kind === 'node' || cached.kind === 'table' || cached.kind === 'none'
      ? ({ kind: 'keep' } as const)
      : readSelection(view));
  const selection =
    resolved.kind === 'none' ? ({ kind: 'keep' } as const) : resolved;
  return EditorInputMsg.fromEditorApplication({
    name,
    json: JSON.stringify(payload),
    generation,
    selection: selectionMessage(selection),
    keyboard: event !== undefined,
    key: event?.key ?? '',
    mods: event
      ? Number(event.shiftKey) |
        (Number(event.altKey) << 1) |
        (Number(event.ctrlKey) << 2) |
        (Number(event.metaKey) << 3) |
        (Number(event.repeat) << 4) |
        (Number(event.isComposing) << 5)
      : 0,
    code: event?.keyCode ?? 0,
  });
}

/** One session admission; all tree reads and policy execute in the native model. */
export function dispatchApplicationCommand(
  view: EditorView,
  name: string,
  payload: JsonValue,
  event?: KeyboardEvent,
  after?: (handled: boolean) => void
): boolean | undefined {
  const input = applicationInput(view, name, payload, event);
  if (!input) return false;
  let handled: boolean | undefined;
  view.port.input(input, (result) => {
    handled = result;
    after?.(result);
  });
  return handled;
}

/** Renderer-derived writes use current native access inside the serialized admission. */
export function dispatchApplicationCommandIfSessionEdit(
  view: EditorView,
  name: string,
  payload: JsonValue,
  after?: (handled: boolean) => void
): void {
  if (!(view.port instanceof SessionPort))
    throw new Error(
      'Session-edit application commands require the native session port'
    );
  const input = applicationInput(view, name, payload);
  if (input) view.port.inputIfSessionEdit(input, after);
}

/** One immutable bulk read, rejecting a reply against a retired mirror generation. */
export function queryApplication(
  view: EditorView,
  name: string,
  data: JsonValue
): unknown {
  const generation = view.mirror.keyGeneration;
  if (generation === null) return null;
  const reply = view.port.query({
    kind: 9,
    key: 0,
    flags: generation,
    text: JSON.stringify({ name, data }),
  });
  const value: unknown = JSON.parse(reply.text);
  return value;
}

/** Settle actual native execution; never infer completion from a dispatch return. */
export function dispatchApplicationCommandSettled(
  view: EditorView,
  name: string,
  payload: JsonValue,
  event?: KeyboardEvent
): Promise<InputSettlement> {
  if (!(view.port instanceof SessionPort))
    throw new Error(
      'Settled application commands require the native session port'
    );
  const input = applicationInput(view, name, payload, event);
  if (!input) throw new Error('Native view generation is unavailable');
  return view.port.inputSettled(input, event);
}

/**
 * Check current session access before evaluating a queued application payload.
 * `at` admits the command at a captured selection instead of the live one.
 */
export function dispatchApplicationCommandSettledIfSessionEdit(
  view: EditorView,
  name: string,
  payload: () => JsonValue,
  at?: () => ViewSelection
): Promise<InputSettlement> {
  if (!(view.port instanceof SessionPort))
    throw new Error(
      'Settled application commands require the native session port'
    );
  const generation = view.mirror.keyGeneration;
  if (!view.isMounted || generation === null)
    throw new Error('Native view generation is unavailable');
  return view.port.inputSettledIfSessionEdit(() => {
    if (!view.isMounted || view.mirror.keyGeneration !== generation)
      throw new Error('Native view generation changed before admission');
    const input = applicationInput(view, name, payload(), undefined, at?.());
    if (
      !view.isMounted ||
      view.mirror.keyGeneration !== generation ||
      !input?.isEditorApplication() ||
      input.value.generation !== generation
    )
      throw new Error('Native view generation changed during admission');
    return input.value;
  });
}
