import { $getRoot, $isParagraphNode, type LexicalEditor } from 'lexical';
import { createSignal, onCleanup } from 'solid-js';

/** Only a single paragraph without line breaks can use the compact layout. */
export function createHasMultilineStructure(editor: LexicalEditor) {
  const read = () => {
    const root = $getRoot();
    const firstChild = root.getFirstChild();
    return (
      root.getChildrenSize() > 1 ||
      (firstChild !== null && !$isParagraphNode(firstChild)) ||
      root.getTextContent().includes('\n')
    );
  };

  const [hasMultilineStructure, setHasMultilineStructure] = createSignal(
    editor.getEditorState().read(read)
  );

  const unsubscribe = editor.registerUpdateListener(({ editorState }) => {
    setHasMultilineStructure(editorState.read(read));
  });

  onCleanup(unsubscribe);
  return hasMultilineStructure;
}
