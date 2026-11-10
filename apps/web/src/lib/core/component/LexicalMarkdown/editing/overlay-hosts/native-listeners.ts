import { Telemetry } from '@macro-inc/observability';

/** Own native overlay registrations, including partial installation failures. */
export function createNativeListenerScope() {
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const release = (failure?: { error: unknown }) => {
    if (disposed) {
      if (failure) throw failure.error;
      return;
    }
    disposed = true;
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        if (!failure) failure = { error };
        else {
          try {
            Telemetry.error(error, { surface: 'native-overlay-cleanup' });
          } catch {
            // A secondary exporter failure must not replace the original cause.
          }
        }
      }
    }
    if (failure) throw failure.error;
  };
  return {
    add(cleanup: () => void) {
      cleanups.push(cleanup);
    },
    dispose: () => release(),
    fail(error: unknown): never {
      release({ error });
      throw error;
    },
  };
}
