import {
  createViewCommand,
  type EditorView,
} from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';

const ENTER = createViewCommand(
  'Key(Enter)',
  (value): value is KeyboardEvent => value instanceof KeyboardEvent
);

/** Route only Enter; ordinary typing never crosses the keydown boundary. */
export function registerNativeNormalizeEnter(view: EditorView): () => void {
  return view.registerViewCommand(
    ENTER,
    (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
        return false;
      return (
        dispatchApplicationCommand(view, 'group-b.key', null, event) !== false
      );
    },
    4
  );
}
