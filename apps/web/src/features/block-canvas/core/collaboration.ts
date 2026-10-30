import {
  createLoroSeed,
  readLoroGraphicsDocument,
} from '@macro-inc/graphics/loro';
import { LoroDoc } from 'loro-crdt';
import { type CanvasFile, readCanvasFile } from './document-format';

const FORMAT = 1;

/** Only the server's winning seed is imported; never merge independent seeds. */
export function createCanvasSeed(
  file: CanvasFile,
  documentId?: string
): Uint8Array {
  const doc = new LoroDoc();
  try {
    doc.import(createLoroSeed(file.document));
    doc.setPeerId('0');
    const meta = doc.getMap('canvasMeta');
    meta.set('format', FORMAT);
    // Preserve migration and extension metadata without duplicating the scene.
    const { document, ...metadata } = file;
    meta.set('file', JSON.stringify(metadata));
    meta.set('rootId', document.rootId);
    if (documentId && file.referenceTracking?.sourceId === documentId) {
      const mentions = doc.getMap(`canvasMentions:${documentId}`);
      const retiring = doc.getMap(`canvasRetiring:${documentId}`);
      for (const mention of file.referenceTracking.mentions)
        mentions.set(mention.mentionId, mention.targetId);
      for (const id of file.referenceTracking.pendingRemoval)
        retiring.set(id, true);
    }
    doc.commit();
    return doc.export({ mode: 'snapshot' });
  } finally {
    doc.free();
  }
}

/** JSON exports and rendering always read the current shared scene. */
export function readSharedCanvas(
  doc: LoroDoc,
  documentId?: string
): CanvasFile {
  const meta = doc.getMap('canvasMeta');
  const format = meta.get('format');
  const rootId = meta.get('rootId');
  const file = meta.get('file');
  if (
    format !== FORMAT ||
    typeof rootId !== 'string' ||
    typeof file !== 'string'
  )
    throw new Error(
      'This canvas uses an unsupported shared format. Update Macro to open it.'
    );
  return readCanvasFile({
    ...JSON.parse(file),
    ...(documentId
      ? {
          referenceTracking: {
            sourceId: documentId,
            mentions: Object.entries(
              doc.getMap(`canvasMentions:${documentId}`).toJSON()
            ).flatMap(([mentionId, targetId]) =>
              typeof targetId === 'string' ? [{ mentionId, targetId }] : []
            ),
            pendingRemoval: doc.getMap(`canvasRetiring:${documentId}`).keys(),
          },
        }
      : {}),
    document: readLoroGraphicsDocument(doc, rootId),
  });
}
