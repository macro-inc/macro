import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { createLoroManager } from '@core/collab/manager';
import { rawStateToLoroSnapshot } from '@core/collab/utils';
import { serializedStateFromBlob } from '@core/component/LexicalMarkdown/collaboration/utils';
import { ENABLE_MARKDOWN_LIVE_COLLABORATION } from '@core/constant/featureFlags';
import { isErr, ok } from '@core/util/maybeResult';
import { type SchemaType, schema } from '@loro-mirror/packages/core/src';
import type { MarkdownRewriteOutput } from '@service-cognition/generated/tools/types';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { makeFileFromBlob } from '@service-storage/util/makeFileFromBlob';
import { untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { syncServiceClient } from '../service-sync/client';
import { createSyncServiceSource } from '../service-sync/source';
import MarkdownBlock from './component/Block';

const nodeSchema = schema.LoroMap({
  $: schema.LoroMap({} as any, {
    required: false,
  }),
  text: schema.LoroText({
    required: false,
  }),
  children: schema.LoroMovableList(
    {} as SchemaType,
    (item) => {
      const id = item?.$?.id;
      if (!id) {
        console.error('no id for item', item);
      }
      return id;
    },
    {
      required: false,
    }
  ),
});

nodeSchema.definition.children.itemSchema = nodeSchema;

export const MARKDOWN_LORO_SCHEMA = schema({
  root: nodeSchema,
});

/** 5 second cache timeout */
const CACHE_THRESHOLD = 5000;
const [existsCache, setExistsCache] = createStore<
  Record<
    string,
    | {
        exists: boolean;
        fetchedAt: number;
      }
    | undefined
  >
>({});

const getExists = async (documentId: string): Promise<boolean> => {
  const existsResult = await syncServiceClient.exists({
    documentId,
  });
  if (isErr(existsResult)) return false;
  const [, { exists: existsResultExists }] = existsResult;
  return existsResultExists;
};

const prefetchExists = async (documentId: string) => {
  const exists = await getExists(documentId);
  setExistsCache(documentId, {
    exists,
    fetchedAt: Date.now(),
  });
};

const fetchExists = async (documentId: string) => {
  const cached = untrack(() => existsCache[documentId]);
  if (cached && cached.fetchedAt + CACHE_THRESHOLD > Date.now()) {
    setExistsCache(documentId, undefined);
    return cached.exists;
  }
  const exists = await getExists(documentId);
  return exists;
};

/**
 * Migrates a document from dss to the sync-service.
 * Should only be called if the document does not exist in the sync-service
 *
 * @param documentId - The document id to migrate
 **/
const migrateToSyncService = async (documentId: string) => {
  const maybeFullDocument = await loadResult(
    storageServiceClient.getBinaryDocument({ documentId })
  );

  if (isErr(maybeFullDocument)) return maybeFullDocument;
  const [, { blobUrl }] = maybeFullDocument;

  const blobResult = await loadResult(fetchBinary(blobUrl, 'blob'));

  if (isErr(blobResult)) return blobResult;

  const [, blob] = blobResult;

  const state = await serializedStateFromBlob(blob);

  if (!state) {
    console.error('Failed to parse blob as serialized state');
    return LoadErrors.INVALID;
  }

  const snapshot = await rawStateToLoroSnapshot(
    MARKDOWN_LORO_SCHEMA,
    state as any
  );

  if (!snapshot) {
    console.error('Failed to create snapshot from blob');
    return LoadErrors.INVALID;
  }

  let res = await syncServiceClient.initializeFromSnapshot({
    snapshot: snapshot as any,
    documentId: documentId,
  });

  if (isErr(res)) {
    console.error('Failed to initialize from snapshot', res);
    return LoadErrors.INVALID;
  }

  return ok(undefined);
};

export const definition = defineBlock({
  name: 'md',
  description: 'write markdown notes',
  defaultFilename: 'New Note',
  component: MarkdownBlock,
  accepted: {
    md: 'text/markdown',
  },
  async load(source, intent) {
    if (source.type === 'sync-service') {
      const documentId = source.id;
      if (intent === 'preload') {
        await prefetchExists(documentId);
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      const [maybeDocument, exists, maybeToken] = await Promise.all([
        loadResult(storageServiceClient.getDocumentMetadata({ documentId })),
        fetchExists(documentId),
        storageServiceClient.permissionsTokens.createPermissionToken({
          document_id: documentId,
        }),
      ]);

      if (isErr(maybeToken)) {
        return LoadErrors.UNAUTHORIZED;
      }

      const [, { token }] = maybeToken;

      if (isErr(maybeDocument)) return maybeDocument;

      const [, documentResult] = maybeDocument;
      const { documentMetadata, userAccessLevel } = documentResult;

      // If the document does not exist in the sync-service,
      // but it does exist in dss we should try and initialize it.
      if (!exists) {
        const migrationResult = await migrateToSyncService(documentId);
        if (isErr(migrationResult)) return migrationResult;
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
