import { FigEngine } from '@core/fig-engine/client';
import { fileFingerprint } from '../core/collab-entries';

/** Open and fingerprint concurrently; the caller owns the resulting engine. */
export async function openFigEngine(
  bytes: ArrayBuffer,
  onFailure: (error: Error) => void
) {
  const [opened, fingerprint] = await Promise.allSettled([
    FigEngine.open(bytes, { onFailure }),
    fileFingerprint(bytes),
  ]);
  if (opened.status === 'rejected') throw opened.reason;
  if (fingerprint.status === 'rejected') {
    opened.value.close();
    throw fingerprint.reason;
  }
  return { engine: opened.value, fingerprint: fingerprint.value };
}

/**
 * Start parsing while the collaboration transport connects. A host takes
 * ownership once sync is ready. Recovery hosts always open a fresh engine,
 * so a replaced Loro document never inherits edits from the old instance.
 */
export function prepareFigEngine(bytes: ArrayBuffer) {
  let claimed = false;
  let disposed = false;
  let failure: Error | undefined;
  let reportFailure: ((error: Error) => void) | undefined;
  const pending = start();

  async function start() {
    try {
      const opened = await openFigEngine(bytes, (error) => {
        failure = error;
        reportFailure?.(error);
      });
      return { opened };
    } catch (error) {
      // Keep an early failure handled until the host takes the result.
      return { error };
    }
  }

  return {
    async take(onFailure: (error: Error) => void) {
      if (disposed) throw new Error('The design was closed.');
      if (claimed) return openFigEngine(bytes, onFailure);
      claimed = true;
      reportFailure = onFailure;
      if (failure) onFailure(failure);
      const result = await pending;
      if (!result.opened) throw result.error;
      return result.opened;
    },
    async dispose() {
      disposed = true;
      const result = await pending;
      if (!claimed) result.opened?.engine.close();
    },
  };
}
