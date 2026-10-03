import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ENABLE_MARKDOWN_LIVE_COLLABORATION } from '@core/constant/featureFlags';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { createSyncServiceSource } from '@service-sync/source';
import { err, ok } from 'neverthrow';
import MarkdownBlock from './component/Block';
import {
  endDocumentSpan,
  registerDocumentSpan,
  resumeDocumentSpan,
  startDocumentSpan,
} from './observability';

export const definition = defineBlock({
  name: 'md',
  description: 'write markdown notes',
  defaultFilename: 'New Note',
  aliases: [
    { name: 'task', defaultFileName: 'New Task' },
    { name: 'snippet', defaultFileName: 'New Snippet' },
    { name: 'skill', defaultFileName: 'New Skill' },
  ],
  component: MarkdownBlock,
  accepted: {
    md: 'text/markdown',
  },
  async load(source, intent) {
    if (source.type === 'sync-service') {
      const documentId = source.id;
      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      let rootSpan = resumeDocumentSpan(documentId);
      if (!rootSpan) {
        rootSpan = startDocumentSpan('doc.open');
        rootSpan.setAttr('doc.type', 'md');
        rootSpan.setAttr('document.id', documentId);
        registerDocumentSpan(documentId, rootSpan);
      }
      return rootSpan.span('doc.load', async (loadSpan) => {
        const context = await loadSpan.span('doc.load.context', () =>
          fetchSyncDocumentOpenContext(documentId)
        );
        if (context.isErr()) {
          loadSpan.error('load context failed');
          rootSpan.error('load context failed');
          endDocumentSpan(documentId);
          return err(context.error);
        }
        const { token, authorization, documentMetadata, userAccessLevel } =
          context.value;
        loadSpan.setAttr('doc.context.cached', context.value.fromCache);

        const { source: syncSource, doInitialSync } = createSyncServiceSource(
          source.id,
          token,
          authorization
        );

        // HACK: unfortunately, most blocks still rely on a dssFile for things like
        // metadata and fileName. so I'm creating an empty blob file to get around that.
        const fileWithoutBlob = await makeFileFromBlob({
          blob: new Blob([]),
          documentKeyParts: {
            owner: documentMetadata.owner,
            documentId: documentMetadata.documentId,
            documentVersionId: documentMetadata.documentVersionId.toString(),
            // @ts-ignore: TODO: fix / replace @macro-inc/document-processing-job-types
            fileType: 'md',
          },
          fileName: documentMetadata.documentName,
          mimeType: definition.accepted['md']!,
          // @ts-ignore: TODO: fix / replace @macro-inc/document-processing-job-types
          metadata: documentMetadata,
        });

        return ok({
          dssFile: fileWithoutBlob,
          userAccessLevel,
          syncSource,
          doInitialSync,
          documentMetadata,
        });
      });
    }
    return LoadErrors.INVALID;
  },
  liveTrackingEnabled: true,
  syncServiceEnabled: ENABLE_MARKDOWN_LIVE_COLLABORATION,
  editPermissionEnabled: ENABLE_MARKDOWN_LIVE_COLLABORATION,
});

export type MarkdownData = ExtractLoadType<(typeof definition)['load']>;
