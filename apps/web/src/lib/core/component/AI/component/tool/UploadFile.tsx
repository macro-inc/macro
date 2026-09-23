import { ItemPreview } from '@core/component/ItemPreview';
import FileArrowUp from '@phosphor-icons/core/regular/file-arrow-up.svg';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

export const uploadFileHandler = createToolRenderer({
  name: 'UploadFile',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    return (
      <BaseTool
        icon={FileArrowUp}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={isExpanded() && ctx.response?.data}>
            {(result) => (
              <div class="space-y-1">
                <Suspense fallback={<span>{result().fileName}</span>}>
                  <ItemPreview id={result().documentId} type="document" />
                </Suspense>
                <div>{result().sizeBytes.toLocaleString()} bytes uploaded</div>
                <div>Preview and indexing may still be processing.</div>
              </div>
            )}
          </Show>
        }
      >
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 break-all">
            Upload <span class="text-ink">{ctx.tool.data.fileName}</span>
          </span>
          <Show when={ctx.response}>
            <Tool.ResultToggle
              expanded={isExpanded()}
              onToggle={() => setIsExpanded((value) => !value)}
              status="Uploaded"
            />
          </Show>
        </div>
      </BaseTool>
    );
  },
});
