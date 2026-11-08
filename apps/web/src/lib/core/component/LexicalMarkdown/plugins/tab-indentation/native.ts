import {
  createViewCommand,
  type EditorView,
} from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';

const TAB = createViewCommand(
  'Key(Tab)',
  (value): value is KeyboardEvent => value instanceof KeyboardEvent
);

/** Native list, table and code handlers decide indentation in one admission. */
export function registerNativeTabIndentation(view: EditorView): () => void {
  return view.registerViewCommand(
    TAB,
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
