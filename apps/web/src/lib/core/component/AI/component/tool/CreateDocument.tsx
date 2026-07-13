import { ItemPreview } from '@core/component/ItemPreview';
import FilePlus from '@phosphor-icons/core/regular/file-plus.svg';
import { Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'CreateDocument',
  render: (ctx) => (
    <BaseTool icon={FilePlus} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        Create{' '}
        <span class="text-ink">
          {ctx.tool.data.documentName}.{ctx.tool.data.fileExtension}
        </span>
        <Show when={ctx.response}>
          {(response) => (
            <>
              {' '}
              <span class="text-ink-placeholder">·</span>{' '}
              <Suspense>
                <ItemPreview
                  class="inline-flex align-middle ring-0"
                  id={response().data.documentId}
                  type="document"
                />
              </Suspense>
            </>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});

export const createDocumentHandler = handler;
