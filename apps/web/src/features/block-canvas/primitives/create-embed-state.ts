import type { GraphicsDocument, GraphicsEditor } from '@macro-inc/graphics';
import { createSignal } from 'solid-js';
import { canEmbedDocument } from '../core/document-display';

export function createEmbedState(
  editor: GraphicsEditor,
  document: GraphicsDocument,
  prepare: () => void
) {
  const [activeId, setActiveId] = createSignal<string>();
  const canEnter = (id: string) => {
    const item = document.items[id];
    if (item?.type === 'artifact') return true;

    return (
      item?.type === 'document' &&
      item.geometry.display === 'embed' &&
      canEmbedDocument(item.geometry.fileType)
    );
  };
  const active = () => {
    const id = activeId();
    return id && canEnter(id) ? id : undefined;
  };
  return {
    active,
    enter(id: string) {
      if (!canEnter(id)) return;
      prepare();
      editor.select(id);
      setActiveId(id);
    },
    exit: () => setActiveId(undefined),
  };
}
