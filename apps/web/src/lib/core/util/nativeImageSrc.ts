import { fireAndForget } from '@core/util/fireAndForget';
import { isImageProxyUrl } from '@core/util/imageProxy';
import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { Telemetry } from '@macro-inc/observability';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

type NativeImageSrcOptions = {
  /** Called when the image could not be fetched for the native app. */
  onError: () => void;
};

/**
 * The URL to put on an `<img>` for `src`.
 *
 * The image proxy authenticates by session cookie. In the native apps that
 * session lives in the native HTTP client's cookie jar, not the webview's, so
 * a plain `<img>` request to the proxy gets 401. There, a proxied image is
 * fetched through `platformFetch` and shown from a blob URL, revoked when
 * `src` changes or the owner is disposed. Everything else is returned as is.
 * While a native fetch is in flight the result is `''`.
 */
export function createNativeImageSrc(
  src: Accessor<string>,
  options: NativeImageSrcOptions
): Accessor<string> {
  const needsNativeFetch = (url: string) => isTauri() && isImageProxyUrl(url);
  const [blobUrl, setBlobUrl] = createSignal('');

  createEffect(
    on(src, (url) => {
      setBlobUrl('');
      if (!needsNativeFetch(url)) return;

      const controller = new AbortController();
      let created: string | undefined;
      onCleanup(() => {
        controller.abort();
        if (created) URL.revokeObjectURL(created);
      });

      fireAndForget(
        (async () => {
          const result = await fetchImageBlob(url, controller.signal);
          if (controller.signal.aborted) return;
          if (result.isErr()) {
            options.onError();
            return;
          }
          created = URL.createObjectURL(result.value);
          setBlobUrl(created);
        })(),
        'native-image-src'
      );
    })
  );

  return () => (needsNativeFetch(src()) ? blobUrl() : src());
}

type NativeImageError =
  | { kind: 'network' }
  | { kind: 'status'; status: number }
  | { kind: 'not-image' };

/** Fetches a proxied image with the native session, recording the outcome. */
function fetchImageBlob(
  url: string,
  signal: AbortSignal
): Promise<Result<Blob, NativeImageError>> {
  return Telemetry.span('markdown.native_image_fetch', async (span) => {
    const fail = (error: NativeImageError) => {
      span.setAttr('image.failure', error.kind);
      if (!signal.aborted)
        span.error(`native image fetch failed: ${error.kind}`);
      return err(error);
    };
    const response = await ResultAsync.fromPromise(
      platformFetch(url, { signal }),
      () => ({ kind: 'network' }) as const
    );
    if (response.isErr()) return fail(response.error);
    const { status, headers } = response.value;
    span.setAttr('http.status_code', status);
    if (!response.value.ok) return fail({ kind: 'status', status });
    if (!(headers.get('content-type') ?? '').startsWith('image/')) {
      return fail({ kind: 'not-image' });
    }
    const blob = await ResultAsync.fromPromise(
      response.value.blob(),
      () => ({ kind: 'network' }) as const
    );
    if (blob.isErr()) return fail(blob.error);
    span.setAttr('image.bytes', blob.value.size);
    return ok(blob.value);
  });
}
