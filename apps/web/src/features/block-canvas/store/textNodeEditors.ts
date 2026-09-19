import type { LexicalEditor } from 'lexical';
import { useCanvasDocument } from '../context/canvas-document-context';

export function useTextNodeEditors() {
  const [textNodeEditors, setTextNodeEditors] =
    useCanvasDocument().state.stores.textNodeEditors;

  return {
    getEditor: (nodeId: string) => textNodeEditors[nodeId],
    registerEditor: (nodeId: string, editor: LexicalEditor) => {
      setTextNodeEditors(nodeId, editor);
    },
    unregisterEditor: (nodeId: string) => {
      delete textNodeEditors[nodeId];
      setTextNodeEditors(textNodeEditors);
    },
  };
}
