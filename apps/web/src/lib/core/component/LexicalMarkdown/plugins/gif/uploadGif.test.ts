import { Blob as BufferBlob, File as BufferFile } from 'node:buffer';
import { createStaticUploadFile } from '@core/util/uploadFile';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Gif } from './klipy';
import { uploadGif } from './uploadGif';

vi.mock('@core/util/uploadFile', () => ({
  createStaticUploadFile: vi.fn(),
  createUploadFile: (file: File) => ({ file }),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (_name: string, operation: (span: unknown) => unknown) =>
      operation({
        setAttr: vi.fn(),
        error: vi.fn(),
        span: (_childName: string, child: () => unknown) => child(),
      }),
  },
}));

const gif: Gif = {
  id: 'gif-1',
  title: 'Animated GIF',
  previewUrl: 'https://media.example/preview.gif',
  url: 'https://media.example/animation.gif',
  width: 640,
  height: 480,
};

beforeEach(() => {
  vi.stubGlobal('File', BufferFile);
  vi.mocked(createStaticUploadFile).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(['GIF87a', 'GIF89a'])(
  'uploads original %s bytes to static storage',
  async (signature) => {
    // Two image descriptors keep this fixture animated rather than a static GIF.
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from(signature),
        Buffer.from(
          '01000100800000000000ffffff2c00000000010001000002024401002c00000000010001000002024401003b',
          'hex'
        ),
      ])
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () =>
          Promise.resolve(new BufferBlob([bytes], { type: 'image/gif' })),
      })
    );
    vi.mocked(createStaticUploadFile).mockResolvedValue('static-1');
    const controller = new AbortController();

    const result = await uploadGif(gif, controller.signal);
    expect(result._unsafeUnwrap()).toBe('static-1');

    expect(fetch).toHaveBeenCalledWith(gif.url, {
      signal: controller.signal,
      credentials: 'omit',
    });
    expect(createStaticUploadFile).toHaveBeenCalledOnce();
    const [source, signal] = vi.mocked(createStaticUploadFile).mock.calls[0];
    const file = source.file;
    expect(signal).toBe(controller.signal);
    expect(file.name).toBe('animation.gif');
    expect(file.type).toBe('image/gif');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  }
);

it('does not upload when the download returns an HTTP error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

  const result = await uploadGif(gif, new AbortController().signal);
  expect(result._unsafeUnwrapErr()).toEqual({ kind: 'failed' });
  expect(createStaticUploadFile).not.toHaveBeenCalled();
});

it('does not upload media without a GIF signature', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () =>
        Promise.resolve(
          new BufferBlob(['<html>not a gif</html>'], { type: 'image/gif' })
        ),
    })
  );

  const result = await uploadGif(gif, new AbortController().signal);
  expect(result._unsafeUnwrapErr()).toEqual({ kind: 'failed' });
  expect(createStaticUploadFile).not.toHaveBeenCalled();
});

it('propagates upload failure without returning a static file ID', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new BufferBlob(['GIF89a', '\0'])),
    })
  );
  const error = new Error('Static upload failed');
  vi.mocked(createStaticUploadFile).mockRejectedValue(error);

  const result = await uploadGif(gif, new AbortController().signal);
  expect(result._unsafeUnwrapErr()).toEqual({ kind: 'failed' });
  expect(createStaticUploadFile).toHaveBeenCalledOnce();
});

it('does not upload when cancelled during the download', async () => {
  const download = Promise.withResolvers<BufferBlob>();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () => download.promise,
    })
  );
  const controller = new AbortController();
  const result = uploadGif(gif, controller.signal);

  controller.abort();
  download.resolve(new BufferBlob(['GIF89a', '\0']));

  expect((await result)._unsafeUnwrapErr()).toEqual({ kind: 'cancelled' });
  expect(createStaticUploadFile).not.toHaveBeenCalled();
});
