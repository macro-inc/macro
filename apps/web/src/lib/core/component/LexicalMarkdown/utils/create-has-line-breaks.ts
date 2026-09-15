import { $getRoot, type LexicalEditor } from 'lexical';
import { createSignal, onCleanup } from 'solid-js';

/** Preserve blank lines that markdown serialization trims from a draft. */
export function createHasLineBreaks(editor: LexicalEditor) {
  const [hasLineBreaks, setHasLineBreaks] = createSignal(false);
  const read = () => {
    const root = $getRoot();
    return root.getChildrenSize() > 1 || root.getTextContent().includes('\n');
  };
  setHasLineBreaks(editor.getEditorState().read(read));
  onCleanup(
    editor.registerUpdateListener(({ editorState }) => {
      setHasLineBreaks(editorState.read(read));
    })
  );
  return hasLineBreaks;
}
