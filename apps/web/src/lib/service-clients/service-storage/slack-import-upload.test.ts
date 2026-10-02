import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadGrant } from './generated/schemas/uploadGrant';
import { uploadSlackImport } from './slack-import-upload';

vi.mock('@core/util/platform', () => ({ isTauri: vi.fn(() => false) }));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));

class FakeXhr {
  static instances: FakeXhr[] = [];
  status = 0;
  withCredentials = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
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

  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

function grant(): UploadGrant {
  return {
    descriptor: {
      upload: { kind: 'users' },
      byteLength: 2,
      sha256:
        '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      recordCount: null,
    },
    url: 'https://staging.example/users.json?signed=secret',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    requiredHeaders: {
      'content-type': 'application/json',
      'if-none-match': '*',
      'x-amz-checksum-sha256': 'T1PNoYwrqgwDVLtfmj7L5e0Sq02OEbqHPC8RFhICuUU=',
    },
  };
}

function xhr(): FakeXhr {
  return FakeXhr.instances[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

describe('browser Slack import uploads', () => {
  it('sends exact signed headers and the original Blob, with actual byte progress', async () => {
    const permission = grant();
    const blob = new Blob(['[]'], { type: 'text/plain' });
    const onProgress = vi.fn();
    const pending = uploadSlackImport(permission, blob, { onProgress });
    expect(xhr().open).toHaveBeenCalledWith('PUT', permission.url);
    expect(xhr().withCredentials).toBe(false);
    expect(xhr().send).toHaveBeenCalledWith(blob);
    expect(xhr().setRequestHeader.mock.calls).toEqual(
      Object.entries(permission.requiredHeaders)
    );
    expect(onProgress).not.toHaveBeenCalled();
    xhr().upload.onprogress?.({ loaded: 1, total: 2, lengthComputable: true });
    expect(onProgress).toHaveBeenLastCalledWith({
      kind: 'bytes',
      loaded: 1,
      total: 2,
    });
    xhr().respond(200);
    expect((await pending)._unsafeUnwrap()).toBe('uploaded');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(xhr().upload.onprogress).toBeNull();
  });

  it('reports indeterminate progress when XHR cannot measure it', async () => {
    const onProgress = vi.fn();
    const pending = uploadSlackImport(grant(), new Blob(['[]']), {
      onProgress,
    });
    xhr().upload.onprogress?.({ loaded: 0, lengthComputable: false });
    expect(onProgress).toHaveBeenCalledWith({
      kind: 'indeterminate',
      total: 2,
    });
    xhr().respond(204);
    expect((await pending).isOk()).toBe(true);
  });

  it('returns 412 for completion verification without retrying or overwriting', async () => {
    const pending = uploadSlackImport(grant(), new Blob(['[]']));
    xhr().respond(412);
    expect((await pending)._unsafeUnwrap()).toBe('already-exists');
    expect(FakeXhr.instances).toHaveLength(1);
    expect(xhr().send).toHaveBeenCalledTimes(1);
    expect(xhr().setRequestHeader).toHaveBeenCalledWith('if-none-match', '*');
  });

  it.each([403, 409, 500])(
    'preserves HTTP failure status %i',
    async (status) => {
      const pending = uploadSlackImport(grant(), new Blob(['[]']));
      xhr().respond(status);
      expect((await pending)._unsafeUnwrapErr()).toEqual({
        code: 'HTTP_ERROR',
        status,
      });
    }
  );

  it.each(['onerror', 'ontimeout'] as const)(
    'handles %s without leaking the URL',
    async (event) => {
      const pending = uploadSlackImport(grant(), new Blob(['[]']));
      xhr()[event]?.();
      expect((await pending)._unsafeUnwrapErr()).toEqual({
        code: 'NETWORK_ERROR',
      });
    }
  );

  it('handles a synchronous transport failure', async () => {
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends FakeXhr {
        constructor() {
          super();
          this.send.mockImplementation(() => {
            throw new Error('Network unavailable');
          });
        }
      }
    );
    const result = await uploadSlackImport(grant(), new Blob(['[]']));
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'NETWORK_ERROR' });
    expect(xhr().onload).toBeNull();
  });

  it('treats status zero as network failure', async () => {
    const pending = uploadSlackImport(grant(), new Blob(['[]']));
    xhr().respond(0);
    expect((await pending)._unsafeUnwrapErr()).toEqual({
      code: 'NETWORK_ERROR',
    });
  });

  it('aborts an in-flight request and removes its signal listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = uploadSlackImport(grant(), new Blob(['[]']), {
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending)._unsafeUnwrapErr()).toEqual({ code: 'ABORTED' });
    expect(xhr().abort).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(xhr().onload).toBeNull();
  });

  it('does not abort a finished upload when the signal later aborts', async () => {
    const controller = new AbortController();
    const pending = uploadSlackImport(grant(), new Blob(['[]']), {
      signal: controller.signal,
    });
    xhr().respond(200);
    await pending;
    controller.abort();
    expect(xhr().abort).not.toHaveBeenCalled();
  });
});

describe.each([false, true])('upload preflight (Tauri: %s)', (native) => {
  beforeEach(() => vi.mocked(isTauri).mockReturnValue(native));
  afterEach(() => {
    expect(FakeXhr.instances).toHaveLength(0);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it('rejects mismatched byte length, including multibyte text', async () => {
    const result = await uploadSlackImport(grant(), new Blob(['éé']));
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'SIZE_MISMATCH' });
  });

  it('rejects expired grants before starting a PUT', async () => {
    const permission = { ...grant(), expiresAt: new Date(0).toISOString() };
    expect(
      (await uploadSlackImport(permission, new Blob(['[]'])))._unsafeUnwrapErr()
    ).toEqual({ code: 'EXPIRED' });
  });

  it('rejects malformed expiry', async () => {
    const permission = { ...grant(), expiresAt: 'invalid' };
    expect(
      (await uploadSlackImport(permission, new Blob(['[]'])))._unsafeUnwrapErr()
    ).toEqual({ code: 'INVALID_GRANT' });
  });

  it.each(['Content-Length', 'Host', 'Cookie', 'Origin', 'Sec-Fetch-Mode'])(
    'never sets forbidden header %s',
    async (header) => {
      const permission = grant();
      permission.requiredHeaders[header] = '2';
      expect(
        (
          await uploadSlackImport(permission, new Blob(['[]']))
        )._unsafeUnwrapErr()
      ).toEqual({ code: 'INVALID_GRANT' });
    }
  );

  it.each(['if-none-match', 'content-type', 'x-amz-checksum-sha256'])(
    'rejects grants missing %s',
    async (header) => {
      const permission = grant();
      delete permission.requiredHeaders[header];
      expect(
        (
          await uploadSlackImport(permission, new Blob(['[]']))
        )._unsafeUnwrapErr()
      ).toEqual({ code: 'INVALID_GRANT' });
    }
  );

  it('rejects malformed header values as invalid grants', async () => {
    const permission = grant();
    permission.requiredHeaders['content-type'] =
      'application/json\r\nInjected: value';
    const result = await uploadSlackImport(permission, new Blob(['[]']));
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'INVALID_GRANT' });
  });

  it('requires create-only rather than overwrite permission', async () => {
    const permission = grant();
    permission.requiredHeaders['if-none-match'] = 'other';
    const result = await uploadSlackImport(permission, new Blob(['[]']));
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'INVALID_GRANT' });
  });

  it('does not send an already-aborted upload', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await uploadSlackImport(grant(), new Blob(['[]']), {
      signal: controller.signal,
    });
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'ABORTED' });
  });
});

describe('Tauri Slack import uploads', () => {
  beforeEach(() => vi.mocked(isTauri).mockReturnValue(true));

  it.each([200, 412])(
    'uses platformFetch with indeterminate progress for status %i',
    async (status) => {
      vi.mocked(platformFetch).mockResolvedValue(
        new Response(null, { status })
      );
      const permission = grant();
      const body = new Blob(['[]']);
      const signal = new AbortController().signal;
      const onProgress = vi.fn();
      const result = await uploadSlackImport(permission, body, {
        signal,
        onProgress,
      });
      expect(result._unsafeUnwrap()).toBe(
        status === 412 ? 'already-exists' : 'uploaded'
      );
      expect(platformFetch).toHaveBeenCalledExactlyOnceWith(permission.url, {
        method: 'PUT',
        body,
        signal,
        headers: permission.requiredHeaders,
        credentials: 'omit',
        redirect: 'error',
      });
      expect(onProgress.mock.calls).toEqual([
        [{ kind: 'indeterminate', total: 2 }],
      ]);
      expect(FakeXhr.instances).toHaveLength(0);
    }
  );

  it('reports native network errors without logging signed URLs', async () => {
    vi.mocked(platformFetch).mockRejectedValue(new Error(grant().url));
    expect(
      (await uploadSlackImport(grant(), new Blob(['[]'])))._unsafeUnwrapErr()
    ).toEqual({ code: 'NETWORK_ERROR' });
  });

  it('releases native response bodies without reading or trusting them', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.mocked(platformFetch).mockResolvedValue(
      new Response(body, { status: 412 })
    );
    const result = await uploadSlackImport(grant(), new Blob(['[]']));
    expect(result._unsafeUnwrap()).toBe('already-exists');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('preserves native HTTP failures', async () => {
    vi.mocked(platformFetch).mockResolvedValue(
      new Response(null, { status: 403 })
    );
    expect(
      (await uploadSlackImport(grant(), new Blob(['[]'])))._unsafeUnwrapErr()
    ).toEqual({ code: 'HTTP_ERROR', status: 403 });
  });

  it('forwards abort to the native transport', async () => {
    const controller = new AbortController();
    vi.mocked(platformFetch).mockImplementation(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    const result = await uploadSlackImport(grant(), new Blob(['[]']), {
      signal: controller.signal,
    });
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'ABORTED' });
  });
});
