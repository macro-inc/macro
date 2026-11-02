import { fetchWithToken } from '@core/util/fetchWithToken';
import { platformFetch } from '@core/util/platformFetch';
import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { createStaticUploadFile, createUploadFile } from './uploadFile';

vi.mock('@core/mobile/nativeStagedUpload', () => ({
  getNativeStagedUpload: () => undefined,
  uploadNativeStagedFileToPresignedUrl: vi.fn(),
}));
vi.mock('@queries/auth', () => ({ invalidateUserQuota: async () => {} }));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchWithToken).mockReset();
  vi.mocked(platformFetch).mockReset();
  vi.mocked(fetchWithToken).mockResolvedValue(
    ok({
      id: 'static-gif',
      upload_url: 'https://storage.example/put',
    })
  );
});

it('keeps the reservation readable and forwards cancellation to the PUT', async () => {
  vi.mocked(platformFetch).mockResolvedValue(
    new Response(null, { status: 200 })
  );
  const controller = new AbortController();
  const file = createUploadFile(
    new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
  );

  await expect(createStaticUploadFile(file, controller.signal)).resolves.toBe(
    'static-gif'
  );

  expect(fetchWithToken).toHaveBeenCalledOnce();
  expect(fetchWithToken).toHaveBeenCalledWith(
    expect.stringContaining('/api/file'),
    {
      method: 'PUT',
      body: JSON.stringify({
        file_name: 'animation.gif',
        content_type: 'image/gif',
      }),
    }
  );
  expect(platformFetch).toHaveBeenCalledWith('https://storage.example/put', {
    method: 'PUT',
    body: file.file,
    headers: { 'Content-Type': 'image/gif' },
    signal: controller.signal,
  });
});

it.each(['response', 'network'])(
  'deletes the reserved static file when a PUT fails with a %s error',
  async (failure) => {
    if (failure === 'response') {
      vi.mocked(platformFetch).mockResolvedValue(
        new Response(null, { status: 500 })
      );
    } else {
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Network unavailable')
      );
    }
    const file = createUploadFile(
      new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
    );

    await expect(createStaticUploadFile(file)).rejects.toThrow(
      failure === 'response' ? 'Failed to upload file' : 'Network unavailable'
    );
    expect(fetchWithToken).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/file/static-gif'),
      { method: 'DELETE' }
    );
  }
);

it('aborts an in-flight PUT and deletes its reserved static file', async () => {
  const started = Promise.withResolvers<void>();
  vi.mocked(platformFetch).mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true }
        );
        started.resolve();
      })
  );
  const controller = new AbortController();
  const file = createUploadFile(
    new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
  );
  const upload = createStaticUploadFile(file, controller.signal);
  await started.promise;
  controller.abort();

  await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchWithToken).toHaveBeenCalledTimes(2);
  expect(fetchWithToken).toHaveBeenLastCalledWith(
    expect.stringContaining('/api/file/static-gif'),
    { method: 'DELETE' }
  );
});

it('cleans up when cancellation races a successful PUT response', async () => {
  const controller = new AbortController();
  vi.mocked(platformFetch).mockImplementation(async () => {
    controller.abort();
    return new Response(null, { status: 200 });
  });
  const file = createUploadFile(
    new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
  );

  await expect(
    createStaticUploadFile(file, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchWithToken).toHaveBeenLastCalledWith(
    expect.stringContaining('/api/file/static-gif'),
    { method: 'DELETE' }
  );
});

it('does not reserve storage for an already cancelled upload', async () => {
  const controller = new AbortController();
  controller.abort();
  const file = createUploadFile(
    new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
  );

  await expect(
    createStaticUploadFile(file, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchWithToken).not.toHaveBeenCalled();
  expect(platformFetch).not.toHaveBeenCalled();
});

it('waits for a cancelled reservation and deletes it without uploading', async () => {
  const reservation =
    Promise.withResolvers<Awaited<ReturnType<typeof fetchWithToken>>>();
  vi.mocked(fetchWithToken).mockReturnValueOnce(reservation.promise);
  const controller = new AbortController();
  const file = createUploadFile(
    new File(['GIF89a'], 'animation.gif', { type: 'image/gif' })
  );
  const upload = createStaticUploadFile(file, controller.signal);
  controller.abort();
  reservation.resolve(
    ok({ id: 'static-gif', upload_url: 'https://storage.example/put' })
  );

  await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  expect(platformFetch).not.toHaveBeenCalled();
  expect(fetchWithToken).toHaveBeenLastCalledWith(
    expect.stringContaining('/api/file/static-gif'),
    { method: 'DELETE' }
  );
});
