import { ThrownResultError } from '@core/util/result';
import { queryClient } from '@queries/client';
import { downloadExportedDocument } from '@service-storage/util/downloadExportedDocument';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchOriginalDocx } from './docx-document';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/util/downloadExportedDocument', () => ({
  downloadExportedDocument: vi.fn(),
}));
vi.mock('@service-sync/client', () => ({ syncServiceClient: {} }));
vi.mock('@service-sync/source', () => ({ createSyncServiceSource: vi.fn() }));
vi.mock('../core/docx-seed', () => ({ buildSeedSnapshot: vi.fn() }));

const download = vi.mocked(downloadExportedDocument);
beforeEach(() => {
  vi.useFakeTimers();
  download.mockReset();
});
afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

it('keeps an early open pending until extraction finishes and shares the download', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  download
    .mockRejectedValueOnce(
      new ThrownResultError([{ code: 'CONFLICT', message: 'processing' }])
    )
    .mockResolvedValueOnce(bytes);
  const completed = vi.fn();
  const first = fetchOriginalDocx('upload').then(completed);
  const second = fetchOriginalDocx('upload');
  await vi.advanceTimersByTimeAsync(999);
  expect(completed).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  await first;
  expect(await second).toEqual(bytes);
  expect(completed).toHaveBeenCalledWith(bytes);
  expect(download).toHaveBeenCalledTimes(2);
});

it('stops waiting after the processing deadline and allows a later reopen', async () => {
  download.mockRejectedValue(
    new ThrownResultError([{ code: 'CONFLICT', message: 'processing' }])
  );
  const first = fetchOriginalDocx('upload');
  const rejected = expect(first).rejects.toBeInstanceOf(ThrownResultError);
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;

  const bytes = new Uint8Array([80, 75, 3, 4]);
  download.mockResolvedValue(bytes);
  expect(await fetchOriginalDocx('upload')).toEqual(bytes);
});

it('does not retry a failed export that is not a processing response', async () => {
  download.mockRejectedValue(new Error('Unable to export the document.'));
  await expect(fetchOriginalDocx('upload')).rejects.toThrow(
    'Unable to export the document.'
  );
  expect(download).toHaveBeenCalledOnce();
});
