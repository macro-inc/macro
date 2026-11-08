import { waitForFeatureFlag } from '@app/lib/analytics/wait-for-feature-flag';
import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import {
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  rustEditorModel,
} from '@core/constant/featureFlags';
import { NOOP_SPAN } from '@macro-inc/observability';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { createMarkdownConnection } from './queries/markdown-connection';

export const definition = defineBlock({
  name: 'md',
  description: 'write markdown notes',
  defaultFilename: 'New Document',
  aliases: [
    { name: 'task', defaultFileName: 'New Task' },
    { name: 'snippet', defaultFileName: 'New Snippet' },
    { name: 'skill', defaultFileName: 'New Skill' },
  ],
  component: lazy(() => import('./component/Block')),
  accepted: {
    md: 'text/markdown',
  },
  async load(source, intent, parentSpan = NOOP_SPAN) {
    if (source.type === 'sync-service') {
      const documentId = source.id;
      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      return parentSpan.span('doc.load', async (loadSpan) => {
        const rustEditorEnabled = await waitForFeatureFlag(rustEditorModel);
        const context = await loadSpan.span('doc.load.context', () =>
          fetchSyncDocumentOpenContext(documentId)
        );
        if (context.isErr()) {
          loadSpan.error('load context failed');
          return err(context.error);
        }
        const { documentMetadata, userAccessLevel } = context.value;
        loadSpan.setAttr('doc.context.cached', context.value.fromCache);

        const connection = await createMarkdownConnection(
          documentId,
          context.value,
          parentSpan,
          rustEditorEnabled
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
          connection,
          ...(connection.type === 'sync'
            ? {
                syncSource: connection.source,
                doInitialSync: connection.doInitialSync,
              }
            : {}),
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
