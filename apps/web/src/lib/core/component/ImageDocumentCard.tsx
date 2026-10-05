import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import LoadingSpinner from '@phosphor/spinner.svg';
import Image from '@phosphor-icons/core/regular/image.svg';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { createSignal, Show, Suspense } from 'solid-js';

export function ImageDocumentCardHeader(props: { fileName: string }) {
  return (
    <div class="flex w-0 min-w-full items-center gap-2 rounded-t-xl border-b border-edge-muted bg-surface px-3 py-2 text-sm text-ink">
      <Image class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 truncate" title={props.fileName}>
        {props.fileName}
      </span>
    </div>
  );
}

export function ImageDocumentPreviewStatus(props: {
  failed?: boolean;
  /** Replaces the default pending label. */
  label?: string;
}) {
  return (
    <div
      class="flex h-64 items-center justify-center gap-2 bg-surface text-sm text-ink-muted"
      role="status"
    >
      <Show when={!props.failed}>
        <LoadingSpinner class="size-4 animate-spin" />
      </Show>
      <span>
        {props.failed
          ? 'Preview unavailable'
          : (props.label ?? 'Preparing preview')}
      </span>
    </div>
  );
}

/**
 * A stored image document as a file card with its preview: the filename
 * header above the image, opening the image block on click.
 *
 * Storage finishes uploads asynchronously; the binary query waits for a
 * readable URL, so the card shows a pending status until then.
 */
export function ImageDocumentCard(props: {
  documentId: string;
  fileName: string;
}) {
  const query = useBinaryDocumentQuery(() => props.documentId);
  // A pending query must not suspend the surrounding transcript.
  const url = () => (query.isSuccess ? query.data : undefined);
  const [failedUrl, setFailedUrl] = createSignal<string>();
  const failed = () =>
    query.isError || (url() !== undefined && failedUrl() === url());
  const { insertSplit, replaceOrInsertSplit } = useSplitLayout();
  const open = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    const split = { type: 'image' as const, id: props.documentId };
    const handle = openInNewSplitForMention(event.shiftKey, true)
      ? insertSplit(split)
      : replaceOrInsertSplit(split);
    handle?.activate();
  });

  return (
    <button
      type="button"
      aria-label={`Open ${props.fileName} in a new split`}
      class="block w-fit max-w-full overflow-hidden rounded-xl border border-edge-muted text-left hover:border-accent hover-transition-border focus-visible:outline-2 focus-visible:outline-accent"
      {...open}
    >
      <ImageDocumentCardHeader fileName={props.fileName} />
      <Suspense fallback={<ImageDocumentPreviewStatus />}>
        <Show
          when={url() && !failed()}
          fallback={<ImageDocumentPreviewStatus failed={failed()} />}
        >
          <img
            src={url()}
            alt={props.fileName}
            class="block h-auto max-h-96 w-auto max-w-full"
            onError={() => setFailedUrl(url())}
          />
        </Show>
      </Suspense>
    </button>
  );
}
