import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { readSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';

/** One session admission; all tree reads and policy execute in the native model. */
export function dispatchApplicationCommand(
  view: EditorView,
  name: string,
  payload: JsonValue,
  event?: KeyboardEvent
): boolean | undefined {
  const generation = view.mirror.keyGeneration;
  if (generation === null) return false;
  const cached = view.selection().selection;
  const resolved =
    cached.kind === 'node' || cached.kind === 'table'
      ? ({ kind: 'keep' } as const)
      : readSelection(view);
  const selection =
    resolved.kind === 'none' ? ({ kind: 'keep' } as const) : resolved;
  let handled: boolean | undefined;
  view.port.input(
    EditorInputMsg.fromEditorApplication({
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
    }),
    (result) => {
      handled = result;
    }
  );
  return handled;
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
