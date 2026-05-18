import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { createLoroManager } from '@core/collab/manager';
import { ENABLE_MARKDOWN_LIVE_COLLABORATION } from '@core/constant/featureFlags';
import { isErr, ok } from '@core/util/maybeResult';
import { MARKDOWN_LORO_SCHEMA } from '@lexical-core/markdown-loro-schema';
import { waitForDocumentSyncServiceReady } from '@queries/storage/document-location';
import { storageServiceClient } from '@service-storage/client';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { createSyncServiceSource } from '@service-sync/source';
import MarkdownBlock from './component/Block';
import type { MarkdownRewriteOutput } from './signal/rewriteSignal';

export const definition = defineBlock({
  name: 'md',
  description: 'write markdown notes',
  defaultFilename: 'New Note',
  aliases: [{ name: 'task', defaultFileName: 'New Task' }],
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

      const [maybeDocument, maybeLocation, maybeToken] = await Promise.all([
        loadResult(storageServiceClient.getDocumentMetadata({ documentId })),
        loadResult(storageServiceClient.getDocumentLocation({ documentId })),
        storageServiceClient.permissionsTokens.createPermissionToken({
          document_id: documentId,
        }),
      ]);

      if (isErr(maybeToken)) {
        return LoadErrors.UNAUTHORIZED;
      }

      const [, { token }] = maybeToken;

      if (isErr(maybeDocument)) return maybeDocument;
      if (isErr(maybeLocation)) return maybeLocation;

      const [, documentResult] = maybeDocument;
      const { documentMetadata, userAccessLevel } = documentResult;
      let [, { data: location }] = maybeLocation;

      if (
        location.type === 'presignedUrl' &&
        location.content.state === 'pending'
      ) {
        location = await waitForDocumentSyncServiceReady({
          documentId,
        }).catch((error) => {
          console.error(
            'Failed waiting for markdown sync-service location',
            error
          );
          return location;
        });
      }

      // Markdown initialization and lifecycle persistence are backend-owned.
      // If a markdown document still resolves to object storage here, opening
      // it would require a backend repair/backfill path rather than a frontend
      // sync-service mutation that leaves DB content metadata inconsistent.
      if (location.type !== 'syncServiceContent') {
        console.error(
          'Markdown document is not available in sync-service',
          documentId,
          location.content
        );
        return LoadErrors.INVALID;
      }

      const syncServiceResult = await createSyncServiceSource(source.id, token);

      const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA);

      if (syncServiceResult.isErr()) {
        console.error('Failed to initialize sync');
        return LoadErrors.INVALID;
      }

      const { source: syncSource, initialSync } = syncServiceResult.value;

      let result = await loroManager.initializeFromSnapshot(
        initialSync.snapshot
      );

      if (isErr(result)) {
        console.error('Failed to initialize doc state', result);
        return LoadErrors.INVALID;
      }

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
        loroManager,
        documentMetadata,
      });
    }
    return LoadErrors.INVALID;
  },
  liveTrackingEnabled: true,
  syncServiceEnabled: ENABLE_MARKDOWN_LIVE_COLLABORATION,
  editPermissionEnabled: ENABLE_MARKDOWN_LIVE_COLLABORATION,
});

export type MarkdownData = ExtractLoadType<(typeof definition)['load']>;

export type MarkdownBlockSpec = {
  setPatches: (args: {
    patches: MarkdownRewriteOutput['diffs'];
  }) => Promise<void>;
  setIsRewriting: () => Promise<void>;
};
