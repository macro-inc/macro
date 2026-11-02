import { fireAndForget } from '@core/util/fireAndForget';
import LoadingSpinner from '@icon/system/regular/spinner.svg';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';

/**
 * Popup preview component for document references
 */
export function DocumentPreviewImage(props: {
  documentId: string;
  fileType?: string;
  class?: string;
}) {
  const query = useBinaryDocumentQuery(() => props.documentId);

  // Captured once at mount: true means the spinner was shown and we should fade in.
  // Reading .isLoading (not .data) avoids triggering Suspense here.
  const shouldFadeIn = query.isLoading;

  // SVGs served from presigned URLs may not carry the correct Content-Type header
  // (especially for older uploads), which causes <img> to show a broken image.
  // Fetching as a blob and creating an object URL with an explicit MIME type
  // bypasses this, matching the approach used by the full image viewer.
  const [svgObjectUrl, setSvgObjectUrl] = createSignal<string | undefined>();
  createEffect(() => {
    const presignedUrl = query.data;
    if (!presignedUrl || props.fileType !== 'svg') return;

    const controller = new AbortController();
    let objectUrl: string | undefined;
    fireAndForget(
      fetchBinary(presignedUrl, 'blob', { signal: controller.signal }).then(
        (result) => {
          if (controller.signal.aborted || result.isErr()) return;
          const blob = result.value;
          objectUrl = URL.createObjectURL(
            new Blob([blob], { type: 'image/svg+xml' })
          );
          setSvgObjectUrl(objectUrl);
        }
      ),
      'document-preview'
    );

    onCleanup(() => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSvgObjectUrl(undefined);
    });
  });

  const displayUrl = () =>
    props.fileType === 'svg' ? svgObjectUrl() : query.data;

  return (
    <div
      class={cn(
        'w-full overflow-hidden relative bg-edge-muted',
        props.class ?? 'h-32'
      )}
    >
      <Suspense
        fallback={
          <div class="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner class="size-5 animate-spin text-ink-muted" />
          </div>
        }
      >
        <Show when={displayUrl()}>
          {(url) => (
            <img
              src={url()}
              class={cn(
                'absolute inset-0 size-full object-cover',
                shouldFadeIn && 'opacity-0 transition-opacity duration-300'
              )}
              onLoad={
                shouldFadeIn
                  ? (e) => {
                      const img = e.target as HTMLImageElement;
                      requestAnimationFrame(() => {
                        img.style.opacity = '1';
                      });
                    }
                  : undefined
              }
              alt=""
            />
          )}
        </Show>
      </Suspense>
    </div>
  );
}
