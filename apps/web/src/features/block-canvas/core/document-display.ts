import type { GraphicsCommand } from '@macro-inc/graphics';

export const canEmbedDocument = (fileType: string) =>
  fileType === 'md' || fileType === 'canvas' || fileType === 'artifact';

/** Artifacts are pages to look at, so they arrive embedded and page-sized. */
export function insertedDocumentBox(
  fileType: string,
  display: 'preview' | 'embed'
) {
  if (display === 'preview') return { width: 340, height: 136 };
  if (fileType === 'artifact') return { width: 960, height: 600 };
  return { width: 640, height: 480 };
}

/** Points an artifact node at one of its scenes, or its index when undefined. */
export const setDocumentSubpathCommand: GraphicsCommand<{
  id: string;
  subpath: string | undefined;
}> = {
  id: 'set-document-subpath',
  apply: ({ document }, { id, subpath }) => {
    const item = document.items[id];
    if (item?.type !== 'document' || item.geometry.subpath === subpath)
      return { document };
    const { subpath: _previous, ...geometry } = item.geometry;
    return {
      document: {
        ...document,
        items: {
          ...document.items,
          [id]: {
            ...item,
            geometry:
              subpath === undefined ? geometry : { ...geometry, subpath },
          },
        },
      },
    };
  },
};

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
            // An artifact card and an artifact page have their own sizes.
            geometry:
              item.geometry.fileType === 'artifact'
                ? {
                    ...item.geometry,
                    ...insertedDocumentBox('artifact', display),
                    display,
                  }
                : { ...item.geometry, display },
          },
        },
      },
    };
  },
};
