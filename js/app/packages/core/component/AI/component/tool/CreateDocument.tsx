import { ItemPreview } from '@core/component/ItemPreview';
import FilePlus from '@phosphor-icons/core/regular/file-plus.svg';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'CreateDocument',
  render: (ctx) => (
    <BaseTool icon={FilePlus} renderContext={ctx.renderContext} type="call">
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div class="min-w-0">
          Create{' '}
          <span class="text-accent">
            {ctx.tool.data.documentName}.{ctx.tool.data.fileExtension}
          </span>
        </div>
        <Show when={ctx.response}>
          {(response) => (
            <div class="shrink-0">
              <ItemPreview id={response().data.documentId} type="document" />
            </div>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});

export const createDocumentHandler = handler;
