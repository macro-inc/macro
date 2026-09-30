import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import LoadingSpinner from '@phosphor/spinner.svg';
import Image from '@phosphor-icons/core/regular/image.svg';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { createSignal, Show, Suspense } from 'solid-js';
import { createToolRenderer, useToolError } from './ToolRenderer';

function ImageHeader(props: { fileName: string }) {
  return (
    <div class="flex w-0 min-w-full items-center gap-2 rounded-t-xl border-b border-edge-muted bg-surface px-3 py-2 text-sm text-ink">
      <Image class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 truncate" title={props.fileName}>
        {props.fileName}
      </span>
    </div>
  );
}

function PreviewStatus(props: { failed?: boolean; generating?: boolean }) {
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
          : props.generating
            ? 'Generating image'
            : 'Preparing preview'}
      </span>
    </div>
  );
}

/** Storage finishes the upload asynchronously; its query waits for a readable URL. */
function GeneratedImage(props: { documentId: string; fileName: string }) {
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
      <ImageHeader fileName={props.fileName} />
      <Suspense fallback={<PreviewStatus />}>
        <Show
          when={url() && !failed()}
          fallback={<PreviewStatus failed={failed()} />}
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

export const generateImageHandler = createToolRenderer({
  name: 'GenerateImage',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={ctx.response?.data}
        fallback={
          <div class="w-full max-w-md overflow-hidden rounded-xl border border-edge-muted">
            <ImageHeader
              fileName={ctx.tool.data.fileName ?? 'Generated image'}
            />
            <Show
              when={!error()}
              fallback={
                <div class="px-3 py-4 text-sm text-ink-muted">
                  Image generation failed
                </div>
              }
            >
              <PreviewStatus generating />
            </Show>
          </div>
        }
      >
        {(result) => (
          <div class="my-2 max-w-md space-y-2">
            <GeneratedImage
              documentId={result().documentId}
              fileName={result().fileName}
            />
            <Show when={result().note}>
              {(note) => (
                <div class="whitespace-pre-wrap text-sm text-ink-muted">
                  {note()}
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    );
  },
});
