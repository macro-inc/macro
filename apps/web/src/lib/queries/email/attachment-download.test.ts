import type { Span } from '@macro-inc/observability';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emailAttachmentDownloadSource } from './attachment-download';

const mocks = vi.hoisted(() => ({
  getDownloadUrl: vi.fn(),
  webviewFetch: vi.fn(),
  platformFetch: vi.fn(),
}));
vi.mock('./attachment', () => ({
  getEmailAttachmentDownloadUrl: mocks.getDownloadUrl,
}));
vi.mock('@core/util/platformFetch', () => ({
  webviewFetch: mocks.webviewFetch,
  platformFetch: mocks.platformFetch,
}));

const SIGNED_URL = 'https://d111111abcdef8.cloudfront.net/temp/a/b-report.pdf';
const span = { setAttr: vi.fn() } as unknown as Span;
const load = (
  attachment: Parameters<typeof emailAttachmentDownloadSource>[0]
) =>
  emailAttachmentDownloadSource(attachment).load({
    signal: new AbortController().signal,
    onProgress: () => {},
    span,
  });

beforeEach(() => {
  mocks.getDownloadUrl.mockResolvedValue(SIGNED_URL);
  mocks.webviewFetch.mockImplementation(
    async () =>
      new Response('%PDF-1.7', {
        status: 200,
        headers: { 'Content-Type': 'binary/octet-stream' },
      })
  );
});
afterEach(() => vi.clearAllMocks());

it('reads the signed URL with the webview fetch, never the native HTTP route', async () => {
  const result = await load({
    db_id: 'attachment',
    filename: 'Quarterly report.pdf',
    mime_type: 'application/pdf',
  });

  expect(mocks.getDownloadUrl).toHaveBeenCalledWith('attachment');
  expect(mocks.webviewFetch).toHaveBeenCalledWith(
    SIGNED_URL,
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(mocks.platformFetch).not.toHaveBeenCalled();
  const { blob, name } = result._unsafeUnwrap();
  expect(name).toBe('Quarterly report.pdf');
  expect(blob.type).toBe('application/pdf');
  expect(blob.size).toBe('%PDF-1.7'.length);
});

it('keeps the served type and names a file that has no name', async () => {
  const result = await load({ db_id: 'attachment' });

  const { blob, name } = result._unsafeUnwrap();
  expect(name).toBe('attachment');
  expect(blob.type).toBe('binary/octet-stream');
});

it('fails without fetching when no download URL is available', async () => {
  mocks.getDownloadUrl.mockRejectedValue(
    new Error('Attachment download is unavailable')
  );

  const result = await load({ db_id: 'attachment', filename: 'a.txt' });

  expect(result.isErr()).toBe(true);
  expect(mocks.webviewFetch).not.toHaveBeenCalled();
});

it('fails when the signed URL answers with an error', async () => {
  mocks.webviewFetch.mockResolvedValue(new Response('', { status: 403 }));

  const result = await load({ db_id: 'attachment', filename: 'a.txt' });

  expect(result.isErr()).toBe(true);
});
