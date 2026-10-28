import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { enableAiEditor, isFeatureEnabled } from '@core/constant/featureFlags';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';

/** The type `.ai` documents are stored as. */
export const AI_MIME: string = FileTypeMap.ai.mime;

export const definition = defineBlock({
  name: 'ai',
  description: 'edit Illustrator files',
  accepted: {
    ai: AI_MIME,
  },
  component: lazy(() => import('./ai-block')),
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type !== 'dss') return LoadErrors.INVALID;
    const maybeDocument = await loadResult(fetchBinaryDocumentData(source.id));
    if (intent === 'preload') {
      return ok({ type: 'preload', origin: source });
    }
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { blobUrl, ...documentFile } = maybeDocument.value;
    // With the editor off, the block offers the file for download as before.
    if (!isFeatureEnabled(enableAiEditor)) {
      return ok({ ...documentFile, blobUrl, bytes: null });
    }
    const maybeBytes = await loadResult(fetchBinary(blobUrl, 'arraybuffer'));
    if (maybeBytes.isErr()) return err(maybeBytes.error);
    return ok({ ...documentFile, blobUrl, bytes: maybeBytes.value });
  },
});

export type AiData = ExtractLoadType<(typeof definition)['load']>;
