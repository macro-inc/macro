import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import BlockUnknown from './component/Block';

export const definition = defineBlock({
  name: 'unknown',
  description: 'fallback block for unknown files types',
  component: BlockUnknown,
  async load(source, intent) {
    if (source.type === 'dss') {
      const maybeDocument = await loadResult(
        storageServiceClient.getDocumentMetadata({ documentId: source.id })
      );

      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      if (isErr(maybeDocument)) return maybeDocument;

      const [, documentResult] = maybeDocument;

      const { documentMetadata, userAccessLevel } = documentResult;

      return ok({ documentMetadata, userAccessLevel });
    }
    return LoadErrors.INVALID;
  },
  liveTrackingEnabled: false,
  accepted: {},
});

export type UnknownFileData = ExtractLoadType<(typeof definition)['load']>;
