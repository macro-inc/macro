import type { GraphicsDocument, GraphicsEditor } from '@macro-inc/graphics';
import { createSignal } from 'solid-js';
import { canEmbedDocument } from '../core/document-display';

export function createEmbedState(
  editor: GraphicsEditor,
  document: GraphicsDocument,
  prepare: () => void
) {
  const [activeId, setActiveId] = createSignal<string>();
  const active = () => {
    const id = activeId();
    const item = id ? document.items[id] : undefined;
    return item?.type === 'document' &&
      item.geometry.display === 'embed' &&
      canEmbedDocument(item.geometry.fileType)
      ? id
      : undefined;
  };
  return {
    active,
    enter(id: string) {
      const item = document.items[id];
      if (
        item?.type !== 'document' ||
        item.geometry.display !== 'embed' ||
        !canEmbedDocument(item.geometry.fileType)
      )
        return;
      prepare();
      editor.select(id);
      setActiveId(id);
    },
    exit: () => setActiveId(undefined),
  };
}
