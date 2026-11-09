import type { Span } from '@macro-inc/observability';
import { waitForFrames } from '../util/sleep';
import type { DocumentSessionModule } from './load';

/** Complete cold paste preparation after the shell has had a paint opportunity. */
export async function prepareEditorEngine(
  module: Pick<DocumentSessionModule, 'prepareMacroPaste'>,
  span: Span
): Promise<void> {
  await waitForFrames(2);
  await new Promise<void>((resolve) => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
  const preparation = span.span('paste.prepare');
  try {
    module.prepareMacroPaste();
  } finally {
    preparation.end();
  }
}
