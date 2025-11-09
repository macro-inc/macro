import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'image',
  description: 'views images',
  component: lazy(() => import('./component/Block')),
  accepted: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  },
  async load(source, intent) {
    if (source.type === 'dss') {
      const maybeDocument = await loadResult(
        storageServiceClient.getBinaryDocument({ documentId: source.id })
      );

      if (intent === 'preload')
        return ok({
          type: 'preload',
          origin: source,
        });

      if (isErr(maybeDocument)) return maybeDocument;

      const [, documentResult] = maybeDocument;

      const { documentMetadata, blobUrl, userAccessLevel } = documentResult;

      const blobResult = await loadResult(fetchBinary(blobUrl, 'blob'));

      if (isErr(blobResult)) return blobResult;
      const [, blob] = blobResult;

      const dssFile = await makeFileFromBlob({
        blob,
        documentKeyParts: {
          owner: documentMetadata.owner,
          documentId: documentMetadata.documentId,
          documentVersionId: documentMetadata.documentVersionId.toString(),
          // @ts-ignore: documentKeyParts.fileType is only pdf or docx
          fileType: documentMetadata.fileType,
        },
        fileName: documentMetadata.documentName,
        mimeType:
          definition.accepted[
            documentMetadata.fileType as keyof typeof definition.accepted
          ]!,
        // @ts-ignore: TODO: fix / replace @macro-inc/document-processing-job-types
        metadata: documentMetadata,
      });

      return ok({ dssFile, userAccessLevel, documentMetadata });
    }

    return LoadErrors.INVALID;
  },
});

export type ImageData = ExtractLoadType<(typeof definition)['load']>;
