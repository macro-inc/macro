import { $getRoot, type LexicalEditor } from 'lexical';
import { createSignal, onCleanup } from 'solid-js';

/** Track explicit line breaks, including blank paragraphs, for composer layout. */
export function createHasLineBreaks(editor: LexicalEditor) {
  const read = () => {
    const root = $getRoot();
    return root.getChildrenSize() > 1 || root.getTextContent().includes('\n');
  };

  const [hasLineBreaks, setHasLineBreaks] = createSignal(
    editor.getEditorState().read(read)
  );

  const unsubscribe = editor.registerUpdateListener(({ editorState }) => {
    setHasLineBreaks(editorState.read(read));
  });

  onCleanup(unsubscribe);
  return hasLineBreaks;
}
