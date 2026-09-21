import { type ExportResult, ExportResultCode } from '@opentelemetry/core';

type Exporter<T> = {
  export(records: T[], callback: (result: ExportResult) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
};

/** Drop a batch at the last boundary, including batches created before privacy was enabled. */
export function disclosureExporter<T>(
  inner: Exporter<T>,
  allowed?: () => boolean
): Exporter<T> & { forceFlush(): Promise<void> } {
  return {
    export(records, callback) {
      if (allowed && !allowed()) {
        callback({ code: ExportResultCode.SUCCESS });
        return;
      }
      inner.export(records, callback);
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}
