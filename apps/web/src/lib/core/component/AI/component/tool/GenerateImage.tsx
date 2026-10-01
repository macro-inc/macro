import {
  ImageDocumentCard,
  ImageDocumentCardHeader,
  ImageDocumentPreviewStatus,
} from '@core/component/ImageDocumentCard';
import { Show } from 'solid-js';
import { createToolRenderer, useToolError } from './ToolRenderer';

export const generateImageHandler = createToolRenderer({
  name: 'GenerateImage',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={ctx.response?.data}
        fallback={
          <div class="w-full max-w-md overflow-hidden rounded-xl border border-edge-muted">
            <ImageDocumentCardHeader
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
              <ImageDocumentPreviewStatus label="Generating image" />
            </Show>
          </div>
        }
      >
        {(result) => (
          <div class="my-2 max-w-md space-y-2">
            <ImageDocumentCard
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
