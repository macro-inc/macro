import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { Telemetry } from '@macro-inc/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadToPresignedUrl } from './uploadToPresignedUrl';

vi.mock('@core/util/platform', () => ({ isTauri: vi.fn(() => false) }));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({ Telemetry: { warn: vi.fn() } }));

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

describe('uploadToPresignedUrl when S3 rejects the upload', () => {
  const presignedUrl = `https://macro-email-attachments-dev.s3.us-east-1.amazonaws.com/draft/01a16ebf/0acf54cf?${new URLSearchParams(
    {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential':
        'ASIAEXAMPLEKEYID1234/20261024/us-east-1/s3/aws4_request',
      'X-Amz-Date': '20261024T162943Z',
      'X-Amz-Expires': '120',
      'X-Amz-Security-Token': 'session-token-secret',
      'X-Amz-Signature': 'signature-secret',
      'X-Amz-SignedHeaders': 'content-type;host;x-amz-checksum-sha256',
      'x-id': 'PutObject',
    }
  )}`;
  const s3Message =
    'User: arn:aws:sts::569036502058:assumed-role/email-service-role-2-dev/05c4b09c72544171a6d8cb73f1f8fdfe is not authorized to perform: s3:PutObject on resource: "arn:aws:s3:::macro-email-attachments-dev/draft/01a16ebf/0acf54cf" because no VPC endpoint policy allows the s3:PutObject action';
  const accessDenied = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>${s3Message}</Message><RequestId>9T8VG69R5KVNCQFK</RequestId><HostId>eogGpUstWUuZTwAMK8B2b2AqUTtW8f</HostId></Error>`;
  const signatureMismatch = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided. Check your key and signing method.</Message><AWSAccessKeyId>ASIAEXAMPLEKEYID1234</AWSAccessKeyId><StringToSign>AWS4-HMAC-SHA256\n20261024T162943Z</StringToSign><SignatureProvided>signature-secret</SignatureProvided><CanonicalRequest>PUT\n/draft/01a16ebf/0acf54cf\nX-Amz-Security-Token=session-token-secret</CanonicalRequest><RequestId>5659KZAZESK3P7X3</RequestId><HostId>4YO3CdvNnyscQZp</HostId></Error>`;

  const transports = {
    fetch: (body: string) => {
      vi.mocked(platformFetch).mockResolvedValue(
        new Response(body, { status: 403 })
      );
      return uploadToPresignedUrl({ ...params(), presignedUrl });
    },
    xhr: (body: string) => {
      const pending = uploadToPresignedUrl({
        ...params(),
        presignedUrl,
        onProgress: vi.fn(),
      });
      xhr().respond(403, body);
      return pending;
    },
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T16:29:53Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each(Object.entries(transports))(
    'returns readable copy and logs the S3 error over %s',
    async (_, upload) => {
      const result = await upload(accessDenied);

      expect(result._unsafeUnwrapErr()).toEqual([
        { code: 'SERVER_ERROR', message: 'Upload failed' },
      ]);
      expect(Telemetry.warn).toHaveBeenCalledExactlyOnceWith(
        'storage_upload.rejected',
        {
          'storage_upload.status': 403,
          'storage_upload.s3_code': 'AccessDenied',
          'storage_upload.s3_message': s3Message,
          'storage_upload.s3_request_id': '9T8VG69R5KVNCQFK',
          'storage_upload.url_age_seconds': 10,
          'storage_upload.url_expires_seconds': 120,
          'storage_upload.credential_prefix': 'ASIA',
        }
      );
    }
  );

  it.each(Object.entries(transports))(
    'keeps the signature, token, and access key out of the error and the log over %s',
    async (_, upload) => {
      const result = await upload(signatureMismatch);

      expect(Telemetry.warn).toHaveBeenCalledWith(
        'storage_upload.rejected',
        expect.objectContaining({
          'storage_upload.s3_code': 'SignatureDoesNotMatch',
        })
      );
      const observed = JSON.stringify([
        result._unsafeUnwrapErr(),
        vi.mocked(Telemetry.warn).mock.calls,
      ]);
      for (const secret of [
        'signature-secret',
        'session-token-secret',
        'ASIAEXAMPLEKEYID1234',
      ])
        expect(observed).not.toContain(secret);
    }
  );
});
