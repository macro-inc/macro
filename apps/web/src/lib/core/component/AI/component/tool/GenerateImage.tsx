import { ItemPreview } from '@core/component/ItemPreview';
import LoadingSpinner from '@phosphor/spinner.svg';
import Image from '@phosphor-icons/core/regular/image.svg';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/**
 * The generated image itself. The upload is finalized by the storage pipeline
 * after the tool returns, so the presigned URL query waits for the document to
 * become ready before the image shows.
 */
function GeneratedImage(props: { documentId: string; alt: string }) {
  const query = useBinaryDocumentQuery(() => props.documentId);
  // Gate on status: an unguarded `data` read suspends the whole tool card.
  const url = () => (query.isSuccess ? query.data : undefined);

  return (
    <Show
      when={url()}
      fallback={
        <div class="flex h-32 items-center justify-center gap-2 rounded-lg border border-edge-muted bg-edge-muted text-ink-muted">
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
        <img
          src={src()}
          alt={props.alt}
          class="max-h-80 max-w-full rounded-lg border border-edge-muted object-contain"
        />
      )}
    </Show>
  );
}

export const generateImageHandler = createToolRenderer({
  name: 'GenerateImage',
  render: (ctx) => {
    // The image is the point of the call, so the result opens expanded.
    const [isExpanded, setIsExpanded] = createSignal(true);
    return (
      <BaseTool
        icon={Image}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={isExpanded() && ctx.response?.data}>
            {(result) => (
              <div class="space-y-2">
                <GeneratedImage
                  documentId={result().documentId}
                  alt={ctx.tool.data.prompt}
                />
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Suspense fallback={<span>{result().fileName}</span>}>
                    <ItemPreview
                      class="inline-flex align-middle ring-0"
                      id={result().documentId}
                      type="document"
                    />
                  </Suspense>
                  <span class="text-ink-placeholder">·</span>
                  <span>
                    {result().mimeType}, {result().sizeBytes.toLocaleString()}{' '}
                    bytes
                  </span>
                </div>
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
            Generate image{' '}
            <span class="text-ink">{ctx.tool.data.fileName}</span>
            <Show when={ctx.tool.data.aspectRatio}>
              {(ratio) => (
                <span class="text-ink-placeholder"> · {ratio()}</span>
              )}
            </Show>
          </span>
          <Show when={ctx.response}>
            <Tool.ResultToggle
              expanded={isExpanded()}
              onToggle={() => setIsExpanded((value) => !value)}
              status="Generated"
            />
          </Show>
        </div>
      </BaseTool>
    );
  },
});
