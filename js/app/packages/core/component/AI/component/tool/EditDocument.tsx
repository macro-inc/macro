import { ItemPreview } from '@core/component/ItemPreview';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import { Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'EditDocument',
  render: (ctx) => (
    <BaseTool icon={PencilSimple} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        Edit{' '}
        <Suspense>
          <ItemPreview
            class="inline-flex align-middle ring-0"
            id={ctx.tool.data.document_id}
            type="document"
          />
        </Suspense>
      </div>
    </BaseTool>
  ),
});

export const editDocumentHandler = handler;
