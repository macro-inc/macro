import { createBlockStore } from '@core/block';
import type { LexicalEditor } from 'lexical';

const textNodeEditorsStore = createBlockStore<Record<string, LexicalEditor>>(
  {}
);

export function useTextNodeEditors() {
  const [textNodeEditors, setTextNodeEditors] = textNodeEditorsStore;

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
