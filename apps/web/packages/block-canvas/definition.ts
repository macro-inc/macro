import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { blockAcceptedFileExtensionToMimeType } from '@core/constant/allBlocks';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { err, ok } from 'neverthrow';
import CanvasBlock from './component/Block';
import type { Canvas } from './model/CanvasModel';

export const definition = defineBlock({
  name: 'canvas',
  description: 'edit canvas',
  component: CanvasBlock,
  accepted: {
    canvas: 'application/x-macro-canvas',
  },
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type === 'dss') {
      const maybeDocument = await loadResult(
        fetchBinaryDocumentData(source.id)
      );

      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      if (maybeDocument.isErr()) return err(maybeDocument.error);
      const documentResult = maybeDocument.value;
      const { documentMetadata, blobUrl, userAccessLevel } = documentResult;

      const blobResult = await loadResult(fetchBinary(blobUrl, 'blob'));

      if (blobResult.isErr()) return err(blobResult.error);

      const blob = blobResult.value;

      const dssFile = await makeFileFromBlob({
        blob,
        documentKeyParts: {
          owner: documentMetadata.owner,
          documentId: documentMetadata.documentId,
          documentVersionId: documentMetadata.documentVersionId.toString(),
          // @ts-ignore: TODO: fix / replace @macro-inc/document-processing-job-types
          fileType: documentMetadata.fileType,
        },
        fileName: documentMetadata.documentName,
        // @sam-> I'm not sure how you are trying to create this file here and how the documentMetadata.fileType compares to what you are storing in DSS. I'm guessing it's all application/json.
        // alternatively you could just cast as 'canvas'. Previously this was cast as 'json' but I don't think that's what we want.
        mimeType:
          blockAcceptedFileExtensionToMimeType[
            documentMetadata.fileType ?? 'canvas'
          ],
        // @ts-ignore: TODO: fix / replace @macro-inc/document-processing-job-types
        metadata: documentMetadata,
      });

      return ok({ dssFile, userAccessLevel, documentMetadata });
    }

    return LoadErrors.INVALID;
  },
});

export type CanvasData = ExtractLoadType<(typeof definition)['load']>;

export type CanvasSpec = {
  exportCanvas: () => Promise<Canvas>;
};
