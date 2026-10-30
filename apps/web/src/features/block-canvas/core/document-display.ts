import type { GraphicsCommand } from '@macro-inc/graphics';

export const canEmbedDocument = (fileType: string) =>
  fileType === 'md' || fileType === 'canvas';

/** Presentation is durable; focus and input ownership stay local to the host. */
export const setDocumentDisplayCommand: GraphicsCommand<{
  id: string;
  display: 'preview' | 'embed';
}> = {
  id: 'set-document-display',
  apply: ({ document }, { id, display }) => {
    const item = document.items[id];
    if (
      item?.type !== 'document' ||
      (display === 'embed' && !canEmbedDocument(item.geometry.fileType)) ||
      (item.geometry.display ?? 'preview') === display
    )
      return { document };
    return {
      document: {
        ...document,
        items: {
          ...document.items,
          [id]: {
            ...item,
            geometry: { ...item.geometry, display },
          },
        },
      },
    };
  },
};
