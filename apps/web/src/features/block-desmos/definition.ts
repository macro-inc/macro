import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import {
  enableDesmosEditor,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { DESMOS_MIME } from './core/document';

export { DESMOS_MIME };

export const definition = defineBlock({
  name: 'desmos',
  description: 'Graph expressions with Desmos',
  accepted: {
    desmos: DESMOS_MIME,
  },
  defaultFilename: 'Untitled graph',
  component: lazy(() => import('./desmos-block')),
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type !== 'dss') return LoadErrors.INVALID;
    const maybeDocument = await loadResult(fetchBinaryDocumentData(source.id));
    if (intent === 'preload') {
      return ok({ type: 'preload' as const, origin: source });
    }
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { blobUrl, ...documentFile } = maybeDocument.value;
    if (!isFeatureEnabled(enableDesmosEditor)) {
      return ok({ ...documentFile, blobUrl, text: null });
    }
    const maybeBytes = await loadResult(fetchBinary(blobUrl, 'arraybuffer'));
    if (maybeBytes.isErr()) return err(maybeBytes.error);
    const text = new TextDecoder().decode(maybeBytes.value);
    return ok({ ...documentFile, blobUrl, text });
  },
});

export type DesmosData = ExtractLoadType<(typeof definition)['load']>;
