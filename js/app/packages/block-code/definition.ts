import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import BlockCode from './component/Block';
import { supportedExtensions } from './util/languageSupport';

export const definition = defineBlock({
  name: 'code',
  description: 'Edit code files with syntax highlighting and formatting',
  component: BlockCode,
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
    if (isErr(document)) return document;
    const [, result] = document;
    return ok(result);
  },

  accepted: Object.fromEntries(
    supportedExtensions.map((ext) => [ext, 'text/plain'])
  ),
  liveTrackingEnabled: true,
  syncServiceEnabled: false,
});

export type CodeData = ExtractLoadType<(typeof definition)['load']>;
