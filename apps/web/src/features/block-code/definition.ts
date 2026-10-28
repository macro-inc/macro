import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { storageServiceClient } from '@service-storage/client';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { supportedExtensions } from './util/languageSupport';

export const definition = defineBlock({
  name: 'code',
  description: 'Edit code files with syntax highlighting and formatting',
  aliases: [{ name: 'csv', defaultFileName: 'New CSV' }],
  component: lazy(() => import('./component/Block')),
  async load(source, intent) {
    if (intent === 'preload') {
      return ok({
        type: 'preload',
        origin:
          source.type === 'preload'
            ? source.origin
            : source.type === 'gen'
              ? source.origin
              : source,
      });
    }
    if (source.type !== 'dss') return LoadErrors.INVALID;
    const document = await loadResult(
      storageServiceClient.getTextDocument({
        documentId: source.id,
      })
    );
    if (document.isErr()) return err(document.error);
    const result = document.value;
    return ok(result);
  },

  accepted: Object.fromEntries(
    supportedExtensions.map((ext) => [ext, 'text/plain'])
  ),
  liveTrackingEnabled: true,
  syncServiceEnabled: false,
});

export type CodeData = ExtractLoadType<(typeof definition)['load']>;
