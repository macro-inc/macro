import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { blockAcceptedFileExtensionToMimeType } from '@core/constant/allBlocks';
import { catchToResult } from '@core/util/result';
import { fetchFileDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import type { CanvasFile } from './core/document-format';
import { loadCanvasDocument } from './queries/document';

export const definition = defineBlock({
  name: 'canvas',
  description: 'edit canvas',
  component: lazy(() => import('./component/Block')),
  accepted: {
    canvas: 'application/x-macro-canvas',
  },
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type === 'dss') {
      if (intent === 'preload') {
        await fetchFileDocumentOpenContext(source.id);
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      const maybeDocument = await loadResult(
        catchToResult(() => loadCanvasDocument(source.id))
      );
      if (maybeDocument.isErr()) return err(maybeDocument.error);
      const documentResult = maybeDocument.value;
      const { documentMetadata, userAccessLevel } = documentResult;
      if (documentResult.shared) {
        return ok({
          documentMetadata,
          userAccessLevel,
          shared: true as const,
        });
      }
      const blob = documentResult.file;

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

      return ok({
        dssFile,
        userAccessLevel,
        documentMetadata,
        shared: false as const,
      });
    }

    return LoadErrors.INVALID;
  },
});

export type CanvasData = ExtractLoadType<(typeof definition)['load']>;

export type CanvasSpec = {
  exportCanvas: () => Promise<CanvasFile>;
};
