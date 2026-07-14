import { ItemPreview } from '@core/component/ItemPreview';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import { Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'RenameDocument',
  render: (ctx) => (
    <BaseTool icon={PencilSimple} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        Rename{' '}
        <Suspense>
          <ItemPreview
            class="inline-flex align-middle ring-0"
            id={ctx.tool.data.documentId}
            type="document"
          />
        </Suspense>{' '}
        to <span class="text-ink">{ctx.tool.data.documentName}</span>
      </div>
    </BaseTool>
  ),
});

export const renameDocumentHandler = handler;
