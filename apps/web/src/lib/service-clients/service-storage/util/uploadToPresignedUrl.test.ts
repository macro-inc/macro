import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadToPresignedUrl } from './uploadToPresignedUrl';

vi.mock('@core/util/platform', () => ({ isTauri: vi.fn(() => false) }));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));

class FakeXhr {
  static instances: FakeXhr[] = [];
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload = {
    onprogress: null as ((event: Partial<ProgressEvent>) => void) | null,
  };
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());

  constructor() {
    FakeXhr.instances.push(this);
  }

  respond(status: number, responseText = ''): void {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
}

const xhr = () => FakeXhr.instances[0];
const params = () => ({
  presignedUrl: 'https://bucket.example/doc?signed',
  buffer: new Uint8Array([1, 2, 3, 4]),
  sha: 'ab'.repeat(32),
  type: 'application/pdf',
});

beforeEach(() => {
  vi.resetAllMocks();
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

describe('uploadToPresignedUrl with progress', () => {
  it('PUTs the signed request over XHR and reports bytes sent', async () => {
    const onProgress = vi.fn();
    const pending = uploadToPresignedUrl({ ...params(), onProgress });

    expect(xhr().open).toHaveBeenCalledWith(
      'PUT',
      'https://bucket.example/doc?signed'
    );
    expect(xhr().setRequestHeader.mock.calls).toEqual([
      ['Content-Type', 'application/pdf'],
      [
        'x-amz-checksum-sha256',
        btoa(String.fromCharCode(...new Uint8Array(32).fill(171))),
      ],
    ]);
    expect(onProgress).toHaveBeenLastCalledWith(0);

    xhr().upload.onprogress?.({ loaded: 2 });
    expect(onProgress).toHaveBeenLastCalledWith(2);

    xhr().respond(200);
    expect((await pending).isOk()).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(4);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it('returns the response body as a server error', async () => {
    const pending = uploadToPresignedUrl({ ...params(), onProgress: vi.fn() });
    xhr().respond(403, 'SignatureDoesNotMatch');
    expect((await pending)._unsafeUnwrapErr()).toEqual([
      { code: 'SERVER_ERROR', message: 'SignatureDoesNotMatch' },
    ]);
  });

  it('rejects on network failure, like fetch', async () => {
    const pending = uploadToPresignedUrl({ ...params(), onProgress: vi.fn() });
    xhr().onerror?.();
    await expect(pending).rejects.toThrow(TypeError);
  });

  it('aborts with the signal and removes its listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = uploadToPresignedUrl({
      ...params(),
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(xhr().abort).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('uses the native transport in Tauri and reports progress as unmeasurable', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(platformFetch).mockResolvedValue(new Response(null));
    const onProgress = vi.fn();

    const result = await uploadToPresignedUrl({ ...params(), onProgress });

    expect(result.isOk()).toBe(true);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(null);
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it('keeps using fetch when no progress is requested', async () => {
    vi.mocked(platformFetch).mockResolvedValue(new Response(null));

    expect((await uploadToPresignedUrl(params())).isOk()).toBe(true);
    expect(platformFetch).toHaveBeenCalledOnce();
    expect(FakeXhr.instances).toHaveLength(0);
  });
});
