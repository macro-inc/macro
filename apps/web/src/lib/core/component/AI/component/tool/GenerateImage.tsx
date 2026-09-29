import { useSplitLayout } from '@components/app/split-layout/layout';
import { ItemPreview } from '@core/component/ItemPreview';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import LoadingSpinner from '@phosphor/spinner.svg';
import Image from '@phosphor-icons/core/regular/image.svg';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/**
 * A thumbnail of the generated image that opens the document. The upload is
 * finalized by the storage pipeline after the tool returns, so the presigned
 * URL query waits for the document to become ready before the image shows.
 * Kept short: agent transcripts show tool results in a bounded window.
 */
function GeneratedImage(props: { documentId: string; alt: string }) {
  const query = useBinaryDocumentQuery(() => props.documentId);
  // Gate on status: an unguarded `data` read suspends the whole tool card.
  const url = () => (query.isSuccess ? query.data : undefined);
  const { replaceOrInsertSplit, insertSplit } = useSplitLayout();
  const open = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    const split = { type: 'image' as const, id: props.documentId };
    const handle = openInNewSplitForMention(event.shiftKey, true)
      ? insertSplit(split)
      : replaceOrInsertSplit(split);
    handle?.activate();
  });

  return (
    <Show
      when={url()}
      fallback={
        <div class="flex h-24 w-40 items-center justify-center gap-2 rounded-lg border border-edge-muted bg-edge-muted text-ink-muted">
          <Show
            when={!query.isError}
            fallback={<span>Preview unavailable</span>}
          >
            <LoadingSpinner class="size-4 animate-spin" />
            <span>Preparing preview</span>
          </Show>
        </div>
      }
    >
      {(src) => (
        <button
          type="button"
          class="block rounded-lg border border-edge-muted hover:border-accent hover-transition-border"
          aria-label={`Open ${props.alt}`}
          {...open}
        >
          <img
            src={src()}
            alt={props.alt}
            class="max-h-24 max-w-full rounded-lg object-contain"
          />
        </button>
      )}
    </Show>
  );
}

export const generateImageHandler = createToolRenderer({
  name: 'GenerateImage',
  render: (ctx) => {
    // The image is the point of the call, so the result opens expanded.
    const [isExpanded, setIsExpanded] = createSignal(true);
    const label = () =>
      ctx.response?.data.fileName ??
      ctx.tool.data.fileName ??
      ctx.tool.data.prompt;
    return (
      <BaseTool
        icon={Image}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={isExpanded() && ctx.response?.data}>
            {(result) => (
              <div class="space-y-1">
                <GeneratedImage
                  documentId={result().documentId}
                  alt={result().fileName}
                />
                <Show when={result().note}>
                  {(note) => <div class="whitespace-pre-wrap">{note()}</div>}
                </Show>
              </div>
            )}
          </Show>
        }
      >
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate">
            Generate image <span class="text-ink">{label()}</span>
            <Show when={ctx.tool.data.aspectRatio}>
              {(ratio) => (
                <span class="text-ink-placeholder"> · {ratio()}</span>
              )}
            </Show>
            <Show when={ctx.response?.data}>
              {(result) => (
                <>
                  {' '}
                  <span class="text-ink-placeholder">·</span>{' '}
                  <Suspense>
                    <ItemPreview
                      class="inline-flex align-middle ring-0"
                      id={result().documentId}
                      type="document"
                    />
                  </Suspense>
                </>
              )}
            </Show>
          </span>
          <Show when={ctx.response?.data}>
            {(result) => (
              <Tool.ResultToggle
                expanded={isExpanded()}
                onToggle={() => setIsExpanded((value) => !value)}
                status={`Generated · ${formatBytes(result().sizeBytes)}`}
              />
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
