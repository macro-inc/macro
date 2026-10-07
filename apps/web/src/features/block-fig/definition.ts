import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { enableFigViewer, isFeatureEnabled } from '@core/constant/featureFlags';
import { compiledFigModule } from '@core/fig-engine/compiled-module';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { FigOpening } from './components/fig-opening';

export const FIG_MIME = 'application/x-figma';

async function warmEngine() {
  try {
    await compiledFigModule();
  } catch {
    // Opening the engine retries a failed warmup and reports the error.
  }
}

export const definition = defineBlock({
  name: 'fig',
  description: 'view Figma design files',
  accepted: {
    fig: FIG_MIME,
  },
  component: lazy(() => import('./fig-block')),
  loading: FigOpening,
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type !== 'dss') return LoadErrors.INVALID;
    if (intent !== 'preload' && isFeatureEnabled(enableFigViewer)) {
      // Fetch and compile while storage retrieves the document.
      void warmEngine();
    }
    const maybeDocument = await loadResult(fetchBinaryDocumentData(source.id));
    if (intent === 'preload') {
      return ok({ type: 'preload', origin: source });
    }
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { blobUrl, ...documentFile } = maybeDocument.value;
    // With the viewer off, the block offers the file for download as before.
    if (!isFeatureEnabled(enableFigViewer)) {
      return ok({ ...documentFile, blobUrl, bytes: null });
    }
    const maybeBytes = await loadResult(fetchBinary(blobUrl, 'arraybuffer'));
    if (maybeBytes.isErr()) return err(maybeBytes.error);
    return ok({ ...documentFile, blobUrl, bytes: maybeBytes.value });
  },
});

export type FigData = ExtractLoadType<(typeof definition)['load']>;
