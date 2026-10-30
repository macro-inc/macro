import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { requestDocumentMetadata } from '@queries/storage/requests';

import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'unknown',
  description: 'fallback block for unknown files types',
  component: lazy(() => import('./component/Block')),
  async load(source, intent) {
    if (source.type === 'dss') {
      const maybeDocument = await loadResult(
        requestDocumentMetadata({ documentId: source.id })
      );

      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      if (maybeDocument.isErr()) return err(maybeDocument.error);

      const documentResult = maybeDocument.value;

      const { documentMetadata, userAccessLevel } = documentResult;

      return ok({ documentMetadata, userAccessLevel });
    }
    return LoadErrors.INVALID;
  },
  liveTrackingEnabled: false,
  accepted: {},
});

export type UnknownFileData = ExtractLoadType<(typeof definition)['load']>;
