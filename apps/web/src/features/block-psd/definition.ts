import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { enablePsdEditor, isFeatureEnabled } from '@core/constant/featureFlags';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';

/** Photoshop documents, large ones (`.psb`) too. */
export const PSD_MIME = 'image/vnd.adobe.photoshop';

export const definition = defineBlock({
  name: 'psd',
  description: 'edit Photoshop documents',
  accepted: {
    psd: PSD_MIME,
    psb: PSD_MIME,
  },
  component: lazy(() => import('./psd-block')),
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type !== 'dss') return LoadErrors.INVALID;
    const maybeDocument = await loadResult(fetchBinaryDocumentData(source.id));
    if (intent === 'preload') {
      return ok({ type: 'preload', origin: source });
    }
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { blobUrl, ...documentFile } = maybeDocument.value;
    // With the editor off, the block offers the file for download.
    if (!isFeatureEnabled(enablePsdEditor)) {
      return ok({ ...documentFile, blobUrl, bytes: null });
    }
    const maybeBytes = await loadResult(fetchBinary(blobUrl, 'arraybuffer'));
    if (maybeBytes.isErr()) return err(maybeBytes.error);
    return ok({ ...documentFile, blobUrl, bytes: maybeBytes.value });
  },
});

export type PsdData = ExtractLoadType<(typeof definition)['load']>;
