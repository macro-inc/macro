import { toast } from '@core/component/Toast/Toast';
import { createSignal } from 'solid-js';

export type SpreadsheetDownloadFormat = 'xlsx' | 'csv';

type SpreadsheetDownload = (format: SpreadsheetDownloadFormat) => boolean;

/**
 * The editor toolbar's downloads, offered outside it (the file menu). The
 * mounted editor registers them; until it has, or while the sheet can't be
 * exported, asking says so instead of doing nothing.
 */
export function createSpreadsheetDownload() {
  const [registered, setRegistered] = createSignal<SpreadsheetDownload>();

  const download = (format: SpreadsheetDownloadFormat) => {
    if (registered()?.(format)) return;
    toast.failure(
      "The spreadsheet isn't ready to download yet. Try again in a moment."
    );
  };

  return {
    register: (run: SpreadsheetDownload) => setRegistered(() => run),
    clear: () => setRegistered(undefined),
    download,
  };
}
