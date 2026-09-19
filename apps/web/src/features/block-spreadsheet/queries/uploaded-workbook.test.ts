import { Blob } from 'node:buffer';
import { platformFetch } from '@core/util/platformFetch';
import { getPresignedUrl } from '@service-storage/util/presignedUrl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadedWorkbookQuery } from './uploaded-workbook';

vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));
vi.mock('@service-storage/util/presignedUrl', () => ({
  getPresignedUrl: vi.fn(async () => 'https://storage.example/workbook'),
}));
const excel = vi.fn(async () => ({ sheets: [], warnings: [] }));
const query = (fileType = 'xlsx', version = 1) =>
  uploadedWorkbookQuery({ id: 'document', version, fileType }, excel);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Blob', Blob);
});
afterEach(() => vi.unstubAllGlobals());

describe('uploaded workbook retrieval', () => {
  it('uses immutable document versions and decodes Excel with the cancellation signal', async () => {
    const signal = new AbortController().signal;
    vi.mocked(platformFetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]))
    );
    await query().queryFn({ signal });
    expect(getPresignedUrl).toHaveBeenCalledWith({
      documentId: 'document',
      versionId: 1,
    });
    expect(excel).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), signal);
    expect(query().queryKey).not.toEqual(query('xlsx', 2).queryKey);
    expect(query().queryKey).not.toEqual(query('csv').queryKey);
  });
  it('opens CSV text as safe typed cells, without invoking the Excel worker', async () => {
    vi.mocked(platformFetch).mockResolvedValueOnce(
      new Response('ID,Amount\r\n00123,12.5')
    );
    const result = await query('CSV').queryFn({
      signal: new AbortController().signal,
    });
    expect(result.sheets[0].cells.A2.value).toBe("'00123");
    expect(result.sheets[0].cells.B2.value).toBe('12.5');
    expect(excel).not.toHaveBeenCalled();
  });
  it.each([
    ['xlsx', 5 * 1024 * 1024 + 1],
    ['csv', 1_000_001],
  ] as const)(
    'rejects declared oversize %s before buffering the response',
    async (type, size) => {
      const cancel = vi.fn();
      const stream = new ReadableStream({ cancel });
      vi.mocked(platformFetch).mockResolvedValueOnce(
        new Response(stream, { headers: { 'Content-Length': String(size) } })
      );
      await expect(
        query(type).queryFn({ signal: new AbortController().signal })
      ).rejects.toThrow(/limit/);
      expect(cancel).toHaveBeenCalledOnce();
      expect(excel).not.toHaveBeenCalled();
    }
  );
  it('cancels a chunked oversized response, even when Content-Length is absent', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(700_000));
      },
      cancel,
    });
    vi.mocked(platformFetch).mockResolvedValueOnce(new Response(stream));
    await expect(
      query('csv').queryFn({ signal: new AbortController().signal })
    ).rejects.toThrow(/limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not download an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      query().queryFn({ signal: controller.signal })
    ).rejects.toThrow();
    expect(platformFetch).not.toHaveBeenCalled();
  });
  it('reports missing files and decoder failures without creating a document', async () => {
    vi.mocked(platformFetch).mockResolvedValueOnce(
      new Response('', { status: 404 })
    );
    await expect(
      query().queryFn({ signal: new AbortController().signal })
    ).rejects.toThrow(/not found/i);
    vi.mocked(platformFetch).mockResolvedValueOnce(new Response('bad archive'));
    excel.mockRejectedValueOnce(new Error('Invalid Excel workbook'));
    await expect(
      query().queryFn({ signal: new AbortController().signal })
    ).rejects.toThrow('Invalid Excel workbook');
  });
});
