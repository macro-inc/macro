import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import {
  enablePptxEditor,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'pptx',
  description: 'view and edit PowerPoint presentations',
  accepted: {
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  component: lazy(() => import('./pptx-block')),
  liveTrackingEnabled: true,
  editPermissionEnabled: true,
  async load(source, intent) {
    if (source.type !== 'dss') return LoadErrors.INVALID;
    const maybeDocument = await loadResult(fetchBinaryDocumentData(source.id));
    if (intent === 'preload') {
      return ok({ type: 'preload', origin: source });
    }
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { blobUrl, ...documentFile } = maybeDocument.value;
    // With the editor off, the block offers the file for download as before.
    if (!isFeatureEnabled(enablePptxEditor)) {
      return ok({ ...documentFile, blobUrl, bytes: null });
    }
    const maybeBytes = await loadResult(fetchBinary(blobUrl, 'arraybuffer'));
    if (maybeBytes.isErr()) return err(maybeBytes.error);
    return ok({ ...documentFile, blobUrl, bytes: maybeBytes.value });
  },
});

export type PptxData = ExtractLoadType<(typeof definition)['load']>;
